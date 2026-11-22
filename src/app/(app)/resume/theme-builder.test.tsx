import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BUILT_IN_THEMES } from "@/lib/themes";

import { draftFrom, ThemeBuilder, type ThemeDraft } from "./theme-builder";

const editorial = BUILT_IN_THEMES[0];

function renderBuilder(draft: ThemeDraft = draftFrom(editorial)) {
  const handlers = { onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() };
  render(<ThemeBuilder draft={draft} saving={false} {...handlers} />);
  return handlers;
}

const group = (name: string) => screen.getByRole("radiogroup", { name });

describe("draftFrom", () => {
  it("starts a new “My theme” from a built-in", () => {
    expect(draftFrom(editorial)).toMatchObject({ id: null, name: "My theme", headFont: "NEWSREADER", accent: "#7a3b2e" });
  });

  it("edits a custom theme in place", () => {
    expect(draftFrom({ ...editorial, id: "c1", name: "Mine", builtIn: false })).toMatchObject({ id: "c1", name: "Mine" });
  });
});

describe("ThemeBuilder", () => {
  it("offers every setting, starting from the draft (RES-3)", () => {
    renderBuilder();
    expect(screen.getByLabelText("Theme name")).toHaveValue("My theme");
    expect(within(group("Heading font")).getByRole("radio", { name: "Newsreader" })).toBeChecked();
    expect(within(group("Body font")).getByRole("radio", { name: "Geist" })).toBeChecked();
    expect(within(group("Layout")).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Single column",
      "Side headings",
      "Sidebar left",
      "Sidebar right",
    ]);
    expect(within(group("Header")).getByRole("radio", { name: "Left" })).toBeChecked();
    expect(within(group("Header style")).getByRole("radio", { name: "Plain" })).toBeChecked();
    expect(within(group("Section titles")).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Underlined",
      "Small caps",
      "Plain",
      "Accent bar",
      "Tinted band",
    ]);
    expect(within(group("Dates")).getByRole("radio", { name: "Beside the title" })).toBeChecked();
    expect(within(group("Spacing")).getByRole("radio", { name: "Regular" })).toBeChecked();
  });

  it("lists serifs, then sans, then mono", () => {
    renderBuilder();
    expect(within(group("Body font")).getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Newsreader",
      "Garamond",
      "Source Serif",
      "Lora",
      "Caslon",
      "Playfair",
      "Fraunces",
      "Geist",
      "Plex Sans",
      "Inter",
      "Manrope",
      "Work Sans",
      "Space Grotesk",
      "Plex Mono",
      "JetBrains Mono",
    ]);
  });

  it("offers the sidebar's look only for sidebar layouts", () => {
    renderBuilder();
    expect(screen.queryByRole("radiogroup", { name: "Sidebar" })).not.toBeInTheDocument();
    renderBuilder({ ...draftFrom(editorial), layout: "SPLIT_END", sidebarStyle: "TINTED" });
    expect(within(group("Sidebar")).getByRole("radio", { name: "Tinted" })).toBeChecked();
  });

  it("sets each font chip in its own typeface", () => {
    renderBuilder();
    // Its own style: without the app's stylesheet, the computed one can't resolve the variable (jsdom 31, as browsers).
    expect(within(group("Heading font")).getByRole("radio", { name: "Plex Mono" }).style.fontFamily).toBe("var(--typeface-plex-mono)");
  });

  it("names the accent swatches, not only their colours", () => {
    renderBuilder();
    expect(within(group("Accent")).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Ink",
      "Slate",
      "Navy",
      "Blue",
      "Teal",
      "Green",
      "Ochre",
      "Rust",
      "Brick",
      "Burgundy",
      "Rose",
      "Plum",
    ]);
    expect(within(group("Accent")).getByRole("radio", { name: "Brick" })).toBeChecked();
  });

  it("keeps a colour that isn't a swatch on offer", () => {
    renderBuilder(draftFrom(BUILT_IN_THEMES.find((theme) => theme.id === "minimal")!));
    expect(within(group("Accent")).getByRole("radio", { name: "Stone" })).toBeChecked();
  });

  it("takes any colour from the picker, or as hex once it's whole", async () => {
    const { onChange } = renderBuilder();
    expect(screen.getByLabelText("Hex color")).toHaveValue("#7a3b2e");
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#c0ffee" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ accent: "#c0ffee" }));
    onChange.mockClear();
    await userEvent.clear(screen.getByLabelText("Hex color"));
    await userEvent.type(screen.getByLabelText("Hex color"), "1F6F5");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Hex color"), "C");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ accent: "#1f6f5c" }));
  });

  it("warns about light colours, which are hard to read as text", () => {
    renderBuilder({ ...draftFrom(editorial), accent: "#f2c94c" });
    expect(within(group("Accent")).getByRole("radio", { name: "#f2c94c" })).toBeChecked();
    expect(screen.getByText(/This color is light/)).toBeInTheDocument();
  });

  it("reports each change", async () => {
    const { onChange } = renderBuilder();
    await userEvent.click(within(group("Accent")).getByRole("radio", { name: "Plum" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ accent: "#6b4f8a", name: "My theme" }));
    await userEvent.click(within(group("Spacing")).getByRole("radio", { name: "Airy" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ density: "AIRY" }));
  });

  it("left-aligns sidebar layouts", () => {
    renderBuilder({ ...draftFrom(editorial), layout: "SPLIT", align: "CENTER" });
    expect(within(group("Header")).getByRole("radio", { name: "Left" })).toBeChecked();
    expect(within(group("Header")).getByRole("radio", { name: "Centered" })).toBeDisabled();
    expect(screen.getByText("Sidebar layouts always align the header left.")).toBeInTheDocument();
  });

  it("saves with the button or Enter, and cancels", async () => {
    const { onSave, onCancel } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Save theme" }));
    await userEvent.type(screen.getByLabelText("Theme name"), "{Enter}");
    expect(onSave).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
