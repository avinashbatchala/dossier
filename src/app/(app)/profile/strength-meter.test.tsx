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
        profile={{ basics: { ...basics, name: "Jane" }, skills: [], languages: [], experience: [{} as never], projects: [], education: [], references: [] }}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Profile strength" });
    expect(bar).toHaveAttribute("aria-valuenow", "29"); // 1/11 × 40 = 3.6 → plus 25
    expect(bar).toHaveAccessibleDescription("A good start. Experience matters most.");
    expect(screen.getByText("29%")).toBeInTheDocument();
  });
});
