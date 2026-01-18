# Điều Chỉnh Phong Cách Giọng Nói Theo Ngữ Cảnh

## Các Tham Số Điều Chỉnh

Cloud TTS Standard voices hỗ trợ SSML với 3 tham số chính:

1. **speakingRate** (Tốc độ): 0.25 - 4.0
   - < 1.0: Chậm hơn
   - 1.0: Tốc độ chuẩn
   - > 1.0: Nhanh hơn

2. **pitch** (Cao độ): -20.0 to +20.0 semitones
   - < 0: Thấp hơn, trầm ấm
   - 0: Trung tính
   - > 0: Cao hơn, sáng hơn

3. **volumeGainDb** (Âm lượng): -96.0 to +16.0 dB
   - < 0: Nhỏ hơn
   - 0: Bình thường
   - > 0: To hơn

## Phong Cách Theo Genre

### 📚 Văn học / Truyện
- **speakingRate:** 0.95 (chậm hơn, truyền cảm)
- **pitch:** +2.0 (cao hơn, ấm áp)
- **volumeGainDb:** 0.0 (bình thường)
- **Mục đích:** Tạo không khí kể chuyện, truyền cảm

### 📰 Tin tức / Báo chí
- **speakingRate:** 1.1 (nhanh hơn, rõ ràng)
- **pitch:** 0.0 (trung tính, chuyên nghiệp)
- **volumeGainDb:** +1.0 (to hơn một chút)
- **Mục đích:** Rõ ràng, chuyên nghiệp như phát thanh viên

### 💼 Trang trọng / Công việc
- **speakingRate:** 1.0 (tốc độ chuẩn)
- **pitch:** -1.0 (thấp hơn, điềm đạm)
- **volumeGainDb:** +0.5 (ổn định)
- **Mục đích:** Lịch sự, chuyên nghiệp, phù hợp thuyết trình

### 💬 Thông thường
- **speakingRate:** 1.0 (tốc độ chuẩn)
- **pitch:** 0.0 (trung tính)
- **volumeGainDb:** 0.0 (bình thường)
- **Mục đích:** Tự nhiên, gần gũi

## Tùy Chỉnh

App đang bọc SSML trong `server.js` qua hàm `buildSsml` và các cấu hình:
- `STYLE_CONFIG` (rate/pitch/break theo phong cách)
- `MALE_VOICES` / `FEMALE_VOICES` (điều chỉnh pitch riêng chuẩn Nam/Nữ)
- `PARAGRAPH_BREAK` (khoảng nghỉ giữa đoạn)

## Bảng cấu hình SSML theo phong cách

| Phong cách | Rate | Pitch (Nam - Standard-D/B) | Pitch (Nữ - Standard-C/A) | Break | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| Văn học / Truyện | 0.88 | -2.0st | -1.0st | 750ms | Trầm ấm, kể chuyện chậm rãi, giảm cảm giác “robot”. |
| Phi hư cấu (Trang trọng / Công việc) | 0.95 | -1.0st | -0.5st | 450ms | Rõ ràng, mạch lạc, phù hợp sách học mà không quá lê thê. |
| Thông thường | 1.00 | 0st | 0st | 320ms | Giọng thân mật, như nói chuyện hàng ngày. |
| Tin tức / Báo chí | 1.08 | +0.5st | 0st | 220ms | Nhanh, khách quan, mô phỏng phát thanh bản tin 60s. |

Các giá trị này được áp dụng tự động khi chọn phong cách trong UI. Khi tạo SSML, hệ thống kết hợp rate/pitch/break cụ thể với giọng Standard hiện tại (A/B/C/D) để tạo trải nghiệm nghe dễ chịu hơn.

## Tùy chỉnh nâng cao

Nếu bạn muốn can thiệp thêm, bật “Tùy chỉnh SSML nâng cao” trong phần Cài đặt để nhập rate, pitch và khoảng break riêng. Những chỉ số này sẽ ghi đè lên cấu hình phong cách hiện tại, cho phép thử nghiệm nhanh nhịp/âm sắc khác (vd. rate 0.8 + pitch -1.5st + break 800ms). Hệ thống vẫn ghi lại giá trị này trong metadata audio để dễ kiểm chứng.

```javascript
const STYLE_CONFIG = {
  'Văn học / Truyện': {
    speakingRate: 0.95,  // Thay đổi từ 0.8-1.2
    pitch: 2.0,          // Thay đổi từ -5.0 đến +5.0
    volumeGainDb: 0.0,   // Thay đổi từ -3.0 đến +3.0
  },
  // ...
};
```

## Lưu Ý

- Các giá trị đã được tối ưu để phù hợp với tiếng Việt
- Không nên thay đổi quá nhiều (sẽ làm giọng nói không tự nhiên)
- Standard voices có giới hạn về SSML so với Neural2/Chirp3, nhưng vẫn đủ dùng
- Các điều chỉnh này không tốn thêm credits
