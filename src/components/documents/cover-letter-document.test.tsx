import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { demoLetterUnits, demoProfile } from "@/lib/demo-profile";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { CoverLetterDocument } from "./cover-letter-document";

const editorial = BUILT_IN_THEMES[0];
const { basics } = demoProfile();
const letter = {
  theme: editorial,
  paper: "A4",
  basics,
  units: demoLetterUnits(),
  company: "Ledgerly",
  location: "Amsterdam",
  tone: "WARM",
  date: new Date(Date.UTC(2026, 8, 27)),
  dateFormat: "DAY_MONTH_YEAR",
} as const;

describe("CoverLetterDocument", () => {
  it("renders the prototype's letter", () => {
    const { container } = render(<CoverLetterDocument {...letter} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("has a sender, date, recipient, greeting, paragraphs and sign-off (APP-10)", () => {
    render(<CoverLetterDocument {...letter} dateFormat="MONTH_DAY_YEAR" tone="FORMAL" />);
    const page = screen.getByRole("article", { name: "Cover letter" });
    expect(page).toHaveTextContent(/^Jane Doejane\.doe@example\.com/);
    expect(screen.getByText("September 27, 2026")).toBeInTheDocument();
    expect(screen.getByText("Ledgerly · Hiring team")).toBeInTheDocument();
    expect(screen.getByText("Dear Ledgerly team,")).toBeInTheDocument();
    expect(page.querySelectorAll("[data-unit^='paragraph:']")).toHaveLength(4);
    expect(page).toHaveTextContent(/Kind regards,Jane Doe$/);
  });

  it("puts the sender on the banner of a banner theme, in a single column whatever the theme's layout", () => {
    const sidebarTheme = BUILT_IN_THEMES.find((theme) => theme.id === "console")!;
    render(<CoverLetterDocument {...letter} theme={{ ...sidebarTheme, headerStyle: "BANNER" }} />);
    const page = screen.getByRole("article", { name: "Cover letter" });
    expect(page.className).toMatch(/banner/);
    expect(page.className).not.toMatch(/split/);
    expect(page.style.getPropertyValue("--on-accent")).toBe("#ffffff");
  });

  it("closes with its saved sign-off unit, not as a paragraph", () => {
    render(<CoverLetterDocument {...letter} units={[...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Best wishes," }]} />);
    const page = screen.getByRole("article", { name: "Cover letter" });
    expect(page.querySelectorAll("[data-unit^='paragraph:']")).toHaveLength(4);
    expect(page).toHaveTextContent(/Best wishes,Jane Doe$/);
  });

  it("uses the model's sign-off when it has one", () => {
    render(<CoverLetterDocument {...letter} signOff="Met vriendelijke groet," />);
    expect(screen.getByText("Met vriendelijke groet,")).toBeInTheDocument();
  });

  it("draws the uploaded PNG signature when the letter is signed (E17)", () => {
    render(<CoverLetterDocument {...letter} signature="data:image/png;base64,iVBORw0KGgo=" />);
    const page = screen.getByRole("article", { name: "Cover letter" });
    const image = page.querySelector("img");
    expect(image).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(image).toHaveAttribute("alt", "");
    expect(page).toHaveTextContent(/Warm regards,Jane Doe$/);
  });

  it("addresses the hiring team when the company is unknown", () => {
    render(<CoverLetterDocument {...letter} company="" location="" />);
    expect(screen.getByText("Hiring team")).toBeInTheDocument();
    expect(screen.getByText("Dear hiring team,")).toBeInTheDocument();
  });

  it("writes a Persian letter right to left (E5-8)", () => {
    render(
      <CoverLetterDocument
        {...letter}
        units={[{ id: "paragraph:1", label: "Opening", text: "با سلام، از دیدن این فرصت خوشحال شدم." }]}
        language="Persian"
      />,
    );
    expect(screen.getByRole("article", { name: "Cover letter" })).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("article", { name: "Cover letter" })).toHaveAttribute("lang", "fa");
  });
});

describe("the letter's own frame (E8-11)", () => {
  it("draws its stored sender, date, recipient, greeting and signature instead of the defaults", () => {
    const units = [
      { id: "sender", label: "Sender", text: "Jane M. Doe\nRotterdam · jane@example.com\nwww.example.com" },
      { id: "date", label: "Date", text: "Rotterdam, 3. Oktober 2026" },
      { id: "recipient", label: "Recipient", text: "Ledgerly GmbH\nz. Hd. Frau Doe\nHamburg" },
      { id: "greeting", label: "Greeting", text: "Sehr geehrte Frau Doe," },
      { id: "paragraph:1", label: "Opening", text: "Mit großem Interesse habe ich Ihre Anzeige gelesen." },
      { id: "sign-off", label: "Sign-off", text: "Mit freundlichen Grüßen" },
      { id: "signature", label: "Signature", text: "Jane M. Doe" },
    ];
    render(<CoverLetterDocument {...letter} units={units} language="German" />);
    const page = screen.getByRole("article", { name: "Cover letter" });
    expect(page).toHaveAttribute("lang", "de");
    expect(page.querySelector("[data-unit='sender'] p")).toHaveTextContent("Jane M. Doe");
    // Each line after the name is a contact line, its items between " · ".
    expect([...page.querySelectorAll("[data-unit='sender'] bdi")].map((item) => item.textContent)).toEqual(["Rotterdam", "jane@example.com", "www.example.com"]);
    expect(screen.getByText("Rotterdam, 3. Oktober 2026")).toBeInTheDocument();
    expect([...page.querySelectorAll("[data-unit='recipient'] p")].map((line) => line.textContent)).toEqual(["Ledgerly GmbH", "z. Hd. Frau Doe", "Hamburg"]);
    expect(screen.getByText("Sehr geehrte Frau Doe,")).toBeInTheDocument();
    expect(page).toHaveTextContent(/Mit freundlichen GrüßenJane M\. Doe$/);
    expect(page).not.toHaveTextContent(/Dear|Hiring team/);
  });

  it("fills in only the parts a letter doesn't store", () => {
    render(<CoverLetterDocument {...letter} units={[{ id: "greeting", label: "Greeting", text: "Hello Ledgerly!" }, ...demoLetterUnits()]} />);
    expect(screen.getByText("Hello Ledgerly!")).toBeInTheDocument();
    expect(screen.getByText("27 September 2026")).toBeInTheDocument();
    expect(screen.queryByText("Dear Ledgerly team,")).not.toBeInTheDocument();
  });
});
