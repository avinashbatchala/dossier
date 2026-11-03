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
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Publications", "Skills", "Languages"]);
  });

  it("lists contact details first in the sidebar of sidebar layouts", () => {
    render(<ResumeDocument theme={theme("modern")} profile={profile} paper="A4" today={today} />);
    expect(sectionTitles()).toEqual(["Contact", "Skills", "Languages", "Profile", "Experience", "Projects", "Education", "Publications"]);
    const contact = screen.getByRole("heading", { name: "Contact" }).parentElement!;
    expect(within(contact).getAllByRole("listitem").map((item) => item.textContent)).toContain("example.com");
  });

  it("renders a sidebar theme in a single column when asked", () => {
    render(<ResumeDocument theme={theme("modern")} profile={profile} paper="A4" layout="SINGLE" today={today} />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Publications", "Skills", "Languages"]);
  });

  it("reads a sidebar at the end of the line after the main column, on its tinted panel", () => {
    render(<ResumeDocument theme={theme("studio")} profile={profile} paper="A4" today={today} />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Publications", "Contact", "Skills", "Languages"]);
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
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Publications", "Skills", "Languages"]);
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
    expect(sectionTitles()).toEqual(["Kontakt", "Kenntnisse", "Sprachen", "Profil", "Berufserfahrung", "Projekte", "Ausbildung", "Publikationen", "Referenzen"]);
    expect(screen.getByText("März 2021 – Heute")).toBeInTheDocument();
    expect(screen.getByText("UX Designer").closest("[data-unit]")).toHaveTextContent("Kenntnisse · HTML & CSS, Interaction design");
    expect(screen.getByText(/^Dutch: Muttersprache · English: Fließend \(C2\)/)).toBeInTheDocument();
    expect(screen.getByText("34 Jahre")).toBeInTheDocument();
  });

  it("keeps English headings for a language without its own", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} language="Hebrew" />);
    expect(sectionTitles()).toEqual(["Profile", "Experience", "Projects", "Education", "Publications", "Skills", "Languages"]);
    expect(screen.getByText("Mar 2021 – Present")).toBeInTheDocument();
  });

  it("adds references only when enabled", () => {
    const { rerender } = render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" />);
    expect(screen.queryByRole("heading", { name: "References" })).not.toBeInTheDocument();
    rerender(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" includeReferences />);
    expect(screen.getByRole("heading", { name: "References" })).toBeInTheDocument();
    expect(screen.getByText("Former manager, Northwind Logistics")).toBeInTheDocument();
  });

  it("puts the line about a role's company under its title, as written, tailored or not (#257)", () => {
    for (const units of [undefined, demoResumeUnits()]) {
      const { unmount } = render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" units={units} today={today} />);
      const line = screen.getByText("Freight platform for European carriers, 300 people");
      expect(line.previousElementSibling).toHaveTextContent("Senior Product Designer, Northwind Logistics");
      expect(line.nextElementSibling?.tagName).toBe("UL");
      // A role without one has nothing between its title and its points.
      const studio = screen.getByText("UX Designer").closest("[data-unit]")!;
      expect(studio.querySelector("ul")?.previousElementSibling).toHaveTextContent("UX Designer, Studio Brik");
      unmount();
    }
  });

  it("prints a line per skill group, led by its name, those without a group first (#280)", () => {
    const grouped = {
      ...profile,
      skills: profile.skills.map((skill) => ({ ...skill, group: ["Figma", "Prototyping"].includes(skill.name) ? "Tools" : skill.name === "User research" ? "Research" : "" })),
    };
    render(<ResumeDocument theme={theme("editorial")} profile={grouped} paper="A4" today={today} />);
    const lines = [...document.querySelectorAll('[data-unit="skills"] p')];
    expect(lines.map((line) => line.textContent)).toEqual([
      "Interaction design · Design systems · HTML & CSS · Workshop facilitation",
      "Tools: Prototyping · Figma",
      "Research: User research",
    ]);
    expect(within(lines[1] as HTMLElement).getByText("Tools:", { selector: "strong" })).toBeInTheDocument();
    expect(lines[0].querySelector("strong")).toBeNull();
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

  it("shows publications with their bold, italics and a link that opens (#218)", () => {
    render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} />);
    const publication = screen.getByRole("heading", { name: "Publications" }).closest("section")!;
    expect(publication).toHaveTextContent(
      "Doe, J., & Vermeer, K. (2016). Trust in automated scheduling: A field study with dispatch planners. Proceedings of the Delft Design Conference, 4, 112–121. doi.org/10.5555/12345678",
    );
    expect(within(publication).getByText("Doe, J.").tagName).toBe("STRONG");
    expect(within(publication).getByText("Proceedings of the Delft Design Conference").tagName).toBe("EM");
    expect(within(publication).getByRole("link", { name: "doi.org/10.5555/12345678" })).toHaveAttribute("href", "https://doi.org/10.5555/12345678");
  });

  it("leaves out empty sections", () => {
    render(
      <ResumeDocument
        theme={theme("modern")}
        profile={{ ...profile, basics: { ...profile.basics, summary: "" }, skills: [], languages: [], projects: [], education: [], publications: [] }}
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

  describe("the photo (#224)", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const withPhoto = { ...profile, photo: { src: png, onResumes: true } };
    const photo = () => screen.queryByRole("img", { name: profile.basics.name });

    it("sits at the end of the header, beside the name, headline and contacts", () => {
      render(<ResumeDocument theme={theme("editorial")} profile={withPhoto} paper="A4" today={today} />);
      const header = photo()!.parentElement!;
      expect(header.tagName).toBe("HEADER");
      expect(header.className).toMatch(/headerWithPhoto/);
      expect(header.lastElementChild).toBe(photo());
      expect(header.firstElementChild).toHaveTextContent(profile.basics.headline);
      expect(photo()).toHaveAttribute("src", png);
      expect(photo()!.className).toMatch(/photoCircle/);
      expect(photo()!.style.getPropertyValue("--photo-width")).toBe("80");
    });

    it("goes where the theme puts it: the start of the header, above the name, or atop the sidebar", () => {
      const { unmount } = render(<ResumeDocument theme={theme("signal")} profile={withPhoto} paper="A4" today={today} />);
      expect(photo()!.parentElement!.firstElementChild).toBe(photo());
      unmount();

      const classic = render(<ResumeDocument theme={theme("classic")} profile={withPhoto} paper="A4" today={today} />);
      const header = photo()!.parentElement!;
      expect(header.firstElementChild).toBe(photo());
      expect(header.className).not.toMatch(/headerWithPhoto/);
      expect(photo()!.className).toMatch(/photoAbove/);
      classic.unmount();

      render(<ResumeDocument theme={theme("modern")} profile={withPhoto} paper="A4" today={today} />);
      const column = photo()!.parentElement!;
      expect(column.tagName).not.toBe("HEADER");
      expect(column.firstElementChild).toBe(photo());
      expect(within(column).getByRole("heading", { name: "Contact" })).toBeInTheDocument();
      expect(photo()!.className).toMatch(/photoRounded/);
      expect(photo()!.style.getPropertyValue("--photo-width")).toBe("104");
    });

    it("moves from the sidebar to the end of the header in a single column", () => {
      render(<ResumeDocument theme={theme("modern")} profile={withPhoto} paper="A4" layout="SINGLE" today={today} />);
      expect(photo()!.parentElement!.tagName).toBe("HEADER");
      expect(photo()!.parentElement!.lastElementChild).toBe(photo());
    });

    it("draws a portrait 3:4, without rounding", () => {
      render(<ResumeDocument theme={theme("chronicle")} profile={withPhoto} paper="A4" today={today} />);
      expect(photo()!.style.getPropertyValue("--photo-width")).toBe("72");
      expect(photo()!.style.getPropertyValue("--photo-height")).toBe("96");
      expect(photo()!.className).not.toMatch(/photoCircle|photoRounded/);
    });

    it("follows Show on resumes, unless the application's switch says otherwise", () => {
      const hidden = { ...profile, photo: { src: png, onResumes: false } };
      const cases = [
        { profile: withPhoto, showPhoto: undefined, shown: true },
        { profile: withPhoto, showPhoto: null, shown: true },
        { profile: withPhoto, showPhoto: false, shown: false },
        { profile: hidden, showPhoto: undefined, shown: false },
        { profile: hidden, showPhoto: true, shown: true },
        { profile, showPhoto: true, shown: false },
      ];
      for (const { profile: entry, showPhoto, shown } of cases) {
        const { unmount } = render(<ResumeDocument theme={theme("editorial")} profile={entry} paper="A4" showPhoto={showPhoto} today={today} />);
        expect(photo() !== null).toBe(shown);
        unmount();
      }
    });

    it("leaves the header as it was without a photo", () => {
      render(<ResumeDocument theme={theme("editorial")} profile={profile} paper="A4" today={today} />);
      const header = screen.getByRole("heading", { level: 1 }).parentElement!;
      expect(header.tagName).toBe("HEADER");
      expect(header.className).not.toMatch(/headerWithPhoto/);
    });
  });
});
