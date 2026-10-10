import { translator } from "@maskinid/shared/i18n/index.ts";
import { LABEL_CODE_ALPHABET, LABEL_CODE_LENGTH } from "@maskinid/shared/identifiers.ts";
import type { TFunction } from "i18next";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { SHEET, labelSheetPdf } from "./labelSheet";

const t = translator("sv") as unknown as TFunction;

/** Deterministic stand-ins for real codes: 22 characters of base62, varied so each QR differs. */
const codes = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    Array.from({ length: LABEL_CODE_LENGTH }, (_, j) => LABEL_CODE_ALPHABET[(i * 7 + j * 13) % LABEL_CODE_ALPHABET.length]!).join(""));

describe("label sheet", () => {
  it("fits 18 stickers on a page and paginates beyond that", async () => {
    const perPage = SHEET.cols * SHEET.rows;
    expect(perPage).toBe(18);
    const one = await PDFDocument.load(await labelSheetPdf(codes(perPage), t));
    expect(one.getPageCount()).toBe(1);
    const two = await PDFDocument.load(await labelSheetPdf(codes(perPage + 1), t));
    expect(two.getPageCount()).toBe(2);
  }, 30_000);

  it("is a PDF of A4 pages even for a single sticker", async () => {
    const bytes = await labelSheetPdf(codes(1), t);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });

  it("renders an empty page rather than failing when there is nothing to print", async () => {
    const doc = await PDFDocument.load(await labelSheetPdf([], t));
    expect(doc.getPageCount()).toBe(1);
  });

  it("caps the sheet so one click cannot rasterise thousands of codes", async () => {
    expect(SHEET.max).toBe(500);
    const doc = await PDFDocument.load(await labelSheetPdf(codes(SHEET.max + 20), t));
    expect(doc.getPageCount()).toBe(Math.ceil(SHEET.max / (SHEET.cols * SHEET.rows)));
  }, 120_000);
});
