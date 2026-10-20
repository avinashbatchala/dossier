import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { LANGUAGE_SAMPLES, sampleProfile } from "@/lib/language-samples";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { ResumeDocument } from "./resume-document";

const themes = BUILT_IN_THEMES;
const theme = (id: string) => themes.find((entry) => entry.id === id)!;
const profile = demoProfile();
const today = new Date(2026, 8, 28);

const sectionTitles = () => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

describe("ResumeDocument", () => {
  it.each(themes.map((entry) => [entry.name, entry] as const))("renders the demo profile in %s", (_, entry) => {
    const { container } = render(<ResumeDocument theme={entry} profile={profile} paper="A4" today={today} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("puts contact details in the header of single-column layouts", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} />);
    expect(screen.getByText("jane.doe@example.com").parentElement?.textContent).toBe(
      "jane.doe@example.com  ·  +31 6 1234 5678  ·  Rotterdam, Netherlands  ·  example.com  ·  linkedin.com/in/janedoe-example",
    );
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Skills", "Languages"]);
  });

  it("lists contact details first in the sidebar of sidebar layouts", () => {
    render(<ResumeDocument theme={theme("modern")} profile={profile} paper="A4" today={today} />);
    expect(sectionTitles()).toEqual(["Contact", "Skills", "Languages", "Profile", "Experience", "Projects", "Education"]);
    const contact = screen.getByRole("heading", { name: "Contact" }).parentElement!;
    expect(within(contact).getAllByRole("listitem").map((item) => item.textContent)).toContain("example.com");
  });

  it("renders a sidebar theme in a single column when asked", () => {
    render(<ResumeDocument theme={theme("modern")} profile={profile} paper="A4" layout="SINGLE" today={today} />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Skills", "Languages"]);
  });

  it("reads a sidebar at the end of the line after the main column, on its tinted panel", () => {
    render(<ResumeDocument theme={theme("studio")} profile={profile} paper="A4" today={today} />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Contact", "Skills", "Languages"]);
    const panel = screen.getByRole("heading", { name: "Contact" }).closest("section")!.parentElement!;
    expect(panel.className).toMatch(/sidebarPanel/);
    expect(screen.getByRole("heading", { name: "Profile" }).closest("section")!.parentElement!.className).not.toMatch(/sidebarPanel/);
  });

  it("leaves out the tinted panel when the sidebar has nothing in it", () => {
    const noContacts = { email: "", phone: "", city: "", country: "", website: "", linkedin: "", showAge: false };
    const empty = { ...profile, basics: { ...profile.basics, ...noContacts }, skills: [], languages: [] };
    const { container } = render(<ResumeDocument theme={theme("studio")} profile={empty} paper="A4" today={today} />);
    expect(container.innerHTML).not.toMatch(/sidebarPanel/);
  });

  it("puts each role's dates before its title in a timeline", () => {
    render(<ResumeDocument theme={theme("chronicle")} profile={profile} paper="A4" today={today} />);
    expect(screen.getByText("UX Designer").closest("[data-unit]")).toHaveTextContent("Sep 2015 – May 2018UX Designer, Studio Brik");
    expect(screen.getByRole("article", { name: "Resume" }).className).toMatch(/timeline/);
  });

  it("marks the page with the theme's structure, and gives a banner its text colour", () => {
    render(<ResumeDocument theme={theme("atlas")} profile={profile} paper="A4" today={today} />);
    const page = screen.getByRole("article", { name: "Resume" });
    expect(page.className).toMatch(/banner/);
    expect(page.className).toMatch(/centered/);
    expect(page.style.getPropertyValue("--on-accent")).toBe("#ffffff");
  });

  it("keeps side headings in a single column", () => {
    render(<ResumeDocument theme={theme("folio")} profile={profile} paper="A4" today={today} />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Skills", "Languages"]);
    expect(screen.getByRole("article", { name: "Resume" }).className).toMatch(/sideHeadings/);
  });

  it("shows the skills used in each role and the education notes", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} />);
    const role = screen.getByText("UX Designer").closest("[data-unit]")!;
    expect(role).toHaveAttribute("data-unit", "experience:e3");
    expect(role).toHaveTextContent("UX Designer, Studio BrikSep 2015 – May 2018");
    expect(role).toHaveTextContent("Skills · HTML & CSS, Interaction design");
    expect(screen.getByText("Thesis on trust in automated scheduling tools")).toBeInTheDocument();
  });

  it("writes its headings, dates, levels and age in the document's language", () => {
    const withAge = { ...profile, basics: { ...profile.basics, showAge: true } };
    render(<ResumeDocument theme={theme("modern")} profile={withAge} paper="A4" today={today} language="German" includeReferences />);
    expect(sectionTitles()).toEqual(["Kontakt", "Kenntnisse", "Sprachen", "Profil", "Berufserfahrung", "Projekte", "Ausbildung", "Referenzen"]);
    expect(screen.getByText("März 2021 – Heute")).toBeInTheDocument();
    expect(screen.getByText("UX Designer").closest("[data-unit]")).toHaveTextContent("Kenntnisse · HTML & CSS, Interaction design");
    expect(screen.getByText(/^Dutch: Muttersprache · English: Fließend \(C2\)/)).toBeInTheDocument();
    expect(screen.getByText("34 Jahre")).toBeInTheDocument();
  });

  it("keeps English headings for a language without its own", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} language="Hebrew" />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Skills", "Languages"]);
    expect(screen.getByText("Mar 2021 – Present")).toBeInTheDocument();
  });

  it("adds references only when enabled", () => {
    const { rerender } = render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" />);
    expect(screen.queryByRole("heading", { name: "References" })).not.toBeInTheDocument();
    rerender(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" includeReferences />);
    expect(screen.getByRole("heading", { name: "References" })).toBeInTheDocument();
    expect(screen.getByText("Former manager, Northwind Logistics")).toBeInTheDocument();
  });

  it("renders a tailored resume from its units", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" units={demoResumeUnits()} />);
    expect(screen.getByText(/^Senior product designer with nine years of making complex/).closest("[data-unit]")).toHaveAttribute(
      "data-unit",
      "summary",
    );
    expect(screen.getByText(/a dense, high-stakes workflow$/)).toBeInTheDocument();
  });

  it("draws each unit with the renderer it's given (E8-3)", () => {
    const { container } = render(
      <ResumeDocument
        theme={theme("editorial")}
        profile={profile}
        paper="A4"
        units={demoResumeUnits()}
        renderUnit={({ id, className, head, children }) => (
          <section className={className} data-testid={id}>
            {head}
            {children}
          </section>
        )}
      />,
    );
    // Every unit, in reading order: the main column, then skills and languages.
    const ids = demoResumeUnits().map((unit) => unit.id);
    const drawn = [...container.querySelectorAll("[data-testid]")].map((element) => element.getAttribute("data-testid"));
    expect(drawn).toEqual([...ids.filter((id) => id !== "skills" && id !== "languages"), "skills", "languages"]);
    // A role's title line comes apart from its text, so it can stay while the text is edited.
    expect(screen.getByTestId("experience:e3")).toHaveTextContent(/^UX Designer, Studio Brik/);
  });

  it("shows projects like roles, with their link, dates and skills (PRO-13)", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} />);
    const project = screen.getByText("Tidewater design tokens").closest("[data-unit]")!;
    expect(project).toHaveAttribute("data-unit", "project:p1");
    expect(project).toHaveTextContent("Tidewater design tokens, github.com/janedoe/tidewater");
    expect(project).toHaveTextContent("Jan 2023 – Present");
    expect(project).toHaveTextContent("Built an open-source Figma plugin that turns design tokens into CSS variables");
    expect(project).toHaveTextContent("Skills · Design systems, Figma, HTML & CSS");
  });

  it("leaves out empty sections", () => {
    render(
      <ResumeDocument
        theme={theme("modern")}
        profile={{ ...profile, basics: { ...profile.basics, summary: "" }, skills: [], languages: [], projects: [], education: [] }}
        paper="A4"
      />,
    );
    expect(sectionTitles()).toEqual(["Contact", "Experience"]);
    expect(screen.queryByText(/^Skills · /)).not.toBeInTheDocument();
  });

  it("sizes the page for the paper", () => {
    const { rerender } = render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" />);
    const page = screen.getByRole("article", { name: "Resume" });
    expect(page.style.getPropertyValue("--page-height")).toBe("905");
    rerender(<ResumeDocument theme={theme("editorial")} profile={profile} paper="LETTER" />);
    expect(page.style.getPropertyValue("--page-height")).toBe("828");
  });

  it.each(LANGUAGE_SAMPLES.map((sample) => [sample.language, sample] as const))(
    "marks the %s sample with its language and direction (E5-8)",
    (language, sample) => {
      render(<ResumeDocument theme={theme("modern")} profile={sampleProfile(sample)} paper="A4" language={language} />);
      const page = screen.getByRole("article", { name: "Resume" });
      expect(page).toHaveAttribute("dir", ["Arabic", "Persian"].includes(language) ? "rtl" : "ltr");
      expect(page.getAttribute("lang")).toBeTruthy();
      expect(page).toHaveTextContent(sample.name);
    },
  );

  it("reads the direction of a base resume from the profile", () => {
    const persian = LANGUAGE_SAMPLES.find((sample) => sample.language === "Persian")!;
    render(<ResumeDocument theme={theme("editorial")} profile={sampleProfile(persian)} paper="A4" />);
    expect(screen.getByRole("article", { name: "Resume" })).toHaveAttribute("dir", "rtl");
  });

  it("keeps emails, phones and web addresses left to right inside a right-to-left document", () => {
    const persian = LANGUAGE_SAMPLES.find((sample) => sample.language === "Persian")!;
    render(<ResumeDocument theme={theme("editorial")} profile={sampleProfile(persian)} paper="A4" language="Persian" />);
    expect(screen.getByText("sample@example.com")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("+1 555 010 0000")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("تهران, ایران")).not.toHaveAttribute("dir");
  });

  it("leaves an English resume left to right, in the page's language", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" />);
    const page = screen.getByRole("article", { name: "Resume" });
    expect(page).toHaveAttribute("dir", "ltr");
    expect(page).not.toHaveAttribute("lang");
  });
});
