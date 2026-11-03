import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringView } from "@/lib/scoring/scorers";

import { saveScorer, saveTypesafeKey, testJev } from "./actions";
import { ScoringSection } from "./scoring-section";

vi.mock("./actions", () => ({ saveScorer: vi.fn(), saveTypesafeKey: vi.fn(), testJev: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const ai: ScoringView = { scorer: "AI", keyState: "none" };
const jev: ScoringView = { scorer: "JEV", keyState: "none" };

beforeEach(() => {
  vi.mocked(saveScorer).mockReset().mockImplementation(async ({ scorer }) => ({ ok: true, data: { scorer, keyState: "none" } }));
  vi.mocked(saveTypesafeKey)
    .mockReset()
    .mockImplementation(async ({ change }) => ({ ok: true, data: { scorer: "JEV", keyState: change.action === "set" ? "set" : "none" } }));
  vi.mocked(testJev).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "jev-1.14.0", seconds: 0.4 } });
});

describe("ScoringSection (#274)", () => {
  it("offers the AI model and Jev, the AI model by default, with nothing about TypeSafe", () => {
    render(<ScoringSection initial={ai} />);
    expect(screen.getByRole("heading", { name: "Scoring" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Your AI model", "Jev by TypeSafe"]);
    expect(screen.getByRole("radio", { name: "Your AI model" })).toBeChecked();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("TypeSafe key")).not.toBeInTheDocument();
  });

  it("saves Jev at once and says what TypeSafe receives, and where to get a key", async () => {
    render(<ScoringSection initial={ai} />);
    await userEvent.click(screen.getByRole("radio", { name: "Jev by TypeSafe" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "JEV" });
    expect(screen.getByRole("note")).toHaveTextContent("Each posting you score goes to TypeSafe with your profile, without your name or contact details.");
    expect(screen.getByRole("link", { name: "the TypeSafe console" })).toHaveAttribute("href", "https://console.typesafe.ai/keys");
    expect(screen.getByRole("link", { name: "Settings → Job agent" })).toHaveAttribute("href", "/settings?section=agent");
  });

  it("saves the key when the field is left, and removes it on request", async () => {
    render(<ScoringSection initial={jev} />);
    await userEvent.type(screen.getByLabelText("TypeSafe key"), "ts_live_123");
    await userEvent.tab();
    expect(saveTypesafeKey).toHaveBeenCalledWith({ change: { action: "set", value: "ts_live_123" } });
    expect(screen.getByLabelText("TypeSafe key")).toHaveValue("");
    expect(screen.getByLabelText("TypeSafe key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");

    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveTypesafeKey).toHaveBeenLastCalledWith({ change: { action: "clear" } });
  });

  it("names the environment's key, and says when the saved one can't be read", () => {
    const { unmount } = render(<ScoringSection initial={{ scorer: "JEV", keyState: "env" }} />);
    expect(screen.getByLabelText("TypeSafe key")).toHaveAttribute("placeholder", "Using DOSSIER_TYPESAFE_KEY · type one to save it here");
    unmount();
    render(<ScoringSection initial={{ scorer: "JEV", keyState: "unreadable" }} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and shows Jev's version, or what went wrong", async () => {
    render(<ScoringSection initial={{ scorer: "JEV", keyState: "set" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change · a test costs a few dozen tokens");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connected · jev-1.14.0 answered in 0.4 s"));

    vi.mocked(testJev).mockResolvedValueOnce({ ok: true, data: { connected: false, message: "TypeSafe didn't accept the key. Check it in Settings → Scoring." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("TypeSafe didn't accept the key."));

    vi.mocked(testJev).mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Something went wrong."));
  });

  it("goes back to the AI model", async () => {
    render(<ScoringSection initial={jev} />);
    await userEvent.click(screen.getByRole("radio", { name: "Your AI model" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "AI" });
    expect(screen.queryByLabelText("TypeSafe key")).not.toBeInTheDocument();
  });
});
