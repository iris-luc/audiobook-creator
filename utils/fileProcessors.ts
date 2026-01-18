
declare const pdfjsLib: any;
declare const mammoth: any;

import { cleanText } from './textCleaner';

export async function extractTextFromFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let rawText = '';

  switch (extension) {
    case 'txt':
      rawText = await file.text();
      break;
    case 'pdf':
      rawText = await extractTextFromPDF(file);
      break;
    case 'docx':
      rawText = await extractTextFromDocx(file);
      break;
    default:
      throw new Error(`Định dạng file .${extension} không được hỗ trợ.`);
  }

  // Clean text ngay sau khi extract để loại bỏ formatting không cần thiết
  return cleanText(rawText);
}

async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}
