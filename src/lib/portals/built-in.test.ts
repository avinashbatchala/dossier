import { describe, expect, it } from "vitest";

import { JOB_SOURCES } from "@/lib/job-search/search";
import { attributionHref, postingPage, SOURCE_INFO } from "@/lib/job-search/sources";

import { BUILT_IN_PORTALS } from "./built-in";
import adzuna from "./built-in/adzuna.json";
import { parsePortalConfig } from "./format";

describe("the built-in portals", () => {
  it("are the sources Settings lists, in its order, each a valid config", () => {
    expect(BUILT_IN_PORTALS.map((config) => config.id)).toEqual([...JOB_SOURCES]);
    for (const config of BUILT_IN_PORTALS) expect(parsePortalConfig(config)).toMatchObject({ ok: true });
  });

  it("never name an environment variable or a host outside their own", () => {
    for (const config of BUILT_IN_PORTALS) expect(JSON.stringify(config)).not.toMatch(/DOSSIER_|process\.env/);
  });

  it("give Find jobs and Settings what they showed before", () => {
    expect(SOURCE_INFO.ADZUNA).toMatchObject({ name: "Adzuna", quotaPeriod: "today", attribution: "Jobs by Adzuna", radius: true });
    expect(SOURCE_INFO.ADZUNA.countries).toHaveLength(19);
    expect(SOURCE_INFO.JSEARCH).toMatchObject({ quotaPeriod: "this month", attribution: null, attributionLink: null, countries: null });
    expect(SOURCE_INFO.FREEHIRE).toMatchObject({ attribution: "Jobs by FreeHire", attributionLink: null, radius: false });
    expect(SOURCE_INFO.ARBEITSAGENTUR).toMatchObject({ countries: ["de"], keyUrl: null });
  });

  it("link Adzuna's credit to its site for the posting's country, and to nowhere else", () => {
    expect(adzuna.credit.localHosts).toBe("www.adzuna.*");
    expect(attributionHref("ADZUNA", "https://www.adzuna.de/details/1")).toBe("https://www.adzuna.de");
    expect(attributionHref("ADZUNA", "https://www.adzuna.com.au/details/1")).toBe("https://www.adzuna.com.au");
    expect(attributionHref("ADZUNA", "https://www.adzuna.co.uk/details/1")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("ADZUNA", "https://www.adzuna.evil.example/x")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("ADZUNA", "http://www.adzuna.de/details/1")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("FREEHIRE", "https://freehire.me/x")).toBeNull();
  });

  it("link a BA posting to its own page on arbeitsagentur.de", () => {
    expect(postingPage({ source: "ARBEITSAGENTUR", externalId: "10000-123/X" })).toBe("https://www.arbeitsagentur.de/jobsuche/jobdetail/10000-123%2FX");
    expect(postingPage({ source: "JSEARCH", externalId: "a" })).toBeNull();
  });
});
