import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { MockProvider } from "../providers/mock";

import { GUESS_LEVELS_VERSION, guessLevels } from "./guess-levels";

const profile = demoProfile();
const options = { creativity: "EXPRESSIVE" as const, strict: true, language: null };

describe("guessLevels (E24-3)", () => {
  it("asks for a range from the profile's roles and years, without contact details or references, and puts it in order", async () => {
    const provider = new MockProvider({ reply: () => ({ from: "lead", to: "senior" }) });
    const { data, promptVersion } = await guessLevels(provider, { profile, today: new Date(2026, 10, 15) }, options);
    expect(promptVersion).toBe(GUESS_LEVELS_VERSION);
    expect(data).toEqual({ from: "senior", to: "lead" });

    const call = provider.calls[0];
    const text = [call.system, ...call.messages.map((message) => message.content)].join("\n");
    expect(call.json?.name).toBe("profile_levels");
    expect(call.system).toMatch(/intern: an internship/);
    expect(call.system).toMatch(/protected characteristic/);
    expect(text).toMatch(/Their work experience: about \d+ years in all/);
    expect(text).toContain('"company": "Northwind Logistics"');
    for (const secret of [profile.basics.email, profile.basics.phone, ...profile.references.map((reference) => reference.name)]) expect(text).not.toContain(secret);
    expect(call.effort).toBe("low");
  });

  it("makes do with one step it knows, and reads a range of steps it doesn't as mid level", async () => {
    expect((await guessLevels(new MockProvider({ reply: () => ({ from: "senior", to: "principal" }) }), { profile }, options)).data).toEqual({ from: "senior", to: "senior" });
    expect((await guessLevels(new MockProvider({ reply: () => ({ from: "x", to: "y" }) }), { profile }, options)).data).toEqual({ from: "mid", to: "mid" });
  });
});
