import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BUILT_IN_THEMES, type ThemeData } from "@/lib/themes";

import { ThemePicker } from "./theme-picker";

const mine: ThemeData = { ...BUILT_IN_THEMES[0], id: "c1", name: "My theme", builtIn: false, accent: "#6b4f8a" };

function renderPicker(activeId = "editorial") {
  const onSelect = vi.fn();
  const onCustomize = vi.fn();
  render(
    <ThemePicker
      themes={[...BUILT_IN_THEMES, mine]}
      activeId={activeId}
      userName="Jane Doe"
      onSelect={onSelect}
      onCustomize={onCustomize}
    />,
  );
  return { onSelect, onCustomize };
}

describe("ThemePicker", () => {
  it("shows the twelve built-in themes as buttons named after them, the active one in use (RES-2)", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "Editorial theme, in use" })).toBeInTheDocument();
    for (const name of ["Classic", "Modern", "Minimal", "Technical", "Ledger", "Signal", "Studio", "Chronicle", "Folio", "Console", "Atlas"]) {
      expect(screen.getByRole("button", { name: `${name} theme` })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Jane Doe")).toHaveLength(12);
  });

  it("sketches a banner theme's name on its accent, in the color that reads on it", () => {
    renderPicker();
    const signal = screen.getByRole("button", { name: "Signal theme" });
    const name = within(signal).getByText("Jane Doe");
    expect(name).toHaveStyle({ color: "#ffffff" });
    expect(name.parentElement).toHaveStyle({ backgroundColor: "#1f3a5f" });
  });

  it("lists your own themes (RES-4)", () => {
    renderPicker("c1");
    expect(within(screen.getByRole("button", { name: "My theme theme, in use" })).getByText("In use")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editorial theme" })).toBeInTheDocument();
  });

  it("selects a theme", async () => {
    const { onSelect } = renderPicker();
    await userEvent.click(screen.getByRole("button", { name: "Technical theme" }));
    expect(onSelect).toHaveBeenCalledWith("technical");
  });

  it("offers to make your own theme", async () => {
    const { onCustomize } = renderPicker();
    await userEvent.click(screen.getByRole("button", { name: /Make your own theme/ }));
    expect(onCustomize).toHaveBeenCalled();
  });
});
