import { assert, assertEquals } from "jsr:@std/assert@1";
import { safeReturnTo, signState, verifyState } from "./oidc-state.ts";

Deno.test("state round trip, tampering and expiry", async () => {
  const s = await signState({ kind: "sign", uid: "u1", return_to: "https://app.example/x", sid: "s1" }, "secret");
  const p = await verifyState(s, "secret", "sign");
  assertEquals(p?.uid, "u1");
  assertEquals(p?.sid, "s1");
  assert(p?.nonce);
  assertEquals(await verifyState(s, "other", "sign"), null);
  assertEquals(await verifyState(s, "secret", "identify"), null);
  const [body, sig] = s.split(".");
  assertEquals(await verifyState(`${body}x.${sig}`, "secret", "sign"), null);
  const old = await signState({ kind: "sign", uid: "u1", return_to: "x" }, "secret", -10);
  assertEquals(await verifyState(old, "secret", "sign"), null);
});

Deno.test("return_to stays on the app origin", () => {
  assertEquals(safeReturnTo("https://maskinid.se/o/x/dashboard", "https://maskinid.se"), "https://maskinid.se/o/x/dashboard");
  assertEquals(safeReturnTo("https://evil.example/", "https://maskinid.se"), "https://maskinid.se/app");
  assertEquals(safeReturnTo("javascript:alert(1)", "https://maskinid.se"), "https://maskinid.se/app");
});
