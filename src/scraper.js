require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

const COOKIES_PATH = path.join(__dirname, '../cookies/fb_cookies.json');

async function saveCookies(page) {
    const cookies = await page.cookies();
    await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function loadCookies(page) {
    try {
        const cookiesString = await fs.readFile(COOKIES_PATH);
        const cookies = JSON.parse(cookiesString);
        await page.setCookie(...cookies);
        return true;
    } catch (error) {
        return false;
    }
}

async function getFacebookProfileLink(customerName, messageText, pageId) {
    console.log(`--- KHỞI CHẠY ROBOT (Target: ${customerName}) ---`);
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--start-maximized'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await loadCookies(page);

        const inboxUrl = pageId
            ? `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}`
            : 'https://business.facebook.com/latest/inbox/all';

        console.log(`Mở Inbox: ${inboxUrl}`);
        await page.goto(inboxUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Chờ danh sách tin nhắn hiện lên
        await new Promise(resolve => setTimeout(resolve, 8000));

        // 1. Kiểm tra Login
        if (page.url().includes('login')) {
            console.log('CẦN ĐĂNG NHẬP THỦ CÔNG...');
            await page.waitForResponse(response => response.url().includes('/latest/inbox/all'), { timeout: 0 });
            await saveCookies(page);
        }

        const isGeneric = customerName.includes('Người dùng Facebook');
        const searchSelector = 'input[placeholder*="Tìm"], input[placeholder*="Search"]';

        // 2. SEARCH (Chỉ search nếu có tên thật)
        if (!isGeneric && customerName) {
            console.log(`Đang search tên: ${customerName}`);
            try {
                await page.waitForSelector(searchSelector, { timeout: 5000 });
                await page.click(searchSelector);
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.type(searchSelector, customerName);
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 8000));
            } catch (e) {
                console.log('Không thấy ô search, tìm trực tiếp...');
            }
        } else {
            console.log('Bỏ qua search vì không có tên thật.');
        }

        // 3. CHỌN KHÁCH (Quyết liệt)
        let clickResult = await page.evaluate((name, text, isGeneric) => {
            function getItems() {
                // Selector cực rộng, quét mọi thứ ở cột bên trái
                const broadSelectors = [
                    '[role="listitem"]',
                    '[data-testid="inbox_thread_list_item"]',
                    'div[aria-label*="Conversation"]',
                    'div[aria-label*="Cuộc trò chuyện"]',
                    'div[role="button"]',
                    'div[class*="thread"]',
                    'div[style*="72px"]'
                ];

                let all = [];
                broadSelectors.forEach(s => all = all.concat(Array.from(document.querySelectorAll(s))));

                return [...new Set(all)].filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.left < 600 && rect.width > 50 && rect.height > 20;
                });
            }

            let items = getItems();
            if (items.length === 0) return { success: false, reason: 'KHÔNG THẤY DANH SÁCH' };

            // Tìm đối tượng khớp nhất
            let target = items.find(el => {
                const c = el.innerText.toLowerCase();
                return (name && c.includes(name.toLowerCase())) || (text && c.includes(text.toLowerCase()));
            });

            // Fallback: Nếu search đang mở mà không thấy match, bấm đại vào dòng đầu tiên (thường là kết quả search)
            if (!target && items.length > 0) target = items[0];

            if (target) {
                target.scrollIntoView();
                target.click();
                return { success: true };
            }
            return { success: false };
        }, customerName, messageText, isGeneric);

        if (!clickResult.success) {
            console.log('==> THẤT BẠI: Robot không thấy danh sách để click. Đang chụp ảnh debug...');
            await page.screenshot({ path: 'debug_no_list.png' });
            return null;
        }

        // 4. TRÍCH XUẤT TÊN VÀ LINK (Sidebar)
        console.log('Đang đọc tên và link từ Sidebar...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        const result = await page.evaluate(() => {
            // 4a. Đọc tên thật từ tiêu đề chat hoặc sidebar
            const headerSelectors = ['h1', 'h2', 'span[role="heading"]', 'a[href*="facebook.com/"]'];
            let foundName = "Người dùng Facebook";

            // Ưu tiên tìm trong sidebar (complementary area)
            const sidebar = document.querySelector('div[role="complementary"]') || document.body;
            for (const sel of headerSelectors) {
                const el = sidebar.querySelector(sel);
                if (el && el.innerText.length > 2 && !el.innerText.includes('Trang cá nhân')) {
                    foundName = el.innerText.split('\n')[0].trim();
                    break;
                }
            }

            // 4b. Tìm link profile
            const links = Array.from(sidebar.querySelectorAll('a'));
            const fbLinks = links.filter(a => {
                const href = a.href.toLowerCase();
                return href.includes('facebook.com/') &&
                    !href.includes('business.facebook.com') &&
                    !href.includes('/pages/') &&
                    !href.includes('/help/') &&
                    (href.match(/\d{10,}/) || a.innerText.toLowerCase().includes('trang') || a.innerText.toLowerCase().includes('profile'));
            });

            return {
                profileLink: fbLinks.length > 0 ? fbLinks[0].href : null,
                realName: foundName
            };
        });

        if (result.profileLink) {
            console.log(`==> TRÍCH XUẤT THÀNH CÔNG: ${result.profileLink}`);
            return result;
        }

        console.log('==> THẤT BẠI: Không lấy được thông tin.');
        await page.screenshot({ path: 'fail_scraped.png' });
        return null;

    } catch (error) {
        console.error('Lỗi Robot:', error);
        return null;
    } finally {
        await browser.close();
    }
}

module.exports = { getFacebookProfileLink };
