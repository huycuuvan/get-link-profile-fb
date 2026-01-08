# Hướng dẫn Triển khai (Deploy) lên VPS để chạy 24/7

Để hệ thống hoạt động ổn định và luôn sẵn sàng nhận tin nhắn từ Facebook, bạn nên triển khai lên một VPS (khuyên dùng Ubuntu 20.04 hoặc 22.04).

---

## 1. Chuẩn bị môi trường trên VPS

Mở Terminal của VPS và chạy các lệnh sau:

### **Bước 1: Cập nhật hệ thống & Cài đặt Node.js**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### **Bước 2: Cài đặt các thư viện cần thiết cho Puppeteer (Chrome)**
Đây là bước quan trọng nhất vì VPS thường thiếu các thư viện đồ họa để chạy trình duyệt ngầm:
```bash
sudo apt-get update
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libasound2 ttf-wqy-zenhei
```

---

---

## 2. Đưa mã nguồn lên VPS bằng Git

Sử dụng Git giúp bạn quản lý mã nguồn và cập nhật ứng dụng cực kỳ nhanh chóng.

### **Tại máy cá nhân (Local):**
1. **Khởi tạo Git**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
2. **Đẩy code lên GitHub/GitLab**: Tạo một repository (nên để Private) và đẩy code lên:
   ```bash
   git remote add origin <your-repo-url>
   git branch -M main
   git push -u origin main
   ```

### **Tại VPS:**
1. **Clone mã nguồn**:
   ```bash
   git clone <your-repo-url> /var/www/fb-scraper
   cd /var/www/fb-scraper
   npm install
   ```
2. **Cấu hình file quan trọng (Vì bị .gitignore bỏ qua)**:
   - **Tạo file .env**: `nano .env` (Copy nội dung từ máy cá nhân sang).
   - **Tạo thư mục cookies**: `mkdir cookies`.
   - **Copy session**: Sử dụng SCP hoặc FileZilla để copy file `cookies/fb_cookies.json` tì máy cá nhân lên thư mục `cookies/` trên VPS để không phải đăng nhập lại.

---

## 3. Cài đặt PM2 để chạy 24/7

**PM2** là trình quản lý giúp app tự động khởi động lại nếu bị crash hoặc khi VPS khởi động lại.

```bash
# Cài đặt PM2 toàn cầu
sudo npm install pm2 -g

# Khởi chạy ứng dụng
pm2 start src/index.js --name "fb-scraper"

# Cấu hình tự khởi động cùng VPS
pm2 save
pm2 startup
```
*(Lệnh `pm2 startup` sẽ trả về một đoạn code, bạn hãy copy và paste đoạn code đó vào terminal rồi nhấn Enter).*

---

## 4. Cấu hình HTTPS (Nginx & Certbot)

Facebook yêu cầu URL Webhook phải là **HTTPS**. Bạn cần một tên miền (Domain) trỏ vào IP của VPS.

### **Cài đặt Nginx:**
```bash
sudo apt install nginx
```

### **Cấu hình Reverse Proxy:**
Tạo file cấu hình: `sudo nano /etc/nginx/sites-available/fb-scraper`
Dán nội dung sau (thay `yourdomain.com` bằng tên miền của bạn):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Kích hoạt cấu hình:
```bash
sudo ln -s /etc/nginx/sites-available/fb-scraper /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### **Cài đặt SSL miễn phí (Certbot):**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 5. Lưu ý quan trọng khi chạy trên VPS

1. **Chế độ Headless**: Trên VPS, Robot sẽ luôn chạy ở chế độ **Headless (không hiện cửa sổ)**. 
   - Trong file `src/scraper.js`, bạn nên đổi `headless: false` thành `headless: "new"`.
2. **Xác thực Cookies**:
   - Vì không có màn hình để bạn đăng nhập giúp Robot, cách tốt nhất là bạn **đăng nhập trên máy cá nhân trước**, sau đó copy file `cookies/fb_cookies.json` lên VPS. Robot sẽ dùng phiên đăng nhập đó để chạy tiếp.
3. **Firewall**: Đảm bảo VPS đã mở port 80 và 443.
   ```bash
   sudo ufw allow 'Nginx Full'
   ```

---

## 6. Lệnh kiểm tra thường dùng
- Xem log đang chạy: `pm2 logs fb-scraper`
- Dừng app: `pm2 stop fb-scraper`
- Khởi động lại: `pm2 restart fb-scraper`
- Xem danh sách app: `pm2 list`
