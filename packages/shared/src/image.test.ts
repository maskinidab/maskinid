import { describe, expect, it } from "vitest";
import { hasExif, sha256Hex, stripJpegMetadata } from "./image.ts";

function seg(marker: number, payload: number[]) {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

describe("stripJpegMetadata", () => {
  const exif = seg(0xe1, [...new TextEncoder().encode("Exif\0\0GPS-LAT-59.85")]);
  const jfif = seg(0xe0, [...new TextEncoder().encode("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const scan = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xff, 0xd9];
  const jpeg = new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...seg(0xfe, [0x41]), ...scan]);

  it("removes EXIF and comments, keeps JFIF and image data", () => {
    expect(hasExif(jpeg)).toBe(true);
    const { bytes, removed } = stripJpegMetadata(jpeg);
    expect(removed).toBe(2);
    expect(hasExif(bytes)).toBe(false);
    expect(new TextDecoder().decode(bytes)).not.toContain("GPS");
    expect([...bytes.slice(-scan.length)]).toEqual(scan);
    expect([...bytes.slice(2, 2 + jfif.length)]).toEqual(jfif);
  });

  it("leaves non-JPEG data unchanged", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripJpegMetadata(png).bytes).toBe(png);
  });

  it("hashes", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
