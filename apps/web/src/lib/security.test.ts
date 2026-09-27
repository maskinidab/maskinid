import { describe, expect, it } from "vitest";
import { uaFamily } from "./security";

describe("uaFamily", () => {
  it("keeps only browser and OS", () => {
    expect(uaFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(uaFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge · Windows");
  });
});
