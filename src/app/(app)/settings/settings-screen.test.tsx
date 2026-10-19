import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsScreen } from "./settings-screen";

describe("SettingsScreen", () => {
  it("has the header and the six sections, the current one marked (E10-1)", () => {
    render(
      <SettingsScreen section="data">
        <p>Section body</p>
      </SettingsScreen>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/^It's your server, so it's your call\./)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["AI provider", "Job search", "Documents", "Google", "Your data", "About"]);
    expect(within(nav).getByRole("link", { name: "Your data" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Your data" })).toHaveAttribute("href", "/settings?section=data");
    expect(within(nav).getByRole("link", { name: "About" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Section body")).toBeInTheDocument();
  });
});
