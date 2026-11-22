import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { adzunaPage } from "@/test/job-search-fixtures";

import { builtInAdapter } from "@/lib/portals/adapters";

import { EMPTY_QUERY } from "./search";

const adzuna = builtInAdapter("ADZUNA");

const fetchPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

const query = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de", radiusKm: 50 as const, postedWithin: "week" as const };
const credentials = { appId: "app-1", key: "adz-key" };

afterEach(() => {
  vi.unstubAllGlobals();
  fetchPosting.mockReset();
});

describe("Adzuna search", () => {
  it("asks for the country's index, signed with the app ID and key", async () => {
    const requests = stubFetch(() => json(adzunaPage));
    await adzuna.search(query, credentials, null);
    const [{ url }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://api.adzuna.com/v1/api/jobs/de/search/1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: "app-1",
      app_key: "adz-key",
      results_per_page: "20",
      what: "product designer",
      where: "Hamburg",
      distance: "50",
      max_days_old: "7",
    });
  });

  it("adds “remote” to the words, having no remote filter, and leaves out what isn't asked", async () => {
    const requests = stubFetch(() => json(adzunaPage));
    await adzuna.search({ ...query, place: "", remoteOnly: true, postedWithin: "any" }, credentials, "page:3", { baseUrl: "http://127.0.0.1:3998/adzuna" });
    const [{ url }] = requests;
    expect(url.href).toMatch(/^http:\/\/127\.0\.0\.1:3998\/adzuna\/de\/search\/3\?/);
    expect(url.searchParams.get("what")).toBe("product designer remote");
    expect(url.searchParams.has("where")).toBe(false);
    expect(url.searchParams.has("distance")).toBe(false);
    expect(url.searchParams.has("max_days_old")).toBe(false);
  });

  it("maps results to the shared shape, marked incomplete, with the HTML taken out", async () => {
    stubFetch(() => json(adzunaPage));
    const page = await adzuna.search(query, credentials, null);
    expect(page.next).toBe("page:2");
    expect(page.postings).toEqual([
      {
        source: "ADZUNA",
        externalId: "4721394012",
        title: "Senior Product Designer & Researcher",
        company: "Ledgerly GmbH",
        place: "Hamburg, Deutschland",
        remote: null,
        salary: "EUR 70,000–85,000 a year (estimated)",
        postedAt: "2026-09-29T09:15:00.000Z",
        url: "https://www.adzuna.de/land/ad/4721394012?se=abc&utm_medium=api&utm_source=dossier&v=1",
        via: "",
        description: "Ledgerly is hiring a Product Designer for its payments team…",
        complete: false,
      },
      {
        source: "ADZUNA",
        externalId: "4721394013",
        title: "UX Researcher",
        company: "",
        place: "Berlin",
        remote: null,
        salary: "",
        postedAt: null,
        url: "",
        via: "",
        description: "",
        complete: false,
      },
    ]);
  });

  it("stops at the last page", async () => {
    stubFetch(() => json({ ...adzunaPage, count: 45 }));
    expect((await adzuna.search(query, credentials, "page:3")).next).toBeNull();
    stubFetch(() => json({ results: [], count: 0 }));
    expect((await adzuna.search(query, credentials, null)).next).toBeNull();
  });

  it("writes a salary without a range as one amount, in the country's currency", async () => {
    stubFetch(() => json({ count: 1, results: [{ id: "1", salary_min: 52000, salary_max: 52000, salary_is_predicted: "0" }] }));
    const [posting] = (await adzuna.search({ ...query, country: "gb" }, credentials, null)).postings;
    expect(posting.salary).toBe("GBP 52,000 a year");
  });

  it("says the source changed when the answer has an unknown shape", async () => {
    stubFetch(() => json({ jobs: [] }));
    await expect(adzuna.search(query, credentials, null)).rejects.toMatchObject({ problem: "changed" });
  });

  it("says when Adzuna refuses the key", async () => {
    stubFetch(() => json({ exception: "AUTH_FAIL" }, { status: 401 }));
    await expect(adzuna.search(query, credentials, null)).rejects.toMatchObject({
      problem: "key",
      message: "Adzuna didn't accept your key. Check it in Settings → Job search.",
    });
  });
});

describe("Adzuna details and test", () => {
  it("reads the rest of the posting from its page with the guarded fetcher", async () => {
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "The whole posting.", source: "page", url: "https://www.adzuna.de/details/1" });
    stubFetch(() => json(adzunaPage));
    const [posting] = (await adzuna.search(query, credentials, null)).postings;
    expect(await adzuna.details(posting, credentials)).toBe("The whole posting.");
    expect(fetchPosting).toHaveBeenCalledWith(posting.url);

    fetchPosting.mockResolvedValueOnce({ ok: false, error: "unreadable" });
    expect(await adzuna.details(posting, credentials)).toBeNull();
    expect(await adzuna.details({ ...posting, url: "" }, credentials)).toBeNull();
  });

  it("tests the key with one small search", async () => {
    const requests = stubFetch(() => json(adzunaPage));
    await adzuna.test(credentials);
    expect(requests[0].url.pathname).toBe("/v1/api/jobs/gb/search/1");
  });
});
