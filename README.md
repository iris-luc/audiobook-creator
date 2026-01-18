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

## Cài đặt

```bash
npm install
```

## Thiết lập Google Cloud (khuyến nghị)

1) Tạo Service Account có quyền dùng TTS:
- Google Cloud Console → IAM & Admin → Service Accounts
- Gán quyền phù hợp cho TTS (ví dụ: Text-to-Speech User)
- Tải file JSON key

2) Để file JSON **ngoài repo** (không commit) và trỏ bằng biến môi trường:

`.env` (ví dụ)
```bash
# Backend
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
PORT=3002

# Frontend (Vite)
VITE_API_BASE_URL=http://localhost:3002
```

Ghi chú: nếu không set `PORT` thì backend mặc định `3001` và frontend cũng sẽ gọi `http://localhost:3001`.

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
