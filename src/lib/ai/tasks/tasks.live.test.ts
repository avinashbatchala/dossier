import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import sample from "../../../../prisma/seed/prototype-sample.json";
import { LmStudioProvider } from "../providers/lmstudio";
import { LocalProvider } from "../providers/local";
import { MistralProvider } from "../providers/mistral";
import { liveLmStudio, liveMistral } from "../test-live";

import { extractPosting, matchRequirements, tailorResume, writeCoverLetter, type TaskOptions } from "./index";

// The whole chain against a real model, skipped unless asked for:
//
//   AI_LIVE=ollama docker/bin/yarn vitest run src/lib/ai/tasks/tasks.live.test.ts
//   AI_LIVE=mistral docker/bin/yarn vitest run src/lib/ai/tasks/tasks.live.test.ts
//   AI_LIVE=lmstudio docker/bin/yarn vitest run src/lib/ai/tasks/tasks.live.test.ts
//
// (Mistral's key and LM Studio's model as in providers.live.test.ts.)
//
// It prints what the model wrote, to judge the prompts by, not only their shape.

const live = new Set((process.env.AI_LIVE ?? "").split(","));
const mistral = live.has("mistral") ? await liveMistral() : null;
const lmStudio = live.has("lmstudio") ? await liveLmStudio() : null;
const provider = mistral
  ? new MistralProvider("https://api.mistral.ai/v1", mistral.key, mistral.model, 600_000)
  : lmStudio
    ? new LmStudioProvider(lmStudio.url, lmStudio.key, lmStudio.model, 600_000)
    : new LocalProvider(process.env.OLLAMA_URL ?? "http://ollama:11434", process.env.OLLAMA_MODEL ?? "qwen2.5:3b", 600_000);
const options: TaskOptions = { creativity: "BALANCED", strict: true, language: null };

describe.runIf(live.has("ollama") || mistral !== null || lmStudio !== null)("live: the application chain", { timeout: 900_000 }, () => {
  it("extracts, matches, tailors and writes the Ledgerly application", async () => {
    const profile = demoProfile();
    const started = Date.now();
    const time = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;

    const { data: extracted } = await extractPosting(provider, { posting: sample.ledgerly.posting }, options);
    console.log(`extracted (${time()}):`, JSON.stringify(extracted, null, 2));
    expect(extracted.company).toMatch(/ledgerly/i);
    expect(extracted.requirements.length).toBeGreaterThanOrEqual(4);

    const { data: match } = await matchRequirements(provider, { requirements: extracted.requirements, profile }, options);
    console.log(`match (${time()}):`, match.items.map((item) => `${item.result.padEnd(7)} ${item.requirement}: ${item.note}`).join("\n"));
    expect(match.items).toHaveLength(extracted.requirements.length);

    const { data: resume } = await tailorResume(provider, { profile, extracted, match, note: "", posting: sample.ledgerly.posting }, options);
    console.log(`resume (${time()}):`, resume.map((unit) => `[${unit.id}] ${unit.text}${unit.unverified ? `  ⚑ ${unit.unverified.join(", ")}` : ""}`).join("\n"));
    expect(resume.find((unit) => unit.id === "summary")?.text.length).toBeGreaterThan(20);

    const { data: letter } = await writeCoverLetter(provider, { profile, extracted, match, tone: "WARM", note: "", posting: sample.ledgerly.posting }, options);
    console.log(`letter (${time()}):`, letter.map((unit) => `[${unit.id}] ${unit.text}${unit.unverified ? `  ⚑ ${unit.unverified.join(", ")}` : ""}`).join("\n\n"));
    expect(letter.at(-1)).toMatchObject({ id: "sign-off", text: "Warm regards," });
    expect(letter.length).toBeGreaterThanOrEqual(3);
  });
});
