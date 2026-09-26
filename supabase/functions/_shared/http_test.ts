import { assertEquals } from "jsr:@std/assert@1";
import { rpcError } from "./http.ts";

Deno.test("PostgREST status SQLSTATEs map to HTTP statuses", async () => {
  assertEquals(rpcError({ message: "RATE_LIMITED", code: "PT429" }).status, 429);
  assertEquals(rpcError({ message: "FORBIDDEN", code: "PT403" }).status, 403);
  assertEquals(rpcError({ message: "ACTIVE_ENCUMBRANCE_EXISTS", code: "PT409", details: '{"holder":"X"}' }).status, 409);
  assertEquals(rpcError({ message: "permission denied", code: "42501" }).status, 403);
  const body = await rpcError({ message: "VALIDATION", code: "PT422", details: '{"field":"x"}' }).json();
  assertEquals(body, { code: "VALIDATION", detail: { field: "x" } });
});
