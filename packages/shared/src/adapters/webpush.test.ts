import { describe, expect, it } from "vitest";
import { createAdapters } from "./index.ts";
import { b64urlDecode, b64urlEncode, createWebPushSender, deriveKeys, encryptPayload, vapidJwt } from "./webpush.ts";

async function ecKeys(usage: KeyUsage[], name = "ECDH") {
  return crypto.subtle.generateKey({ name, namedCurve: "P-256" }, true, usage) as Promise<CryptoKeyPair>;
}

describe("web push", () => {
  it("encrypts so the browser (user agent) can decrypt it – RFC 8291 round trip", async () => {
    const ua = await ecKeys(["deriveBits"]);
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload(new TextEncoder().encode('{"title":"Stulen maskin"}'), b64urlEncode(uaPublic), b64urlEncode(auth));
    // Parse the aes128gcm header and decrypt as the browser would.
    const salt = body.slice(0, 16);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    const idlen = body[20]!;
    const asPublic = body.slice(21, 21 + idlen);
    const ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
    const { cek, nonce } = await deriveKeys(secret, auth, uaPublic, asPublic, salt);
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
    expect(plain.at(-1)).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Stulen maskin"}');
  });

  it("signs a VAPID JWT that verifies with the public key", async () => {
    const k = await ecKeys(["sign", "verify"], "ECDSA");
    const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey)));
    const d = (await crypto.subtle.exportKey("jwk", k.privateKey)).d!;
    const jwt = await vapidJwt("https://push.example.com", "mailto:drift@maskinid.se", pub, d, 1_790_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p!)))).toEqual({ aud: "https://push.example.com", exp: 1_790_000_000 + 43200, sub: "mailto:drift@maskinid.se" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.publicKey, b64urlDecode(s!), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it("sends with VAPID headers and reports gone subscriptions", async () => {
    const k = await ecKeys(["sign", "verify"], "ECDSA");
    const pub = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey)));
    const d = (await crypto.subtle.exportKey("jwk", k.privateKey)).d!;
    const ua = await ecKeys(["deriveBits"]);
    const target = { endpoint: "https://push.example.com/abc", p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))),
      auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
    let headers: Record<string, string> = {};
    const fake = (async (_url: string, init: RequestInit) => { headers = init.headers as Record<string, string>; return new Response(null, { status: 410 }); }) as unknown as typeof fetch;
    const r = await createWebPushSender({ publicKey: pub, privateKey: d, subject: "mailto:x@y.se", fetch: fake }).send(target, { title: "t", body: "b", url: "/" }, { urgency: "high" });
    expect(r).toEqual({ ok: false, gone: true, status: 410 });
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${pub}$`));
    expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", Urgency: "high" });
  });

  it("DEMO_MODE uses the mock sender", () => {
    expect(createAdapters({ DEMO_MODE: "true", VAPID_PRIVATE_KEY: "x", VAPID_PUBLIC_KEY: "y" }).push.name).toBe("mock");
    expect(createAdapters({ DEMO_MODE: "false", VAPID_PRIVATE_KEY: "x", VAPID_PUBLIC_KEY: "y" }).push.name).toBe("webpush");
  });
});
