import { createHash, randomBytes } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// The Claude connector (#221): off until it's turned on in Settings; then
// Claude registers, the user signs in and allows it on the consent page,
// Claude trades the code for tokens and uses Dossier's tools at /api/mcp,
// until Disconnect Claude or the switch goes off. The "Claude" here is a
// request context without Dossier's cookie, and claude.ai's callback is
// answered by the test.

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

test.beforeAll(resetData);
// Other specs see the connector off.
test.afterAll(() => sql(`DELETE FROM "Setting" WHERE key = 'connectorEnabledAt'`));

/** No serious axe findings, in the light scheme and then the dark one. */
async function expectAccessible(page: Page) {
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((chosen) => (document.documentElement.dataset.theme = chosen), scheme);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious.map((violation) => `${scheme}: ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join("; ")}`)).toEqual([]);
  }
  await page.evaluate(() => delete document.documentElement.dataset.theme);
}

/** One JSON-RPC answer, sent as JSON or as one server-sent event. */
async function rpc(response: APIResponse): Promise<{ result: { tools?: { name: string }[]; content?: { text: string }[] } }> {
  const body = await response.text();
  return JSON.parse(body.trimStart().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
}

test("connects Claude through Settings and the consent page, serves its tools, and signs it out", async ({ page, baseURL, playwright }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const claude = await playwright.request.newContext({ baseURL });
  const address = `${baseURL}/api/mcp`;

  // Off: none of its addresses are there.
  expect((await claude.post("/api/mcp", { data: {} })).status()).toBe(404);
  expect((await claude.get("/.well-known/oauth-authorization-server")).status()).toBe(404);
  expect((await claude.post("/api/oauth/register", { data: { redirect_uris: [CALLBACK] } })).status()).toBe(404);

  await page.goto("/settings?section=claude");
  await expect(page.getByRole("heading", { name: "Claude connector" })).toBeVisible();
  await page.getByRole("switch", { name: "Let Claude connect" }).click();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  // A local address works for Claude's command-line app only, and the section says so.
  await expect(page.getByRole("note")).toContainText("This is a local address.");
  await expectAccessible(page);

  // Claude finds out how to sign in, and registers.
  const unauthorized = await claude.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["www-authenticate"]).toContain(`resource_metadata="${baseURL}/.well-known/oauth-protected-resource/api/mcp"`);
  expect(await (await claude.get("/.well-known/oauth-protected-resource/api/mcp")).json()).toMatchObject({ resource: address, authorization_servers: [baseURL] });
  const metadata = await (await claude.get("/.well-known/oauth-authorization-server")).json();
  expect(metadata).toMatchObject({ authorization_endpoint: `${baseURL}/oauth/authorize`, code_challenge_methods_supported: ["S256"] });
  expect((await claude.post("/api/oauth/register", { data: { redirect_uris: ["https://evil.example/callback"] } })).status()).toBe(400);
  const { client_id: clientId } = await (await claude.post("/api/oauth/register", { data: { redirect_uris: [CALLBACK], client_name: "Claude" } })).json();

  // The user allows it, signed in, and goes back to Claude with a code.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await page.route("https://claude.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "Back in Claude" }));
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: address });
  await page.goto(`/oauth/authorize?${query}`);
  await expect(page.getByRole("heading", { name: "Connect Claude to Dossier" })).toBeVisible();
  await expect(page.getByText("It can never send an application or an email, or delete anything.", { exact: false })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Allow" }).click();
  await page.waitForURL((url) => url.href.startsWith(`${CALLBACK}?`));
  const back = new URL(page.url());
  expect(back.searchParams.get("state")).toBe("xyz");

  const tokens = await (
    await claude.post("/api/oauth/token", {
      form: { grant_type: "authorization_code", code: back.searchParams.get("code")!, client_id: clientId, redirect_uri: CALLBACK, code_verifier: verifier },
    })
  ).json();
  expect(tokens).toMatchObject({ token_type: "Bearer", scope: "dossier" });

  const mcp = (body: unknown) =>
    claude.post("/api/mcp", {
      data: body,
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    });
  const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  expect(list.status()).toBe(200);
  expect((await rpc(list)).result.tools?.map((tool) => tool.name)).toContain("save_application");
  const profile = await rpc(await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_profile", arguments: {} } }));
  expect(JSON.parse(profile.result.content![0].text)).toMatchObject({ name: "Jane Doe" });

  // Disconnect Claude signs it out; off closes the addresses.
  await page.goto("/settings?section=claude");
  await page.getByRole("button", { name: "Disconnect Claude" }).click();
  await expect(page.getByText("Claude is disconnected.", { exact: false })).toBeVisible();
  expect((await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" })).status()).toBe(401);
  await page.getByRole("switch", { name: "Let Claude connect" }).click();
  await expect(page.getByRole("switch", { name: "Let Claude connect" })).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await mcp({ jsonrpc: "2.0", id: 5, method: "tools/list" })).status()).toBe(404);
  await claude.dispose();
});
