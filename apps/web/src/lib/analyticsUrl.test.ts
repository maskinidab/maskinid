import { describe, expect, it } from "vitest";
import { analyticsUrl } from "./analyticsUrl";

describe("what page-view analytics may see", () => {
  it("never the token of a share link or an invitation", () => {
    expect(analyticsUrl("https://maskinid.se/s/AbC123secret")).toBe("https://maskinid.se/s/[token]");
    expect(analyticsUrl("https://app.maskinid.se/invite/deadbeef?x=1")).toBe("https://app.maskinid.se/invite/[token]");
  });

  it("never which machine or organisation", () => {
    expect(analyticsUrl("https://maskinid.se/m/4tFQQcpw8vZBUvs6n6Sqg2")).toBe("https://maskinid.se/m/[code]");
    expect(analyticsUrl("https://maskinid.se/r/Q68HTH9")).toBe("https://maskinid.se/r/[reg]");
    expect(analyticsUrl("https://app.maskinid.se/o/bergs-schakt/machines/0c9c99a4-9564-490b-befa-eb9ab6f17f52?tab=history"))
      .toBe("https://app.maskinid.se/o/[org]/machines/[id]");
  });

  it("drops query strings and fragments, and keeps ordinary pages as they are", () => {
    expect(analyticsUrl("https://app.maskinid.se/login?next=/o/x/machines#top")).toBe("https://app.maskinid.se/login");
    expect(analyticsUrl("https://maskinid.se/help/qr-markning")).toBe("https://maskinid.se/help/qr-markning");
    expect(analyticsUrl("not a url")).toBe("");
  });
});
