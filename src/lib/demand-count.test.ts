import { describe, expect, it } from "vitest";

import { askedFor, askedNote, countDemand, skillKey, type DemandSource } from "./demand-count";

const source = (company: string, ...asks: [string, boolean | null][]): DemandSource => ({ company, asks: asks.map(([skill, covered]) => ({ skill, covered })) });

describe("skillKey (E33-3)", () => {
  it("normalises case, accents, punctuation and a few synonyms, and keeps what tells skills apart", () => {
    expect(skillKey(" React.js ")).toBe("react");
    expect(skillKey("ReactJS")).toBe("react");
    expect(skillKey("react")).toBe("react");
    expect(skillKey("K8s")).toBe("kubernetes");
    expect(skillKey("Postgres")).toBe("postgresql");
    expect(skillKey("Café-Design")).toBe("cafe design");
    expect(skillKey("C++")).toBe("c++");
    expect(skillKey("C#")).toBe("c#");
    expect(skillKey("CI/CD")).toBe("ci/cd");
    expect(skillKey("CI CD")).toBe("ci/cd");
    expect(skillKey("  ")).toBe("");
  });
});

describe("countDemand (E33-3)", () => {
  const demand = countDemand([
    source("Ledgerly", ["Kubernetes", false], ["Figma", true], ["k8s", null]),
    source("Adyen", ["Kubernetes", false], ["figma", true]),
    source("Finch Ledger", ["kubernetes", true]),
    source("Ledgerly", ["Payments", false]),
    source("Nobody", ["  ", null]),
  ]);

  it("counts each skill once per posting, the postings that ask for any, and who asks", () => {
    expect(demand.postings).toBe(4);
    expect(demand.items.map(({ name, count }) => [name, count])).toEqual([
      ["Kubernetes", 3],
      ["Figma", 2],
      ["Payments", 1],
    ]);
    expect(demand.items[0]).toMatchObject({ key: "kubernetes", coveredVotes: 1, gapVotes: 2, companies: ["Ledgerly", "Adyen", "Finch Ledger"] });
    expect(demand.items[2]).toMatchObject({ companies: ["Ledgerly"] });
  });

  it("covers what the profile lists or most scores found, and leaves out gaps marked as not had", () => {
    expect(askedFor(demand, { known: [], hidden: [] }).map(({ name, covered }) => [name, covered])).toEqual([
      ["Kubernetes", false],
      ["Figma", true],
      ["Payments", false],
    ]);
    expect(askedFor(demand, { known: ["K8s"], hidden: ["payments"] }).map(({ name, covered }) => [name, covered])).toEqual([
      ["Kubernetes", true],
      ["Figma", true],
    ]);
  });

  it("notes how many postings ask and who", () => {
    expect(askedNote(demand.items[0])).toBe("In 3 postings · Ledgerly, Adyen, Finch Ledger");
    expect(askedNote(demand.items[0], 2)).toBe("In 3 postings · Ledgerly, Adyen…");
    expect(askedNote({ count: 1, companies: [] })).toBe("In 1 posting");
  });
});
