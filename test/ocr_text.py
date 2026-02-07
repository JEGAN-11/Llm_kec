import os
import pytesseract
from pdf2image import convert_from_path


# 🔧 CHANGE THIS
PDF_PATH = r"data/ocr/KEC-R2024-AIDS.pdf"
OUTPUT_TXT = "ocr_output.txt"

# (Windows only – uncomment if needed)
# pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def ocr_pdf_to_text(pdf_path: str) -> str:
    images = convert_from_path(pdf_path, dpi=300)
    pages_text = []

    print(f"📄 Total pages: {len(images)}")

    for i, img in enumerate(images, start=1):
        print(f"🖼️ OCR page {i}")
        text = pytesseract.image_to_string(img, lang="eng")
        pages_text.append(text)

    return "\n\n".join(pages_text)


if __name__ == "__main__":
    print("🔍 Starting OCR...")
    extracted_text = ocr_pdf_to_text(PDF_PATH)

    with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
        f.write(extracted_text)

    print("\n✅ OCR completed")
    print(f"📁 Saved output to: {OUTPUT_TXT}")
    print(f"📊 Characters extracted: {len(extracted_text)}")
