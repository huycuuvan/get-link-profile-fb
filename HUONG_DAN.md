# Hướng dẫn Hệ thống Tự động Bóc Link Facebook (Standalone)

Hệ thống này giúp tự động lấy Link Profile Facebook cá nhân của khách hàng khi họ nhắn tin vào Fanpage và lưu trực tiếp vào Google Sheets. Đây là giải pháp tự vận hành (Self-hosted) không cần qua n8n.

---

## 1. Cơ chế Logic (How it works)

Hệ thống hoạt động theo quy trình 5 bước khép kín:

1.  **Tiếp nhận (Webhook)**: Khi khách nhắn tin, Facebook gửi Webhook về Server. Server đưa yêu cầu vào một **Hàng chờ (Queue)** để xử lý tuần tự (tránh bị Facebook khóa do mở nhiều trình duyệt cùng lúc).
2.  **Truy vấn Tên (Step 1)**: Sử dụng **Message ID (MID)** để gọi Graph API. Đây là mẹo giúp lấy được Tên thật của khách (Ví dụ: "Nguyễn Đình Huy") ngay cả khi App Facebook chưa được xét duyệt quyền truy cập Profile người lạ.
3.  **Kiểm tra Bộ nhớ tạm (Cache)**: Hệ thống kiểm tra trong `cookies/scraped_links.json` xem khách này đã từng được bóc link chưa.
    *   **Nếu ĐÃ CÓ**: Lấy link cũ và lưu vào Sheets ngay lập tức (Xử lý trong 0.1s, không mở trình duyệt).
    *   **Nếu CHƯA CÓ**: Chuyển sang bước 4.
4.  **Robot Giả lập (Puppeteer)**: Mở trình duyệt Chrome, vào thẳng Inbox của Page, gõ tìm tên khách hàng. Robot sẽ click vào hội thoại đúng nhất và bóc Link Profile từ Sidebar bên phải.
5.  **Xuất dữ liệu (Google Sheets)**: Lưu toàn bộ thông tin gồm: Thời gian, Tên khách hàng, Link Facebook, Nội dung nhắn, PSID, Page ID và MID vào Google Sheet. 

---

## 2. Cấu trúc thư mục
- `src/index.js`: Server chính xử lý Webhook, API và Hàng chờ.
- `src/scraper.js`: Robot điều khiển trình duyệt để bóc link.
- `cookies/fb_cookies.json`: Lưu phiên đăng nhập Facebook.
- `cookies/scraped_links.json`: Bộ nhớ tạm lưu danh sách khách đã quét (Chống spam).
- `.env`: Nơi cấu hình Token Facebook, ID Google Sheet và Key bảo mật.

---

## 3. Cấu hình .env
Bạn cần điền đầy đủ các thông tin sau:
- `PAGE_ACCESS_TOKEN`: Token của Fanpage.
- `VERIFY_TOKEN`: Mã xác thực Webhook (tự đặt).
- `SPREADSHEET_ID`: ID của file Google Sheet.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Email của tài khoản dịch vụ Google.
- `GOOGLE_PRIVATE_KEY`: Khóa bí mật của Google.

---

## 4. Các tính năng thông minh đã cài đặt
- **Chống trùng lặp (Deduplication)**: Một khách hàng nhắn 10 câu thì chỉ lưu 1 dòng duy nhất vào Google Sheets.
- **Tự động sửa lỗi Sheets**: Tự động tạo tiêu đề hoặc bổ sung cột (như cột MID) nếu Sheet của bạn bị thiếu.
- **Vượt rào API**: Lấy tên qua Message ID thay vì PSID để tránh lỗi quyền truy cập.
- **Resilient Scraper**: Robot có khả năng tự xóa search cũ, chọn đúng người đầu tiên nếu không thấy kết quả search, và lọc Sidebar để lấy đúng link cá nhân.

---

## 6. Tài liệu API (Chi tiết)

Hệ thống cung cấp 2 loại Endpoint chính:

### **6.1. Webhook Facebook (Tự động)**
Dành cho Facebook gửi tin nhắn về. Bạn cấu hình URL này trong App Facebook Developer.

- **URL**: `https://<ten-mien-cua-ban>/webhook`
- **Xác thực (GET)**: Dùng để Facebook Verify Webhook.
- **Xử lý tin nhắn (POST)**:
    - **Cấu trúc JSON nhận được từ FB**:
        ```json
        {
          "object": "page",
          "entry": [
            {
              "id": "PAGE_ID",
              "messaging": [{
                "sender": { "id": "PSID" },
                "message": { "mid": "m_...", "text": "Nội dung" }
              }]
            }
          ]
        }
        ```

### **6.2. API Scrape Trực tiếp (Thủ công)**
Dùng để bạn tự gọi bằng cURL hoặc Postman để ép Robot chạy cho một khách nào đó.

- **URL**: `http://localhost:3000/scrape-fb-link`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body Params**:
    | Tham số | Loại | Bắt buộc | Mô tả |
    | :--- | :--- | :--- | :--- |
    | `psid` | String | Có | ID của người dùng trên Page đó |
    | `mid` | String | Có | ID tin nhắn (Dùng để lấy tên thật) |
    | `text` | String | Có | Nội dung tin nhắn của khách |
    | `page_id` | String | Có | ID của Fanpage |

- **Ví dụ Request (cURL)**:
    ```bash
    curl -X POST http://localhost:3000/scrape-fb-link \
    -H "Content-Type: application/json" \
    -d '{
      "psid": "25307480362268887",
      "mid": "m_123...",
      "text": "Chào shop",
      "page_id": "701008376421587"
    }'
    ```

- **Response (Thành công)**:
    ```json
    {
      "success": true,
      "data": {
        "psid": "25307480362268887",
        "customerName": "Nguyễn Đình Huy",
        "profileLink": "https://www.facebook.com/nho.mattri.98031",
        "messageId": "m_123...",
        "text": "Chào shop",
        "pageId": "701008376421587",
        "time": "2026-01-08T10:10:25Z"
      }
    }
    ```

- **Response (Nếu dữ liệu đã có trong Cache)**:
    ```json
    {
      "success": true,
      "data": { ... },
      "message": "Already cached"
    }
    ```

### **6.3. Giải phẫu quy trình xử lý của `/scrape-fb-link` (Technical Deep Dive)**

Khi bạn gọi API này, hệ thống thực hiện một chuỗi các hành động kỹ thuật phức tạp bằng cách kết hợp nhiều công nghệ:

#### **Bước A: Quản lý hàng chờ (Queue System - Express.js)**
- Vì trình duyệt (Puppeteer) ngốn rất nhiều RAM, hệ thống không chạy ngay lập tức mà đưa yêu cầu vào một mảng `queue`.
- Chỉ một trình duyệt được mở tại một thời điểm (`isProcessing`) để đảm bảo CPU không bị quá tải và không bị Facebook đánh dấu spam.

#### **Bước B: Truy vấn danh tính (Axios & Graph API)**
- **MID (Message ID)**: Hệ thống dùng Axios gửi yêu cầu đến `graph.facebook.com/v18.0/{mid}`. 
- **Tại sao dùng MID?**: Vì truy vấn qua MID trả về trường `from` chứa tên thật của khách mà không yêu cầu các quyền bảo mật khắt khe như khi truy vấn trực tiếp qua PSID.

#### **Bước C: Kiểm tra Bộ nhớ tạm (JSON Cache)**
- Trước khi mở trình duyệt, hệ thống đọc file `scraped_links.json`.
- Nếu PSID này đã tồn tại, nó sẽ "bẻ lái" quy trình, bỏ qua bước mở browser để trả về kết quả ngay lập tức.

#### **Bước D: Robot giả lập (Puppeteer Automation)**
Nếu chưa có trong Cache, Robot bắt đầu làm việc:
1. **Khởi tạo**: Mở một instance Chrome giả lập người dùng thật (User-Agent, Viewport start-maximized).
2. **Nạp Session**: Đọc `fb_cookies.json` để vượt qua bước đăng nhập.
3. **Điều hướng**: Vào thẳng Inbox qua URL: `https://business.facebook.com/latest/inbox/all?asset_id={page_id}`.
4. **Tìm kiếm (Search Strategy)**: 
    - Robot ưu tiên gõ tên thật lấy được từ Bước B vào ô tìm kiếm.
    - Nếu không thấy kết quả, nó sẽ tự động xóa search và chọn **cuộc hội thoại ở vị trí trên cùng** (vì đây là người vừa nhắn tin).
5. **Trích xuất (Sidebar Extraction)**:
    - Robot đợi Sidebar bên phải load xong.
    - Nó sử dụng các Selector CSS để quét vùng `complementary` (sidebar).
    - Nó lọc các thẻ `<a>` chứa từ khóa `facebook.com` nhưng loại bỏ các link rác (liên quan đến Ads, Business, Help).
6. **Lưu phiên**: Cập nhật lại `fb_cookies.json` để duy trì trạng thái đăng nhập cho lần sau.

#### **Bước E: Tổng hợp & Lưu trữ (Google Spreadsheet API)**
- Dữ liệu cuối cùng được đóng gói và gửi đến Google Sheets thông qua `google-spreadsheet` library.
- Hệ thống sử dụng tài khoản Service Account (JWT) để xác thực, giúp việc lưu dữ liệu diễn ra ngầm mà không cần cửa sổ popup nào từ Google.
