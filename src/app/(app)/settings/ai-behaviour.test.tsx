import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { updateSettings } from "./actions";
import { AiBehaviour } from "./ai-behaviour";

vi.mock("./actions", () => ({ updateSettings: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({
  toast: vi.fn(),
  toastResult: (result: { ok: boolean; error?: string }) => {
    if (!result.ok) toast(result.error!);
    return result;
  },
}));

const initial = { creativity: "BALANCED" as const, strict: true, showDiff: true, dailyNoteAi: true };

beforeEach(() => vi.mocked(updateSettings).mockClear());

describe("AI behaviour (E10-2)", () => {
  it("has creativity and two labelled switches", () => {
    render(<AiBehaviour initial={initial} />);
    expect(screen.getByRole("radiogroup", { name: "Creativity" })).toHaveAccessibleDescription(
      "Lower keeps drafts close to your own wording. Higher takes more liberties with phrasing, but never with facts.",
    );
    expect(screen.getByRole("radio", { name: "Balanced" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Never invent experience" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Show what changed" })).toHaveAccessibleDescription(
      "After each draft, list what was tailored compared with your base resume.",
    );
  });

  it("saves each change", async () => {
    const user = userEvent.setup();
    render(<AiBehaviour initial={initial} />);
    await user.click(screen.getByRole("radio", { name: "Faithful" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ creativity: "FAITHFUL" });
    await user.click(screen.getByRole("switch", { name: "Show what changed" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ showDiff: false });
  });

  it("warns when drafts may stretch beyond the profile", async () => {
    const user = userEvent.setup();
    render(<AiBehaviour initial={initial} />);
    expect(screen.queryByText(/^Heads up/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Never invent experience" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ strict: false });
    expect(screen.getByRole("status")).toHaveTextContent("Heads up: drafts may now stretch beyond your profile. Double-check before sending.");
  });

  it("goes back when a save fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateSettings).mockResolvedValueOnce({ ok: false, error: "Couldn't save." });
    render(<AiBehaviour initial={initial} />);
    await user.click(screen.getByRole("switch", { name: "Show what changed" }));
    expect(screen.getByRole("switch", { name: "Show what changed" })).toHaveAttribute("aria-checked", "true");
    expect(toast).toHaveBeenCalledWith("Couldn't save.");
  });

  it("turns the AI's daily note off (E28-6)", async () => {
    render(<AiBehaviour initial={initial} />);
    const note = screen.getByRole("switch", { name: "Write the daily note with AI" });
    expect(note).toHaveAttribute("aria-checked", "true");
    expect(note).toHaveAccessibleDescription(/Nothing about you goes into it/);
    await userEvent.click(note);
    expect(updateSettings).toHaveBeenCalledWith({ dailyNoteAi: false });
  });
});
