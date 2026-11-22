import { describe, expect, it } from "vitest";

import { emailAddresses, emailParts, emailUnits, isEmailAddress, mailtoHref } from "./application-email";

describe("the email's parts", () => {
  it("reads and builds the units, a missing part empty", () => {
    expect(emailParts([{ id: "subject", label: "Subject", text: "Hello" }])).toEqual({ to: "", subject: "Hello", body: "" });
    expect(emailUnits({ to: "a@b.eu", subject: "Hi", body: "Text" })).toEqual([
      { id: "to", label: "Recipient", text: "a@b.eu" },
      { id: "subject", label: "Subject", text: "Hi" },
      { id: "body", label: "Message", text: "Text" },
    ]);
  });
});

describe("email addresses", () => {
  it("finds the addresses in a recipient line", () => {
    expect(emailAddresses("John Doe <john.doe@example.com>")).toEqual(["john.doe@example.com"]);
    expect(emailAddresses("jobs@example.com, John <john@example.com>; jobs@example.com")).toEqual(["jobs@example.com", "john@example.com"]);
    expect(emailAddresses("The hiring team")).toEqual([]);
  });

  it("tells an address from anything else", () => {
    expect(isEmailAddress("john@example.com")).toBe(true);
    expect(isEmailAddress("John <john@example.com>")).toBe(false);
    expect(isEmailAddress("john@example")).toBe(false);
    expect(isEmailAddress("john@example.com.")).toBe(false);
    expect(isEmailAddress("john@doe@example.com")).toBe(false);
  });

  it("reads a long posting quickly", () => {
    const started = performance.now();
    expect(emailAddresses(`${"a".repeat(100_000)} Write to jobs@acme.example.`)).toEqual(["jobs@acme.example"]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("mailtoHref", () => {
  it("fills in the addresses, subject and message, with CRLF line breaks (RFC 6068)", () => {
    expect(mailtoHref({ to: "John Doe <john+jobs@example.com>", subject: "Application: Designer & more", body: "Dear John,\n\nHello." })).toBe(
      "mailto:john%2Bjobs@example.com?subject=Application%3A%20Designer%20%26%20more&body=Dear%20John%2C%0D%0A%0D%0AHello.",
    );
  });

  it("leaves out what's empty", () => {
    expect(mailtoHref({ to: "", subject: "", body: "" })).toBe("mailto:");
    expect(mailtoHref({ to: "The team", subject: "Hi", body: " " })).toBe("mailto:?subject=Hi");
  });
});
