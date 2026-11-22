import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { arbeitsagenturDetails, arbeitsagenturPage } from "@/test/job-search-fixtures";

import { builtInAdapter } from "@/lib/portals/adapters";

import { EMPTY_QUERY } from "./search";

const arbeitsagentur = builtInAdapter("ARBEITSAGENTUR");

const fetchPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

const query = { ...EMPTY_QUERY, keywords: "Softwareentwickler", place: "Hamburg", country: "de", radiusKm: 25 as const, postedWithin: "3days" as const };

afterEach(() => {
  vi.unstubAllGlobals();
  fetchPosting.mockReset();
});

describe("Arbeitsagentur search", () => {
  it("asks for internships and traineeships for an internship search (public issue 59)", async () => {
    const requests = stubFetch(() => json(arbeitsagenturPage));
    await arbeitsagentur.search({ ...query, experience: "intern" }, {}, null);
    expect(requests[0].url.searchParams.get("angebotsart")).toBe("34");
  });

  it("asks the v6 search with the public client ID", async () => {
    const requests = stubFetch(() => json(arbeitsagenturPage));
    await arbeitsagentur.search(query, {}, null);
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs");
    expect(headers.get("x-api-key")).toBe("jobboerse-jobsuche");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      was: "Softwareentwickler",
      angebotsart: "1",
      page: "1",
      size: "25",
      wo: "Hamburg",
      umkreis: "25",
      veroeffentlichtseit: "3",
    });
  });

  it("asks for home office jobs for Remote only, and pages on", async () => {
    const requests = stubFetch(() => json(arbeitsagenturPage));
    await arbeitsagentur.search({ ...query, place: "", remoteOnly: true, postedWithin: "any" }, {}, "page:2", { baseUrl: "http://127.0.0.1:3998/ba" });
    const [{ url }] = requests;
    expect(url.href).toMatch(/^http:\/\/127\.0\.0\.1:3998\/ba\/pc\/v6\/jobs\?/);
    expect(url.searchParams.get("arbeitszeit")).toBe("ho");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("wo")).toBe(false);
    expect(url.searchParams.has("veroeffentlichtseit")).toBe(false);
  });

  it("maps offers to the shared shape, to be completed by the details", async () => {
    stubFetch(() => json(arbeitsagenturPage));
    const page = await arbeitsagentur.search(query, {}, null);
    expect(page.next).toBe("page:2");
    expect(page.postings).toEqual([
      {
        source: "ARBEITSAGENTUR",
        externalId: "10001-1003486534-S",
        title: "Softwareentwickler (m/w/d)",
        company: "Hafenlogik GmbH",
        place: "Hamburg / Lübeck",
        // Home office for 60% of the week isn't remote.
        remote: null,
        salary: "EUR 55,000–68,000",
        postedAt: "2026-09-28T00:00:00.000Z",
        url: "https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1003486534-S",
        via: "",
        description: "",
        complete: false,
      },
      {
        source: "ARBEITSAGENTUR",
        externalId: "12265-0000912345-S",
        title: "Remote Backend Developer",
        company: "Nordlicht Software",
        place: "",
        remote: true,
        salary: "",
        postedAt: null,
        url: "https://karriere.nordlicht.example/jobs/7",
        via: "",
        description: "",
        complete: false,
      },
    ]);
  });

  it("stops at the last page, and reads a missing list as none", async () => {
    stubFetch(() => json({ ...arbeitsagenturPage, maxErgebnisse: 2 }));
    expect((await arbeitsagentur.search(query, {}, null)).next).toBeNull();
    stubFetch(() => json({ maxErgebnisse: 0 }));
    expect(await arbeitsagentur.search(query, {}, null)).toEqual({ postings: [], next: null });
  });

  it("says the search changed when it's refused, since there's no key to blame", async () => {
    stubFetch(() => new Response("", { status: 403 }));
    await expect(arbeitsagentur.search(query, {}, null)).rejects.toMatchObject({
      problem: "changed",
      message: "The Arbeitsagentur's job search has changed or isn't answering. Try another source in Settings → Job search.",
      detail: "ARBEITSAGENTUR: /jobboerse/jobsuche-service/pc/v6/jobs: HTTP 403",
    });
  });

  it("says so when the answer has an unknown shape", async () => {
    stubFetch(() => json({ ergebnisliste: "none" }));
    await expect(arbeitsagentur.search(query, {}, null)).rejects.toMatchObject({ problem: "changed" });
  });
});

describe("Arbeitsagentur details and test", () => {
  const posting = {
    source: "ARBEITSAGENTUR" as const,
    externalId: "10001-1003486534-S",
    title: "Softwareentwickler (m/w/d)",
    company: "Hafenlogik GmbH",
    place: "Hamburg",
    remote: null,
    salary: "",
    postedAt: null,
    url: "https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1003486534-S",
    via: "",
    description: "",
    complete: false,
  };

  it("gets the description from the v4 details, by the reference number in base64", async () => {
    const requests = stubFetch(() => json(arbeitsagenturDetails));
    expect(await arbeitsagentur.details(posting, {})).toBe(
      "Wer wir sind\nHafenlogik baut Software für den Hafen.\n\nWas du machst\n- APIs bauen\n- Tests schreiben",
    );
    expect(requests[0].url.pathname).toBe(`/jobboerse/jobsuche-service/pc/v4/jobdetails/${Buffer.from("10001-1003486534-S").toString("base64")}`);
    expect(fetchPosting).not.toHaveBeenCalled();
  });

  it("falls back to the posting's page, then to nothing", async () => {
    stubFetch(() => new Response("", { status: 403 }));
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "From the page.", source: "page", url: posting.url });
    expect(await arbeitsagentur.details(posting, {})).toBe("From the page.");

    stubFetch(() => json({ stellenangebotsBeschreibung: "" }));
    fetchPosting.mockResolvedValueOnce({ ok: false, error: "unreadable" });
    expect(await arbeitsagentur.details(posting, {})).toBeNull();
    expect(await arbeitsagentur.details({ ...posting, url: "" }, {})).toBeNull();
  });

  it("tests the service with one small search", async () => {
    const requests = stubFetch(() => json(arbeitsagenturPage));
    await arbeitsagentur.test({});
    expect(requests[0].url.searchParams.get("was")).toBe("Softwareentwickler");
  });
});
