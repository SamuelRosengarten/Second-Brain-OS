import { describe, expect, it } from "vitest";
import { classifyFile, extractText, UnsupportedFileError, verifyMagic } from "../src/lib/extract.ts";
import { contentHash, newId, sha256, todayLocal } from "../src/lib/util.ts";

describe("classifyFile", () => {
  it("recognises supported types case-insensitively", () => {
    expect(classifyFile("Notes.MD")).toEqual({ kind: "markdown", mime: "text/markdown" });
    expect(classifyFile("a.markdown").kind).toBe("markdown");
    expect(classifyFile("a.txt").kind).toBe("text");
    expect(classifyFile("Report.PDF")).toEqual({ kind: "pdf", mime: "application/pdf" });
    for (const f of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp"]) expect(classifyFile(f).kind).toBe("image");
  });
  it("uses the last extension only", () => {
    expect(classifyFile("archive.tar.md").kind).toBe("markdown");
    expect(() => classifyFile("notes.md.exe")).toThrow(UnsupportedFileError);
  });
  it("gives a specific hint for known unsupported formats", () => {
    expect(() => classifyFile("a.docx")).toThrow(/Word documents/);
    expect(() => classifyFile("a.pptx")).toThrow(/PowerPoint/);
    expect(() => classifyFile("a.xlsx")).toThrow(/Spreadsheets/);
    expect(() => classifyFile("a.html")).toThrow(/scripts/);
  });
  it("names the missing extension for unknown files", () => {
    expect(() => classifyFile("README")).toThrow(/\(none\)/);
    expect(() => classifyFile("a.xyz")).toThrow(/\.xyz/);
  });
});

describe("verifyMagic", () => {
  it("accepts a real PDF header and rejects anything else", () => {
    expect(verifyMagic("pdf", Buffer.from("%PDF-1.7\n..."))).toBe(true);
    expect(verifyMagic("pdf", Buffer.from("MZ\x90\x00"))).toBe(false);
    expect(verifyMagic("pdf", Buffer.alloc(0))).toBe(false);
  });
  it("accepts PNG, JPEG, GIF and WEBP signatures", () => {
    expect(verifyMagic("image", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(true);
    expect(verifyMagic("image", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(verifyMagic("image", Buffer.from("GIF89a......"))).toBe(true);
    expect(verifyMagic("image", Buffer.from("RIFF\0\0\0\0WEBP"))).toBe(true);
  });
  it("rejects a renamed executable or a RIFF file that is not WEBP", () => {
    expect(verifyMagic("image", Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"))).toBe(false);
    expect(verifyMagic("image", Buffer.from("RIFF\0\0\0\0WAVE"))).toBe(false);
    expect(verifyMagic("image", Buffer.alloc(0))).toBe(false);
  });
  it("rejects text with NUL bytes in the first 8 KB, but not later ones", () => {
    expect(verifyMagic("text", Buffer.from("hello\0world"))).toBe(false);
    expect(verifyMagic("markdown", Buffer.from("# fine\n"))).toBe(true);
    const late = Buffer.concat([Buffer.alloc(8192, "a"), Buffer.from([0])]);
    expect(verifyMagic("text", late)).toBe(true);
    expect(verifyMagic("text", Buffer.alloc(0))).toBe(true);
  });
});

describe("extractText", () => {
  it("returns text and markdown unchanged, including non-ASCII", async () => {
    expect((await extractText(Buffer.from("héllo ✓"), "text")).text).toBe("héllo ✓");
    expect((await extractText(Buffer.from("# T\n\nbody"), "markdown")).text).toBe("# T\n\nbody");
  });
  it("stores images with no text", async () => {
    expect(await extractText(Buffer.from([1, 2, 3]), "image")).toEqual({ text: "" });
  });
  it("rejects a file that claims to be a PDF but is not parseable", async () => {
    await expect(extractText(Buffer.from("%PDF-1.4 not really"), "pdf")).rejects.toBeDefined();
  });
});

describe("util", () => {
  it("sha256 is stable and accepts strings and buffers", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256(Buffer.from("abc"))).toBe(sha256("abc"));
  });
  it("contentHash ignores case, surrounding and repeated whitespace", () => {
    expect(contentHash("  Buy   MILK\n\ntoday ")).toBe(contentHash("buy milk today"));
    expect(contentHash("buy milk")).not.toBe(contentHash("buy bread"));
  });
  it("newId gives unique UUIDs", () => {
    const ids = new Set(Array.from({ length: 50 }, newId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("todayLocal formats a given date as YYYY-MM-DD in local time", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
