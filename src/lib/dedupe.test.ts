import { describe, expect, it } from "vitest";

import { cityKey, companyKey, isBoardLink, sameJob, textOverlap, titleKey, type Comparable } from "./dedupe";

const text = (topic: string) =>
  `We are looking for someone to build ${topic} with us. You will work in a small team, ship often and talk to the people who use what we make. ` +
  "You know your way around TypeScript and React, care about accessibility and like to explain what you did. We offer a yearly budget for learning and four weeks of holidays.";

const posting = (extra: Partial<Comparable> = {}): Comparable => ({
  url: "https://careers.northwind.example/jobs/123",
  company: "Northwind GmbH",
  title: "Senior Frontend Engineer (m/w/d)",
  place: "10115 Berlin, Germany",
  remote: false,
  description: text("our shop"),
  ...extra,
});

describe("what postings are compared by (E22-6)", () => {
  it("knows a company without its legal form", () => {
    expect(companyKey("Zalando SE")).toBe("zalando");
    expect(companyKey("Acme GmbH & Co. KG")).toBe("acme");
    expect(companyKey("ACME Holding GmbH")).toBe("acme");
    expect(companyKey("Ernst & Young GmbH")).toBe("ernst and young");
    expect(companyKey("Société Générale SA")).toBe("societe generale");
    // A name that is only a legal form keeps it.
    expect(companyKey("AG")).toBe("ag");
  });

  it("knows a title without its gender tag", () => {
    for (const title of ["Senior Frontend Engineer (m/w/d)", "Senior Frontend Engineer (f/m/x)", "Senior Frontend Engineer m/f/d", "Senior Frontend Engineer (all genders)", "senior frontend engineer"]) {
      expect(titleKey(title)).toBe("senior frontend engineer");
    }
    expect(titleKey("Softwareentwickler*in")).toBe("softwareentwickler");
  });

  it("knows a city by the place's first part, without a postcode", () => {
    expect(cityKey("10115 Berlin, Germany")).toBe("berlin");
    expect(cityKey("Berlin / Hybrid")).toBe("berlin");
    expect(cityKey("Berlin (Mitte)")).toBe("berlin");
    expect(cityKey("Düsseldorf")).toBe("dusseldorf");
    expect(cityKey("")).toBe("");
  });

  it("tells a job board's link from the employer's", () => {
    for (const url of ["https://www.linkedin.com/jobs/view/1", "https://de.indeed.com/viewjob?jk=2", "https://www.adzuna.de/details/3", "https://www.stepstone.de/stellenangebote--x.html"]) expect(isBoardLink(url)).toBe(true);
    for (const url of ["https://careers.northwind.example/jobs/1", "https://jobs.lever.co/northwind/2", "https://boards.greenhouse.io/northwind/jobs/3", "not a link"]) expect(isBoardLink(url)).toBe(false);
  });

  it("measures how much two texts share", () => {
    expect(textOverlap(text("our shop"), text("our shop"))).toBe(1);
    expect(textOverlap(text("our shop"), "Something else entirely, about bread and baking.")).toBe(0);
  });
});

describe("the same job (E22-6)", () => {
  it("is the same apply link, tracking aside, for a title alike (layer 2)", () => {
    expect(sameJob(posting(), posting({ url: "https://careers.northwind.example/jobs/123?utm_source=linkedin", title: "Frontend Engineer, Senior", description: "" }))).toBe(2);
    expect(sameJob(posting(), posting({ title: "Senior Frontend Engineer (React)", description: "" }))).toBe(2);
  });

  it("isn't one careers page for every job", () => {
    expect(sameJob(posting({ url: "https://northwind.example/careers" }), posting({ url: "https://northwind.example/careers", title: "Senior Backend Engineer", description: text("payments") }))).toBeNull();
  });

  it("is the same title in the same city (layer 3)", () => {
    expect(sameJob(posting(), posting({ url: "https://www.adzuna.de/details/1", company: "Northwind", title: "Senior Frontend Engineer", place: "Berlin", description: "Short." }))).toBe(3);
    const remote = { place: "", remote: true };
    expect(sameJob(posting({ ...remote }), posting({ ...remote, url: "" }))).toBe(3);
  });

  it("is a similar title with mostly the same text in the same city (layer 4)", () => {
    expect(sameJob(posting({ url: "" }), posting({ url: "", title: "Senior Frontend Engineer – React" }))).toBe(4);
    // Too little text to tell.
    expect(sameJob(posting({ url: "", description: "Join us." }), posting({ url: "", title: "Senior Frontend Engineer – React", description: "Join us." }))).toBeNull();
  });

  it("isn't one company's template for another role", () => {
    expect(sameJob(posting({ url: "" }), posting({ url: "", title: "Senior Backend Engineer (m/w/d)" }))).toBeNull();
  });

  it("is never across companies, cities or levels", () => {
    expect(sameJob(posting(), posting({ company: "Contoso GmbH" }))).toBeNull();
    expect(sameJob(posting(), posting({ place: "Hamburg" }))).toBeNull();
    expect(sameJob(posting(), posting({ title: "Junior Frontend Engineer (m/w/d)" }))).toBeNull();
    expect(sameJob(posting(), posting({ title: "Frontend Engineer (m/w/d)" }))).toBeNull();
    // A different spelling of the city is a different city: better shown twice than hidden.
    expect(sameJob(posting({ place: "München" }), posting({ place: "Munich", url: "" }))).toBeNull();
  });

  it("needs a city for the same title, unless both are remote", () => {
    expect(sameJob(posting({ url: "" }), posting({ url: "", place: "" }))).toBeNull();
    expect(sameJob(posting({ url: "", place: "", remote: true }), posting({ url: "", place: "", remote: false }))).toBeNull();
  });
});
