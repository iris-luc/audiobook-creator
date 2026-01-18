// File này được generate tự động từ readingStyles.ts để backend Node.js sử dụng
// Chỉ chứa các thông số cần thiết cho SSML

export default {
    'Văn học / Truyện': {
        rate: 0.88,
        breakTime: '700ms',
        pitchMale: '-2st',
        pitchFemale: '-1st',
        pitchDefault: '-1st',
    },
    'Phi hư cấu (Sách học)': {
        rate: 0.95,
        breakTime: '450ms',
        pitchMale: '-1st',
        pitchFemale: '-0.5st',
        pitchDefault: '-0.5st',
    },
    'Thông thường': {
        rate: 1.0,
        breakTime: '300ms',
        pitchMale: '0st',
        pitchFemale: '0st',
        pitchDefault: '0st',
    },
    'Tin tức / Báo chí': {
        rate: 1.08,
        breakTime: '220ms',
        pitchMale: '+0.5st',
        pitchFemale: '0st',
        pitchDefault: '0st',
    },
};
