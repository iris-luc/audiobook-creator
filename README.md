# Audiobook Creator (Sách Nói Phương Nam)

Ứng dụng tạo audiobook tiếng Việt chạy local, dùng **Google Cloud Text-to-Speech (Standard)** + chia đoạn để dễ kiểm soát chi phí, tốc độ và chất lượng.

## Tính năng chính

- 4 giọng (Standard): Dương Quá, Tiểu Long Nữ, Hoàng Dung, Quách Tĩnh
- 4 phong cách đọc (SSML preset) + tuỳ chọn **SSML nâng cao** (rate/pitch/break)
- Nghe thử nhanh `🔊 Nghe nhanh` theo giọng + phong cách đang chọn
- Tách văn bản thành các đoạn, tạo audio theo từng đoạn, merge & tải xuống `.mp3` (ffmpeg)

Tài liệu liên quan: `PRICING.md`, `TEXT_CLEANING.md`, `VOICE_STYLES.md`

## Yêu cầu

- Node.js 18+
- `ffmpeg` (để encode/merge ra `.m4a`)
- Google Cloud Project đã bật **Text-to-Speech API**

## Cài đặt & Thiết lập

### 1. Clone & Cài đặt dependencies

```bash
git clone https://github.com/iris-luc/audiobook-creator.git
cd audiobook-creator
npm install
```

### 2. Cấu hình môi trường (`.env`)

Dự án có sẵn file mẫu `.env.example`. Bạn cần tạo file `.env` từ file này:

```bash
cp .env.example .env
```

Sau đó mở file `.env` và cập nhật các thông tin sau:
- `API_KEY`: Key của Gemini API (dùng để chuyển đổi phương ngữ).
- `GOOGLE_APPLICATION_CREDENTIALS`: Đường dẫn đến file JSON Service Account của Google Cloud.

### 3. Thiết lập Google Cloud Text-to-Speech

Để sử dụng giọng đọc Google, bạn cần:
1. Tạo Project trên [Google Cloud Console](https://console.cloud.google.com/).
2. Bật **Text-to-Speech API**.
3. Tạo **Service Account**:
   - Vào IAM & Admin → Service Accounts.
   - Tạo mới service account, cấp quyền **Cloud Text-to-Speech API User**.
   - Tạo key (JSON) và tải về máy.
4. Đổi tên file key thành `service-account-key.json` và chép vào thư mục gốc của dự án (hoặc cập nhật đường dẫn trong `.env`).

> **Lưu ý bảo mật:** File `.env` và `service-account-key.json` đã được thêm vào `.gitignore` để tránh lộ thông tin nhạy cảm khi push code.

## Chạy ứng dụng

Chạy cả backend + frontend:
```bash
npm run dev:all
```

Hoặc chạy riêng:
```bash
npm run dev:server
npm run dev
```

Mở UI: http://localhost:3000

## Cách dùng nhanh

1) Dán văn bản hoặc upload file → `Phân tích & Tách đoạn`
2) Chọn `Giọng đọc` + `Phong cách đọc` → `🔊 Nghe nhanh` để kiểm tra nhanh
3) (Tuỳ chọn) mở `Tùy chỉnh SSML nâng cao` để override rate/pitch/break
4) Tạo audio từng đoạn hoặc `Tạo Audiobook (Tất cả đoạn)` → merge & tải `.mp3`

## Cấu trúc mã nguồn

- `App.tsx`: UI chính (tách đoạn, preview, batch, merge)
- `server.js`: backend Express gọi Google Cloud TTS + encode m4a qua ffmpeg
- `utils/voiceMap.js`, `utils/voiceMapping.ts`: map giọng hiển thị ↔ model ID
- `utils/readingStyles.ts`, `utils/readingStyles.config.js`: preset phong cách đọc (frontend/backend)
- `utils/textCleaner.ts`: làm sạch văn bản trước khi gửi TTS

## Troubleshooting

- Không kết nối được backend / `Failed to fetch`:
  - chạy `npm run dev:server`
  - kiểm tra `PORT` và `VITE_API_BASE_URL`
- Lỗi xác thực Google:
  - kiểm tra `GOOGLE_APPLICATION_CREDENTIALS` trỏ đúng file JSON
  - đảm bảo đã bật Text-to-Speech API trong project
- Encode lỗi:
  - kiểm tra máy có `ffmpeg` trong PATH (`ffmpeg -version`)
