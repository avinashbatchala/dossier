import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import type { AiSettingsView } from "@/lib/ai/provider-options";

import { listAiModels, saveAiProvider, saveAiTimeout, saveApiKey, testAiConnection } from "./actions";
import { AiProviderSection } from "./ai-provider-section";

vi.mock("./actions", () => ({
  saveAiProvider: vi.fn(),
  saveApiKey: vi.fn(),
  saveAiTimeout: vi.fn(),
  listAiModels: vi.fn(),
  testAiConnection: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const local: AiSettingsView = { provider: "LOCAL", baseUrl: "http://ollama:11434", model: "qwen2.5:3b", keyState: "none", keyEnding: null, test: null, timeoutSeconds: null, envTimeoutSeconds: null };

beforeEach(() => {
  vi.mocked(saveAiProvider).mockReset().mockResolvedValue({ ok: true, data: { keyState: "none", keyEnding: null } });
  vi.mocked(saveApiKey).mockReset().mockResolvedValue({ ok: true, data: { keyState: "set", keyEnding: "3f9a" } });
  vi.mocked(saveAiTimeout).mockReset().mockImplementation(async ({ seconds }) => ({ ok: true, data: { seconds } }));
  vi.mocked(listAiModels).mockReset().mockResolvedValue({ ok: true, data: { models: ["llama3.1:8b", "qwen2.5:3b"], problem: null } });
  vi.mocked(testAiConnection).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "qwen2.5:3b", seconds: 1.4, at: "2026-11-17T10:00:00.000Z" } });
});

describe("AiProviderSection", () => {
  it("shows the providers as a radio group with where each runs, and the fields for the chosen one (SET-1, E34-4)", async () => {
    render(<AiProviderSection initial={local} />);
    expect(screen.getByRole("heading", { name: "AI provider" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Local model",
      "LM Studio",
      "OpenAI-compatible",
      "Anthropic",
      "Mistral",
    ]);
    expect(screen.getByRole("radio", { name: "Local model" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Local model" })).toHaveAccessibleDescription(/^On your hardware\. Runs on your own hardware/);
    expect(screen.getByRole("radio", { name: "OpenAI-compatible" })).toHaveAccessibleDescription(/^Hosted or yours, by its address\./);
    expect(screen.getByRole("radio", { name: "Anthropic" })).toHaveAccessibleDescription(/^Hosted\./);
    expect(screen.getByRole("radio", { name: "Mistral" })).toHaveAccessibleDescription(/^Hosted, in the EU\./);
    expect(screen.getByLabelText("Server address")).toHaveValue("http://ollama:11434");
    expect(await screen.findByRole("option", { name: "llama3.1:8b" })).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("qwen2.5:3b");
    expect(screen.getByText("Not needed for a local model")).toBeInTheDocument();
  });

  it("counts an OpenAI-compatible server on the local network as on your hardware (ST3)", () => {
    render(<AiProviderSection initial={{ ...local, provider: "OPENAI", baseUrl: "http://192.168.1.20:8080/v1" }} />);
    expect(screen.getByRole("radio", { name: "OpenAI-compatible" })).toHaveAccessibleDescription(/^On your hardware\./);
  });

  it("fills in a hosted provider's defaults and saves at once", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("https://api.anthropic.com");
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Stored encrypted on your server");
    await waitFor(() =>
      expect(saveAiProvider).toHaveBeenCalledWith({ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" }),
    );
  });

  it("fills in Mistral's address and model (#206)", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "Mistral" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("https://api.mistral.ai/v1");
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    await waitFor(() =>
      expect(saveAiProvider).toHaveBeenCalledWith({ provider: "MISTRAL", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-2603" }),
    );
  });

  it("fills in LM Studio on the Docker host, with an optional token (#210)", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "LM Studio" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("http://host.docker.internal:1234");
    expect(screen.getByText(/Serve on Local Network/)).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toBeInTheDocument();
    expect(screen.getByText("Only needed if you've turned on authentication in LM Studio's server settings.")).toBeInTheDocument();
    await waitFor(() => expect(saveAiProvider).toHaveBeenCalledWith({ provider: "LMSTUDIO", baseUrl: "http://host.docker.internal:1234", model: "" }));
  });

  it("saves a key when you leave the field, then shows only its last four characters, with Replace (E6-2, ST4)", async () => {
    const user = userEvent.setup();
    render(<AiProviderSection initial={{ ...local, provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" }} />);
    await user.type(screen.getByLabelText("API key"), "sk-ant-secret-3f9a");
    await user.tab();
    expect(saveApiKey).toHaveBeenCalledWith({ provider: "ANTHROPIC", change: { action: "set", value: "sk-ant-secret-3f9a" } });
    const saved = await screen.findByRole("group", { name: "API key" });
    expect(saved).toHaveTextContent("••••••••Saved, ending in 3f9a");
    expect(screen.queryByLabelText("API key", { selector: "input" })).not.toBeInTheDocument();

    // Replace opens the field; Keep the saved key closes it again.
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("API key")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep the saved key" }));
    expect(screen.getByRole("group", { name: "API key" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveApiKey).toHaveBeenLastCalledWith({ provider: "ANTHROPIC", change: { action: "clear" } });
  });

  it("shows a key from DOSSIER_AI_KEY as that, with Replace to save one here", async () => {
    render(<AiProviderSection initial={{ ...local, provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", keyState: "env" }} />);
    expect(screen.getByRole("group", { name: "API key" })).toHaveTextContent("From DOSSIER_AI_KEY");
    expect(screen.queryByRole("button", { name: "Remove saved key" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Type the new key");
  });

  it("says when a saved key can't be read", () => {
    render(<AiProviderSection initial={{ ...local, provider: "OPENAI", keyState: "unreadable" }} />);
    expect(screen.getByText("Your saved API key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and reports the latency, with Test again (SET-2, E34-4)", async () => {
    render(<AiProviderSection initial={local} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/^✓Connected\. qwen2\.5:3b answered in 1\.4 s · tested (today at \d\d:\d\d|on 17 Nov)/);
    expect(screen.getByRole("button", { name: "Test again" })).toBeInTheDocument();
  });

  it("starts with the last test's result, kept on the server (E34-1)", () => {
    render(<AiProviderSection initial={{ ...local, test: { at: "2026-11-12T09:00:00.000Z", ok: false, seconds: null, error: "Anthropic rejected the key." } }} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^!Anthropic rejected the key\. · tested on 12 Nov/);
    expect(screen.getByRole("button", { name: "Test again" })).toBeInTheDocument();
  });

  it("shows a failure in plain words, and forgets the result after any change", async () => {
    vi.mocked(testAiConnection).mockResolvedValue({ ok: true, data: { connected: false, message: "Couldn't reach the server. Check the address and that it's running.", at: "2026-11-17T10:00:00.000Z" } });
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/^Couldn't reach the server/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Server address"), "/");
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change");
  });

  it("says when a new address took the saved key (public PR 107)", async () => {
    vi.mocked(saveAiProvider).mockResolvedValue({ ok: true, data: { keyState: "none", keyEnding: null, keyRemoved: true } });
    render(<AiProviderSection initial={{ ...local, provider: "OPENAI", baseUrl: "https://openrouter.ai/api/v1", model: "", keyState: "set" }} />);
    await userEvent.clear(screen.getByLabelText("Server address"));
    await userEvent.type(screen.getByLabelText("Server address"), "https://api.deepseek.com");
    await userEvent.tab();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The saved key was for another server, so it's removed. Enter the key for this one."));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Stored encrypted on your server");
  });

  it("takes a timeout in seconds, empty for the default, which follows the card (public issue 118)", async () => {
    render(<AiProviderSection initial={local} />);
    const field = screen.getByLabelText("Timeout, in seconds");
    expect(field).toHaveAttribute("placeholder", "300");
    expect(screen.getByText(/Empty uses 300, the default for a model on your own hardware\./)).toBeInTheDocument();

    await userEvent.type(field, "900");
    await userEvent.tab();
    await waitFor(() => expect(saveAiTimeout).toHaveBeenCalledWith({ seconds: 900 }));

    await userEvent.clear(field);
    await userEvent.type(field, "2 minutes");
    await userEvent.tab();
    expect(await screen.findByText("A whole number of seconds, from 5 to 3,600, or empty for 300.")).toBeInTheDocument();
    expect(saveAiTimeout).toHaveBeenCalledTimes(1);

    await userEvent.clear(field);
    await userEvent.tab();
    await waitFor(() => expect(saveAiTimeout).toHaveBeenLastCalledWith({ seconds: null }));

    await userEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(field).toHaveAttribute("placeholder", "120");
  });

  it("says when DOSSIER_AI_TIMEOUT_SECONDS sets the default", () => {
    render(<AiProviderSection initial={{ ...local, timeoutSeconds: 600, envTimeoutSeconds: 900 }} />);
    expect(screen.getByLabelText("Timeout, in seconds")).toHaveValue("600");
    expect(screen.getByText(/Empty uses 900, from DOSSIER_AI_TIMEOUT_SECONDS\./)).toBeInTheDocument();
  });

  it("lets you type a model that isn't listed", async () => {
    render(<AiProviderSection initial={local} />);
    await screen.findByRole("option", { name: "llama3.1:8b" });
    await userEvent.selectOptions(screen.getByLabelText("Model"), "Other model…");
    await userEvent.clear(screen.getByLabelText("Model name"));
    await userEvent.type(screen.getByLabelText("Model name"), "mistral-nemo:12b");
    await userEvent.tab();
    await waitFor(() => expect(saveAiProvider).toHaveBeenLastCalledWith(expect.objectContaining({ model: "mistral-nemo:12b" })));
  });

  it("explains why the model list is empty", async () => {
    vi.mocked(listAiModels).mockResolvedValue({ ok: true, data: { models: [], problem: "Couldn't reach the server. Check the address and that it's running." } });
    render(<AiProviderSection initial={{ ...local, model: "" }} />);
    expect(await screen.findByText(/^Couldn't list the models: Couldn't reach the server/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choose a model" })).toBeInTheDocument();
  });
});
