import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { connectAi } from "./actions";
import { AiStep } from "./ai-step";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ connectAi: vi.fn(), findLocalAi: vi.fn() }));
vi.mock("../../(app)/settings/actions", () => ({ saveAiProvider: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));

describe("the setup guide's AI step (E21-2)", () => {
  it("sends an account without the guide's models to Settings, where its key is saved and its models are listed", async () => {
    vi.mocked(connectAi).mockResolvedValue({
      ok: true,
      data: { connected: false, kind: "model", message: "Your OpenAI account doesn't offer the models Dossier uses: gpt-6.1-terra or gpt-6-luna." },
    });
    const user = userEvent.setup();
    render(<AiStep current={{ usable: false, name: "", model: "", choice: "openai", fromEnv: false }} />);
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Check it" }));

    expect(await screen.findByText(/doesn't offer the models Dossier uses/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByRole("status")).toHaveTextContent("where your key is already saved");
  });
});
