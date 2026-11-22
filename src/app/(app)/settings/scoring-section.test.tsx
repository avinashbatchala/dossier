import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringView } from "@/lib/scoring/scorers";

import { saveOpenRouterScoringModel, saveScorer, saveScoringKey, testScoringModel } from "./actions";
import { ScoringSection } from "./scoring-section";

vi.mock("./actions", () => ({ saveScorer: vi.fn(), saveScoringKey: vi.fn(), testScoringModel: vi.fn(), saveOpenRouterScoringModel: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const ai: ScoringView = { scorer: "AI", keys: { JEV: "none" }, openrouterModel: "openai/gpt-6-luna" };
const jev: ScoringView = { scorer: "JEV", keys: { JEV: "none" }, openrouterModel: "openai/gpt-6-luna" };

beforeEach(() => {
  vi.mocked(saveScorer).mockReset().mockImplementation(async ({ scorer }) => ({ ok: true, data: { scorer, keys: { JEV: "none" }, openrouterModel: "openai/gpt-6-luna" } }));
  vi.mocked(saveScoringKey)
    .mockReset()
    .mockImplementation(async ({ change }) => ({ ok: true, data: { scorer: "JEV", keys: { JEV: change.action === "set" ? "set" : "none" }, openrouterModel: "openai/gpt-6-luna" } }));
  vi.mocked(testScoringModel).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "jev-1.14.0", seconds: 0.4 } });
});

describe("ScoringSection (#274)", () => {
  it("offers the scoring models on the list, the AI model by default, with nothing about TypeSafe", async () => {
    render(<ScoringSection initial={ai} />);
    expect(screen.getByRole("heading", { name: "Scoring" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Your AI model", "Jev by TypeSafe", "OpenAI Decisions", "OpenRouter"]);
    expect(screen.getByRole("radio", { name: "Your AI model" })).toBeChecked();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("TypeSafe key")).not.toBeInTheDocument();
    // The AI model has its own connection test too (E25-2).
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(testScoringModel).toHaveBeenCalledWith({ scorer: "AI" });
  });

  it("saves Jev at once and says what TypeSafe receives, and where to get a key", async () => {
    render(<ScoringSection initial={ai} />);
    await userEvent.click(screen.getByRole("radio", { name: "Jev by TypeSafe" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "JEV" });
    expect(screen.getByRole("note")).toHaveTextContent("Each posting you score goes to TypeSafe with the profile it's scored against, without your name, contact details, references or links.");
    expect(screen.getByRole("link", { name: "the TypeSafe console" })).toHaveAttribute("href", "https://console.typesafe.ai/keys");
  });

  it("saves the key when the field is left, and removes it on request", async () => {
    render(<ScoringSection initial={jev} />);
    await userEvent.type(screen.getByLabelText("TypeSafe key"), "ts_live_123");
    await userEvent.tab();
    expect(saveScoringKey).toHaveBeenCalledWith({ scorer: "JEV", change: { action: "set", value: "ts_live_123" } });
    expect(screen.getByLabelText("TypeSafe key")).toHaveValue("");
    expect(screen.getByLabelText("TypeSafe key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");

    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveScoringKey).toHaveBeenLastCalledWith({ scorer: "JEV", change: { action: "clear" } });
  });

  it("names the environment's key, and says when the saved one can't be read", () => {
    const { unmount } = render(<ScoringSection initial={{ scorer: "JEV", keys: { JEV: "env" }, openrouterModel: "openai/gpt-6-luna" }} />);
    expect(screen.getByLabelText("TypeSafe key")).toHaveAttribute("placeholder", "Using DOSSIER_TYPESAFE_KEY · type one to save it here");
    unmount();
    render(<ScoringSection initial={{ scorer: "JEV", keys: { JEV: "unreadable" }, openrouterModel: "openai/gpt-6-luna" }} />);
    expect(screen.getByText("Your saved key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and shows Jev's version, or what went wrong", async () => {
    render(<ScoringSection initial={{ scorer: "JEV", keys: { JEV: "set" }, openrouterModel: "openai/gpt-6-luna" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change · a test costs a few dozen tokens");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connected · jev-1.14.0 answered in 0.4 s"));

    vi.mocked(testScoringModel).mockResolvedValueOnce({ ok: true, data: { connected: false, message: "TypeSafe didn't accept the key. Check it in Settings → Scoring." } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("TypeSafe didn't accept the key."));

    vi.mocked(testScoringModel).mockResolvedValueOnce({ ok: false, error: "Something went wrong." });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Something went wrong."));
  });

  it("goes back to the AI model", async () => {
    render(<ScoringSection initial={jev} />);
    await userEvent.click(screen.getByRole("radio", { name: "Your AI model" }));
    expect(saveScorer).toHaveBeenCalledWith({ scorer: "AI" });
    expect(screen.queryByLabelText("TypeSafe key")).not.toBeInTheDocument();
  });

  it("offers OpenAI Decisions and OpenRouter, OpenRouter with its model (E25-3, E25-4)", async () => {
    const user = userEvent.setup();
    render(<ScoringSection initial={{ scorer: "OPENROUTER", keys: { JEV: "none", DECISIONS: "none", OPENROUTER: "set" }, openrouterModel: "openai/gpt-6-luna" }} />);
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Your AI model", "Jev by TypeSafe", "OpenAI Decisions", "OpenRouter"]);
    expect(screen.getByRole("note")).toHaveTextContent("Dossier asks OpenRouter to use only companies that don't keep or train on it.");
    expect(screen.getByLabelText("OpenRouter key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
    vi.mocked(saveOpenRouterScoringModel).mockResolvedValueOnce({ ok: true, data: { scorer: "OPENROUTER", keys: { OPENROUTER: "set" }, openrouterModel: "mistralai/mistral-small-2603" } });
    await user.type(screen.getByLabelText("Model"), "mistralai/mistral-small-2603");
    await user.tab();
    expect(saveOpenRouterScoringModel).toHaveBeenCalledWith({ model: "mistralai/mistral-small-2603" });
  });
});
