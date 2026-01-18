# Dọn Dẹp Văn Bản - Chuẩn Giọng Standard

## Tổng quan

Google Cloud TTS Standard nhìn chữ và dấu chấm câu một cách rất "cụt càu". Nếu văn bản còn nhiều ký tự trang trí hoặc emoji, máy sẽ đọc verbatim: “gạch ngang, sao, trái tim, trên...”. App vì vậy luôn chạy một bước clean để:

1. Giữ lại ký tự có tiếng (chữ cái, số, .,!?;:()),
2. Loại bỏ "dang dở" đang khiến TTS hú kiểu robot,
3. Giảm whitespace/emoji để tiết kiệm credits.

## Phân loại ký tự khi clean

### 1. Nhóm "Vô hình"

Những ký tự này không đọc tên, nhưng nếu có nhiều sẽ tốn tiền hoặc gây ngắt đoạn:

- Khoảng trắng liên tiếp: thay bằng 1 space (10 spaces thì tốn 10 ký tự, nhưng đọc như 1).
- Dấu xuống dòng (`\n`, `\r`): Norm chuyển thành 1 hoặc 2 newline, giữ lại để SSML cảm nhận đoạn mới.
- Tab (`\t`): chuyển thành space.
- Ngoặc cặp `()`, `[]`, `"`, `'`: TTS thường bỏ qua nhưng còn "nghỉ" trước/sau. Clean giữ nguyên nếu chúng bao quanh cụm chữ, còn nếu đứng riêng thì trim.

### 2. Nhóm "Điều khiển"

Giữ lại để định nhịp:

- `.` `;` `:` → pause dài hơn (~0.5s).
- `,` → pause ngắn.
- `?` → lên giọng cuối câu.
- `!` → nhấn mạnh (Standard không nổi bật nhưng có tác dụng).
- `...` → kéo dài âm tiết cuối, tạo ngập ngừng.

### 3. Nhóm "Nguy hiểm"

Những ký tự này TTS Standard sẽ đọc thành tiếng "gạch ngang", "sao", "gạch chéo"… nên luôn bị xóa hoặc thay space:

- `-`, `_`, `=`, `#`, `~`, `*` (khi đứng thành chuỗi > 1): thay bằng space. Nếu nằm giữa số/chuỗi thì cũng convert thành space để tránh đọc “gạch ngang”.
- Dấu gạch ngang `-`: luôn chuyển thành dấu phẩy `,` sau khi đảm bảo không phá ellipsis; mục đích giữ nhịp ngang với dấu câu.
- `/`, `+`, `@`, `^`: thay bằng space.
- Emoji (🙂, 😡, 🌲…): xóa vì TTS đôi khi hé lộ tên emoji.
- Các ký tự khác ngoài chữ/số/dấu chấm câu đề cập ở trên: xóa luôn.

## Chiến lược Regex cleaning

1. **Sanitize Markdown:** xóa link, header, code block, tag, list (giữ phần text).
2. **Entity:** `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;` → ký tự thật.
3. **Whitespace:** normal hóa newline, collapse multi-space/tab -> 1 space, cắt leading/trailing/trailing spaces per line.
4. **Dangerous chars:** replace sequences `[\*\-\=\#\_\~]{2,}` bằng space; chuyển `-` thành `,` (vẫn giữ ..., vì ảnh hưởng giọng); convert `1990-2000` thành `1990 2000`; `online-offline` cũng thành `online offline`; remove `/`, `+`, `@`, `^`.
5. **Paragraph gap:** khoảng trống giữa đoạn (2 newline trở lên) được chuyển thành `.` để TTS nghe như chuyển câu lớn.
6. **Emoji:** xóa bằng regex Unicode `\p{Emoji_Presentation}`/`Extended_Pictographic`.
7. **Limit:** chỉ giữ `\p{L}`, `\p{N}`, whitespace và .,!?;:().
8. **Finalize:** trim, loại bỏ dòng <2 ký tự, collapse spaces một lần nữa.

## Khi nào text được clean?

- Upload file/ paste vào textarea/ trước khi gọi API đều qua step này.

## Vì sao phải clean?

- Giọng Standard đọc: `Chương một hai chấm... gạch ngang... sao...`. Clean sớm sẽ đi thẳng vào nội dung: “Chương 1. Mở đầu. Ngày 20 tháng 10. Hôm nay trời đẹp.”  
- Cắt hết bộ lọc không cần thiết giúp giảm ký tự và tránh TTS "nghịch ngợm" đọc tên ký tự.

## Ghi chú

- Nếu bạn muốn giữ break hoàn toàn, có thể thêm `<break time="1s"/>` trong SSML thay vì chuỗi ký tự trang trí; hệ thống hiện tại chuyển các chuỗi nguy hiểm thành space để vừa tránh đọc vừa giữ nhịp.
