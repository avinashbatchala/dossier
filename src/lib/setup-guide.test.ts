import { describe, expect, it } from "vitest";

import { nextSetupStep, opensSetupGuide, previousSetupStep, setupInProgress, setupStepFromParam } from "./setup-guide";

describe("the setup guide (E21)", () => {
  it("opens by itself only on a fresh install that hasn't seen it", () => {
    expect(opensSetupGuide({ guide: null, name: "", applications: 0 })).toBe(true);
    expect(opensSetupGuide({ guide: null, name: " ", applications: 0 })).toBe(true);
    expect(opensSetupGuide({ guide: null, name: "Jane Doe", applications: 0 })).toBe(false);
    expect(opensSetupGuide({ guide: null, name: "", applications: 1 })).toBe(false);
    expect(opensSetupGuide({ guide: { step: "ai", finished: false }, name: "", applications: 0 })).toBe(false);
  });

  it("goes on where it was left, unless a step is asked for", () => {
    expect(setupStepFromParam(undefined, null)).toBe("start");
    expect(setupStepFromParam(undefined, { step: "google", finished: false })).toBe("google");
    expect(setupStepFromParam(undefined, { step: "google", finished: true })).toBe("start");
    expect(setupStepFromParam("scoring", { step: "google", finished: false })).toBe("scoring");
    expect(setupStepFromParam("nowhere", null)).toBe("start");
    expect(setupStepFromParam(["ai", "jobs"], null)).toBe("start");
  });

  it("steps forward and back, and stops at the ends", () => {
    expect(nextSetupStep("start")).toBe("ai");
    expect(nextSetupStep("profile")).toBe("done");
    expect(nextSetupStep("done")).toBe("done");
    expect(previousSetupStep("ai")).toBe("start");
    expect(previousSetupStep("start")).toBe("start");
  });

  it("holds other questions back while it's open", () => {
    expect(setupInProgress(null)).toBe(false);
    expect(setupInProgress({ step: "jobs", finished: false })).toBe(true);
    expect(setupInProgress({ step: "jobs", finished: true })).toBe(false);
  });
});
