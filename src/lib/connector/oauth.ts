import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import { passwordFingerprint } from "@/lib/auth/session";
import { deriveKey } from "@/lib/keys";
import { loadSettings } from "@/lib/settings-data";

// Sign-in for the Claude connector (#221, src/app/api/mcp): a small OAuth 2.1
// authorization server, as Claude's custom connectors expect it, with
// Dynamic Client Registration and PKCE (S256 only). Adapted from Anirudh
// Sharma's fork of Dossier. It keeps nothing in the database: clients, codes
// and tokens are signed with keys derived from DOSSIER_SECRET, and every one
// carries a fingerprint of DOSSIER_PASSWORD and the time the connector was
// turned on (connectorEnabledAt). So a new password, a new secret, Disconnect
// Claude or turning the connector off and on signs Claude out.

/** Where Claude's hosted apps (claude.ai, Desktop, mobile) come back to after sign-in. */
const HOSTED_CALLBACKS = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);

/** What a token lets Claude do; there's only one thing. */
export const SCOPE = "dossier";

export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;

const AUDIENCE = { client: "dossier-connector-client", code: "dossier-connector-code", access: "dossier-mcp", refresh: "dossier-connector-refresh" } as const;
type TokenKind = keyof typeof AUDIENCE;
const key = (kind: TokenKind) => deriveKey(`connector-${kind}`);

/** When the connector was turned on, or Claude last disconnected; null while it's off. */
export async function connectorSince(): Promise<string | null> {
  return (await loadSettings()).connectorEnabledAt;
}

/**
 * Whether an app may be sent back to `uri` after sign-in: Claude's own
 * callback, a loopback address on any port (Claude's command-line app signs
 * in through one), or another app's address added in Settings → MCP
 * connector, exactly as added (#281).
 */
export function allowedRedirect(uri: string, added: readonly string[] = []): boolean {
  if (HOSTED_CALLBACKS.has(uri) || added.includes(uri)) return true;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && isLoopback(url) && url.pathname === "/callback";
  } catch {
    return false;
  }
}

const isLoopback = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

/** Whether `redirectUri` is one of Claude's, which then needs no other name. */
export function isClaudeRedirect(redirectUri: string): boolean {
  return allowedRedirect(redirectUri);
}

/** Other apps' callback addresses, added in Settings → MCP connector (#281). */
export async function addedRedirects(): Promise<string[]> {
  return (await loadSettings()).connectorRedirects;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/** This computer, or an address on a home or office network: a private IPv4 range, a name without a dot, or .local, .lan, .internal, .home.arpa. */
function isPrivateHost(hostname: string): boolean {
  const ip = IPV4.exec(hostname);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return hostname === "[::1]" || !hostname.includes(".") || /\.(local|lan|internal|home\.arpa)$/.test(hostname);
}

/**
 * Why `uri` can't be another app's callback, or null (#281): https, or http
 * only on this computer or a private network, without a fragment or a
 * user name in it.
 */
export function redirectProblem(uri: string): string | null {
  const url = URL.canParse(uri) ? new URL(uri) : null;
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return "That isn't a web address. Copy it from the app, starting with https://.";
  if (url.hash || url.username || url.password) return "A callback address can't have a # part or a user name in it.";
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) return "Use an https:// address, or http:// only for an app on this computer or your own network.";
  return null;
}

/** The same redirect, ignoring a loopback address's port, which changes each time. */
function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true;
  try {
    const a = new URL(registered);
    const b = new URL(given);
    return isLoopback(a) && isLoopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.protocol === b.protocol;
  } catch {
    return false;
  }
}

async function sign(kind: TokenKind, claims: Record<string, unknown>, seconds: number | null): Promise<string> {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setAudience(AUDIENCE[kind]).setIssuedAt().setJti(randomUUID());
  return (seconds === null ? jwt : jwt.setExpirationTime(`${seconds}s`)).sign(key(kind));
}

async function verify(kind: TokenKind, token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(kind), { audience: AUDIENCE[kind], algorithms: ["HS256"] });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The password and the connector's time a token was signed for: both must still hold. */
async function stamp(): Promise<{ pwd: string; gen: string } | null> {
  const since = await connectorSince();
  return since ? { pwd: passwordFingerprint(), gen: since } : null;
}

const stillValid = (claims: Record<string, unknown>, current: { pwd: string; gen: string } | null) =>
  current !== null && claims.pwd === current.pwd && claims.gen === current.gen;

// ─── Clients ─────────────────────────────────────────────────────────────────

export type Client = { name: string; redirectUris: string[] };

/** Registers a client (RFC 7591): its id is a signed note of its name and redirects. */
export async function registerClient(client: Client): Promise<string> {
  // Client ids don't expire: Claude keeps the one it registered.
  return sign("client", { name: client.name, redirect_uris: client.redirectUris }, null);
}

export async function readClient(clientId: string | null | undefined): Promise<Client | null> {
  const claims = await verify("client", clientId);
  const uris = claims?.redirect_uris;
  if (!claims || !Array.isArray(uris) || !uris.every((uri) => typeof uri === "string")) return null;
  return { name: typeof claims.name === "string" ? claims.name : "Claude", redirectUris: uris };
}

/** Whether a client registered `redirectUri`. */
export const clientAllows = (client: Client, redirectUri: string) => client.redirectUris.some((uri) => sameRedirect(uri, redirectUri));

// ─── Codes and tokens ────────────────────────────────────────────────────────

export class OAuthError extends Error {
  constructor(
    readonly code: "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type",
    message: string,
  ) {
    super(message);
  }
}

/** The one-time code handed back once the user allows Claude in, valid for five minutes. */
export async function issueCode(grant: { clientId: string; redirectUri: string; codeChallenge: string; resource: string }): Promise<string> {
  const current = await stamp();
  if (!current) throw new OAuthError("invalid_request", "The MCP connector is off.");
  return sign("code", { cid: grant.clientId, uri: grant.redirectUri, chl: grant.codeChallenge, res: grant.resource, ...current }, CODE_SECONDS);
}

/** S256: the challenge is the verifier's SHA-256, base64url-encoded. */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export type TokenPair = { access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number; scope: string };

async function tokens(clientId: string, resource: string, current: { pwd: string; gen: string }): Promise<TokenPair> {
  return {
    access_token: await sign("access", { cid: clientId, res: resource, scope: SCOPE, ...current }, ACCESS_TOKEN_SECONDS),
    refresh_token: await sign("refresh", { cid: clientId, res: resource, ...current }, REFRESH_TOKEN_SECONDS),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    scope: SCOPE,
  };
}

/** Trades a code for tokens, checking the client, the redirect and the PKCE verifier. */
export async function exchangeCode({ code, clientId, redirectUri, verifier }: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<TokenPair> {
  const [claims, current] = await Promise.all([verify("code", code), stamp()]);
  if (!claims || !stillValid(claims, current)) throw new OAuthError("invalid_grant", "The code is invalid or has expired.");
  if (claims.cid !== clientId) throw new OAuthError("invalid_grant", "The code was issued to another client.");
  if (typeof claims.uri !== "string" || !sameRedirect(claims.uri, redirectUri)) throw new OAuthError("invalid_grant", "The redirect URI doesn't match.");
  if (!verifier || challengeOf(verifier) !== claims.chl) throw new OAuthError("invalid_grant", "The code verifier doesn't match.");
  return tokens(clientId, String(claims.res ?? ""), current!);
}

/** New tokens for a refresh token, with a new refresh token too. */
export async function refresh({ refreshToken, clientId }: { refreshToken: string; clientId: string }): Promise<TokenPair> {
  const [claims, current] = await Promise.all([verify("refresh", refreshToken), stamp()]);
  if (!claims || !stillValid(claims, current) || claims.cid !== clientId) {
    throw new OAuthError("invalid_grant", "The refresh token is invalid or has expired.");
  }
  return tokens(clientId, String(claims.res ?? ""), current!);
}

/** Whether a bearer token lets Claude use Dossier now; the client it was issued to, if so. */
export async function verifyAccessToken(token: string | null | undefined): Promise<{ clientId: string } | null> {
  const [claims, current] = await Promise.all([verify("access", token), stamp()]);
  if (!claims || claims.scope !== SCOPE || !stillValid(claims, current)) return null;
  return { clientId: String(claims.cid ?? "") };
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/** The MCP endpoint, as Claude is given it. */
export const mcpUrl = (origin: string) => `${origin}/api/mcp`;

/** RFC 8414 metadata: where Claude registers, signs in and gets tokens. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

/** RFC 9728 metadata: which server protects the MCP endpoint. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Dossier",
  };
}
