import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hideDailyNote, writeDailyNoteAction } from "./actions";
import { DailyNote } from "./daily-note";

vi.mock("./actions", () => ({ writeDailyNoteAction: vi.fn(), hideDailyNote: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeDailyNoteAction).mockResolvedValue({ ok: true, data: { text: "Slow and steady still gets there.", rewritesLeft: 3 } });
});

/** The note's quote, whose words are spans of their own (#523). */
const saying = (text: string) => (_: string, element: Element | null) => element?.tagName === "BLOCKQUOTE" && element.textContent === text;

describe("DailyNote (E28-6)", () => {
  it("shows today's note in the hand-written face", () => {
    render(<DailyNote initial={{ text: "Rest is part of the work.", rewritesLeft: 3 }} />);
    const note = screen.getByRole("region", { name: "Today's note" });
    expect(note).toHaveTextContent(/^Rest is part of the work\.$/);
    const quote = note.querySelector("blockquote")!;
    expect(quote).toHaveClass("font-hand", "text-note");
    // Written word by word (#523): each word its own span, all there from the start.
    expect([...quote.querySelectorAll("span")].map((word) => word.textContent)).toEqual(["Rest", "is", "part", "of", "the", "work."]);
    expect(quote.querySelector("span:last-child")?.getAttribute("style")).toBe("animation-delay: 450ms;");
    expect(writeDailyNoteAction).not.toHaveBeenCalled();
  });

  it("writes today's first note after the page is in", async () => {
    render(<DailyNote initial={null} />);
    expect(screen.getByRole("region", { name: "Today's note" })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText(saying("Slow and steady still gets there."))).toBeInTheDocument();
    expect(writeDailyNoteAction).toHaveBeenCalledExactlyOnceWith({ another: false });
  });

  it("asks for another one until today's are used up", async () => {
    vi.mocked(writeDailyNoteAction).mockResolvedValue({ ok: true, data: { text: "A fresh start each morning.", rewritesLeft: 0 } });
    render(<DailyNote initial={{ text: "Rest is part of the work.", rewritesLeft: 1 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Another one" }));
    expect(writeDailyNoteAction).toHaveBeenCalledWith({ another: true });
    expect(await screen.findByText(saying("A fresh start each morning."))).toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Another one" });
    await waitFor(() => expect(again).toHaveAttribute("aria-disabled", "true"));
    expect(again).toHaveAttribute("title", "That's today's last one");
    await userEvent.click(again);
    expect(writeDailyNoteAction).toHaveBeenCalledTimes(1);
  });

  it("hides for today", async () => {
    render(<DailyNote initial={{ text: "Rest is part of the work.", rewritesLeft: 3 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide for today" }));
    expect(screen.queryByRole("region", { name: "Today's note" })).not.toBeInTheDocument();
    expect(hideDailyNote).toHaveBeenCalledWith({});
  });
});
