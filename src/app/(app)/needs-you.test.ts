import { describe, expect, it } from "vitest";

import { needsYouHref } from "./needs-you";

describe("needsYouHref (E30-6, E30-8)", () => {
  it("opens the right tab and starts the work its click asks for", () => {
    expect(needsYouHref({ id: "a1", action: "Prepare" })).toBe("/applications/a1?start=prepare");
    expect(needsYouHref({ id: "a1", action: "Follow up" })).toBe("/applications/a1?tab=email&start=follow-up");
    expect(needsYouHref({ id: "a1", action: "Answer", tab: "conversation" })).toBe("/applications/a1?tab=conversation");
    expect(needsYouHref({ id: "a1", action: "Finish draft" })).toBe("/applications/a1");
  });
});
