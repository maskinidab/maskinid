import { assertEquals, assertMatch } from "jsr:@std/assert@1";

// Same algorithm as webhook-dispatch (kept here so the test does not start the server).
async function sign(secret: string, body: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return `t=${t},v1=${[...sig].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

Deno.test("webhook signature format and determinism", async () => {
  const s = await sign("whsec_abc", '{"type":"ping"}', 1700000000);
  assertMatch(s, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assertEquals(s, await sign("whsec_abc", '{"type":"ping"}', 1700000000));
});
