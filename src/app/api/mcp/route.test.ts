import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_PASSWORD: "argon2id:m=19456,t=2,p=1:c2FsdA:aGFzaA" } }));
const settings = vi.hoisted(() => ({ resumeSections: { order: [] as string[], off: [] as string[] }, connectorEnabledAt: "2026-10-23T09:00:00.000Z" as string | null }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => settings }));
vi.mock("@/lib/profiles", () => ({
  loadProfileSettings: async () => settings,
  listProfiles: async () => [{ id: "first", name: "My profile" }],
  profileNamed: async () => ({ id: "first", name: "My profile" }),
  levelsProblem: async () => null,
  loadProfileLevels: async () => ({ from: "mid", to: "senior" }),
  loadProfileWorkplace: async () => ({ workplace: (await import("@/lib/profile-workplace")).DEFAULT_WORKPLACE, seen: true }),
}));
const db = vi.hoisted(() => ({ postingSearch: { findUnique: vi.fn() }, postingFind: { findMany: vi.fn() }, postingScore: { upsert: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai/config", () => ({ isAiUsable: async () => false }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
const searches = vi.hoisted(() => ({ ran: [] as unknown[] }));
vi.mock("@/lib/posting-searches", () => ({
  runSearch: async (query: unknown) => (searches.ran.push(query), { ok: true, id: "s1" }),
  loadSearch: async () => ({ id: "s1", postings: [], next: null }),
  showMoreFor: async () => ({ ok: true, postings: [], next: null }),
}));

import { demoProfile } from "@/lib/demo-profile";
import { challengeOf, exchangeCode, issueCode, registerClient } from "@/lib/connector/oauth";

import { GET, POST } from "./route";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

async function accessToken(): Promise<string> {
  const clientId = await registerClient({ name: "Claude", redirectUris: [CLAUDE] });
  const verifier = "v".repeat(50);
  const code = await issueCode({ clientId, redirectUri: CLAUDE, codeChallenge: challengeOf(verifier), resource: "" });
  return (await exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier })).access_token;
}

const call = (body: unknown, token?: string) =>
  POST(
    new Request("https://dossier.example/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/** The answer to one JSON-RPC call, whether it came as JSON or as one server-sent event. */
async function answer(response: Response): Promise<{ result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; serverInfo?: unknown }; error?: unknown }> {
  const body = await response.text();
  const data = body.trimStart().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice("data: ".length);
  return JSON.parse(data);
}

const tool = async (name: string, args: Record<string, unknown>) => {
  const { result } = await answer(await call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, await accessToken()));
  return { isError: result?.isError ?? false, text: result?.content?.[0]?.text ?? "" };
};

beforeEach(() => {
  settings.connectorEnabledAt = "2026-10-23T09:00:00.000Z";
  searches.ran = [];
});

describe("the Claude connector at /api/mcp (#221)", () => {
  it("isn't there while the connector is off", async () => {
    const token = await accessToken();
    settings.connectorEnabledAt = null;
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token)).status).toBe(404);
    expect((await GET(new Request("https://dossier.example/api/mcp"))).status).toBe(404);
  });

  it("asks Claude to sign in, and says where to find out how", async () => {
    const response = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://dossier.example/.well-known/oauth-protected-resource/api/mcp", scope="dossier"',
    );
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "not-a-token")).status).toBe(401);
  });

  it("answers MCP with Dossier's tools once signed in, and none that delete, archive or send", async () => {
    const token = await accessToken();
    const init = await call(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
      token,
    );
    expect(init.status).toBe(200);
    expect(await answer(init)).toMatchObject({ result: { serverInfo: { name: "dossier" } } });

    const { result } = await answer(await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, token));
    expect(result?.tools?.map((entry) => entry.name).sort()).toEqual([
      "check_draft",
      "draft_application",
      "get_application",
      "get_posting",
      "get_profile",
      "list_applications",
      "more_jobs",
      "save_application",
      "save_job_scores",
      "search_jobs",
      "set_application_status",
      "update_application",
    ]);
  });

  it("gives Claude the profile without contact details", async () => {
    const { isError, text } = await tool("get_profile", {});
    expect(isError).toBe(false);
    const profile = JSON.parse(text) as Record<string, unknown>;
    expect(profile).toMatchObject({ profile: "My profile", name: demoProfile().basics.name, link: "https://dossier.example/profile?profile=first" });
    // With one profile, none are listed.
    expect(profile).not.toHaveProperty("profiles");
    expect(text).not.toContain(demoProfile().basics.email);
    expect(text).not.toContain(demoProfile().basics.phone || "no phone");
  });

  it("searches the profile's city and country by default", async () => {
    const { isError, text } = await tool("search_jobs", { keywords: "product designer" });
    expect(isError).toBe(false);
    const { city } = demoProfile().basics;
    expect(searches.ran.at(-1)).toMatchObject({ keywords: "product designer", place: city, radiusKm: 25, remoteOnly: false, postedWithin: "month" });
    expect(JSON.parse(text)).toMatchObject({ search_id: "s1", searched: `product designer in ${city}`, link: "https://dossier.example/jobs?search=s1" });
    // Any level, as Find jobs leaves it: no experience at all, not "any".
    expect(searches.ran.at(-1)).not.toHaveProperty("experience");
  });

  it("searches for an experience level, as Find jobs' Level does (public issue 100)", async () => {
    const { isError, text } = await tool("search_jobs", { keywords: "data analyst", experience: "junior", remote_only: true });
    expect(isError).toBe(false);
    expect(searches.ran.at(-1)).toMatchObject({ keywords: "data analyst", experience: "junior" });
    expect(JSON.parse(text)).toMatchObject({ searched: "data analyst in Netherlands (remote only, entry level)" });
    expect((await tool("search_jobs", { keywords: "data analyst", experience: "principal" })).isError).toBe(true);
  });

  it("asks Claude to write the application itself when Dossier has no AI model", async () => {
    const { isError, text } = await tool("draft_application", { posting_text: "Product designer at Acme" });
    expect(isError).toBe(true);
    expect(text).toContain("save_application");
  });

  it("saves Claude's answers about postings as scores that count requirements, so Positions ranks them (#159)", async () => {
    const posting = { source: "JSEARCH", externalId: "j1", title: "Product Designer", company: "Acme", place: "Berlin", remote: null, salary: "", postedAt: null, url: "", via: "", description: "Figma", complete: true };
    // What the search found is in the library (E22-5).
    db.postingSearch.findUnique.mockResolvedValue({ id: "s1" });
    db.postingFind.findMany.mockResolvedValue([{ posting: { ...posting, id: "row-1" } }]);
    const answers = {
      requirements: [
        { text: "3+ years with Figma", must_have: true, covered: true, evidence: "Designer at Acme", skill: "Figma" },
        { text: "Experience with design tokens", must_have: false, covered: false },
      ],
      work: { level: 3, reason: "You've designed products before." },
      extra: { level: 1, reason: "" },
      education: { level: 2, reason: "" },
      seniority: { fit: "fits", reason: "" },
      location: { fit: "fits", reason: "" },
    };
    const { text } = await tool("save_job_scores", { search_id: "s1", scores: [{ number: 1, ...answers }, { number: 9, ...answers }] });
    expect(JSON.parse(text)).toMatchObject({ saved: [{ number: 1, covered: "1 of 2", fit: "Good fit" }], not_found: [9] });
    const { create } = db.postingScore.upsert.mock.calls.at(-1)![0];
    expect(create).toMatchObject({ externalId: "j1", scoredWith: "claude-chat" });
    expect(create.breakdown.requirements).toEqual([
      { text: "3+ years with Figma", mustHave: true, covered: true, evidence: "Designer at Acme", skill: "Figma" },
      { text: "Experience with design tokens", mustHave: false, covered: false, evidence: null, skill: null },
    ]);
  });
});
