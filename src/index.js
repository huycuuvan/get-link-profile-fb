require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { getFacebookProfileLink } = require('./scraper');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'antigravity_secret_token';
const CACHE_PATH = path.join(__dirname, '../cookies/scraped_links.json');

const queue = [];
let isProcessing = false;

// Tải bộ nhớ tạm (Cache)
async function loadCache() {
    try {
        const data = await fs.readFile(CACHE_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

// Lưu bộ nhớ tạm
async function saveToCache(psid, data) {
    const cache = await loadCache();
    cache[psid] = {
        profileLink: data.profileLink,
        customerName: data.customerName,
        timestamp: Date.now()
    };
    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
}

// HÀM LƯU VÀO GOOGLE SHEETS
async function saveToGoogleSheets(data) {
    const { SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) return;

    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];

        // Kiểm tra và cập nhật tiêu đề
        try {
            await sheet.loadHeaderRow();
            const headers = sheet.headerValues;
            if (!headers.includes('MID')) {
                headers.push('MID');
                await sheet.setHeaderRow(headers);
            }
        } catch (e) {
            await sheet.setHeaderRow(['Thời gian', 'Tên khách hàng', 'Link Facebook', 'Nội dung tin nhắn', 'PSID', 'Page ID', 'MID']);
        }

        await sheet.addRow({
            'Thời gian': new Date().toLocaleString('vi-VN'),
            'Tên khách hàng': data.customerName,
            'Link Facebook': data.profileLink,
            'Nội dung tin nhắn': data.text,
            'PSID': data.psid,
            'Page ID': data.pageId,
            'MID': data.messageId
        });
        console.log(`[Sheets] ✅ Đã lưu: ${data.customerName}`);
    } catch (error) {
        console.error('[Sheets] ❌ Lỗi:', error.message);
    }
}

// LẤY TÊN QUA MESSAGE ID
async function getCustomerNameFromAPI(psid, mid, page_token) {
    const token = page_token || process.env.PAGE_ACCESS_TOKEN;
    try {
        if (mid) {
            const response = await axios.get(`https://graph.facebook.com/v18.0/${mid}`, {
                params: { fields: 'from', access_token: token }
            });
            if (response.data?.from?.name) return response.data.from.name;
        }
        const res2 = await axios.get(`https://graph.facebook.com/${psid}`, {
            params: { fields: 'name', access_token: token }
        });
        return res2.data.name || 'Người dùng Facebook';
    } catch (e) {
        return 'Người dùng Facebook';
    }
}

// XỬ LÝ HÀNG CHỜ (Có deduplication)
async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;

    const { req, res, isDirectApi } = queue.shift();
    const { psid, mid, text, page_id, page_token } = req.body;

    console.log(`\n--- TIN NHẮN MỚI: [${psid}] ${text} ---`);

    try {
        const cache = await loadCache();

        let resultData = {
            psid,
            messageId: mid,
            text,
            pageId: page_id,
            time: new Date().toISOString()
        };

        if (cache[psid]) {
            console.log(`[Cache] ⚡ Khách quen: ${cache[psid].customerName}. Bỏ qua lưu Sheets để tránh trùng lặp.`);
            resultData.customerName = cache[psid].customerName;
            resultData.profileLink = cache[psid].profileLink;

            // Nếu bạn vẫn muốn phản hồi API nhưng không lưu Sheets:
            if (isDirectApi && res) res.json({ success: true, data: resultData, message: 'Already cached' });
            return; // DỪNG TẠI ĐÂY, KHÔNG LƯU SHEETS NỮA
        } else {
            const customerName = await getCustomerNameFromAPI(psid, mid, page_token);
            const scraped = await getFacebookProfileLink(customerName, text, page_id);

            if (scraped?.profileLink) {
                resultData.customerName = (customerName !== 'Người dùng Facebook') ? customerName : (scraped.realName || customerName);
                resultData.profileLink = scraped.profileLink;
                // Lưu vào cache để lần sau không quét và không lưu Sheets lặp lại
                await saveToCache(psid, resultData);

                // Lưu vào Sheets (Lần đầu tiên)
                await saveToGoogleSheets(resultData);
                if (isDirectApi && res) res.json({ success: true, data: resultData });
            }
        }
    } catch (e) {
        console.error('[Lỗi Hàng Chờ]:', e.message);
    } finally {
        isProcessing = false;
        processQueue();
    }
}

app.post('/webhook', (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            entry.messaging?.forEach(event => {
                if (event.message?.text) {
                    queue.push({
                        req: { body: { psid: event.sender.id, mid: event.message.mid, text: event.message.text, page_id: entry.id } },
                        res: null,
                        isDirectApi: false
                    });
                    processQueue();
                }
            });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

app.post('/scrape-fb-link', (req, res) => {
    queue.push({ req, res, isDirectApi: true });
    processQueue();
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(PORT, () => console.log(`🚀 Server chạy tại port ${PORT}`));
