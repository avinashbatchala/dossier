import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { attributionHref } from "@/lib/job-search/sources";

import { SourceAttribution } from "./source-attribution";

describe("attributionHref", () => {
  it("links to Adzuna's site for the posting's country, read from its link", () => {
    expect(attributionHref("ADZUNA", "https://www.adzuna.de/land/ad/4721394012?se=abc")).toBe("https://www.adzuna.de");
    expect(attributionHref("ADZUNA", "https://www.adzuna.com.au/land/ad/1")).toBe("https://www.adzuna.com.au");
  });

  it("falls back to adzuna.co.uk for a link that isn't on one of Adzuna's sites", () => {
    expect(attributionHref("ADZUNA", "https://jobs.example/1")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("ADZUNA", "https://www.adzuna.de.example/1")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("ADZUNA", "http://www.adzuna.de/land/ad/1")).toBe("https://www.adzuna.co.uk");
    expect(attributionHref("ADZUNA", "")).toBe("https://www.adzuna.co.uk");
  });

  it("has no link for the other sources", () => {
    expect(attributionHref("JSEARCH", "https://www.adzuna.de/land/ad/1")).toBeNull();
    expect(attributionHref("ARBEITSAGENTUR", "https://www.arbeitsagentur.de/jobsuche/jobdetail/1")).toBeNull();
    expect(attributionHref("FREEHIRE", "https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
  });
});

describe("SourceAttribution", () => {
  it("is a link of at least 116 × 23 px for Adzuna", () => {
    render(<SourceAttribution source="ADZUNA" url="https://www.adzuna.fr/land/ad/1" />);
    const link = screen.getByRole("link", { name: "Jobs by Adzuna (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://www.adzuna.fr");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("min-w-[116px]", "min-h-[23px]");
  });

  it("only keeps the room as a placeholder, hidden from assistive technology", () => {
    const { container } = render(<SourceAttribution source="ADZUNA" url="https://www.adzuna.fr/land/ad/1" placeholder />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("is plain text for the Bundesagentur für Arbeit, and nothing for JSearch", () => {
    const { container, rerender } = render(<SourceAttribution source="ARBEITSAGENTUR" url="https://www.arbeitsagentur.de/jobsuche/jobdetail/1" />);
    expect(screen.getByText("Source: Bundesagentur für Arbeit").tagName).toBe("P");
    rerender(<SourceAttribution source="ARBEITSAGENTUR" url="" placeholder />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SourceAttribution source="JSEARCH" url="https://jobs.example/1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
