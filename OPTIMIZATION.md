# Tối Ưu Hóa Credits - Google Cloud TTS

## Các Tối Ưu Đã Áp Dụng

### 1. **Tối ưu Chunk Size - Cloud TTS**
- **Trước:** 4000 bytes/chunk → nhiều requests hơn
- **Sau:** 4800 bytes/chunk → giảm ~20% số requests
- **Lợi ích:** Tiết kiệm credits đáng kể với văn bản dài
- **An toàn:** Vẫn còn buffer 200 bytes để tránh lỗi

### 2. **Tối ưu Chunk Size - Gemini API**
- **Trước:** 1500 ký tự/chunk
- **Sau:** 2000 ký tự/chunk
- **Lợi ích:** Giảm số requests Gemini khi chuyển phương ngữ
- **Model:** Dùng `gemini-2.0-flash-exp` (nhanh hơn, rẻ hơn)

### 3. **Validation & Error Handling**
- ✅ Kiểm tra text rỗng trước khi gửi request
- ✅ Kiểm tra độ dài bytes trước khi gửi
- ✅ Retry logic với exponential backoff
- ✅ Tránh gửi requests không cần thiết

### 4. **Audio Config**
- **Sample Rate:** 24000 Hz (giữ nguyên để đảm bảo chất lượng)
- **Encoding:** MP3 (tối ưu kích thước file)
- **Lý do:** Giảm sample rate sẽ làm giảm chất lượng đáng kể, không đáng

### 5. **Text Processing**
- Trim whitespace thừa trước khi gửi
- Loại bỏ chunks rỗng
- Chia chunk thông minh tại dấu câu (giữ chất lượng)

## Ước Tính Tiết Kiệm

### Với văn bản 50,000 ký tự (~100,000 bytes):

**Trước:**
- Cloud TTS: ~25 requests (4000 bytes/chunk)
- Gemini: ~33 requests (1500 chars/chunk)

**Sau:**
- Cloud TTS: ~21 requests (4800 bytes/chunk) → **Tiết kiệm 16%**
- Gemini: ~25 requests (2000 chars/chunk) → **Tiết kiệm 24%**

## Best Practices

1. **Chỉ bật chuyển phương ngữ khi cần** - Gemini API tốn credits
2. **Kiểm tra text trước khi xử lý** - Tránh requests lỗi
3. **Dùng retry cho lỗi tạm thời** - Tránh mất credits do lỗi network
4. **Monitor số requests** - Theo dõi usage trong Google Cloud Console

## Lưu Ý

- Chunk size 4800 bytes là tối ưu cho tiếng Việt UTF-8
- Không nên tăng quá 4900 bytes (rủi ro lỗi)
- Gemini Flash model rẻ hơn và nhanh hơn Pro
- Sample rate 24000 Hz là sweet spot cho speech quality


