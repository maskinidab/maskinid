import { describe, expect, it } from "vitest";
import { NEXT_YEAR, TODAY, encumber, machineData, registerAs, sign } from "./factories.ts";
import { ORGS, tx } from "./helpers.ts";

/**
 * Every account type can look up a serial and see whether a machine is financed; the full history needs the
 * owner's consent (ADR 0032).
 *
 * `owner_a` here stands in for both of the product owner's cases — a sole proprietor and a plain company account.
 * Neither is special: `is_sole_trader` is read by no permission path at all, and what gated them was the org type.
 */

describe("looking up a serial as any account type (ADR 0032)", () => {
  it("a plain owner account sees the machine and that it is financed, but not who holds it", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await encumber(t, "financier_a", m.id);
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);

      await t.as("owner_a");
      const [hit] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_a, p_query: reg });
      expect(hit, "a stranger's serial is found").toBeTruthy();
      expect(hit.access).toBe("basic");
      expect(hit.make).toBe("Volvo");
      // The question Rikard asked for: is it financed?
      expect(hit.financing.has_active).toBe(true);
      expect(hit.financing.has_pending).toBe(false);
      // But not who the lender is, nor the terms.
      expect(hit.financing.active).toBeNull();
      expect(JSON.stringify(hit)).not.toMatch(/financing_amount|monthly_cost/);
      // Nor the owner, nor an unmasked serial.
      expect(hit.owner ?? null).toBeNull();
      expect(hit.identifiers[0].value).not.toBe(await t.val("select value from public.machine_identifiers where machine_id = $1", [m.id]));
    });
  });

  it("an active block shows up too, without the authority's description", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);
      await t.as("authority");
      await t.rpc("raise_flag", {
        p_org_id: ORGS.authority, p_machine_id: m.id, p_type: "blocked",
        p_reference: "PM-1", p_description: "Utreds i ärende om misstänkt häleri",
      });
      await t.as("owner_a");
      const [hit] = await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_a, p_query: reg });
      expect(hit.flags.map((f: any) => f.type)).toContain("blocked");
      expect(JSON.stringify(hit.flags)).not.toMatch(/häleri/);
    });
  });

  it("the history still needs a relation or consent", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await t.as("owner_a");
      expect((await t.rpcError("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toBe("NOT_FOUND");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toBe("NOT_FOUND");
    });
  });

  it("the public card is unchanged: still no financing at all", async () => {
    // Opening the search up must not open up the unauthenticated surface.
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await encumber(t, "financier_a", m.id);
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);
      await t.as("anon");
      const card = await t.rpc<any>("public_machine_card", { p_code: null, p_reg: reg });
      expect(card.found).toBe(true);
      expect(JSON.stringify(card)).not.toMatch(/financing|has_active/);
    });
  });

  it("the search is rate limited, because it is open to everyone now", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);
      await t.as(null);
      // 120 an hour per organisation; fill the window rather than making 120 calls.
      await t.q(`insert into app.rate_limits (key, window_start, hits) values ('lookup:' || $1,
        to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 120)
        on conflict (key, window_start) do update set hits = 120`, [ORGS.owner_a]);
      await t.as("owner_a");
      expect((await t.rpcError("lookup_machine", { p_org_id: ORGS.owner_a, p_query: reg })).code).toBe("RATE_LIMITED");
      // A different organisation is unaffected.
      await t.as("owner_b");
      expect((await t.rpc<any[]>("lookup_machine", { p_org_id: ORGS.owner_b, p_query: reg })).length).toBe(1);
    });
  });

  it("perform_check is deliberately left alone, so curiosity is not billed", async () => {
    // check_receipts carries a metering trigger priced per check, grants the `checker` relation for 24 hours and
    // feeds the many_recent_checks risk signal. lookup_machine is the search that opened up; this one did not.
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      const reg = await t.val<string>("select reg_number from public.machines where id = $1", [m.id]);
      await t.as("owner_a");
      expect((await t.rpcError("perform_check", { p_org_id: ORGS.owner_a, p_query: { reg } })).code).toBe("FORBIDDEN");
      await t.as(null);
      expect(await t.val("select count(*)::int from public.usage_records where org_id = $1 and metric = 'check'", [ORGS.owner_a])).toBe(0);
    });
  });
});

describe("consent: asking the owner for the full history (ADR 0032)", () => {
  /** owner_a asks owner_b for one machine's history. Returns the machine and the request. */
  async function askForMachine(t: any) {
    const m = await registerAs(t, "owner_b", machineData());
    await t.as("owner_a");
    const r = await t.rpc("request_mandate", {
      p_org_id: ORGS.owner_a, p_principal_org_id: null, p_machine_id: m.id,
      p_scopes: ["view"], p_valid_to: NEXT_YEAR, p_message: "Vi överväger att köpa maskinen",
    });
    return { m, request: r.mandate };
  }

  it("the requester cannot approve its own request", async () => {
    // The whole reason for a separate `requested` status: `pending` means "the agent must accept", and
    // respond_mandate matches agent_org_id = actor and status = 'pending'. An agent-initiated pending row would
    // let the requester grant itself a full machine view.
    await tx(async (t) => {
      const { m, request } = await askForMachine(t);
      expect(request.status).toBe("requested");
      expect(request.requested_by).toBe("agent");

      await t.as("owner_a");
      expect((await t.rpcError("respond_mandate", { p_org_id: ORGS.owner_a, p_mandate_id: request.id, p_accept: true })).code).toBe("NOT_FOUND");
      expect((await t.rpcError("decide_mandate_request", {
        p_org_id: ORGS.owner_a, p_mandate_id: request.id, p_approve: true,
      })).code).toBe("NOT_FOUND");
      // Nor can an uninvolved third party decide it.
      await t.as("dealer");
      expect((await t.rpcError("decide_mandate_request", {
        p_org_id: ORGS.dealer, p_mandate_id: request.id, p_approve: true,
      })).code).toBe("NOT_FOUND");
      // And nothing leaked in the meantime.
      await t.as(null);
      expect(await t.val("select app.has_mandate($1, $2, 'view')", [m.id, ORGS.owner_a])).toBe(false);
      await t.as("owner_a");
      expect((await t.rpcError("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toBe("NOT_FOUND");
    });
  });

  it("the owner approves with a signature and the history opens, then closes on revoke", async () => {
    await tx(async (t) => {
      const { m, request } = await askForMachine(t);

      // It is waiting in the owner's inbox, not only in a notification.
      await t.as("owner_b");
      const inbox = await t.rpc<any>("get_inbox", { p_org_id: ORGS.owner_b });
      const item = inbox.items.find((x: any) => x.kind === "mandate_request");
      expect(item, "the request is an inbox item").toBeTruthy();
      expect(item.mandate.agent.id).toBe(ORGS.owner_a);

      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.owner_a, machine_id: m.id, scopes: "view", valid_to: NEXT_YEAR,
      });
      const approved = await t.rpc<any>("decide_mandate_request", {
        p_org_id: ORGS.owner_b, p_mandate_id: request.id, p_approve: true, p_signature_id: sig,
      });
      expect(approved.mandate.status).toBe("active");

      await t.as("owner_a");
      expect((await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).length).toBeGreaterThan(0);
      expect((await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).access).toBe("full");

      await t.as("owner_b");
      await t.rpc("revoke_mandate", { p_org_id: ORGS.owner_b, p_mandate_id: request.id, p_reason: "Klart" });
      await t.as("owner_a");
      expect((await t.rpcError("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).code).toBe("NOT_FOUND");
    });
  });

  it("consent gives the history but never the lender's terms", async () => {
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await t.as("financier_a");
      const params = { type: "leasing", contract_ref: "C-1", start_date: TODAY, end_date: NEXT_YEAR };
      const esig = await sign(t, ORGS.financier_a, "register_encumbrance", m.id, params);
      await t.rpc("register_encumbrance", {
        p_org_id: ORGS.financier_a, p_machine_id: m.id, p_type: "leasing", p_contract_ref: "C-1",
        p_start_date: TODAY, p_end_date: NEXT_YEAR, p_signature_id: esig,
        p_terms: { financing_amount: 900_000, amortization_months: 48, interest_rate: 5 },
      });
      await t.as("owner_a");
      const r = await t.rpc("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: null, p_machine_id: m.id, p_scopes: ["view"], p_valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.owner_a, machine_id: m.id, scopes: "view", valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: r.mandate.id, p_approve: true, p_signature_id: sig });

      await t.as("owner_a");
      const view = await t.rpc<any>("get_machine", { p_org_id: ORGS.owner_a, p_machine_id: m.id });
      expect(view.access).toBe("full");
      // Full access to the machine is not access to the contract between the owner and its bank (ADR 0029).
      expect(JSON.stringify(view)).not.toMatch(/financing_amount|monthly_cost|residual_value/);
    });
  });

  it("a fleet-wide consent covers every machine the company owns", async () => {
    // The answer to "ska banken även kunna se företagets övriga maskiner": only when the company says so.
    await tx(async (t) => {
      const a = await registerAs(t, "owner_b", machineData());
      const b = await registerAs(t, "owner_b", machineData());
      await t.as("financier_a");
      const r = await t.rpc("request_mandate", {
        p_org_id: ORGS.financier_a, p_principal_org_id: ORGS.owner_b, p_machine_id: null,
        p_scopes: ["view"], p_valid_to: NEXT_YEAR, p_message: "Kreditbedömning",
      });
      expect(r.mandate.machine_id).toBeNull();
      // Before consent the lender sees only what it finances.
      await t.as("financier_a");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: a.id })).code).toBe("NOT_FOUND");

      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.financier_a, machine_id: "", scopes: "view", valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: r.mandate.id, p_approve: true, p_signature_id: sig });

      await t.as("financier_a");
      for (const m of [a, b]) {
        expect((await t.rpc<any>("get_machine", { p_org_id: ORGS.financier_a, p_machine_id: m.id })).access, m.id).toBe("full");
        expect((await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.financier_a, p_machine_id: m.id })).length).toBeGreaterThan(0);
      }
      // Another lender is unaffected: consent is to one organisation.
      await t.as("financier_b");
      expect((await t.rpcError("get_machine", { p_org_id: ORGS.financier_b, p_machine_id: a.id })).code).toBe("NOT_FOUND");
    });
  });

  it("a fleet mandate is about operating the machine, not about its ownership history", async () => {
    // machine_relations_more sets `agent` for view|sell|fleet alike, so keying the timeline on the relation
    // would hand a fleet-only agent the whole transfer and encumbrance history.
    await tx(async (t) => {
      const m = await registerAs(t, "owner_b", machineData());
      await encumber(t, "financier_a", m.id);
      await t.as("owner_a");
      const r = await t.rpc("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: null, p_machine_id: m.id, p_scopes: ["fleet"], p_valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.owner_a, machine_id: m.id, scopes: "fleet", valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: r.mandate.id, p_approve: true, p_signature_id: sig });

      await t.as("owner_a");
      const types = (await t.rpc<any[]>("get_machine_history", { p_org_id: ORGS.owner_a, p_machine_id: m.id })).map((h) => h.type);
      expect(types).toContain("machine.registered");
      expect(types).not.toContain("encumbrance.registered");
    });
  });

  it("asking twice, asking yourself, and asking for sell rights are all refused", async () => {
    await tx(async (t) => {
      const { m } = await askForMachine(t);
      await t.as("owner_a");
      expect((await t.rpcError("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: null, p_machine_id: m.id, p_scopes: ["view"],
      })).code).toBe("MANDATE_ALREADY_OPEN");
      expect((await t.rpcError("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: ORGS.owner_a, p_machine_id: null, p_scopes: ["view"],
      })).code).toBe("VALIDATION");
      // A request is for seeing things. The right to sell someone else's machine is a consignment the owner offers.
      expect((await t.rpcError("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: ORGS.owner_b, p_machine_id: null, p_scopes: ["sell"],
      })).code).toBe("VALIDATION");
      // An organisation that already has access has nothing to ask for.
      const own = await registerAs(t, "owner_a", machineData());
      await t.as("owner_a");
      expect((await t.rpcError("request_mandate", {
        p_org_id: ORGS.owner_a, p_principal_org_id: null, p_machine_id: own.id, p_scopes: ["view"],
      })).code).toBe("VALIDATION");
    });
  });

  it("either side can withdraw a request, and a decline leaves no access", async () => {
    await tx(async (t) => {
      const first = await askForMachine(t);
      await t.as("owner_a");
      expect((await t.rpc<any>("revoke_mandate", { p_org_id: ORGS.owner_a, p_mandate_id: first.request.id })).ok).toBe(true);

      const second = await askForMachine(t);
      await t.as("owner_b");
      const declined = await t.rpc<any>("decide_mandate_request", {
        p_org_id: ORGS.owner_b, p_mandate_id: second.request.id, p_approve: false,
      });
      expect(declined.mandate.status).toBe("declined");
      await t.as(null);
      expect(await t.val("select app.has_mandate($1, $2, 'view')", [second.m.id, ORGS.owner_a])).toBe(false);
    });
  });

  it("asking does not tell the requester who owns the machine, until the owner says yes", async () => {
    // The lookup withholds the owner's name (ADR 0032), so the request must not hand it back: otherwise
    // "request, then read Fullmakter" is a way to find out who owns any serial.
    await tx(async (t) => {
      const first = await askForMachine(t);
      expect(first.request.principal_org_id ?? null).toBeNull();
      await t.as("owner_a");
      let row = (await t.rpc<any[]>("list_mandates", { p_org_id: ORGS.owner_a })).find((d) => d.id === first.request.id);
      expect(row.principal).toBeNull();
      expect(row.principal_org_id ?? null).toBeNull();
      expect(row.awaiting).toBe("principal");

      // A decline does not reveal it either, neither in the list nor in the notification.
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: first.request.id, p_approve: false });
      await t.as("owner_a");
      row = (await t.rpc<any[]>("list_mandates", { p_org_id: ORGS.owner_a })).find((d) => d.id === first.request.id);
      expect(row.principal).toBeNull();
      await t.as(null);
      const ownerName = await t.val("select name from public.organizations where id = $1", [ORGS.owner_b]);
      const declinedNote = await t.val<any>(
        "select data from public.notifications where type = 'mandate.request_declined' and org_id = $1 order by created_at desc limit 1", [ORGS.owner_a]);
      expect(JSON.stringify(declinedNote)).not.toContain(ownerName);

      // Once approved, the owner has chosen to deal with the requester, and the name is shown.
      const second = await askForMachine(t);
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.owner_a, machine_id: second.m.id, scopes: "view", valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: second.request.id, p_approve: true, p_signature_id: sig });
      await t.as("owner_a");
      row = (await t.rpc<any[]>("list_mandates", { p_org_id: ORGS.owner_a })).find((d) => d.id === second.request.id);
      expect(row.principal.id).toBe(ORGS.owner_b);
    });
  });

  it("the decision is in the chain and the requester is told", async () => {
    await tx(async (t) => {
      const { m, request } = await askForMachine(t);
      await t.as("owner_b");
      const sig = await sign(t, ORGS.owner_b, "grant_mandate", ORGS.owner_b, {
        agent_org_id: ORGS.owner_a, machine_id: m.id, scopes: "view", valid_to: NEXT_YEAR,
      });
      await t.as("owner_b");
      await t.rpc("decide_mandate_request", { p_org_id: ORGS.owner_b, p_mandate_id: request.id, p_approve: true, p_signature_id: sig });
      await t.as(null);
      const types = (await t.q<{ type: string }>(
        "select type from public.events where machine_id = $1 and type like 'mandate.%' order by seq", [m.id])).map((r) => r.type);
      expect(types).toEqual(["mandate.requested", "mandate.request_approved"]);
      expect(await t.val("select count(*)::int from public.notifications where type = 'mandate.request_approved'")).toBeGreaterThan(0);
    });
  });
});
