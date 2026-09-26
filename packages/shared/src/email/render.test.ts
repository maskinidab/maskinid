import { describe, expect, it } from "vitest";
import { FORBIDDEN_PRODUCT_NAMES } from "../config.ts";
import { EMAIL_TEMPLATES, renderEmail, type OutboxMessage } from "./render.ts";

const BASE = "https://maskinid.se";
const samples: Record<string, Record<string, unknown>> = {
  notification: { type: "flag.stolen", data: { reg_number: "ABC-123", type: "stolen" }, link: "/machines/1", severity: "critical" },
  invite: { org_name: "Bergs Schakt AB", token: "tok<en>", role: "member", inviter: "Bengt Berg" },
  invite_owner: { org_name: "Bergs Schakt AB", token: "t1", registered_by: "Nordmaskin AB" },
  transfer_invite: { token: "t2", transfer_id: "tr1", reg_number: "ABC-123", make: "Volvo", model: "EC220E", seller: "Nordmaskin AB" },
  weekly_digest: { org_name: "Bergs", items: [{ title: "Service 500 h", reg_number: "ABC-123", make: "Volvo", model: "L60H", due_at: "2026-10-01", due_hours: 500, hour_meter: 450 }] },
  ownership_certificate: { certificate_number: "B-2026-000001", result_hash: "ab", reg_number: "ABC-123", make: "Volvo", model: "L60H", org_name: "Bergs", seller: "Nordmaskin AB", machine_id: "m1" },
  sms: { type: "flag.stolen", data: { reg_number: "ABC-123" }, link: "/machines/1" },
};

describe("e-mail templates (SPEC §13)", () => {
  for (const template of EMAIL_TEMPLATES) {
    for (const locale of ["sv", "en"]) {
      it(`${template} renders in ${locale} without placeholders, forbidden names or unescaped input`, () => {
        const r = renderEmail({ template, locale, data: samples[template] } as OutboxMessage, { baseUrl: BASE })!;
        expect(r).not.toBeNull();
        const all = `${r.subject}\n${r.text}\n${r.html}\n${r.sms ?? ""}`;
        expect(all).not.toMatch(/\{\{|\}\}|email\.|notifications\./);
        for (const bad of FORBIDDEN_PRODUCT_NAMES) expect(all.toLowerCase()).not.toContain(bad);
        expect(r.html).not.toContain("tok<en>");
        expect(r.subject.length).toBeGreaterThan(5);
      });
    }
  }
  it("links are absolute https and app paths go through /go", () => {
    const r = renderEmail({ template: "notification", data: samples.notification }, { baseUrl: BASE })!;
    expect(r.text).toContain("https://maskinid.se/go?to=%2Fmachines%2F1");
    expect(r.subject).toMatch(/^Viktigt:/);
    const inv = renderEmail({ template: "transfer_invite", locale: "en", data: samples.transfer_invite }, { baseUrl: BASE })!;
    expect(inv.text).toContain("https://maskinid.se/transfer/tr1?token=t2");
    expect(inv.subject).toBe("Nordmaskin AB wants to transfer Volvo EC220E (ABC-123) to you");
  });
  it("plural subjects and unknown templates", () => {
    expect(renderEmail({ template: "weekly_digest", data: samples.weekly_digest }, { baseUrl: BASE })!.subject).toBe("Bergs: 1 påminnelse den här veckan");
    expect(renderEmail({ template: "nope", data: {} }, { baseUrl: BASE })).toBeNull();
    expect(renderEmail({ template: "sms", data: samples.sms }, { baseUrl: BASE })!.sms!.length).toBeLessThanOrEqual(320);
  });
});
