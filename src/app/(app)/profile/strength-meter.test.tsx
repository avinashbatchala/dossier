import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BASICS_FIELDS, type ProfileData } from "@/lib/profile";

import { StrengthMeter } from "./strength-meter";

const basics: ProfileData["basics"] = {
  ...(Object.fromEntries(BASICS_FIELDS.map((field) => [field, ""])) as Record<(typeof BASICS_FIELDS)[number], string>),
  showAge: false,
};

describe("StrengthMeter", () => {
  it("is a labelled progress bar with the score and the hint", () => {
    render(
      <StrengthMeter
        profile={{ basics: { ...basics, name: "Jane" }, skills: [], languages: [], experience: [{} as never], projects: [], education: [], certifications: [], publications: [], references: [], customSections: [], facts: [], photo: null }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Profile strength" });
    expect(bar).toHaveAttribute("aria-valuenow", "37"); // 1/6 × 40 = 6.7 → plus 30
    // The hint names the next missing thing (E33-1).
    expect(bar).toHaveAccessibleDescription("A good start. Add your email address in Basics.");
    expect(screen.getByText("37%")).toBeInTheDocument();
  });

  it("gives experience its points for a paid role only, not for volunteering alone (#294)", () => {
    const volunteering = { volunteering: true } as never;
    render(
      <StrengthMeter
        profile={{ basics: { ...basics, name: "Jane" }, skills: [], languages: [], experience: [volunteering], projects: [], education: [], certifications: [], publications: [], references: [], customSections: [], facts: [], photo: null }}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Profile strength" })).toHaveAttribute("aria-valuenow", "7");
  });
});

describe("StrengthMeter's hint (E33-1)", () => {
  it("names a role with no lines once the basics are there", () => {
    const full = { ...basics, name: "Jane", email: "jane@example.com", city: "Rotterdam", country: "Netherlands", headline: "Designer", summary: "Designs." };
    render(
      <StrengthMeter
        profile={{ basics: full, skills: [], languages: [], experience: [{ bullets: "Led it" } as never, { bullets: "" } as never], projects: [], education: [], certifications: [], publications: [], references: [], customSections: [], facts: [], photo: null }}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Profile strength" })).toHaveAccessibleDescription("Good progress. One role has no lines yet.");
  });
});
