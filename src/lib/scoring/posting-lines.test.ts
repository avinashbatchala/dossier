import { describe, expect, it } from "vitest";

import { MAX_LINES, postingLines } from "./posting-lines";

describe("postingLines (#274)", () => {
  it("joins the lines a source wrapped at a fixed width, under each bullet", () => {
    const text = [
      "-Ihre Aufgaben:-",
      "",
      "· Sie unterstützen Aufbau und Betrieb einer Kubernetes Infrastruktur in",
      "unseren Rechenzentren für air-gapped Environments und sorgen für",
      "Skalierung und Sicherheit",
      "· Infrastructure as Code und Automation liegen Ihnen im Blut",
    ].join("\n");
    expect(postingLines(text)).toEqual([
      "Sie unterstützen Aufbau und Betrieb einer Kubernetes Infrastruktur in unseren Rechenzentren für air-gapped Environments und sorgen für Skalierung und Sicherheit",
      "Infrastructure as Code und Automation liegen Ihnen im Blut",
    ]);
  });

  it("keeps short lines without bullets apart, as a list without markers", () => {
    expect(postingLines("What you bring\n5+ years of TypeScript\nExperience with PostgreSQL\nFluent English")).toEqual([
      "What you bring",
      "5+ years of TypeScript",
      "Experience with PostgreSQL",
      "Fluent English",
    ]);
  });

  it("splits a long paragraph into its sentences, and reads wrapped paragraphs as one", () => {
    const paragraph = [
      "We build software for logistics companies across Europe and have grown to forty people in",
      "three offices. You have five or more years of experience with TypeScript and React, and you",
      "have run PostgreSQL in production. A degree in computer science or similar experience is a",
      "plus. We offer a yearly learning budget, flexible hours, a company bike and thirty days of",
      "paid holiday, and we meet in Berlin once a quarter.",
    ].join("\n");
    expect(postingLines(paragraph)).toEqual([
      "We build software for logistics companies across Europe and have grown to forty people in three offices.",
      "You have five or more years of experience with TypeScript and React, and you have run PostgreSQL in production.",
      "A degree in computer science or similar experience is a plus.",
      "We offer a yearly learning budget, flexible hours, a company bike and thirty days of paid holiday, and we meet in Berlin once a quarter.",
    ]);
  });

  it("drops headings, markdown, invisible characters, repeats and lines too short to say anything", () => {
    const text = ["**Requirements:**", "- **Strong** Python skills\u200b", "* Strong Python skills", "1. Docker", "2) Experience with Kubernetes in production"].join("\n");
    expect(postingLines(text)).toEqual(["Strong Python skills", "Experience with Kubernetes in production"]);
  });

  it("cuts a line too long to quote at a word", () => {
    const text = "Experience with distributed systems ".repeat(12).trim();
    const [line] = postingLines(`- ${text}`);
    expect(line.length).toBeLessThanOrEqual(300);
    expect(line).toMatch(/[a-z]…$/);
    expect(text.startsWith(`${line.slice(0, -1)} `)).toBe(true);
  });

  it("past its limit, keeps bullets over sentences from paragraphs, in the posting's order", () => {
    const sentences = Array.from({ length: 30 }, (_, index) => `This is sentence number ${index} about the company.`).join(" ");
    const bullets = Array.from({ length: MAX_LINES }, (_, index) => `- Requirement number ${index} for this job`).join("\n");
    const lines = postingLines(`${sentences}\n\n${bullets}`);
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines[0]).toBe("Requirement number 0 for this job");
    expect(lines.at(-1)).toBe(`Requirement number ${MAX_LINES - 1} for this job`);
  });

  it("finds nothing in an empty posting", () => {
    expect(postingLines("")).toEqual([]);
    expect(postingLines("\n \n")).toEqual([]);
  });
});
