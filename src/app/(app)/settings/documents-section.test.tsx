import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { addDocumentLanguage, updateSettings } from "./actions";
import { DocumentsSection, type DocumentSettings } from "./documents-section";

vi.mock("./actions", () => ({
  updateSettings: vi.fn(async () => ({ ok: true, data: null })),
  addDocumentLanguage: vi.fn(async ({ name }: { name: string }) => ({ ok: true, data: { language: name, added: true } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const initial: DocumentSettings = {
  paper: "A4",
  dateFormat: "DAY_MONTH_YEAR",
  defaultTone: "WARM",
  docLanguage: null,
  resumeLanguage: null,
  customLanguages: ["Farsi"],
  fileNamePattern: "{name} – {company} – {doc}",
  includeRefs: false,
  pageLimit: "1",
};
const preview = { name: "Jane Doe", company: "Ledgerly", role: "Senior Product Designer" };
const open = () => render(<DocumentsSection initial={initial} preview={preview} />);

beforeEach(() => {
  vi.mocked(updateSettings).mockClear();
  vi.mocked(addDocumentLanguage).mockClear();
  vi.mocked(toast).mockClear();
});

describe("Documents settings (E10-3)", () => {
  it("has the defaults for every new application", () => {
    open();
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("Defaults for every new application. You can still change them per job.")).toBeInTheDocument();
    expect(screen.getByLabelText("Paper size")).toHaveDisplayValue("A4");
    expect(screen.getByLabelText("Date format")).toHaveDisplayValue("27 September 2026");
    expect(screen.getByLabelText("Cover letter tone")).toHaveDisplayValue("Warm");
    expect(screen.getByRole("switch", { name: "Include references" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Resume length")).toHaveDisplayValue("One page");
  });

  it("offers the posting's language, the 21 built-in ones and the user's own", () => {
    open();
    const options = [...(screen.getByLabelText("Write documents in") as HTMLSelectElement).options].map((option) => option.text);
    expect(options[0]).toBe("The posting's language");
    expect(options).toHaveLength(1 + 21 + 1 + 1);
    expect(options.slice(-2)).toEqual(["Farsi", "Other language…"]);
  });

  it("saves each choice at once", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Paper size"), "LETTER");
    expect(updateSettings).toHaveBeenLastCalledWith({ paper: "LETTER" });
    await user.selectOptions(screen.getByLabelText("Write documents in"), "Dutch");
    expect(updateSettings).toHaveBeenLastCalledWith({ docLanguage: "Dutch" });
    await user.selectOptions(screen.getByLabelText("Write documents in"), "The posting's language");
    expect(updateSettings).toHaveBeenLastCalledWith({ docLanguage: null });
    await user.click(screen.getByRole("switch", { name: "Include references" }));
    expect(updateSettings).toHaveBeenLastCalledWith({ includeRefs: true });
  });

  it("limits resumes to one page, two pages or no limit (SET-9)", async () => {
    const user = userEvent.setup();
    open();
    const select = screen.getByLabelText("Resume length") as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(["One page", "Up to two pages", "No limit"]);
    expect(select).toHaveAccessibleDescription(
      "A tailored resume that runs longer is trimmed, oldest roles first, and I'll tell you what was cut.",
    );
    await user.selectOptions(select, "Up to two pages");
    expect(updateSettings).toHaveBeenLastCalledWith({ pageLimit: "2" });
    await user.selectOptions(select, "No limit");
    expect(updateSettings).toHaveBeenLastCalledWith({ pageLimit: "none" });
  });

  it("picks the base resume's language from the built-in ones, English by default", async () => {
    const user = userEvent.setup();
    open();
    const select = screen.getByLabelText("Base resume language") as HTMLSelectElement;
    expect(select).toHaveDisplayValue("English");
    expect(select.options).toHaveLength(21);
    expect(select).toHaveAccessibleDescription("For its headings and dates. Tailored documents use their application's language.");
    await user.selectOptions(select, "German");
    expect(updateSettings).toHaveBeenLastCalledWith({ resumeLanguage: "German" });
    await user.selectOptions(select, "English");
    expect(updateSettings).toHaveBeenLastCalledWith({ resumeLanguage: null });
  });

  it("adds another language", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Write documents in"), "Other language…");
    const box = screen.getByRole("textbox", { name: "Other language" });
    expect(box).toHaveAttribute("placeholder", "e.g. Persian");
    await user.type(box, "Hebrew{Enter}");
    expect(addDocumentLanguage).toHaveBeenCalledWith({ name: "Hebrew" });
    expect(toast).toHaveBeenCalledWith("Added Hebrew. Output quality depends on how well your model knows it.");
    expect(screen.getByLabelText("Write documents in")).toHaveDisplayValue("Hebrew");
  });

  it("picks a language that's already there without a toast", async () => {
    const user = userEvent.setup();
    vi.mocked(addDocumentLanguage).mockResolvedValueOnce({ ok: true, data: { language: "Dutch", added: false } });
    open();
    await user.selectOptions(screen.getByLabelText("Write documents in"), "Other language…");
    await user.type(screen.getByRole("textbox", { name: "Other language" }), "dutch");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByLabelText("Write documents in")).toHaveDisplayValue("Dutch");
    expect(toast).not.toHaveBeenCalled();
  });

  it("inserts file name tokens at the cursor and previews the name", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByRole("status")).toHaveTextContent("Jane Doe – Ledgerly – Resume.pdf");
    const input = screen.getByLabelText("PDF file name") as HTMLInputElement;
    input.setSelectionRange(0, 0);
    await user.click(screen.getByRole("button", { name: "{date} Download date" }));
    expect(input).toHaveValue("{date}{name} – {company} – {doc}");
    expect(screen.getByRole("status").textContent).toMatch(/^\d{4}-\d{2}-\d{2}Jane Doe – Ledgerly – Resume\.pdf$/);
  });
});
