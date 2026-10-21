import path from "node:path";

export type FileKind = "markdown" | "text" | "pdf" | "image";

const EXT: Record<string, { kind: FileKind; mime: string }> = {
  ".md": { kind: "markdown", mime: "text/markdown" },
  ".markdown": { kind: "markdown", mime: "text/markdown" },
  ".txt": { kind: "text", mime: "text/plain" },
  ".pdf": { kind: "pdf", mime: "application/pdf" },
  ".png": { kind: "image", mime: "image/png" },
  ".jpg": { kind: "image", mime: "image/jpeg" },
  ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".gif": { kind: "image", mime: "image/gif" },
  ".webp": { kind: "image", mime: "image/webp" },
};

export const UNSUPPORTED_HINT: Record<string, string> = {
  ".docx": "Word documents are not supported yet (no reliable extractor installed). Export to PDF or Markdown first.",
  ".doc": "Legacy Word documents are not supported. Export to PDF or Markdown first.",
  ".pptx": "PowerPoint files are not supported yet. Export to PDF first.",
  ".xlsx": "Spreadsheets are not supported yet. Export to CSV/Markdown first.",
  ".html": "HTML files are not imported (they could contain scripts). Save the page as Markdown or PDF.",
};

export class UnsupportedFileError extends Error {}

export function classifyFile(filename: string): { kind: FileKind; mime: string } {
  const ext = path.extname(filename).toLowerCase();
  const hit = EXT[ext];
  if (!hit) throw new UnsupportedFileError(UNSUPPORTED_HINT[ext] ?? `Files of type "${ext || "(none)"}" are not supported. Supported: .md, .txt, .pdf, images.`);
  return hit;
}

/** Check that the bytes match the claimed type, so a renamed executable is rejected. */
export function verifyMagic(kind: FileKind, buf: Buffer): boolean {
  if (kind === "pdf") return buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (kind === "image") {
    const h = buf.subarray(0, 12);
    return (
      (h[0] === 0x89 && h.subarray(1, 4).toString() === "PNG") ||
      (h[0] === 0xff && h[1] === 0xd8) ||
      h.subarray(0, 3).toString() === "GIF" ||
      (h.subarray(0, 4).toString() === "RIFF" && h.subarray(8, 12).toString() === "WEBP")
    );
  }
  // text: reject binary content (NUL bytes in the first 8 KB)
  return !buf.subarray(0, 8192).includes(0);
}

export async function extractText(buf: Buffer, kind: FileKind): Promise<{ text: string; pages?: number }> {
  if (kind === "markdown" || kind === "text") return { text: buf.toString("utf8") };
  if (kind === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text, totalPages } = await pdfText(pdf, { mergePages: true });
    return { text: (Array.isArray(text) ? text.join("\n\n") : text).trim(), pages: totalPages };
  }
  return { text: "" }; // images: stored, but no OCR in this release
}
