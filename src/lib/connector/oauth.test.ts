import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ DOSSIER_SECRET: "s".repeat(40), DOSSIER_PASSWORD: "argon2id:m=19456,t=2,p=1:c2FsdA:aGFzaA" }));
vi.mock("@/lib/env", () => ({ env }));
const settings = vi.hoisted(() => ({ connectorEnabledAt: "2026-10-23T09:00:00.000Z" as string | null }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => settings }));

import {
  allowedRedirect,
  authorizationServerMetadata,
  challengeOf,
  clientAllows,
  exchangeCode,
  issueCode,
  protectedResourceMetadata,
  readClient,
  refresh,
  registerClient,
  verifyAccessToken,
} from "./oauth";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(50);

async function signIn(redirectUri = CLAUDE) {
  const clientId = await registerClient({ name: "Claude", redirectUris: [redirectUri] });
  const code = await issueCode({ clientId, redirectUri, codeChallenge: challengeOf(VERIFIER), resource: "https://dossier.example/api/mcp" });
  return { clientId, code };
}

beforeEach(() => {
  settings.connectorEnabledAt = "2026-10-23T09:00:00.000Z";
  env.DOSSIER_PASSWORD = "argon2id:m=19456,t=2,p=1:c2FsdA:aGFzaA";
});

describe("the Claude connector's sign-in (#221)", () => {
  it("only sends Claude back to its own callbacks, or a loopback address for Claude's command-line app", () => {
    expect(allowedRedirect(CLAUDE)).toBe(true);
    expect(allowedRedirect("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(allowedRedirect("http://localhost:33418/callback")).toBe(true);
    expect(allowedRedirect("http://127.0.0.1:9/callback")).toBe(true);
    expect(allowedRedirect("https://evil.example/api/mcp/auth_callback")).toBe(false);
    expect(allowedRedirect("https://claude.ai/api/mcp/auth_callback/../evil")).toBe(false);
    expect(allowedRedirect("http://localhost:33418/other")).toBe(false);
    expect(allowedRedirect("https://localhost/callback")).toBe(false);
    expect(allowedRedirect("not a url")).toBe(false);
  });

  it("keeps a client's redirects in its id, ignoring a loopback port that changes", async () => {
    const clientId = await registerClient({ name: "Claude CLI", redirectUris: ["http://localhost:1234/callback"] });
    const client = await readClient(clientId);
    expect(client).toEqual({ name: "Claude CLI", redirectUris: ["http://localhost:1234/callback"] });
    expect(clientAllows(client!, "http://localhost:5678/callback")).toBe(true);
    expect(clientAllows(client!, CLAUDE)).toBe(false);
    expect(await readClient("forged")).toBeNull();
  });

  it("trades a code for tokens with the PKCE verifier, and refreshes them", async () => {
    const { clientId, code } = await signIn();
    const tokens = await exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER });
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "dossier" });
    expect(await verifyAccessToken(tokens.access_token)).toEqual({ clientId });
    // A refresh token isn't an access token.
    expect(await verifyAccessToken(tokens.refresh_token)).toBeNull();

    const renewed = await refresh({ refreshToken: tokens.refresh_token, clientId });
    expect(await verifyAccessToken(renewed.access_token)).toEqual({ clientId });
    await expect(refresh({ refreshToken: tokens.refresh_token, clientId: "someone else" })).rejects.toThrow("The refresh token is invalid or has expired.");
  });

  it("refuses a wrong verifier, another client or another redirect", async () => {
    const { clientId, code } = await signIn();
    await expect(exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: "w".repeat(50) })).rejects.toThrow("The code verifier doesn't match.");
    await expect(exchangeCode({ code, clientId: "other", redirectUri: CLAUDE, verifier: VERIFIER })).rejects.toThrow("The code was issued to another client.");
    await expect(exchangeCode({ code, clientId, redirectUri: "https://claude.com/api/mcp/auth_callback", verifier: VERIFIER })).rejects.toThrow(
      "The redirect URI doesn't match.",
    );
    await expect(exchangeCode({ code: "forged", clientId, redirectUri: CLAUDE, verifier: VERIFIER })).rejects.toThrow("The code is invalid or has expired.");
  });

  it("signs Claude out on Disconnect Claude, when the connector goes off, and with a new password", async () => {
    const { clientId, code } = await signIn();
    const tokens = await exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER });

    // Disconnect Claude: a new time on the connector.
    settings.connectorEnabledAt = "2026-10-23T10:00:00.000Z";
    expect(await verifyAccessToken(tokens.access_token)).toBeNull();
    await expect(refresh({ refreshToken: tokens.refresh_token, clientId })).rejects.toThrow("invalid or has expired");
    await expect(exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier: VERIFIER })).rejects.toThrow("invalid or has expired");

    // Off: nothing is issued or accepted.
    const fresh = await signIn();
    const freshTokens = await exchangeCode({ code: fresh.code, clientId: fresh.clientId, redirectUri: CLAUDE, verifier: VERIFIER });
    settings.connectorEnabledAt = null;
    expect(await verifyAccessToken(freshTokens.access_token)).toBeNull();
    await expect(signIn()).rejects.toThrow("The Claude connector is off.");

    // A new password, like every browser session.
    settings.connectorEnabledAt = "2026-10-23T11:00:00.000Z";
    const again = await signIn();
    const againTokens = await exchangeCode({ code: again.code, clientId: again.clientId, redirectUri: CLAUDE, verifier: VERIFIER });
    env.DOSSIER_PASSWORD = "argon2id:m=19456,t=2,p=1:c2FsdA:bmV3";
    expect(await verifyAccessToken(againTokens.access_token)).toBeNull();
  });

  it("describes itself at the addresses Claude looks for", () => {
    expect(authorizationServerMetadata("https://dossier.example")).toMatchObject({
      issuer: "https://dossier.example",
      authorization_endpoint: "https://dossier.example/oauth/authorize",
      token_endpoint: "https://dossier.example/api/oauth/token",
      registration_endpoint: "https://dossier.example/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(protectedResourceMetadata("https://dossier.example")).toMatchObject({
      resource: "https://dossier.example/api/mcp",
      authorization_servers: ["https://dossier.example"],
    });
  });
});
