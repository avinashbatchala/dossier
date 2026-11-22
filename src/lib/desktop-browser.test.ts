import { describe, expect, it } from "vitest";

import { mintBrowserCode, takeBrowserCode } from "./desktop-browser";

describe("one-time browser links (#365)", () => {
  it("works once, for a minute", () => {
    const now = 1_000_000;
    const code = mintBrowserCode("/settings?section=google", now);
    expect(takeBrowserCode(code, now + 59_000)).toBe("/settings?section=google");
    expect(takeBrowserCode(code, now + 59_000)).toBeNull();
    const late = mintBrowserCode("/", now);
    expect(takeBrowserCode(late, now + 61_000)).toBeNull();
    expect(takeBrowserCode(null)).toBeNull();
  });
});
