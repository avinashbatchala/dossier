import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fitFromAnswers } from "@/lib/fit";

import { FitDetails } from "./fit-details";

const fit = fitFromAnswers({
  requirements: [
    { text: "Kubernetes", mustHave: true, covered: false, evidence: null },
    ...["Figma", "Design systems", "Research", "Prototyping", "Workshops", "B2B", "Payments", "SQL", "Mentoring"].map((text) => ({ text, mustHave: true, covered: true, evidence: null })),
  ],
  work: { value: 1, reason: "You've designed payments tools at Northwind." },
  extra: { value: 1, reason: "Your design system project." },
  education: { value: 1, reason: "Your degree meets it." },
  seniority: { fit: "fits", reason: "Senior, as your levels say." },
  location: { fit: "fits", reason: "Amsterdam is within 50 km." },
  thin: false,
});

describe("FitDetails (E25-6, E32-2)", () => {
  it("shows the requirements covered and each part of the fit as a reason, never a number out of 100", () => {
    const { container } = render(<FitDetails fit={fit} note="Scored against Design" />);
    expect(screen.getByRole("img", { name: "9 of 10 requirements covered" })).toBeInTheDocument();
    // A must-have missing keeps it from Strong.
    expect(screen.getByText("Good fit")).toBeInTheDocument();
    expect(screen.getByText(/^9 of 10 requirements covered · Scored against Design$/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
      "✓In favour: Requirements: You show 9 of 10 must-haves.",
      "✓In favour: Work experience: You've designed payments tools at Northwind.",
      "✓In favour: Seniority: Senior, as your levels say.",
      "✓In favour: Location: Amsterdam is within 50 km.",
      "✓In favour: Education: Your degree meets it.",
      "✓In favour: Extra activities: Your design system project.",
      "–Against: “Kubernetes” is a must-have you don't show.",
    ]);
    expect(container.textContent).not.toMatch(/of 100|69/);
  });

  it("shows the reasons of a score without a breakdown, without their points, and says when it's an older one", () => {
    render(<FitDetails fit={{ score: 72, reasons: ["Requirements 30/35: Knows Figma."], redFlags: ["Capped at 69: Dutch is required."], breakdown: null }} older />);
    expect(screen.getAllByRole("listitem").map((line) => line.textContent)).toEqual(["✓In favour: Requirements: Knows Figma.", "–Against: Dutch is required."]);
    expect(screen.getByText("The posting lists none to check")).toBeInTheDocument();
    expect(screen.getByText(/An older score/)).toBeInTheDocument();
  });
});
