import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { seedDemo } from "../../../prisma/seed/demo";

import { handOffPastedPosting } from "./handoff";
import { challengeOf, exchangeCode, issueCode, registerClient } from "./oauth";

// The Claude connector's tools (#221), called as Claude calls them, through
// /api/mcp, against the test database with the demo data.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_PASSWORD: "argon2id:m=19456,t=2,p=1:c2FsdA:aGFzaA" } }));
const fake = vi.hoisted(() => ({ aiUsable: false, fetched: { ok: true, text: "Fetched posting text", url: "https://jobs.example/fetched" } as Record<string, unknown> }));
vi.mock("@/lib/ai/config", () => ({ isAiUsable: async () => fake.aiUsable }));
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting: vi.fn(async () => fake.fetched) }));
vi.mock("@/lib/job-search/find", () => ({
  fullText: vi.fn(async () => "The whole posting from its source"),
  askSource: vi.fn(async () => ({ ok: true, source: "JSEARCH", postings: [found("p3", "Page two posting")], next: null })),
}));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "draft-job"),
}));
// Trimming renders PDFs; here nothing needs cutting.
vi.mock("@/lib/page-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-limit")>()),
  fitResumeToPages: vi.fn(async () => ({ trimmed: [], fits: true })),
}));

import { POST } from "@/app/api/mcp/route";

const prisma = () => db.client!;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

function found(id: string, title: string, complete = true) {
  return {
    source: "JSEARCH" as const,
    externalId: id,
    title,
    company: "Acme",
    place: "Berlin",
    remote: null,
    salary: "",
    postedAt: null,
    url: `https://jobs.example/${id}`,
    via: "",
    description: complete ? `${title}: Figma, design systems.` : "The start",
    complete,
  };
}

let token = "";
beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now: new Date("2026-10-23T09:00:00Z") });
  await saveSettings({ connectorEnabledAt: "2026-10-23T09:00:00.000Z", strict: false });
  fake.aiUsable = false;
  fake.fetched = { ok: true, text: "Fetched posting text", url: "https://jobs.example/fetched" };
  const clientId = await registerClient({ name: "Claude", redirectUris: [CLAUDE] });
  const verifier = "v".repeat(50);
  const code = await issueCode({ clientId, redirectUri: CLAUDE, codeChallenge: challengeOf(verifier), resource: "" });
  token = (await exchangeCode({ code, clientId, redirectUri: CLAUDE, verifier })).access_token;
});
afterAll(() => prisma().$disconnect());

/** Calls a tool; its text answer, parsed when it's JSON, and whether it's an error. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string; json: Record<string, unknown> & unknown[] }> {
  const response = await POST(
    new Request("https://dossier.example/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const body = await response.text();
  const { result } = JSON.parse(body.trimStart().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
  const text = result.content[0].text as string;
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A plain message.
  }
  return { isError: result.isError ?? false, text, json: json as Record<string, unknown> & unknown[] };
}

const storeSearch = (postings: unknown[]) =>
  prisma().postingSearch.create({ data: { source: "JSEARCH", query: { keywords: "designer", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" }, postings: postings as object[], found: postings.length, next: "page:2" } });

describe("the Claude connector's tools (#221)", () => {
  it("lists the applications, newest first, by status, and reads one without notes, sender or signature", async () => {
    const all = await tool("list_applications");
    expect(all.json.length).toBeGreaterThan(3);
    expect(all.json[0]).toMatchObject({ status: expect.any(String), link: expect.stringMatching(/^https:\/\/dossier\.example\/applications\//) });
    const drafts = await tool("list_applications", { status: "DRAFT", limit: 2 });
    expect(drafts.json.every((row) => (row as { status: string }).status === "Draft")).toBe(true);

    const ledgerly = await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" }, include: { documents: true } });
    await prisma().note.create({ data: { applicationId: ledgerly.id, body: "Private: salary floor 80k" } });
    const one = await tool("get_application", { id: ledgerly.id });
    expect(one.json).toMatchObject({ id: ledgerly.id, company: "Ledgerly", link: `https://dossier.example/applications/${ledgerly.id}` });
    expect(one.json.resume).toContain("## Summary");
    expect(one.text).not.toContain("Private: salary floor");
    expect(one.json.cover_letter).not.toContain("## Sender");
    expect(one.json.cover_letter).not.toContain("## Signature");
    expect(await tool("get_application", { id: "gone" })).toMatchObject({ isError: true, text: "That application no longer exists." });
  });

  it("moves an application along, approving a job agent draft first", async () => {
    const ledgerly = await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } });
    await prisma().application.update({ where: { id: ledgerly.id }, data: { status: "DRAFT", awaitingReview: true } });
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "agent-1", dedupeKey: "agent-1", status: "DRAFTED", applicationId: ledgerly.id } });
    expect((await tool("set_application_status", { id: ledgerly.id, status: "SENT" })).json).toEqual({ id: ledgerly.id, status: "Sent", changed: true });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: ledgerly.id } })).toMatchObject({ status: "SENT", awaitingReview: false });
    expect((await tool("set_application_status", { id: ledgerly.id, status: "SENT" })).json).toMatchObject({ changed: false });
    expect(await tool("set_application_status", { id: "gone", status: "SENT" })).toMatchObject({ isError: true });
  });

  it("reads a posting from wherever Claude got it", async () => {
    const search = await storeSearch([found("p1", "Product Designer"), found("p2", "Brand Designer", false)]);
    expect((await tool("get_posting", { search_id: search.id, number: 1 })).json).toMatchObject({ title: "Product Designer", url: "https://jobs.example/p1" });
    expect((await tool("get_posting", { search_id: search.id, number: 2 })).json.text).toContain("The whole posting from its source");
    expect(await tool("get_posting", { search_id: search.id, number: 9 })).toMatchObject({ isError: true });

    const row = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "p9", title: "UX Writer", company: "Acme", description: "The start", complete: false } });
    expect((await tool("get_posting", { posting_id: row.id })).json).toMatchObject({ title: "UX Writer", text: expect.stringContaining("The whole posting from its source") });
    expect(await tool("get_posting", { posting_id: "gone" })).toMatchObject({ isError: true, text: "That posting is no longer in Dossier. Open it again from Find jobs." });

    const chat = await handOffPastedPosting({ text: "Pasted: Senior Designer at Acme", url: "https://jobs.example/pasted" });
    const pasteId = /paste_id "([^"]+)"/.exec(new URL(chat).searchParams.get("q")!)![1];
    expect((await tool("get_posting", { paste_id: pasteId })).json).toMatchObject({ text: "Pasted: Senior Designer at Acme", url: "https://jobs.example/pasted" });
    expect(await tool("get_posting", { paste_id: "00000000-0000-0000-0000-000000000000" })).toMatchObject({ isError: true });

    expect((await tool("get_posting", { posting_url: "https://jobs.example/fetched" })).json).toMatchObject({ text: "Fetched posting text" });
    fake.fetched = { ok: false, error: "That page couldn't be reached." };
    expect((await tool("get_posting", { posting_url: "https://jobs.example/broken" })).text).toBe("That page couldn't be reached. Paste the posting's text as posting_text instead.");
    expect(await tool("get_posting")).toMatchObject({ isError: true, text: "Give posting_id, paste_id, search_id and number, posting_url, or posting_text." });
  });

  it("saves an application Claude wrote, linked to the posting it came from", async () => {
    const search = await storeSearch([found("p1", "Product Designer")]);
    const profile = await prisma().experience.findFirstOrThrow({ orderBy: { sort: "asc" } });
    const saved = await tool("save_application", {
      search_id: search.id,
      number: 1,
      details: { company: "Acme", role: "Product Designer", location: "Berlin" },
      resume: { summary: "Designer who ships calm products.", roles: [{ id: profile.id, bullets: ["Led the payments redesign"] }], skills: ["Figma"] },
      cover_letter: { paragraphs: [{ text: "I'd like to help Acme." }] },
      match: [{ requirement: "Figma", result: "covered" }],
    });
    expect(saved.json).toMatchObject({ status: "Draft", application_id: expect.any(String) });
    const id = saved.json.application_id as string;
    expect(await prisma().application.findUniqueOrThrow({ where: { id } })).toMatchObject({ company: "Acme", status: "DRAFT", postingUrl: "https://jobs.example/p1" });
    expect((await prisma().posting.findFirstOrThrow({ where: { externalId: "p1" } })).applicationId).toBe(id);

    expect(await tool("save_application", { details: { company: "Acme", role: "Designer" }, resume: { summary: "", roles: [], skills: [] }, cover_letter: { paragraphs: [{ text: "Hi" }] } })).toMatchObject({
      isError: true,
    });
  });

  it("has Dossier's own model draft one only when there is one, and says how it's coming along", async () => {
    expect((await tool("draft_application", { posting_text: "Designer at Acme" })).text).toContain("save_application");
    fake.aiUsable = true;
    expect((await tool("draft_application", { posting_text: "Designer at Acme", note: "Stress Figma" })).json).toMatchObject({ draft_id: "draft-job", status: "started" });
    expect(await tool("draft_application", {})).toMatchObject({ isError: true });

    expect(await tool("check_draft", { draft_id: "nope" })).toMatchObject({ isError: true, text: "There's no such draft." });
    const job = await prisma().job.create({ data: { type: "connector-draft", status: "RUNNING", step: "Writing the cover letter", input: {} } });
    expect((await tool("check_draft", { draft_id: job.id })).json).toMatchObject({ status: "working", step: "Writing the cover letter" });
    await prisma().job.update({ where: { id: job.id }, data: { status: "FAILED", error: "The model didn't answer." } });
    expect(await tool("check_draft", { draft_id: job.id })).toMatchObject({ isError: true, text: "The model didn't answer." });
    const ledgerly = await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } });
    await prisma().job.update({ where: { id: job.id }, data: { status: "DONE", error: null, result: { applicationId: ledgerly.id } } });
    expect((await tool("check_draft", { draft_id: job.id })).json).toMatchObject({ status: "done", application_id: ledgerly.id });
  });

  it("shows more of a search, and scores postings handed over by id", async () => {
    const search = await storeSearch([found("p1", "Product Designer"), found("p2", "Brand Designer")]);
    expect((await tool("more_jobs", { search_id: search.id })).json).toMatchObject({ added: 1, postings: [{ number: 3, title: "Page two posting" }] });
    expect(await tool("more_jobs", { search_id: "gone" })).toMatchObject({ isError: true, text: "That search is no longer kept. Search again." });

    const row = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "p7", title: "Design Lead", company: "Acme" } });
    expect((await tool("save_job_scores", { scores: [{ posting_id: row.id, score: 91, reasons: ["Led a design system"] }] })).json).toMatchObject({
      saved: [{ posting_id: row.id, score: 91 }],
      link: "https://dossier.example/jobs?view=saved",
    });
    expect(await tool("save_job_scores", { search_id: "gone", scores: [{ number: 1, score: 1, reasons: ["?"] }] })).toMatchObject({ isError: true });
  });
});
