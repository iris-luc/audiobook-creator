# Hướng Dẫn Mở App Trên External Browser

## Cách 1: Tự động mở browser (đã cấu hình)

Khi chạy `npm run dev:all`, Vite sẽ tự động mở browser với URL `http://localhost:3000`

## Cách 2: Truy cập từ máy khác trong cùng mạng WiFi

### Bước 1: Tìm IP address của máy Linux Mint

```bash
hostname -I
# Hoặc
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Ví dụ kết quả: `192.168.1.100`

### Bước 2: Truy cập từ máy khác

Trên máy khác (laptop, điện thoại, tablet), mở browser và truy cập:

```
http://192.168.1.100:3000
```

**Lưu ý:** Thay `192.168.1.100` bằng IP thực tế của máy bạn.

### Bước 3: Kiểm tra Firewall (nếu không truy cập được)

```bash
# Kiểm tra firewall status
sudo ufw status

# Nếu firewall đang bật, mở port 3000 và 3002
sudo ufw allow 3000/tcp
sudo ufw allow 3002/tcp

# Hoặc tạm thời tắt firewall (không khuyên dùng)
sudo ufw disable
```

## Cách 3: Truy cập từ localhost với IP cụ thể

Nếu muốn truy cập từ chính máy Linux Mint bằng IP:

```bash
# Tìm IP
hostname -I

# Mở browser và truy cập
# http://YOUR_IP:3000
```

## Cách 4: Dùng ngrok để truy cập từ internet (tùy chọn)

Nếu muốn truy cập từ bất kỳ đâu (qua internet):

```bash
# Cài đặt ngrok
# Download từ: https://ngrok.com/download
# Hoặc dùng snap:
sudo snap install ngrok

# Chạy ngrok
ngrok http 3000

# Sẽ có URL dạng: https://xxxx-xx-xx-xx.ngrok.io
```

## Kiểm tra kết nối

Sau khi chạy `npm run dev:all`, bạn sẽ thấy:

```
[BACKEND] 🚀 Server running on http://localhost:3002
[BACKEND] 🌐 External access: http://192.168.1.100:3002
[FRONTEND] ➜  Local:   http://localhost:3000/
[FRONTEND] ➜  Network: http://192.168.1.100:3000/
```

Dùng URL trong dòng "Network" để truy cập từ máy khác.

## Troubleshooting

### Không truy cập được từ máy khác:

1. **Kiểm tra firewall:**
   ```bash
   sudo ufw status
   sudo ufw allow 3000/tcp
   sudo ufw allow 3002/tcp
   ```

2. **Kiểm tra IP address:**
   ```bash
   hostname -I
   ```

3. **Kiểm tra server đang chạy:**
   ```bash
   netstat -tulpn | grep -E "3000|3002"
   ```

4. **Kiểm tra cùng mạng WiFi:**
   - Đảm bảo cả 2 máy cùng WiFi
   - Hoặc cùng mạng LAN

### Lỗi CORS:

Nếu gặp lỗi CORS, đảm bảo `server.js` đã có:
```javascript
app.use(cors());
```


