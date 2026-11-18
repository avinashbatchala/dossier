import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExport, EXPORT_SCHEMA_VERSION } from "@/lib/data-export";
import { ActionError } from "@/lib/action";
import { importExport, parseExport } from "@/lib/data-import";
import { EMPTY_QUERY, type FoundPosting } from "@/lib/job-search/search";
import { loadSettings } from "@/lib/settings-data";
import { postingStates } from "@/lib/postings";
import * as postingsService from "@/lib/postings";
import { createTestClient, resetDatabase, testsUseSqlite } from "@/test/db";

import { attributeAgentCandidates } from "./attribution";
import { candidateData } from "./candidates";
import { deleteAgentSearch, listAgentSearches, lockAgentSearches, saveAgentSearch, setAgentSearchEnabled } from "./searches";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_, key) => Reflect.get(client, key) }) }));
const client = createTestClient();
const input = { name: "  Design  ", query: { ...EMPTY_QUERY, keywords: "  Designer  ", country: " DE ", place: " Berlin " } };
const score = { score: 80, reasons: ["Fits"], redFlags: [] };
const posting = (externalId: string): FoundPosting => ({
  source: "JSEARCH", externalId, title: externalId, company: "Co", place: "Berlin", remote: null, salary: "",
  postedAt: null, url: `https://example.org/${externalId}`, via: "", description: "Job", complete: true,
});
beforeEach(() => resetDatabase(client));
afterAll(() => client.$disconnect());

describe("recurring Agent search storage", () => {
  it("patches enabled only against the current row, retaining concurrent edits and validating its country", async () => {
    const original = await saveAgentSearch(input, undefined, client);
    const edited = await saveAgentSearch({ ...input, name: "Edited elsewhere", query: { ...input.query, keywords: "Engineer", place: "Hamburg" }, sort: 9 }, original.id, client);
    const toggled = await setAgentSearchEnabled(original.id, false, client);
    expect(toggled).toMatchObject({ id: original.id, enabled: false, name: edited.name, query: edited.query, sort: 9, createdAt: edited.createdAt });
    expect(await client.agentSearch.findUnique({ where: { id: original.id } })).toMatchObject({ enabled: false, name: edited.name, query: edited.query, sort: 9 });

    const incomplete = await saveAgentSearch({ ...input, name: "Current country missing", query: { ...input.query, country: "" }, sort: 4, enabled: false }, original.id, client);
    await expect(setAgentSearchEnabled(original.id, true, client)).rejects.toThrow("Choose a country for “Current country missing”.");
    expect(await client.agentSearch.findUnique({ where: { id: original.id } })).toMatchObject({ enabled: false, name: incomplete.name, query: incomplete.query, sort: 4 });
    await expect(setAgentSearchEnabled(original.id, false, client)).resolves.toMatchObject({ enabled: false, query: incomplete.query });
    await deleteAgentSearch(original.id, client);
    await expect(setAgentSearchEnabled(original.id, true, client)).rejects.toThrow("no longer exists");
  });

  it("normalizes queries and names, preserves stable ids, and orders enabled and disabled searches", async () => {
    const first = await saveAgentSearch({ ...input, sort: 2 }, undefined, client);
    const second = await saveAgentSearch({ ...input, name: "Other", enabled: false }, undefined, client);
    expect(first).toMatchObject({ name: "Design", query: { keywords: "Designer", country: "de", place: "Berlin" }, enabled: true });
    const renamed = await saveAgentSearch({ ...input, name: "New name", sort: 1 }, first.id, client);
    expect(renamed.id).toBe(first.id);
    expect((await listAgentSearches(client)).map((search) => search.id)).toEqual([second.id, first.id]);
    await expect(saveAgentSearch({ ...input, name: " " }, undefined, client)).rejects.toThrow();
    await expect(saveAgentSearch({ ...input, query: { ...input.query, keywords: " " } }, undefined, client)).rejects.toThrow();
    await expect(saveAgentSearch(input, "deleted-id", client)).rejects.toBeInstanceOf(ActionError);
    await expect(saveAgentSearch(input, "deleted-id", client)).rejects.toThrow("no longer exists");
  });

  it("enforces three total searches even with concurrent writes and disabled searches", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, sort) => saveAgentSearch({ ...input, sort, enabled: false }, undefined, client)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(await client.agentSearch.count()).toBe(3);
    const first = (await listAgentSearches(client))[0];
    await expect(saveAgentSearch({ ...input, name: "Edit at cap" }, first.id, client)).resolves.toMatchObject({ id: first.id });
    await deleteAgentSearch(first.id, client);
    await expect(saveAgentSearch(input, undefined, client)).resolves.toBeDefined();
  });

  it("attributes candidates only, shares overlap, and keeps original names after rename/delete", async () => {
    const first = await saveAgentSearch(input, undefined, client);
    const second = await saveAgentSearch({ ...input, name: "Other" }, undefined, client);
    const kept = await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    await client.agentCandidate.create({ data: { ...candidateData(posting("dismissed"), score), status: "DISMISSED" } });
    for (const [id, mark] of [["saved", { savedAt: new Date() }], ["passed", { dismissedAt: new Date() }]] as const) {
      await client.agentCandidate.create({ data: candidateData(posting(id), score) });
      await client.posting.create({ data: { source: "JSEARCH", externalId: id, ...mark } });
    }
    await client.agentCandidate.create({ data: candidateData(posting("applied"), score) });
    await client.application.create({ data: { postingUrl: posting("applied").url } });
    const found = ["kept", "dismissed", "saved", "passed", "applied", "unscored"].map(posting);
    await attributeAgentCandidates(first, found);
    // A different source/id with the same link matches the kept candidate.
    await attributeAgentCandidates(second, [{ ...posting("kept"), source: "ADZUNA", externalId: "elsewhere" }]);
    await attributeAgentCandidates(second, [{ ...posting("saved"), source: "ADZUNA", externalId: "saved-elsewhere" }]);
    await saveAgentSearch({ ...input, name: "Renamed" }, first.id, client);
    await attributeAgentCandidates({ ...first, name: "Renamed" }, found);
    expect(await client.agentCandidateSearch.findMany()).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: kept.id, searchId: first.id, searchName: "Design" }),
      expect.objectContaining({ candidateId: kept.id, searchId: second.id, searchName: "Other" }),
    ]));
    expect(await client.agentCandidateSearch.count()).toBe(2);
    await deleteAgentSearch(first.id, client);
    expect(await client.agentCandidateSearch.findFirst({ where: { searchName: "Design" } })).toMatchObject({ searchId: null });
    expect(await client.agentCandidate.count()).toBe(5);
    await client.agentCandidate.delete({ where: { id: kept.id } });
    expect(await client.agentCandidateSearch.count()).toBe(0);
  });

  it("round trips v11 searches and historical attribution, removes old storage, and preserves the quota ledger", async () => {
    const first = await saveAgentSearch(input, undefined, client);
    const second = await saveAgentSearch({ ...input, name: "Disabled", enabled: false }, undefined, client);
    await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    await attributeAgentCandidates(first, [posting("kept")]);
    await attributeAgentCandidates(second, [posting("kept")]);
    await deleteAgentSearch(first.id, client);
    await client.setting.createMany({ data: [{ key: "agentRuns", value: "[]" }, { key: "agentQuery", value: JSON.stringify(input.query) }] });
    const data = await buildExport(client);
    expect(data.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(data.settings.map((setting) => setting.key)).not.toContain("agentQuery");
    expect(data.settings.map((setting) => setting.key)).not.toContain("agentRuns");
    const parsed = parseExport(JSON.stringify(data));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(client, parsed.data);
    expect((await buildExport(client)).agentSearches).toEqual(data.agentSearches);
    expect((await buildExport(client)).agentCandidateSearches).toEqual(data.agentCandidateSearches);
    expect(await client.setting.findUnique({ where: { key: "agentQuery" } })).toBeNull();
    expect(await client.setting.findUnique({ where: { key: "agentRuns" } })).toMatchObject({ value: "[]" });
    await importExport(client, { ...data, agentSearches: [], agentCandidates: [], agentCandidateSearches: [] });
    expect(await client.agentSearch.count()).toBe(0);
    expect(await client.agentCandidateSearch.count()).toBe(0);
  });

  it("reads posting exclusions through the caller's transaction, including uncommitted changes", async () => {
    await client.$transaction(async (tx) => {
      await tx.posting.create({ data: { source: "JSEARCH", externalId: "uncommitted", savedAt: new Date() } });
      const states = await postingStates([posting("uncommitted")], tx);
      expect([...states.values()]).toEqual([expect.objectContaining({ saved: true })]);
    });
  });

  it("restores dangling search references as historical labels and ignores links without candidates", async () => {
    const search = await saveAgentSearch(input, undefined, client);
    const kept = await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    await attributeAgentCandidates(search, [posting("kept")]);
    const data = await buildExport(client);
    const link = data.agentCandidateSearches[0];
    await importExport(client, { ...data, agentSearches: [], agentCandidateSearches: [
      link, { ...link, id: "orphan-link", candidateId: "missing-candidate" },
    ] });
    expect(await client.agentCandidateSearch.findMany()).toEqual([
      expect.objectContaining({ candidateId: kept.id, searchId: null, searchName: "Design" }),
    ]);
    expect(await client.agentCandidate.count()).toBe(1);
    expect(await client.agentSearch.count()).toBe(0);
  });

  it("rolls back the whole replacement if imported attribution violates uniqueness", async () => {
    const search = await saveAgentSearch(input, undefined, client);
    await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    await attributeAgentCandidates(search, [posting("kept")]);
    const data = await buildExport(client);
    const link = data.agentCandidateSearches[0];
    await expect(importExport(client, { ...data, agentSearches: [{ ...data.agentSearches[0], name: "Should roll back" }], agentCandidateSearches: [
      link, { ...link, id: "duplicate-link" },
    ] })).rejects.toThrow();
    const after = await buildExport(client);
    expect(after.agentSearches).toEqual(data.agentSearches);
    expect(after.agentCandidates).toEqual(data.agentCandidates);
    expect(after.agentCandidateSearches).toEqual(data.agentCandidateSearches);
  });

  it("does not restore historical attribution for dismissed candidates", async () => {
    const search = await saveAgentSearch(input, undefined, client);
    const kept = await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    await attributeAgentCandidates(search, [posting("kept")]);
    const data = await buildExport(client);
    await importExport(client, { ...data, agentCandidates: data.agentCandidates.map((candidate) => ({ ...candidate, status: "DISMISSED" })) });
    expect(await client.agentCandidate.findUnique({ where: { id: kept.id } })).toMatchObject({ status: "DISMISSED" });
    expect(await client.agentCandidateSearch.count()).toBe(0);
  });

  it("keeps every attribution eligibility read on its transaction client", async () => {
    const search = await saveAgentSearch(input, undefined, client);
    await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    const states = vi.spyOn(postingsService, "postingStates");
    try {
      await attributeAgentCandidates(search, [posting("kept")]);
      expect(states).toHaveBeenCalledTimes(2);
      for (const [, tx] of states.mock.calls) {
        expect(tx).toBeDefined();
        expect(tx).not.toBe(client);
      }
      expect(states.mock.calls[0][1]).toBe(states.mock.calls[1][1]);
    } finally {
      states.mockRestore();
    }
  });

  // PostgreSQL's advisory lock, watched in pg_locks. SQLite runs one transaction at a time anyway.
  it.skipIf(testsUseSqlite())("waits behind a replacement's shared lock before reading candidates or creating attribution", async () => {
    const search = await saveAgentSearch(input, undefined, client);
    await client.agentCandidate.create({ data: candidateData(posting("kept"), score) });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const replacing = client.$transaction(async (tx) => {
      await lockAgentSearches(tx);
      ready();
      await gate;
      // Same lock and deletion order as import/wipe.
      await tx.agentCandidate.deleteMany();
      await tx.agentSearch.deleteMany();
    });
    await locked;
    const attributing = attributeAgentCandidates(search, [posting("kept")]);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [row] = await client.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 621746001
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND NOT granted
        ) AS waiting`;
        waiting = row.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await Promise.all([replacing, attributing]);
    }
    expect(await client.agentCandidateSearch.count()).toBe(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const)("converts legacy agentQuery only for schema %i, without inventing past attribution", async (schemaVersion) => {
    const data = { ...await buildExport(client), schemaVersion, agentSearches: undefined, agentCandidateSearches: undefined, settings: [{ key: "agentQuery", value: JSON.stringify(input.query) }] };
    const parsed = parseExport(JSON.stringify(data));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(client, parsed.data);
    expect(await listAgentSearches(client)).toEqual([expect.objectContaining({ id: "agent-search-legacy", name: "My search", query: { keywords: "Designer", country: "de", place: "Berlin", radiusKm: 25, remoteOnly: false, postedWithin: "any" } })]);
    expect(await client.agentCandidateSearch.count()).toBe(0);
    expect(await client.setting.count({ where: { key: "agentQuery" } })).toBe(0);
  });

  it("ignores invalid/empty legacy queries and ignores agentQuery in v11", async () => {
    for (const value of ["broken", "null", JSON.stringify(EMPTY_QUERY)]) {
      await importExport(client, { ...await buildExport(client), schemaVersion: 5, settings: [{ key: "agentQuery", value }] });
      expect(await client.agentSearch.count()).toBe(0);
    }
    await importExport(client, { ...await buildExport(client), settings: [{ key: "agentQuery", value: JSON.stringify(input.query) }] });
    expect(await client.agentSearch.count()).toBe(0);
  });

  it("recovers legacy optional fields like SQL, truncating a long place without losing keywords", async () => {
    await importExport(client, { ...await buildExport(client), schemaVersion: 5, settings: [{
      key: "agentQuery", value: JSON.stringify({ keywords: " Engineer ", place: " x".repeat(300), country: "invalid", radiusKm: 42, remoteOnly: "yes", postedWithin: "invalid" }),
    }] });
    const [search] = await listAgentSearches(client);
    expect(search.query).toEqual({ ...EMPTY_QUERY, keywords: "Engineer", place: " x".repeat(300).trim().slice(0, 200).trim() });
  });

  it("rejects oversized or invalid imports before replacing anything, including direct callers", async () => {
    await saveAgentSearch(input, undefined, client);
    const data = await buildExport(client);
    const oversized = { ...data, agentSearches: Array.from({ length: 4 }, (_, index) => ({ ...data.agentSearches[0], id: `id-${index}` })) };
    expect(parseExport(JSON.stringify(oversized))).toMatchObject({ ok: false, error: expect.stringContaining("Keep at most three Agent searches.") });
    await expect(importExport(client, oversized)).rejects.toBeInstanceOf(ActionError);
    await expect(importExport(client, oversized)).rejects.toThrow("three");
    await expect(importExport(client, { ...data, agentSearches: [{ ...data.agentSearches[0], name: " " }] })).rejects.toThrow();
    expect((await buildExport(client)).agentSearches).toEqual(data.agentSearches);
  });

  it("does not expose a legacy query through settings", async () => {
    await client.setting.create({ data: { key: "agentQuery", value: JSON.stringify(input.query) } });
    expect(await loadSettings()).not.toHaveProperty("agentQuery");
  });
});
