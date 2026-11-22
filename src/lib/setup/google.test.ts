import { describe, expect, it } from "vitest";

import { GOOGLE_STEPS, googleAddressProblem } from "./google";

describe("the setup guide's Google step (E21-5)", () => {
  it("spots an address Google won't take", () => {
    expect(googleAddressProblem("https://jobs.example.com/api/google/callback")).toBeNull();
    expect(googleAddressProblem("http://localhost:3000/api/google/callback")).toBeNull();
    expect(googleAddressProblem("http://127.0.0.1:41234/api/google/callback")).toBeNull();
    expect(googleAddressProblem("http://jobs.example.com/api/google/callback")).toBe("http");
    expect(googleAddressProblem("http://192.168.1.20:3000/api/google/callback")).toBe("ip");
    expect(googleAddressProblem("https://203.0.113.5/api/google/callback")).toBe("ip");
  });

  it("link only to Google's https pages", () => {
    for (const step of GOOGLE_STEPS) if (step.link) expect(step.link.href).toMatch(/^https:\/\/console\.(cloud|developers)\.google\.com\//);
  });
});
