# Hướng Dẫn Cài Đặt - Linux Mint

## Bước 1: Kiểm tra và cài đặt Node.js

Mở Terminal (Ctrl+Alt+T) và kiểm tra:

```bash
node --version
npm --version
```

Nếu chưa có hoặc version cũ, cài đặt:

```bash
# Cài đặt Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Hoặc dùng nvm (khuyên dùng)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

## Bước 2: Thiết lập Google Cloud Service Account

### 2.1. Tạo Service Account trên Google Cloud Console

1. Truy cập: https://console.cloud.google.com/
2. Chọn project của bạn (hoặc tạo project mới)
3. Vào **APIs & Services** > **Library**
4. Tìm "Cloud Text-to-Speech API" và nhấn **Enable**

### 2.2. Tạo Service Account

1. Vào **IAM & Admin** > **Service Accounts**
2. Nhấn **Create Service Account**
3. Đặt tên: `tts-user` (hoặc tên khác)
4. Nhấn **Create and Continue**
5. Chọn Role: **Cloud Text-to-Speech** > **Cloud Text-to-Speech API User**
6. Nhấn **Continue** > **Done**

### 2.3. Tải file JSON Key

1. Click vào email của service account vừa tạo
2. Vào tab **Keys**
3. Nhấn **Add Key** > **Create new key**
4. Chọn **JSON**
5. File sẽ tự động tải về (thường ở thư mục Downloads)

### 2.4. Đặt file JSON vào project

```bash
# Di chuyển vào thư mục project
cd ~/Downloads/audiobook-creator

# Copy file JSON từ Downloads (thay tên file bằng tên file thực tế của bạn)
cp ~/Downloads/your-service-account-key-xxxxx.json ./service-account-key.json

# Hoặc dùng đường dẫn tuyệt đối
# Đảm bảo file có tên chính xác: service-account-key.json
```

**LƯU Ý BẢO MẬT:** File này chứa credentials quan trọng, không commit lên git!

## Bước 3: Cài đặt Dependencies

```bash
# Đảm bảo đang ở thư mục project
cd ~/Downloads/audiobook-creator

# Cài đặt tất cả packages
npm install
```

Nếu gặp lỗi permission, có thể cần:
```bash
sudo npm install
```

## Bước 4: Chạy Ứng dụng

Cần mở **2 terminal windows**:

### Terminal 1 - Backend Server:

```bash
cd ~/Downloads/audiobook-creator
npm run dev:server
```

Bạn sẽ thấy:
```
Server running on http://localhost:3001
```

### Terminal 2 - Frontend:

```bash
cd ~/Downloads/audiobook-creator
npm run dev
```

Bạn sẽ thấy:
```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### Mở trình duyệt:

Truy cập: **http://localhost:3000**

## Bước 5: Sử dụng App

1. Upload file text (.txt, .pdf, .docx) hoặc paste văn bản
2. Chọn thể loại văn bản
3. Bật/tắt "Tự động chuyển sang giọng Nam" (nếu muốn)
4. Chọn giọng đọc
5. Nhấn "Bắt Đầu Tạo Sách Nói"
6. Đợi quá trình xử lý hoàn tất
7. Tải file MP3 về

## Xử lý Lỗi Thường Gặp

### Lỗi: "Cannot find module"
```bash
# Xóa node_modules và cài lại
rm -rf node_modules package-lock.json
npm install
```

### Lỗi: "Permission denied" khi chạy server
```bash
# Kiểm tra quyền file
chmod +x server.js

# Hoặc chạy với node trực tiếp
node server.js
```

### Lỗi: "GOOGLE_APPLICATION_CREDENTIALS not found"
- Đảm bảo file `service-account-key.json` ở đúng thư mục root của project
- Hoặc set biến môi trường:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/Downloads/audiobook-creator/service-account-key.json"
```

### Lỗi: "Port 3001 already in use"
```bash
# Tìm process đang dùng port
sudo lsof -i :3001

# Kill process
sudo kill -9 <PID>
```

### Lỗi: "API not enabled"
- Vào Google Cloud Console
- Kiểm tra Cloud Text-to-Speech API đã được bật chưa
- Đảm bảo service account có đúng role

## Dừng Ứng Dụng

Trong mỗi terminal, nhấn **Ctrl+C** để dừng server.

## Cấu Trúc Thư Mục

```
audiobook-creator/
├── service-account-key.json  ← File credentials (KHÔNG commit)
├── server.js                 ← Backend server
├── App.tsx                   ← Frontend
├── services/
│   ├── cloudTtsService.ts    ← Cloud TTS service
│   └── geminiService.ts      ← Gemini (cho chuyển phương ngữ)
└── package.json
```

## Tips

- Giữ 2 terminal windows mở khi chạy app
- Nếu thay đổi code, Vite sẽ tự động reload frontend
- Backend server cần restart thủ công nếu thay đổi `server.js`
- File service account key phải có tên chính xác: `service-account-key.json`


