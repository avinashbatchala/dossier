import { describe, expect, it } from "vitest";

import { demoLetterUnits, demoProfile } from "@/lib/demo-profile";
import { documentLabels } from "@/lib/document-labels";

import { defaultFrame, isFrameUnit, isParagraph, letterDate, letterText, newFrame, withFrame, withoutPrivateParts } from "./letter-frame";

const { basics } = demoProfile();
const context = { basics, company: "Ledgerly", location: "Amsterdam", date: new Date(Date.UTC(2026, 9, 3)), dateFormat: "DAY_MONTH_YEAR" as const };

describe("the letter's frame (E8-11)", () => {
  it("draws the frame as letters always had it, in English", () => {
    expect(defaultFrame(context)).toEqual({
      sender: expect.stringMatching(/^Jane Doe\n.*jane\.doe@example\.com.* · /),
      date: "3 October 2026",
      recipient: "Ledgerly · Hiring team\nAmsterdam",
      greeting: "Dear Ledgerly team,",
      signature: "Jane Doe",
    });
    expect(defaultFrame({ ...context, basics: { ...basics, name: " ", email: "", phone: "", website: "", linkedin: "", city: "", country: "", address: "" }, company: "", location: "" })).toEqual({
      sender: "Your name",
      date: "3 October 2026",
      recipient: "Hiring team",
      greeting: "Dear hiring team,",
      signature: "Your name",
    });
  });

  it("draws the parts the AI didn't write in the letter's language", () => {
    const frame = defaultFrame({ ...context, basics: { ...basics, showAge: true }, labels: documentLabels("German") });
    expect(frame).toMatchObject({ recipient: "Ledgerly · Personalabteilung\nAmsterdam", greeting: "Sehr geehrte Damen und Herren," });
    expect(frame.sender).toMatch(/ · 34 Jahre$/);
    expect(defaultFrame({ ...context, company: "", labels: documentLabels("Spanish") })).toMatchObject({
      recipient: "Equipo de selección\nAmsterdam",
      greeting: "Estimado equipo de selección:",
    });
  });

  it("writes the date in the letter's language", () => {
    expect(letterDate(context.date, "DAY_MONTH_YEAR", "de")).toBe("3. Oktober 2026");
    expect(letterDate(context.date, "MONTH_DAY_YEAR", "fr")).toBe("3 octobre 2026");
    expect(letterDate(context.date, "MONTH_DAY_YEAR", "en")).toBe("October 3, 2026");
    expect(letterDate(context.date, "NUMERIC", "de")).toBe("03-10-2026");
    expect(letterDate(context.date, "DAY_MONTH_YEAR", undefined)).toBe("3 October 2026");
    expect(letterDate(context.date, "DAY_MONTH_YEAR", "not a tag!")).toBe("3 October 2026");
  });

  it("frames a new letter with the profile's sender and the date in its language", () => {
    expect(newFrame({ ...context, lang: "nl" })).toMatchObject({ date: "3 oktober 2026", signature: "Jane Doe", greeting: "Dear Ledgerly team," });
  });

  it("puts every part in reading order, keeping the ones a letter has", () => {
    const units = [{ id: "greeting", label: "Greeting", text: "Hallo," }, ...demoLetterUnits()];
    const framed = withFrame(units, defaultFrame(context));
    expect(framed.map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "paragraph:1", "paragraph:2", "paragraph:3", "paragraph:4", "signature"]);
    expect(framed.find((unit) => unit.id === "greeting")?.text).toBe("Hallo,");
    expect(framed.find((unit) => unit.id === "date")).toEqual({ id: "date", label: "Date", text: "3 October 2026" });
    // The sign-off comes after the paragraphs, then the signature.
    expect(withFrame([{ id: "sign-off", label: "Sign-off", text: "Groetjes," }, ...demoLetterUnits()], { signature: "Jane" }).slice(-2).map((unit) => unit.id)).toEqual(["sign-off", "signature"]);
    // Only what's given is added.
    expect(withFrame(demoLetterUnits(), { date: "heute" }).map((unit) => unit.id)).toEqual(["date", "paragraph:1", "paragraph:2", "paragraph:3", "paragraph:4"]);
  });

  it("tells the parts apart, and keeps contact details out of prompts", () => {
    const framed = withFrame(demoLetterUnits(), defaultFrame(context));
    expect(framed.filter((unit) => isFrameUnit(unit.id)).map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "signature"]);
    expect(framed.filter(isParagraph)).toHaveLength(4);
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).not.toContain("sender");
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).not.toContain("signature");
    expect(withoutPrivateParts(framed).map((unit) => unit.id)).toContain("greeting");
  });
});

describe("the letter as text (public issue 101)", () => {
  const parts = (units: { id: string; text: string }[]) => withFrame(units.map((unit) => ({ ...unit, label: "" })), defaultFrame(context));

  it("runs from the greeting to the name under the sign-off, without the sender, date or recipient", () => {
    const units = [
      { id: "paragraph:1", text: "I'd like to join Ledgerly.\n" },
      { id: "paragraph:2", text: " " },
      { id: "paragraph:3", text: "I've run payments for six years." },
      { id: "sign-off", text: "Kind regards," },
    ];
    expect(letterText(parts(units), "Best,")).toBe("Dear Ledgerly team,\n\nI'd like to join Ledgerly.\n\nI've run payments for six years.\n\nKind regards,\nJane Doe");
  });

  it("takes the tone's sign-off for a letter without its own, and the letter's own greeting and name when edited", () => {
    const units = [
      { id: "greeting", text: "Hello Mia," },
      { id: "paragraph:1", text: "Short and sweet." },
      { id: "signature", text: "Jane" },
    ];
    expect(letterText(parts(units), "Best,")).toBe("Hello Mia,\n\nShort and sweet.\n\nBest,\nJane");
  });

  it("copies the demo letter whole", () => {
    const text = letterText(parts(demoLetterUnits()), "Best,");
    expect(text.startsWith("Dear Ledgerly team,\n\n")).toBe(true);
    expect(text.endsWith("\nJane Doe")).toBe(true);
    expect(text).not.toContain("jane.doe@example.com");
  });
});
