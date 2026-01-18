# PRD — Audiobook Creator (Sách Nói Phương Nam)

Mục tiêu của tài liệu này là **liệt kê đầy đủ các tính năng hiện có** của app `audiobook-creator` như một bản tham chiếu để **đối chiếu/regression** mỗi khi refactor hoặc sửa đổi.

- Phạm vi: tính năng **đang tồn tại trong codebase** (frontend + backend) tại thời điểm viết PRD.
- Đối tượng đọc: dev/maintainer.
- Nguồn tham chiếu chính: `App.tsx`, `server.js`, `utils/*`, `services/*`, `README.md`, `TEXT_CLEANING.md`, `VOICE_STYLES.md`, `PRICING.md`.

---

## 1) Tổng quan sản phẩm

### 1.1. Vấn đề
- Tạo audiobook tiếng Việt cần kiểm soát chi phí/ký tự và chất lượng nhịp đọc.
- Văn bản dài cần chia đoạn để dễ kiểm soát, preview, sửa lỗi cục bộ.

### 1.2. Giải pháp
- App chạy local gồm:
  - Frontend React/Vite: nhập văn bản, tách đoạn, preview, tạo audio theo đoạn, merge và tải file.
  - Backend Express: gọi **Google Cloud Text-to-Speech (Standard, vi-VN)** tạo audio PCM (LINEAR16) và **encode MP3 bằng ffmpeg**, kèm cache kết quả TTS.
- (Tuỳ chọn) Chuyển văn bản sang **phương ngữ Nam** bằng Gemini trước khi tách đoạn.

### 1.3. Mục tiêu (Goals)
- Tạo audiobook từ văn bản tiếng Việt với **chi phí dự đoán được**.
- Có khả năng **preview nhanh** trước khi render toàn bộ.
- Có thể **sửa từng đoạn** và render lại đúng đoạn đó.
- Có thể merge và tải xuống file audiobook hoàn chỉnh (`.mp3`).

### 1.4. Không thuộc phạm vi (Non-goals)
- Không triển khai cloud-hosting/multi-user.
- Không có quản lý dự án/đơn hàng/queue lâu dài (không persistence theo workspace ngoài cache TTS backend).
- Không có editor SSML tự do (chỉ preset + override 3 tham số).

---

## 2) Kiến trúc & ràng buộc

### 2.1. Thành phần
- Frontend:
  - Entry: `index.html`, `index.tsx`, UI chính: `App.tsx`
  - Tailwind CDN + fonts Google + PDF.js + Mammoth (CDN) để parse `.pdf/.docx` (xem `index.html`)
- Backend:
  - `server.js` (Express)
  - Google Cloud TTS: `@google-cloud/text-to-speech`
  - ffmpeg: encode/convert MP3

### 2.2. Cấu hình môi trường (tham chiếu)
- Backend:
  - `GOOGLE_APPLICATION_CREDENTIALS`: đường dẫn key JSON service account
  - `PORT` (mặc định `3001`)
  - `HOST` (mặc định `0.0.0.0`)
  - `CACHE_ENABLED` (mặc định bật; tắt khi `false`)
  - `CACHE_TTL_DAYS` (mặc định `7`)
  - `CACHE_MAX_GB` (mặc định `2`)
  - `ENCODE_BODY_LIMIT` (mặc định `1024mb`)
- Frontend:
  - `VITE_API_BASE_URL` (fallback `VITE_TTS_SERVER_URL`, mặc định `http://localhost:3001`)
  - `GEMINI_API_KEY` (tuỳ chọn; cần nếu bật chuyển phương ngữ Nam bằng Gemini)

### 2.3. Ràng buộc kỹ thuật quan trọng
- Giới hạn request TTS:
  - Client-side chặn nếu `textBytes > 5000` (xem `services/cloudTtsService.ts`)
  - Chunking mặc định dùng ngưỡng ~`3000` ký tự để hạn chế lỗi do UTF-8 + SSML.
- Encode MP3 dựa vào `ffmpeg` trong PATH (backend).

---

## 3) Tính năng (Functional Requirements)

> Quy ước mã tính năng: `FR-xx` để dùng làm checklist regression.

### FR-01 — Chạy app local (frontend + backend)
- Mô tả: chạy UI và API local; backend bind `0.0.0.0` để truy cập LAN.
- Thành phần:
  - Scripts: `npm run dev`, `npm run dev:server`, `npm run dev:all` (xem `package.json`)
  - External access log (xem `server.js`)
- Tiêu chí nghiệm thu:
  - UI mở được trên `http://localhost:3000`.
  - Backend trả `200` cho `GET /api/health`.
  - Có thể truy cập backend qua IP LAN (khi firewall cho phép).

### FR-02 — Nhập văn bản thủ công (paste/edit)
- Mô tả: textarea nhập văn bản; thay đổi cập nhật state.
- Tiêu chí nghiệm thu:
  - Có thể dán/nhập văn bản dài.
  - Không crash UI khi nhập nhanh.

### FR-03 — Upload file và trích xuất văn bản
- Mô tả: upload và extract text cho `.txt`, `.pdf`, `.docx` (xem `utils/fileProcessors.ts` + CDN libs trong `index.html`).
- Hành vi:
  - Sau khi upload: set `fileName`, fill `originalText`, clean text ngay, reset chunks + merged audio.
- Tiêu chí nghiệm thu:
  - Upload `.txt` hiển thị đúng nội dung.
  - Upload `.pdf` lấy text từng trang và nối bằng `\n`.
  - Upload `.docx` đọc raw text.
  - Định dạng không hỗ trợ báo lỗi thân thiện.

### FR-04 — Làm sạch văn bản (Text Cleaning)
- Mô tả: chuẩn hoá văn bản trước khi phân tích/TTS (xem `utils/textCleaner.ts`, tài liệu `TEXT_CLEANING.md`).
- Tiêu chí nghiệm thu:
  - Loại bỏ ký tự “nguy hiểm” khiến TTS đọc verbatim (emoji, chuỗi ký tự trang trí…).
  - Chuẩn hoá whitespace/newline; thay `-` theo chiến lược của app.
  - Không làm rỗng nội dung hợp lệ một cách bất ngờ.

### FR-05 — (Tuỳ chọn) Chuyển phương ngữ Nam bằng Gemini
- Mô tả: khi bật “Chuyển phương ngữ Nam”, văn bản được clean (preserve newline) rồi gửi Gemini để chuyển style theo `TextGenre` (xem `services/geminiService.ts`).
- Hành vi:
  - Có cache in-memory cho kết quả chuyển phương ngữ.
  - Chunks được gắn cờ `isDialectConverted`.
- Tiêu chí nghiệm thu:
  - Bật/tắt checkbox ảnh hưởng tới quá trình “Phân tích & Tách đoạn”.
  - Khi bật: chunks sau phân tích có badge “Phương ngữ Nam”.
  - Khi Gemini lỗi: fallback giữ text gốc của chunk tương ứng (không crash).

### FR-06 — Phân tích & tách đoạn (Chunking)
- Mô tả: tách văn bản thành chunks phục vụ preview/TTS theo đoạn (xem `utils/chunkManager.ts`).
- Quy tắc chính:
  - Tách theo paragraph (ngăn bởi dòng trống).
  - Ghép paragraph vào chunk miễn tổng <= `3000` ký tự.
  - Paragraph quá dài được tách theo câu/dấu câu rồi fallback theo khoảng trắng.
- Tiêu chí nghiệm thu:
  - Bấm “🔍 Phân tích & Tách đoạn” tạo ra danh sách chunks có `id` tăng dần.
  - Chunk không vượt quá giới hạn ký tự mục tiêu.
  - Bấm phân tích lại sẽ reset audio URL cũ và merged audio.

### FR-07 — Thống kê ký tự và ước tính chi phí (Credits)
- Mô tả: hiển thị thống kê sau khi đã có chunks (xem `utils/textStats.ts` và UI trong `App.tsx`).
- Chỉ số:
  - Ký tự ban đầu / sau clean
  - Số chunks, ký tự trung bình/chunk
  - Số request TTS dự kiến (= số chunks)
  - Ước tính $ cho TTS Standard, và Gemini (nếu bật)
- Tiêu chí nghiệm thu:
  - Thống kê cập nhật đúng khi thay đổi văn bản và phân tích lại.
  - Khi bật chuyển phương ngữ: có thêm mục chi phí Gemini + tổng.

### FR-08 — Tìm & thay thế (Find & Replace) trên văn bản gốc và/hoặc chunks
- Mô tả: bộ công cụ tìm/replace literal (không regex) áp dụng cho:
  - Văn bản gốc
  - Chunks
  - Cả hai (xem `utils/findReplace.ts`, `utils/chunkManager.ts`, UI `App.tsx`)
- UX:
  - Phím tắt: `Ctrl/Cmd+F` focus ô Tìm, `Ctrl/Cmd+H` focus ô Thay
  - Có option phân biệt hoa/thường
  - Có “Tìm tiếp”, “Thay”, “Thay tất cả”
  - Replace trong chunks sẽ reset audio/preview của chunk bị thay
- Tiêu chí nghiệm thu:
  - Find next chạy vòng qua các vùng theo “Phạm vi”.
  - Replace current chỉ thay khi match tại selection còn hợp lệ.
  - Replace all trả về số lượng thay thế và reset audio phù hợp.

### FR-09 — Sửa nội dung từng chunk
- Mô tả: mỗi chunk có textarea để sửa; sửa chunk sẽ:
  - reset `audioUrl`, `isGenerated`, preview state
  - reset cờ `isDialectConverted` (vì đã khác nội dung) (xem `updateChunkText`)
- Tiêu chí nghiệm thu:
  - Sửa text chunk cập nhật UI ngay.
  - Audio cũ của chunk bị xoá và phải tạo lại.

### FR-10 — Chọn giọng đọc (4 voices) + kiểm tra voice khả dụng
- Mô tả:
  - UI hỗ trợ 4 giọng `VoiceName` (xem `types.ts`, `utils/voiceMapping.ts`)
  - Frontend gọi `GET /api/voices` để disable option không có trong tài khoản (xem `App.tsx`)
- Tiêu chí nghiệm thu:
  - Dropdown hiển thị đúng tên + technicalName.
  - Nếu backend trả danh sách voices: option không có sẽ bị disable và có tooltip.

### FR-11 — Chọn phong cách đọc (genre) và preset SSML
- Mô tả:
  - 4 genre (`TextGenre`) ảnh hưởng preset rate/pitch/break (xem `utils/readingStyles.ts`, `utils/readingStyles.config.js`, `VOICE_STYLES.md`)
  - UI hiển thị mô tả/đặc tính của preset.
- Tiêu chí nghiệm thu:
  - Đổi genre cập nhật “SSML hiệu lực”.
  - Pitch có thể khác theo giới tính giọng (nam/nữ).

### FR-12 — SSML nâng cao: override Rate/Pitch/Break + validation
- Mô tả: bật/tắt override 3 tham số; có validation và nút reset (xem `App.tsx`).
- Validation:
  - Rate: `0.50–2.00` (number)
  - Pitch: dạng `-1st`, `0st`, `+0.5st`, giới hạn `[-20st, +20st]`
  - Break: `100–2000ms`
- Tiêu chí nghiệm thu:
  - Khi invalid: không cho preview/generate và hiển thị lỗi đỏ.
  - Khi reset: quay về preset và thông báo “Đã reset SSML nâng cao”.

### FR-13 — Nghe nhanh (preset preview)
- Mô tả: nút “🔊 Nghe nhanh” tạo preview với câu mẫu theo giọng + genre + override (xem `handlePresetPreview`).
- Hành vi:
  - Cache theo key `voice|genre|customProsody` ở phía client để bấm lại sẽ phát lại ngay.
- Tiêu chí nghiệm thu:
  - Bấm nghe nhanh phát audio.
  - Đổi voice/genre/override sẽ tạo preview mới.

### FR-14 — Preview theo chunk (“Nghe thử 1 câu”)
- Mô tả: mỗi chunk có nút “🔊 Nghe thử (1 câu)” để tạo preview ngắn (xem `handlePreview`, `utils/textPreview.ts`).
- Tiêu chí nghiệm thu:
  - Preview tạo audio và phát được.
  - Preview không ghi đè audio chính (chỉ previewAudioUrl).

### FR-15 — Tạo audio cho 1 chunk (và tạo lại)
- Mô tả: nút “🎧 Tạo audio” (hoặc “🎧 Tạo lại”) gọi TTS cho chunk hiện tại theo cài đặt (xem `handleGenerateChunk`, `services/cloudTtsService.ts`).
- Hành vi:
  - Có trạng thái đang xử lý.
  - Lưu `lastGenre/lastProsody` để hiển thị “Phong cách/Rate/Pitch” của audio đã tạo.
- Tiêu chí nghiệm thu:
  - Chunk tạo thành công có `✓ Đã tạo audio`.
  - Có thể nghe chunk đã tạo bằng nút “▶ Nghe”.
  - Tạo lại sẽ thay thế audio cũ.

### FR-16 — Tạo audiobook theo batch (tất cả chunks)
- Mô tả: nút “🎧 Tạo Audiobook (Tất cả đoạn)” chạy tạo audio các chunk chưa có audio (hoặc bị mất `audioUrl`) với concurrency=3 và tiến độ % (xem `handleBatchGenerate`).
- Tiêu chí nghiệm thu:
  - Progress tăng dần đến 100%.
  - Không bỏ sót chunk thiếu `audioUrl` (kể cả trường hợp reload/restore).
  - Khi tất cả đã có audio: hiển thị “✅ Tất cả đoạn đã có audio”.

### FR-20 — Persistence: lưu queue batch vào localStorage và resume sau khi F5
- Mô tả:
  - Khi chạy batch, app lưu snapshot queue (settings + danh sách chunk + trạng thái) vào `localStorage`.
  - Khi mở lại trang và chưa có chunks trong UI, app hiển thị banner cho phép “Khôi phục” hoặc “Khôi phục & chạy tiếp”.
- Ghi chú:
  - localStorage có giới hạn dung lượng; với văn bản quá lớn có thể không lưu được.
  - Audio blob không được lưu vào localStorage; khi resume, app sẽ gọi lại TTS để dựng lại audio (backend cache giúp giảm chi phí nếu bật).
- Tiêu chí nghiệm thu:
  - F5 trong lúc batch đang chạy → sau khi vào lại trang có thể khôi phục và chạy tiếp.
  - Bấm “Xoá” → không còn banner và không resume được.

### FR-21 — Exponential Backoff: tự động retry khi gặp lỗi rate limit từ Google TTS
- Mô tả:
  - Backend tự retry `synthesizeSpeech` với exponential backoff + jitter khi gặp `429/RESOURCE_EXHAUSTED` (và một số lỗi tạm thời).
- Tiêu chí nghiệm thu:
  - Khi gặp rate limit tạm thời, request `/api/tts` không fail ngay lập tức mà sẽ retry trong giới hạn cấu hình.
  - Khi retry hết vẫn bị rate limit: trả lỗi `429` với message thân thiện.

### FR-17 — Merge & encode audiobook hoàn chỉnh (MP3) + tải xuống
- Mô tả:
  - Merge audio theo thứ tự chunkId (client) → gửi blob lên `POST /api/encode` (backend ffmpeg) → nhận MP3 và hiển thị player + link download (xem `utils/audio-utils.ts`, `server.js`, `App.tsx`).
- Tiêu chí nghiệm thu:
  - Chỉ cho bấm “📥 Tải Audiobook Hoàn Chỉnh” khi tất cả chunk đã có audio.
  - Merge xong: xuất hiện player “Audiobook Hoàn Chỉnh” và nút tải `.mp3`.

### FR-18 — Kiểm tra backend health & hiển thị trạng thái
- Mô tả: frontend gọi `GET /api/health` (timeout ~3.5s) để hiển thị badge `Backend: OK` và một vài thông số (xem `App.tsx`, `server.js`).
- Tiêu chí nghiệm thu:
  - Khi backend OK: badge xanh.
  - Khi lỗi kết nối: badge đỏ + tooltip thông tin lỗi.

### FR-19 — Thông báo (notice) + xử lý lỗi toàn cục
- Mô tả:
  - Notice `info/success/error` hiển thị trên UI; auto-dismiss 6s (trừ lỗi).
  - Bắt `window.error` và `unhandledrejection` để show lỗi thân thiện (xem `App.tsx`).
- Tiêu chí nghiệm thu:
  - Lỗi network/backend hiển thị thông báo dễ hiểu (gợi ý `npm run dev:server` + `VITE_API_BASE_URL`).
  - Info/success tự biến mất; error không tự biến mất.

---

## 4) Backend API (tham chiếu hợp đồng)

### 4.1. `POST /api/tts`
- Input JSON:
  - `text` (string, required)
  - `voice` (string; chấp nhận voice display key hoặc technicalName; backend map qua `VOICE_MAP`)
  - `genre` (string; default `Thông thường`)
  - `customProsody` (object optional): `{ rate?: number, pitch?: string, breakTime?: string }`
- Output JSON:
  - `audioContent` (base64)
  - `mimeType` (ví dụ `audio/L16;rate=24000`)
  - `meta` (genre/voice/prosody/paragraphBreak/textLength/…)
- Ghi chú:
  - Backend cache theo `{ ssml, voice }` với TTL + size limit.

### 4.2. `POST /api/encode`
- Input: raw audio bytes (accept nhiều content-types; giới hạn theo `ENCODE_BODY_LIMIT`)
- Output: `audio/mpeg` (MP3) — encode bằng ffmpeg
- Lỗi đặc biệt: `413` trả thông báo thân thiện về payload quá lớn.

### 4.3. `GET /api/health`
- Output: `{ ok, cacheEnabled, cacheTtlDays, cacheMaxGb, encodeBodyLimit, defaultVoice }`

### 4.4. `GET /api/voices`
- Output: `{ voices: [{ name: string }] }`

### 4.5. `GET /api/drive-audio/:fileId` (tiện ích)
- Mô tả: proxy stream audio từ Google Drive để bypass CORS + hỗ trợ Range.
- Trạng thái: hiện chưa có UI sử dụng; là endpoint utility.

---

## 5) Regression checklist (cách “đảm bảo tính năng hoạt động”)

> Checklist này nhằm chạy nhanh sau mỗi refactor. Mỗi item map về `FR-xx`.

### 5.1. Smoke test nhanh (5–10 phút)
1. (FR-01) Chạy `npm run dev:all` → UI mở được, `GET /api/health` ok.
2. (FR-02/06) Paste 2–3 đoạn văn có xuống dòng → “Phân tích & Tách đoạn” tạo đúng số chunks.
3. (FR-11/13) Đổi genre + bấm “Nghe nhanh” → có tiếng.
4. (FR-14/15) Preview 1 chunk rồi tạo audio chunk đó → nghe được.
5. (FR-16/17) Batch generate → merge → tải MP3.

### 5.2. Checklist chi tiết theo rủi ro
- Input & cleaning:
  - (FR-03/04) Upload `.txt` chứa emoji/markdown/dấu “---” → clean không còn ký tự gây TTS đọc “gạch ngang/sao”.
  - (FR-06) Văn bản có đoạn cực dài → app vẫn tách được, không tạo chunk quá lớn.
- Find/replace:
  - (FR-08/09) Replace all trong chunks → các chunk bị thay reset audio; chunk không đổi giữ nguyên.
- Dialect:
  - (FR-05) Bật chuyển phương ngữ Nam → chunks có badge; tắt → không có badge.
- Backend/cache:
  - (FR-18) Tắt backend → UI hiện “Backend: lỗi kết nối” và lỗi fetch thân thiện khi preview.
  - (FR-17) Merge file lớn → nếu 413, UI hiện lỗi hướng dẫn giảm tải hoặc tăng `ENCODE_BODY_LIMIT`.

---

## 6) Ghi chú về phần “có trong code nhưng chưa dùng trong UI”
- `services/voiceFinderService.ts`: có hàm `recommendVoices()` dùng Gemini để gợi ý giọng + sample text, nhưng hiện không được gọi từ `App.tsx`.
- `GET /api/drive-audio/:fileId`: backend hỗ trợ proxy audio Google Drive, nhưng UI hiện chưa tích hợp.
