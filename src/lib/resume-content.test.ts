import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";

import { contactItems, displayLink, resumeContent, sectionsWithContent } from "./resume-content";

const today = new Date(2026, 8, 28);

describe("contactItems", () => {
  const { basics } = demoProfile();

  it("lists email, phone, city and country, website and LinkedIn", () => {
    expect(contactItems(basics, today)).toEqual([
      "jane.doe@example.com",
      "+31 6 1234 5678",
      "Rotterdam, Netherlands",
      "example.com",
      "linkedin.com/in/janedoe-example",
    ]);
  });

  it("adds the age only when show-age is on", () => {
    expect(contactItems({ ...basics, showAge: true }, today).at(-1)).toBe("Age 34");
    expect(contactItems({ ...basics, showAge: true, dob: "" }, today)).toHaveLength(5);
  });

  it("skips what's empty", () => {
    expect(contactItems({ ...basics, phone: " ", city: "", website: "" }, today)).toEqual([
      "jane.doe@example.com",
      "Netherlands",
      "linkedin.com/in/janedoe-example",
    ]);
  });
});

describe("resumeContent", () => {
  const profile = demoProfile();

  it("builds the base resume from the profile", () => {
    const content = resumeContent(profile, { today });
    expect(content.name).toBe("Jane Doe");
    expect(content.experience.map((role) => [role.company, role.dates])).toEqual([
      ["Northwind Logistics", "Mar 2021 – Present"],
      ["Fieldnote", "Jun 2018 – Feb 2021"],
      ["Studio Brik", "Sep 2015 – May 2018"],
    ]);
    expect(content.experience[0].bullets).toHaveLength(3);
    expect(content.experience[2].skills).toEqual(["HTML & CSS", "Interaction design"]);
    expect(content.education[0]).toMatchObject({ dates: "2013 – 2015", notes: "Thesis on trust in automated scheduling tools" });
    expect(content.skills).toBe(
      "Interaction design · Design systems · Prototyping · User research · Figma · HTML & CSS · Workshop facilitation",
    );
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("includes references only when asked", () => {
    expect(resumeContent(profile).references).toEqual([]);
    expect(resumeContent(profile, { includeReferences: true }).references[0]).toEqual({
      id: "r1",
      name: "John Doe",
      role: "Former manager, Northwind Logistics",
      contact: "john.doe@example.com",
    });
  });

  it("leaves an empty profile empty, apart from a placeholder name", () => {
    const empty: ProfileData = {
      basics: { ...profile.basics, ...Object.fromEntries(Object.keys(profile.basics).map((key) => [key, ""])), showAge: false },
      skills: [],
      languages: [],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      publications: [],
      references: [],
      customSections: [],
      facts: [],
      photo: null,
    };
    expect(resumeContent(empty)).toEqual({
      customSections: [],
      name: "Your name",
      headline: "",
      photo: null,
      contacts: [],
      summary: "",
      experience: [],
      volunteering: [],
      projects: [],
      education: [],
      certifications: [],
      publications: [],
      skills: "",
      languages: "",
      references: [],
    });
  });

  it("takes a tailored resume's text from its units", () => {
    const content = resumeContent(profile, { units: demoResumeUnits() });
    expect(content.summary).toMatch(/^Senior product designer with nine years of making complex/);
    expect(content.experience[0].bullets[0]).toBe(
      "Led the redesign of the carrier portal used daily by 4,000+ dispatchers: a dense, high-stakes workflow",
    );
    // Role skills still come from the profile (RES-6).
    expect(content.experience[0].skills).toContain("Design systems");
    expect(content.skills).toMatch(/^Design systems · User research · Figma · /);
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("lays out projects like roles, with their link as a resume shows it (PRO-13)", () => {
    expect(resumeContent(profile).projects).toEqual([
      {
        id: "p1",
        name: "Tidewater design tokens",
        link: "github.com/janedoe/tidewater",
        href: "https://github.com/janedoe/tidewater",
        dates: "Jan 2023 – Present",
        bullets: profile.projects[0].bullets.split("\n"),
        skills: ["Design systems", "Figma", "HTML & CSS"],
      },
    ]);
    expect(displayLink("https://www.example.com/work/")).toBe("example.com/work");
    expect(displayLink(" http://github.com/jane ")).toBe("github.com/jane");
    // A tailored resume takes a project's bullets from its unit, and leaves out one without a unit.
    const tailored = resumeContent(profile, { units: [{ id: "project:p1", label: "Tidewater project", text: "Shipped a token pipeline" }] });
    expect(tailored.projects.map((project) => project.bullets)).toEqual([["Shipped a token pipeline"]]);
    // The profile's bold comes back on the words a tailored text keeps (#368).
    const bold = { ...profile, projects: [{ ...profile.projects[0], bullets: "Shipped a **token pipeline** for three teams" }] };
    const kept = resumeContent(bold, { units: [{ id: "project:p1", label: "Tidewater project", text: "Shipped a token pipeline" }] });
    expect(kept.projects[0].bullets).toEqual(["Shipped a **token pipeline**"]);
    expect(resumeContent(profile, { units: [] }).projects).toEqual([]);
  });

  it("shows publications word for word, with their link, and not the ones kept off resumes (#218)", () => {
    expect(resumeContent(profile).publications).toEqual([
      {
        id: "u1",
        citation: profile.publications[0].citation,
        link: "doi.org/10.5555/12345678",
        href: "https://doi.org/10.5555/12345678",
      },
    ]);
    const hidden = { ...profile, publications: [{ ...profile.publications[0], onResumes: false }, { id: "u2", citation: " ", link: "", onResumes: true }] };
    expect(resumeContent(hidden).publications).toEqual([]);
    // A tailored resume takes the citation from its unit, and a DOI on its own opens at doi.org.
    const doi = { ...profile, publications: [{ ...profile.publications[0], link: "10.1038/s41388-024-03270-3" }] };
    expect(resumeContent(doi, { units: [{ id: "publication:u1", label: "Publication", text: "Doe, J. (2016). *Edited.*" }] }).publications).toEqual([
      { id: "u1", citation: "Doe, J. (2016). *Edited.*", link: "doi.org/10.1038/s41388-024-03270-3", href: "https://doi.org/10.1038/s41388-024-03270-3" },
    ]);
    expect(resumeContent(profile, { units: [] }).publications).toEqual([]);
  });

  it("shows certifications with their issuer, dates, ID and link, and not the ones kept off resumes (#293)", () => {
    expect(resumeContent(profile).certifications).toEqual([
      {
        id: "c1",
        name: "Certified Accessibility Specialist",
        issuer: "Inclusive Design Institute",
        date: "Jun 2022",
        details: ["Valid until Jun 2028", "Credential ID IDI-20481"],
        link: "verify.example.org/IDI-20481",
        href: "https://verify.example.org/IDI-20481",
      },
    ]);
    const hidden = { ...profile, certifications: [{ ...profile.certifications[0], onResumes: false }, { ...profile.certifications[0], id: "c2", name: " " }] };
    expect(resumeContent(hidden).certifications).toEqual([]);
    // A tailored resume takes the name from its unit; a link that isn't a web address doesn't open.
    const odd = { ...profile, certifications: [{ ...profile.certifications[0], link: "javascript:alert(1)" }] };
    expect(resumeContent(odd, { units: [{ id: "certification:c1", label: "Certification", text: "Accessibility Specialist" }] }).certifications).toEqual([
      expect.objectContaining({ name: "Accessibility Specialist", href: null }),
    ]);
    expect(resumeContent(profile, { units: [] }).certifications).toEqual([]);
  });

  it("puts volunteering apart from the paid roles, in a tailored resume too (#294)", () => {
    const mentor = { ...profile.experience[2], id: "v1", role: "Mentor", company: "Code Club", volunteering: true };
    const withVolunteering = { ...profile, experience: [...profile.experience, mentor] };
    const content = resumeContent(withVolunteering);
    expect(content.experience.map((role) => role.id)).toEqual(["e1", "e2", "e3"]);
    expect(content.volunteering).toEqual([expect.objectContaining({ id: "v1", role: "Mentor", company: "Code Club", bullets: [mentor.bullets] })]);
    const tailored = resumeContent(withVolunteering, {
      units: [
        { id: "experience:v1", label: "Code Club volunteering", text: "Ran a weekly club" },
        { id: "experience:e1", label: "Northwind Logistics role", text: "Led it" },
      ],
    });
    expect(tailored.experience.map((role) => role.id)).toEqual(["e1"]);
    expect(tailored.volunteering).toEqual([expect.objectContaining({ id: "v1", bullets: ["Ran a weekly club"] })]);
  });

  it("includes only the parts a tailored resume has units for, in their order", () => {
    const units = [
      { id: "experience:e2", label: "Fieldnote role", text: "Ran research" },
      { id: "experience:e1", label: "Northwind Logistics role", text: "Led the portal redesign" },
      { id: "experience:gone", label: "Deleted role", text: "Ignored" },
      { id: "education:d1", label: "MSc", text: "" },
    ];
    const content = resumeContent(profile, { units });
    expect(content.summary).toBe("");
    expect(content.experience.map((role) => [role.company, role.bullets])).toEqual([
      ["Fieldnote", ["Ran research"]],
      ["Northwind Logistics", ["Led the portal redesign"]],
    ]);
    expect(content.education.map((entry) => entry.school)).toEqual(["TU Delft"]);
    expect(content.skills).toBe("");
    expect(content.languages).toBe("");
  });
});

describe("custom sections (#298)", () => {
  const item = {
    id: "i1",
    title: "Mentor",
    subtitle: "Code Club",
    startYear: 2021,
    startMonth: null,
    endYear: null,
    endMonth: null,
    current: true,
    details: "Taught 40 pupils\nRan the summer camp",
    link: "https://www.example.org/club/",
    onResumes: true,
  };
  const withSection = (format: "ENTRIES" | "LINES" | "INLINE", items = [item]) => ({
    ...demoProfile(),
    customSections: [{ id: "s1", title: " Awards ", format, countsAs: "EXTRA_ACTIVITIES" as const, items }],
  });

  it("shows items with their fields, without the link's scheme", () => {
    const [section] = resumeContent(withSection("ENTRIES")).customSections;
    expect(section).toMatchObject({ id: "s1", title: "Awards", format: "ENTRIES" });
    expect(section.items[0]).toMatchObject({ title: "Mentor", subtitle: "Code Club", dates: "2021 – Present", bullets: ["Taught 40 pupils", "Ran the summer camp"], link: "example.org/club", href: "https://www.example.org/club/" });
  });

  it("leaves out items kept off resumes, and a section left empty", () => {
    expect(resumeContent(withSection("LINES", [{ ...item, onResumes: false }])).customSections).toEqual([]);
    expect(resumeContent(withSection("LINES", [{ ...item, title: " " }])).customSections).toEqual([]);
  });

  it("counts a section with something to show as having content", () => {
    expect(sectionsWithContent(resumeContent(withSection("LINES")))).toContain("custom:s1");
    expect(sectionsWithContent(resumeContent(withSection("LINES", [])))).not.toContain("custom:s1");
  });

  it("takes a tailored entry's bullets and a tailored line's text from its unit, and shows nothing without one", () => {
    const entries = resumeContent(withSection("ENTRIES"), { units: [{ id: "custom-entry:i1", label: "Mentor", text: "Edited here" }] });
    expect(entries.customSections[0].items[0]).toMatchObject({ title: "Mentor", bullets: ["Edited here"] });
    const lines = resumeContent(withSection("LINES"), { units: [{ id: "custom-line:i1", label: "Mentor", text: "Edited line" }] });
    expect(lines.customSections[0].items[0]).toMatchObject({ title: "Edited line", bullets: [], link: "example.org/club" });
    expect(resumeContent(withSection("LINES"), { units: [] }).customSections).toEqual([]);
  });

  it("reads an inline section from its one unit, an item per line", () => {
    const content = resumeContent(withSection("INLINE"), { units: [{ id: "custom-inline:s1", label: "Awards", text: "Climbing\nChess" }] });
    expect(content.customSections[0].items.map((entry) => entry.title)).toEqual(["Climbing", "Chess"]);
  });
});
