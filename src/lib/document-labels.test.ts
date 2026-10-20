import { describe, expect, it } from "vitest";

import { LanguageLevel } from "@/generated/prisma/enums";

import { ageLabel, documentLabels, ENGLISH_LABELS, languagesLine } from "./document-labels";
import { DOCUMENT_LANGUAGES } from "./document-language";
import { LANGUAGE_LEVELS } from "./profile";

const languages = [
  { name: "Dutch", level: LanguageLevel.NATIVE },
  { name: "English", level: LanguageLevel.C2 },
];

describe("document labels", () => {
  it("has its own words for every language in the list", () => {
    for (const { name, tag } of DOCUMENT_LANGUAGES.filter((language) => language.name !== "English")) {
      const labels = documentLabels(name);
      expect(labels.locale, name).toBe(tag);
      expect(labels.experience, name).not.toBe(ENGLISH_LABELS.experience);
      expect(labels.projects, name).not.toBe(ENGLISH_LABELS.projects);
      expect(Object.values(labels.levels).filter(Boolean), name).toHaveLength(LANGUAGE_LEVELS.length);
    }
  });

  it("uses English for English, no language, and languages added with Other language…", () => {
    for (const language of ["English", null, undefined, "", "Hebrew", "Klingon"]) {
      expect(documentLabels(language)).toBe(ENGLISH_LABELS);
    }
    expect(ENGLISH_LABELS.levels[LanguageLevel.B2]).toBe("Upper intermediate (B2)");
  });

  it("knows a language by its name, whatever its case, and Farsi as Persian", () => {
    expect(documentLabels(" german ").experience).toBe("Berufserfahrung");
    expect(documentLabels("Farsi")).toEqual(documentLabels("Persian"));
  });

  it("lists the profile's languages with their levels in the document's words", () => {
    expect(languagesLine(languages, ENGLISH_LABELS)).toBe("Dutch: Native · English: Fluent (C2)");
    expect(languagesLine(languages, documentLabels("German"))).toBe("Dutch: Muttersprache · English: Fließend (C2)");
    expect(languagesLine([], ENGLISH_LABELS)).toBe("");
  });

  it("writes the age in the language's words and digits", () => {
    expect(ageLabel(34, ENGLISH_LABELS)).toBe("Age 34");
    expect(ageLabel(34, documentLabels("Dutch"))).toBe("34 jaar");
    expect(ageLabel(34, documentLabels("Persian"))).toBe("۳۴ سال");
  });

  it("greets the company's team where the language does, and a cover-all greeting otherwise", () => {
    expect(ENGLISH_LABELS.greeting("Ledgerly")).toBe("Dear Ledgerly team,");
    expect(ENGLISH_LABELS.greeting("")).toBe("Dear hiring team,");
    expect(documentLabels("German").greeting("Ledgerly")).toBe("Sehr geehrte Damen und Herren,");
    expect(documentLabels("Chinese (Simplified)").greeting("Ledgerly")).toBe("尊敬的Ledgerly招聘团队：");
  });
});
