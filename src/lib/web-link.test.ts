import { describe, expect, it } from "vitest";

import { contactHref, webHref } from "./web-link";

describe("contactHref (#369)", () => {
  it("writes to an email address and opens a web address", () => {
    expect(contactHref("jane.doe@example.com")).toBe("mailto:jane.doe@example.com");
    expect(contactHref("example.com")).toBe("https://example.com/");
    expect(contactHref("linkedin.com/in/jane-doe")).toBe("https://linkedin.com/in/jane-doe");
    expect(contactHref("https://www.jane.design/work")).toBe("https://www.jane.design/work");
    expect(contactHref("münchen.de")).toBe("https://xn--mnchen-3ya.de/");
  });

  it("leaves a phone number, a place or an age as text", () => {
    for (const item of ["+31 6 1234 5678", "Rotterdam, Netherlands", "Amsterdam", "Age 34", "St. Gallen", "Washington D.C.", ""]) {
      expect(contactHref(item)).toBeNull();
    }
  });

  it("never links another scheme", () => {
    expect(contactHref("javascript:alert(1)")).toBeNull();
    expect(webHref("ftp://example.com")).toBeNull();
  });
});
