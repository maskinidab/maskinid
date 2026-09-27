/**
 * JPEG metadata stripping (SPEC §11.5: EXIF-GPS is removed before storage). Removes APP1 (EXIF/XMP), APP13 (IPTC) and
 * COM segments; keeps image data, JFIF (APP0), ICC profiles (APP2) and Adobe (APP14) so colours are unchanged.
 * Pure byte operations – runs in the browser, Node and Deno.
 */
export function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
}

export function stripJpegMetadata(input: Uint8Array): { bytes: Uint8Array; removed: number } {
  if (!isJpeg(input)) return { bytes: input, removed: 0 };
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  let removed = 0;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) break; // malformed – copy the rest untouched
    const marker = input[i + 1]!;
    if (marker === 0xda) break; // start of scan: the rest is image data
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = (input[i + 2]! << 8) | input[i + 3]!;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (drop) removed++;
    else for (let k = i; k < i + 2 + len && k < input.length; k++) out.push(input[k]!);
    i += 2 + len;
  }
  const bytes = new Uint8Array(out.length + (input.length - i));
  bytes.set(out, 0);
  bytes.set(input.subarray(i), out.length);
  return { bytes, removed };
}

/** True if the JPEG still contains an EXIF APP1 segment. */
export function hasExif(input: Uint8Array): boolean {
  if (!isJpeg(input)) return false;
  let i = 2;
  while (i + 4 <= input.length && input[i] === 0xff) {
    const marker = input[i + 1]!;
    if (marker === 0xda) return false;
    const len = (input[i + 2]! << 8) | input[i + 3]!;
    if (marker === 0xe1) return true;
    i += 2 + len;
  }
  return false;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
