import { describe, expect, it } from "vitest";

import { AiProvider } from "@/generated/prisma/enums";

import { AI_CHOICES, AI_PRIORITIES, choiceOf, pickModel } from "./ai-choices";

describe("the setup guide's AI choices (E21-2)", () => {
  it("offer one or two choices for each priority, the free one only on your own computer", () => {
    for (const { value } of AI_PRIORITIES) {
      const choices = AI_CHOICES.filter((choice) => choice.priority === value);
      expect(choices.length, value).toBeGreaterThanOrEqual(1);
      expect(choices.length, value).toBeLessThanOrEqual(2);
    }
    for (const choice of AI_CHOICES) {
      const local = choice.provider === AiProvider.LOCAL || choice.provider === AiProvider.LMSTUDIO;
      expect(choice.cost.startsWith("Free"), choice.id).toBe(local);
      expect(choice.key === null, choice.id).toBe(local);
      expect(Boolean(choice.needs), choice.id).toBe(local);
    }
  });

  it("link only to https pages, and say what each costs and where the data goes", () => {
    for (const choice of AI_CHOICES) {
      expect(choice.steps.length, choice.id).toBeGreaterThan(1);
      expect(choice.help).toMatch(/^https:\/\//);
      for (const step of choice.steps) if (step.link) expect(step.link.href, choice.id).toMatch(/^https:\/\//);
      expect(choice.data).not.toBe("");
      if (choice.key) expect(choice.baseUrl, choice.id).toMatch(/^https:\/\//);
    }
  });

  it("pick the first model the account has, as Gemini lists it too, or the first wanted when nothing is listed", () => {
    expect(pickModel(["a", "b"], ["b", "c"])).toBe("b");
    expect(pickModel(["gemini-x"], ["models/gemini-x"])).toBe("gemini-x");
    expect(pickModel(["a"], [])).toBe("a");
    expect(pickModel(["a"], ["c"])).toBeNull();
  });

  it("know a saved provider again by its address", () => {
    expect(choiceOf(AiProvider.OPENAI, "https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(choiceOf(AiProvider.OPENAI, "https://generativelanguage.googleapis.com/v1beta/openai")).toBe("gemini");
    expect(choiceOf(AiProvider.OPENAI, "https://api.openai.com/v1")).toBe("openai");
    expect(choiceOf(AiProvider.OPENAI, "http://my-server:8000/v1")).toBeNull();
    expect(choiceOf(AiProvider.LMSTUDIO, "http://localhost:1234")).toBe("lmstudio");
  });
});
