import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSettingsView } from "@/lib/ai/provider-options";

import { listAiModels, saveAiProvider, saveApiKey, testAiConnection } from "./actions";
import { AiProviderSection } from "./ai-provider-section";

vi.mock("./actions", () => ({
  saveAiProvider: vi.fn(),
  saveApiKey: vi.fn(),
  listAiModels: vi.fn(),
  testAiConnection: vi.fn(),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const local: AiSettingsView = { provider: "LOCAL", baseUrl: "http://ollama:11434", model: "qwen2.5:3b", keyState: "none" };

beforeEach(() => {
  vi.mocked(saveAiProvider).mockReset().mockResolvedValue({ ok: true, data: { keyState: "none" } });
  vi.mocked(saveApiKey).mockReset().mockResolvedValue({ ok: true, data: { keyState: "set" } });
  vi.mocked(listAiModels).mockReset().mockResolvedValue({ ok: true, data: { models: ["llama3.1:8b", "qwen2.5:3b"], problem: null } });
  vi.mocked(testAiConnection).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "qwen2.5:3b", seconds: 1.4 } });
});

describe("AiProviderSection", () => {
  it("shows the providers as a radio group, and the fields for the chosen one (SET-1)", async () => {
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
    expect(screen.getByLabelText("Server address")).toHaveValue("http://ollama:11434");
    expect(await screen.findByRole("option", { name: "llama3.1:8b" })).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("qwen2.5:3b");
    expect(screen.getByText("Not needed for a local model")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("fills in a hosted provider's defaults, says what's sent to it and saves at once", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "Anthropic" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("https://api.anthropic.com");
    expect(screen.getByRole("note")).toHaveTextContent(/^Anthropic receives what each task needs: your profile without contact details, .* the drafts and your chat messages\. Importing a resume sends its whole text/);
    expect(screen.getByRole("note")).toHaveTextContent(/depend on your account with Anthropic\.$/);
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Stored encrypted on your server");
    await waitFor(() =>
      expect(saveAiProvider).toHaveBeenCalledWith({ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" }),
    );
  });

  it("fills in Mistral's address and model, and names Mistral in the note (#206)", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "Mistral" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("https://api.mistral.ai/v1");
    expect(screen.getByRole("note")).toHaveTextContent(/^Mistral receives what each task needs: .* depend on your account with Mistral\.$/);
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    await waitFor(() =>
      expect(saveAiProvider).toHaveBeenCalledWith({ provider: "MISTRAL", baseUrl: "https://api.mistral.ai/v1", model: "mistral-medium-latest" }),
    );
  });

  it("fills in LM Studio on the Docker host, with an optional token and no note about data leaving (#210)", async () => {
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("radio", { name: "LM Studio" }));
    expect(screen.getByLabelText("Server address")).toHaveValue("http://host.docker.internal:1234");
    expect(screen.getByText(/Serve on Local Network/)).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toBeInTheDocument();
    expect(screen.getByText("Only needed if you've turned on authentication in LM Studio's server settings.")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await waitFor(() => expect(saveAiProvider).toHaveBeenCalledWith({ provider: "LMSTUDIO", baseUrl: "http://host.docker.internal:1234", model: "" }));
  });

  it("saves a key when you leave the field, then forgets it in the browser (E6-2)", async () => {
    render(<AiProviderSection initial={{ ...local, provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5" }} />);
    await userEvent.type(screen.getByLabelText("API key"), "sk-ant-secret");
    await userEvent.tab();
    expect(saveApiKey).toHaveBeenCalledWith({ provider: "ANTHROPIC", change: { action: "set", value: "sk-ant-secret" } });
    await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
    expect(screen.getByLabelText("API key")).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
    await userEvent.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(saveApiKey).toHaveBeenLastCalledWith({ provider: "ANTHROPIC", change: { action: "clear" } });
  });

  it("says when a saved key can't be read", () => {
    render(<AiProviderSection initial={{ ...local, provider: "OPENAI", keyState: "unreadable" }} />);
    expect(screen.getByText("Your saved API key can't be read. Please enter it again.")).toBeInTheDocument();
  });

  it("tests the connection and reports the latency (SET-2)", async () => {
    render(<AiProviderSection initial={local} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected · qwen2.5:3b answered in 1.4 s")).toBeInTheDocument();
  });

  it("shows a failure in plain words, and forgets the result after any change", async () => {
    vi.mocked(testAiConnection).mockResolvedValue({ ok: true, data: { connected: false, message: "Couldn't reach the server. Check the address and that it's running." } });
    render(<AiProviderSection initial={local} />);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/^Couldn't reach the server/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Server address"), "/");
    expect(screen.getByRole("status")).toHaveTextContent("Not tested since your last change");
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
