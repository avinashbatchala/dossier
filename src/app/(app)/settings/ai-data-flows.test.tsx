import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiDataFlows, publishAiChoice, whereItRuns } from "./ai-data-flows";

describe("whereItRuns (ST3)", () => {
  it("puts local providers on this computer, an OpenAI-compatible server by its address, and the rest hosted", () => {
    expect(whereItRuns("LOCAL", "http://ollama:11434")).toBe("computer");
    expect(whereItRuns("LMSTUDIO", "http://host.docker.internal:1234")).toBe("computer");
    expect(whereItRuns("OPENAI", "http://localhost:8080/v1")).toBe("computer");
    expect(whereItRuns("OPENAI", "http://10.0.0.5:8080/v1")).toBe("network");
    expect(whereItRuns("OPENAI", "https://api.openai.com/v1")).toBe("hosted");
    expect(whereItRuns("ANTHROPIC", "https://api.anthropic.com")).toBe("hosted");
  });
});

describe("AiDataFlows (E34-4)", () => {
  it("lists what leaves the server for a hosted provider, and follows the choice in the section", () => {
    render(<AiDataFlows initial={{ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com" }} />);
    const column = screen.getByRole("region", { name: "Where your data goes" });
    expect(column).toHaveTextContent("With Anthropic chosen, here's what leaves this server, and when. How long it's kept depends on your account with Anthropic.");
    expect(within(column).getAllByRole("listitem").map((item) => item.querySelector(".font-medium")?.textContent)).toEqual([
      "Your profile and the posting, leaves this server",
      "Postings, for scoring, leaves this server",
      "A resume you import, leaves this server",
      "Replies, with Gmail connected, leaves this server",
      "Your password and keys, stays here",
      "Your applications and notes, stays here",
    ]);
    expect(within(column).getByRole("link", { name: /Read the privacy page/ })).toHaveAttribute("href", "https://github.com/AienTech/dossier/blob/main/PRIVACY.md");

    act(() => publishAiChoice({ provider: "LOCAL", baseUrl: "http://ollama:11434" }));
    expect(column).toHaveTextContent(/^Where your data goesNothing leaves this computer\. With Local model chosen/);
    expect(within(column).getAllByRole("listitem").every((item) => item.textContent?.includes("stays here"))).toBe(true);
  });
});
