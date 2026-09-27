import { expect, type Page } from "@playwright/test";

export const PASSWORD = "demo1234";

/** Signs in with a demo account and returns the org base path, e.g. "/o/bergs-schakt-entreprenad-ab". */
export async function login(page: Page, email: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("E-postadress").fill(email);
  await page.getByLabel("Lösenord").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/o\/[^/]+\/dashboard/, { timeout: 180_000 });
  return new URL(page.url()).pathname.replace(/\/dashboard.*$/, "");
}

/** Signs out by dropping the local session (the in-browser database stays). */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => { localStorage.removeItem("maskinid.local.session"); sessionStorage.clear(); });
  await page.goto("/");
}

/** Reads the in-browser database (dev server only, see lib/backend/local.ts). */
export async function sql<T = Record<string, unknown>>(page: Page, query: string, params: unknown[] = []): Promise<T[]> {
  await page.waitForFunction(() => !!(window as unknown as { __maskinidTest?: unknown }).__maskinidTest, null, { timeout: 60_000 });
  return page.evaluate(([q, p]) => (window as unknown as { __maskinidTest: { query(q: string, p: unknown[]): Promise<unknown[]> } }).__maskinidTest.query(q, p),
    [query, params] as const) as Promise<T[]>;
}

/** Calls an RPC as the service role in the in-browser database (for steps a scheduler or an Edge Function would do). */
export async function service<T = unknown>(page: Page, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await page.waitForFunction(() => !!(window as unknown as { __maskinidTest?: unknown }).__maskinidTest, null, { timeout: 60_000 });
  return page.evaluate(([f, a]) => (window as unknown as { __maskinidTest: { rpcAs(r: string, f: string, a: unknown): Promise<unknown> } }).__maskinidTest
    .rpcAs("service_role", f, a), [fn, args] as const) as Promise<T>;
}

/** Confirms a Demo-BankID signature dialog. */
export async function signDemo(page: Page): Promise<void> {
  // The signing dialog may open on top of another dialog; pick the innermost one.
  const dialog = page.locator("dialog[open]").filter({ hasText: "Du signerar" }).last();
  await expect(dialog.getByText("Du signerar")).toBeVisible();
  await dialog.getByRole("button", { name: "Signera", exact: true }).click();
}

export function uniqueSerial(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
}

/** Calls an RPC as the signed-in user (what the web app or an API client does). */
export async function asUser<T = unknown>(page: Page, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await page.waitForFunction(() => !!(window as unknown as { __maskinidTest?: unknown }).__maskinidTest, null, { timeout: 60_000 });
  return page.evaluate(([f, a]) => (window as unknown as { __maskinidTest: { rpcAs(r: string, f: string, a: unknown): Promise<unknown> } }).__maskinidTest
    .rpcAs("authenticated", f, a), [fn, args] as const) as Promise<T>;
}

/** A minimal valid PDF (invoice fixture). */
export const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/** A real 1×1 PNG with a mock-OCR hint appended (the mock reads "nameplate:k=v;…" from the file bytes). */
export function nameplatePng(fields: Record<string, string | number>): Buffer {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return Buffer.concat([png, Buffer.from(`nameplate:${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(";")}\n`)]);
}
