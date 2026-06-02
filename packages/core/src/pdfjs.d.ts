declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export interface PdfTextItem {
    str?: string;
  }

  export interface PdfPageProxy {
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
  }

  export interface PdfDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxy>;
  }

  export function getDocument(source: unknown): { promise: Promise<PdfDocumentProxy> };
}
