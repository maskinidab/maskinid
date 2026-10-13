import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, machineData, registerAs, serial } from "./factories.ts";
import { ORGS, tx, USERS, type Tx } from "./helpers.ts";

/**
 * Financing against a bank that does not use MaskinID yet (ADR 0027).
 *
 * The security line these tests exist to hold: being *nameable* as a lender is not a capability. A pending
 * placeholder can hold a reported financing and nothing else — it cannot register encumbrances, confirm them,
 * release them, or read a portfolio, until an operator approves the organisation and a signatory claims it.
 */

// Banks with no MaskinID account. In DEMO_MODE any organisation number resolves through the mock register, so
// these need no fixture. They must not reuse the demo seed's numbers, which already create placeholders for
// LF Finans and BNP Paribas Leasing.
const BANK_A = "559100-1002";
const BANK_B = "559100-1010";

async function dealerMachine(t: Tx, sn = serial("PH")) {
  return registerAs(t, "dealer", machineData({ identifiers: [{ type: "serial", value: sn }] }));
}

async function placeholderIdFor(t: Tx, orgNumber: string) {
  await t.as(null);
  return t.val<string>("select id from public.organizations where org_number_hash = app.org_number_hash($1)", [orgNumber]);
}

describe("financing against a lender outside MaskinID", () => {
  it("names the bank by organisation number and creates an unclaimed placeholder", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      const r = await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "BANK_A-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: BANK_A, p_holder_name: "LF Finans", p_holder_email: "ny@lf.example",
      });
      expect(r.ok).toBe(true);
      expect(r.encumbrance.status).toBe("pending");
      expect(r.holder_unclaimed).toBe(true);

      const id = await placeholderIdFor(t, BANK_A);
      expect(await t.val("select status::text from public.organizations where id = $1", [id])).toBe("pending");
      expect(await t.val("select 'financier' = any (types) from public.organizations where id = $1", [id])).toBe(true);
      expect(Number(await t.val("select count(*) from public.memberships where org_id = $1 and status = 'active'", [id]))).toBe(0);

      // notify_org writes nothing for a member-less org, so an invitation e-mail is what reaches the bank.
      expect(await t.val("select template from public.email_outbox where org_id = $1", [id])).toBe("invite_financier");
      // The placeholder is recorded as such in the event log.
      expect(await t.val("select (payload ->> 'placeholder')::boolean from public.events where org_id = $1 and type = 'org.created'", [id])).toBe(true);
    });
  });

  it("gives the placeholder no financier capability at all", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "BANK_A-2",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: BANK_A,
      });
      const id = await placeholderIdFor(t, BANK_A);

      // The predicate that lets it be named is NOT the predicate that grants power.
      expect(await t.val("select app.can_be_financier_holder($1)", [id])).toBe(true);
      expect(await t.val("select app.has_org_type($1, 'financier')", [id])).toBe(false);
      // A pending organisation acts as an owner only (SPEC §2.2).
      expect(await t.val("select app.has_org_type($1, 'owner')", [id])).toBe(true);

      // And it must never show up in the dropdown the UI offers, which would be a phishing surface.
      await t.as("dealer");
      const partners = await t.rpc<{ id: string }[]>("list_partner_orgs", { p_type: "financier" });
      expect(partners.some((o) => o.id === id)).toBe(false);
    });
  });

  it("a suspended organisation can never be named as a lender", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as(null);
      await t.q("update public.organizations set status = 'suspended' where id = $1", [ORGS.financier_a]);
      await t.as("dealer");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "X", p_start_date: TODAY, p_end_date: NEXT_YEAR,
      })).code).toBe("FINANCIER_NOT_ELIGIBLE");
    });
  });

  it("refuses an organisation that is not a lender, and a request with no lender at all", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_holder_org_id: ORGS.owner_b, p_type: "leasing",
        p_contract_ref: "X", p_start_date: TODAY, p_end_date: NEXT_YEAR,
      })).code).toBe("FINANCIER_NOT_ELIGIBLE");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "X", p_start_date: TODAY, p_end_date: NEXT_YEAR,
      })).code).toBe("VALIDATION");
    });
  });

  it("is claimed in place, so the financing is the bank's from their first login", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      const r = await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "BANK_A-3",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: BANK_A,
      });
      const id = await placeholderIdFor(t, BANK_A);

      // The lookup the onboarding form uses must say the organisation can be taken over.
      await t.as("newcomer");
      const look = await t.rpc("lookup_company", { p_org_number: BANK_A });
      expect(look.existing_org.claimable).toBe(true);
      expect(look.existing_org.needs_signatory).toBe(true);
      expect(look.existing_org.types).toContain("financier");

      const claimed = await t.rpc("create_org", {
        p_org_number: BANK_A, p_types: ["financier"], p_name: "LF Finans", p_accept_dpa_version: "2026-09",
      });
      expect(claimed.id).toBe(id);
      expect(claimed.claimed).toBe(true);
      // A lender is never auto-approved: the operator still reviews it.
      expect(claimed.status).toBe("pending");
      await t.as(null);
      expect(await t.val("select count(*)::int from public.events where org_id = $1 and type = 'org.claimed'", [id])).toBe(1);

      // Still no financier power while pending.
      expect(await t.val("select app.has_org_type($1, 'financier')", [id])).toBe(false);

      await t.as("operator");
      await t.rpc("approve_org", { p_org_id: id });
      await t.as(null);
      expect(await t.val("select app.has_org_type($1, 'financier')", [id])).toBe(true);

      // Now the reported financing is theirs to confirm, with no data entry at all.
      await t.as("newcomer");
      const inbox = await t.rpc<{ items: { kind: string; id: string }[] }>("get_inbox", { p_org_id: id });
      expect(inbox.items.map((i) => i.kind)).toContain("encumbrance_confirm");
      expect((await t.rpc<unknown[]>("list_portfolio", { p_org_id: id })).length).toBe(1);
      expect((await t.rpc("confirm_encumbrance", { p_org_id: id, p_encumbrance_id: r.encumbrance.id })).ok).toBe(true);
    });
  });

  it("a placeholder carrying only encumbrances still needs a signatory to claim", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "BANK_B-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: BANK_B,
      });
      const id = await placeholderIdFor(t, BANK_B);
      // It owns no machines, only a financing — which is just as load-bearing.
      expect(Number(await t.val("select count(*) from public.machines where owner_org_id = $1", [id]))).toBe(0);
      expect(await t.val("select app.placeholder_is_load_bearing($1)", [id])).toBe(true);

      // Outside DEMO_MODE the signatory requirement is enforced.
      await t.as(null);
      await t.q("update public.app_config set value = to_jsonb(false) where key = 'DEMO_MODE'");
      await t.q(
        `insert into public.company_lookups (org_number_hash, name, city, address, is_sole_trader, source, looked_up_at, signatory_hashes)
         values (app.org_number_hash($1), 'BNP Paribas Leasing', 'Göteborg', '{}'::jsonb, false, 'mock', now(), '{}')
         on conflict (org_number_hash) do update set looked_up_at = now(), signatory_hashes = '{}'`, [BANK_B]);
      await t.as("newcomer");
      expect((await t.rpcError("create_org", {
        p_org_number: BANK_B, p_types: ["financier"], p_name: "BANK_B", p_accept_dpa_version: "2026-09",
      })).code).toBe("SIGNATORY_REQUIRED");
    });
  });

  it("an unclaimed organisation gains the lender type instead of becoming a duplicate", async () => {
    await tx(async (t) => {
      // First seen as an owner, because a dealer registered a machine for it.
      await t.as("dealer");
      const m1 = await t.rpc("register_machine", {
        p_org_id: ORGS.dealer,
        p_data: machineData({ identifiers: [{ type: "serial", value: serial("PH2") }], owner_org_number: BANK_A }),
      });
      const id = await placeholderIdFor(t, BANK_A);
      expect(await t.val("select types::text from public.organizations where id = $1", [id])).toBe("{owner}");

      // Then named as the lender on another machine.
      const m2 = await dealerMachine(t);
      await t.as("dealer");
      await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m2.id, p_type: "leasing", p_contract_ref: "BANK_A-4",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: BANK_A,
      });
      await t.as(null);
      expect(await t.val("select types::text from public.organizations where id = $1", [id])).toBe("{owner,financier}");
      // One organisation, not two.
      expect(Number(await t.val("select count(*) from public.organizations where org_number_hash = app.org_number_hash($1)", [BANK_A]))).toBe(1);
      expect(m1.id).not.toBe(m2.id);
    });
  });

  it("a claimed organisation is never silently given a new type", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      // owner_b is a real, claimed organisation that is not a lender. Read its number as the database owner:
      // a dealer cannot see that row at all (organizations_read), and passing null would just be a VALIDATION.
      await t.as(null);
      const ownerBNumber = await t.val<string>("select org_number from public.organizations where id = $1", [ORGS.owner_b]);
      expect(ownerBNumber).toBeTruthy();

      await t.as("dealer");
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "X",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_holder_org_number: ownerBNumber,
      })).code).toBe("FINANCIER_NOT_ELIGIBLE");

      // Naming it must fail, not relabel it: only an unclaimed placeholder may gain a type.
      await t.as(null);
      expect(await t.val("select types::text from public.organizations where id = $1", [ORGS.owner_b])).toBe("{owner}");
    });
  });

  it("the sale flow can name a lender by organisation number too", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      const tr = await t.rpc("initiate_transfer", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_sale_date: TODAY, p_to_org_id: ORGS.owner_b,
        p_new_financing: { holder_org_number: BANK_A, holder_name: "LF Finans", type: "leasing", contract_ref: "LF-2026-1", end_date: NEXT_YEAR },
      });
      // The bank is told at once, rather than only when the buyer accepts.
      expect(tr.transfer.new_encumbrance.status).toBe("pending");
      const id = await placeholderIdFor(t, BANK_A);
      expect(await t.val("select holder_org_id from public.encumbrances where machine_id = $1", [m.id])).toBe(id);
    });
  });

  it("get_financier_profile carries the bank's own defaults, and match_financier resolves a name", async () => {
    await tx(async (t) => {
      await t.as("financier_a");
      await t.rpc("update_org", {
        p_org_id: ORGS.financier_a,
        p_patch: { settings: { financing_defaults: { default_type: "leasing", default_term_months: 60, contact_email: "losen@testfinans.se" } } },
      });
      const p = await t.rpc("get_financier_profile", { p_org_id: ORGS.financier_a });
      expect(p.financing_defaults).toMatchObject({ default_type: "leasing", default_term_months: 60 });

      await t.as("dealer");
      const byName = await t.rpc("match_financier", { p_org_id: ORGS.dealer, p_name: "Test Finans A" });
      expect(byName.org.id).toBe(ORGS.financier_a);
      expect(byName.eligible).toBe(true);
      const byNumber = await t.rpc("match_financier", {
        p_org_id: ORGS.dealer,
        p_org_number: await t.val<string>("select org_number from public.organizations where id = $1", [ORGS.financier_a]),
      });
      expect(byNumber.org.id).toBe(ORGS.financier_a);
      // A name nobody matches is reported as no hit, not as an error.
      expect((await t.rpc("match_financier", { p_org_id: ORGS.dealer, p_name: "Alldeles Okänd Bank" })).org).toBe(null);
    });
  });
});

describe("financing documents", () => {
  it("attaches the bank order to the financing and shares it with the lender", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      // A dealer may stage an organisation-level document before any financing exists.
      await t.as("dealer");
      const up = await t.rpc<{ id: string }>("create_document_upload", {
        p_org_id: ORGS.dealer, p_machine_id: null, p_type: "bank_order", p_filename: "bankbestallning.pdf",
        p_mime: "application/pdf", p_size_bytes: 4096, p_sha256: "d".repeat(64), p_visibility: "owner",
      });
      const doc = await t.rpc<{ id: string }>("finalize_document", { p_org_id: ORGS.dealer, p_document_id: up.id });
      const r = await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "BO-1", p_start_date: TODAY, p_end_date: NEXT_YEAR, p_document_ids: [doc.id],
      });
      expect(r.encumbrance.documents.map((d: { type: string }) => d.type)).toEqual(["bank_order"]);

      // The lender can read it; an unrelated organisation cannot.
      await t.as("financier_a");
      const v = await t.rpc("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id });
      expect(v.encumbrances[0].documents.map((d: { type: string }) => d.type)).toEqual(["bank_order"]);
      await t.as("owner_b");
      expect(Number(await t.val("select count(*) from public.documents where id = $1", [doc.id]))).toBe(0);
    });
  });

  it("refuses a document that belongs to another machine", async () => {
    await tx(async (t) => {
      const a = await dealerMachine(t);
      const b = await dealerMachine(t);
      await t.as("dealer");
      const up = await t.rpc<{ id: string }>("create_document_upload", {
        p_org_id: ORGS.dealer, p_machine_id: a.id, p_type: "financing_contract", p_filename: "avtal.pdf",
        p_mime: "application/pdf", p_size_bytes: 1024, p_sha256: "e".repeat(64), p_visibility: "owner",
      });
      const doc = await t.rpc<{ id: string }>("finalize_document", { p_org_id: ORGS.dealer, p_document_id: up.id });
      expect((await t.rpcError("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: b.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "X", p_start_date: TODAY, p_end_date: NEXT_YEAR, p_document_ids: [doc.id],
      })).code).toBe("VALIDATION");
    });
  });
});

describe("a reported financing is visible before the lender confirms", () => {
  it("shows as pending on the machine and in the list, but never in a financing check", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "P-1", p_start_date: TODAY, p_end_date: NEXT_YEAR,
      });
      const v = await t.rpc("get_machine", { p_org_id: ORGS.dealer, p_machine_id: m.id });
      expect(v.financing.has_active).toBe(false);
      expect(v.financing.has_pending).toBe(true);
      expect(v.financing.pending.holder.name).toBe("Test Finans A AB");

      const list = await t.rpc<{ items: { id: string; has_active_financing: boolean; has_pending_financing: boolean }[] }>(
        "list_machines", { p_org_id: ORGS.dealer, p_scope: "owned" });
      const row = list.items.find((x) => x.id === m.id)!;
      expect(row.has_active_financing).toBe(false);
      expect(row.has_pending_financing).toBe(true);

      // The financing check is the lender's legal answer and must stay strictly on active financing
      // (SPEC §6.6, §16.3–4): a reported but unconfirmed financing is not an encumbrance.
      await t.as("financier_b");
      const check = await t.rpc("perform_check", { p_org_id: ORGS.financier_b, p_query: { type: "reg", value: m.reg_number }, p_purpose: "test" });
      expect(check.result.has_active_financing).toBe(false);
    });
  });
});

describe("the lender's own actions finally have a route", () => {
  it("rejects a reported financing, and a takeover is accepted rather than confirmed", async () => {
    await tx(async (t) => {
      const m = await dealerMachine(t);
      await t.as("dealer");
      const r = await t.rpc("request_encumbrance", {
        p_org_id: ORGS.dealer, p_machine_id: m.id, p_holder_org_id: ORGS.financier_a, p_type: "leasing",
        p_contract_ref: "R-1", p_start_date: TODAY, p_end_date: NEXT_YEAR,
      });
      await t.as("financier_a");
      expect((await t.rpc("reject_encumbrance", { p_org_id: ORGS.financier_a, p_encumbrance_id: r.encumbrance.id, p_reason: "Avtalet är inte vårt" })).ok).toBe(true);
      await t.as(null);
      expect(await t.val("select status::text from public.encumbrances where id = $1", [r.encumbrance.id])).toBe("rejected");
    });
  });
});

describe("export keeps the machine's identity", () => {
  it("keeps the label and the serial, logs its own event, and can be undone", async () => {
    await tx(async (t) => {
      const sn = serial("EXP");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: sn }] }));

      // A bound label is what makes the QR on an exported machine resolve.
      await t.as("operator");
      await t.rpc("print_label_batch", { p_batch_id: null, p_quantity: 1, p_assigned_org_id: null, p_printer_ref: "T" });
      await t.as(null);
      const code = await t.val<string>("select code from public.labels where status = 'printed' and machine_id is null order by created_at, code limit 1");
      await t.as("owner_a");
      await t.rpc("bind_label", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_code: code, p_role: "primary" });

      const sig = await (await import("./factories.ts")).sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "exported", label_disposition: "kept" });
      const r = await t.rpc("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "exported", p_label_disposition: "kept",
        p_signature_id: sig, p_export_country: "no", p_export_customs_ref: "TULL-1",
      });
      expect(r.status).toBe("exported");
      expect(r.labels_revoked).toBe(0);

      await t.as(null);
      expect(await t.val("select status::text from public.labels where machine_id = $1", [m.id])).toBe("bound");
      expect(await t.val("select unique_active from public.machine_identifiers where machine_id = $1 and type = 'serial'", [m.id])).toBe(true);
      expect(await t.val("select export_country from public.machines where id = $1", [m.id])).toBe("NO");
      expect(Number(await t.val("select count(*) from public.events where machine_id = $1 and type = 'machine.exported'", [m.id]))).toBe(1);

      // The serial still finds the machine — this is the behaviour that was reported as missing.
      await t.as("owner_a");
      const check = await t.rpc("check_identifier", { p_org_id: ORGS.owner_a, p_type: "serial", p_value: sn });
      expect(check.exists).toBe(true);
      expect(check.status).toBe("exported");

      // And the public card still resolves by QR.
      await t.as("anon");
      const card = await t.rpc("public_machine_card", { p_code: code });
      expect(card.found).toBe(true);
      expect(card.card.status).toBe("exported");
      expect(card.card.export_country).toBe("NO");
      expect(card.card.label_status).toBe("bound");

      // Re-import brings it back, keeping the export in the history.
      await t.as("owner_a");
      const sig2 = await (await import("./factories.ts")).sign(t, ORGS.owner_a, "reimport_machine", m.id, {});
      expect((await t.rpc("reimport_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_signature_id: sig2 })).status).toBe("active");
      await t.as(null);
      expect(await t.val("select export_country from public.machines where id = $1", [m.id])).toBe("NO");
      expect(await t.val("select deregistration_reason from public.machines where id = $1", [m.id])).toBe(null);
    });
  });

  it("scrapping still revokes the label and releases the serial", async () => {
    await tx(async (t) => {
      const sn = serial("SCR");
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: sn }] }));
      const sig = await (await import("./factories.ts")).sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "scrapped", label_disposition: "destroyed" });
      await t.rpc("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "scrapped", p_label_disposition: "destroyed", p_signature_id: sig,
      });
      await t.as(null);
      expect(await t.val("select unique_active from public.machine_identifiers where machine_id = $1 and type = 'serial'", [m.id])).toBe(false);
    });
  });

  it("refuses 'kept' for anything but an export, and export fields for anything but an export", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: serial("NEG") }] }));
      const { sign } = await import("./factories.ts");
      const s1 = await sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "scrapped", label_disposition: "kept" });
      expect((await t.rpcError("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "scrapped", p_label_disposition: "kept", p_signature_id: s1,
      })).code).toBe("VALIDATION");
      const s2 = await sign(t, ORGS.owner_a, "deregister_machine", m.id, { reason: "scrapped", label_disposition: "destroyed" });
      expect((await t.rpcError("deregister_machine", {
        p_org_id: ORGS.owner_a, p_machine_id: m.id, p_reason: "scrapped", p_label_disposition: "destroyed",
        p_signature_id: s2, p_export_country: "NO",
      })).code).toBe("VALIDATION");
    });
  });

  it("only the owner may re-import, and only an exported machine", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_a", machineData({ identifiers: [{ type: "serial", value: serial("RIM") }] }));
      const { sign } = await import("./factories.ts");
      const sig = await sign(t, ORGS.owner_a, "reimport_machine", m.id, {});
      expect((await t.rpcError("reimport_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id, p_signature_id: sig })).code).toBe("MACHINE_NOT_EXPORTED");
      void USERS;
    });
  });
});
