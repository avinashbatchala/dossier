import { Fragment, type ReactNode } from "react";

import type { PaperSize, ThemeLayout } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import type { ProfileData } from "@/lib/profile";
import { resumeContent, type ResumeContent, type ResumeOptions } from "@/lib/resume-content";
import { resolveTheme, type ThemeData } from "@/lib/themes";

import { Contact, ContactLine, DocumentPage, DocumentSection, plainUnit, type UnitRenderer } from "./document-page";
import styles from "./document.module.css";

type ResumeDocumentProps = ResumeOptions & {
  theme: ThemeData;
  profile: ProfileData;
  paper: PaperSize;
  /** Overrides the theme's layout, e.g. a tailored resume in a single column. */
  layout?: ThemeLayout;
  /** The language it's written in (SET-7), for its headings too; without one, it's read from the text and the headings are English. */
  language?: string | null;
  /** Draws each tailored part; the preview's adds editing (E8-3). */
  renderUnit?: UnitRenderer;
};

/** Enough of a resume's own words to tell its script and direction. */
const sampleText = (content: ResumeContent) =>
  [
    content.name,
    content.headline,
    content.summary,
    ...content.experience.flatMap((role) => [role.role, ...role.bullets]),
    ...content.projects.flatMap((project) => [project.name, ...project.bullets]),
  ].join(" ");

/**
 * A resume (RES-1, RES-6, APP-4), the same markup for the preview and the
 * PDF. The base resume passes the profile alone; a tailored resume also
 * passes its units, which replace the profile's text.
 *
 * Sections without content are left out. Each tailored part is drawn by
 * `renderUnit` with its unit id, for editing it in place (E8-3).
 */
export function ResumeDocument({ theme, profile, paper, layout, language, renderUnit = plainUnit, ...options }: ResumeDocumentProps) {
  const resolved = resolveTheme(theme, layout);
  const labels = documentLabels(language);
  const content = resumeContent(profile, options, labels);
  const { lang, dir } = documentLanguage(language, sampleText(content));

  const sidebar = [
    resolved.split && content.contacts.length > 0 && (
      <DocumentSection key="contact" title={labels.contact}>
        <ul className={styles.contactList}>
          {content.contacts.map((item, index) => (
            <li key={index}>
              <Contact>{item}</Contact>
            </li>
          ))}
        </ul>
      </DocumentSection>
    ),
    content.skills && (
      <DocumentSection key="skills" title={labels.skills}>
        {renderUnit({ id: "skills", children: <p>{content.skills}</p> })}
      </DocumentSection>
    ),
    content.languages && (
      <DocumentSection key="languages" title={labels.languages}>
        {renderUnit({ id: "languages", children: <p>{content.languages}</p> })}
      </DocumentSection>
    ),
  ].filter(Boolean);

  const main = [
    content.summary && (
      <DocumentSection key="summary" title={labels.profile}>
        {renderUnit({ id: "summary", children: <p className={styles.summary}>{content.summary}</p> })}
      </DocumentSection>
    ),
    content.experience.length > 0 && (
      <DocumentSection key="experience" title={labels.experience}>
        {content.experience.map((role) => (
          <Fragment key={role.id}>
            {renderUnit({
              id: `experience:${role.id}`,
              className: styles.entry,
              head: <EntryHead title={role.role} at={role.company} dates={role.dates} timeline={resolved.timeline} />,
              children: (
                <>
                  {role.bullets.length > 0 && (
                    <ul className={styles.bullets}>
                      {role.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                  {role.skills.length > 0 && (
                    <p className={styles.entrySkills}>
                      <span className={styles.accent}>{`${labels.skills} · `}</span>
                      {role.skills.join(", ")}
                    </p>
                  )}
                </>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.projects.length > 0 && (
      <DocumentSection key="projects" title={labels.projects}>
        {content.projects.map((project) => (
          <Fragment key={project.id}>
            {renderUnit({
              id: `project:${project.id}`,
              className: styles.entry,
              head: (
                <EntryHead
                  title={project.name}
                  at={project.link && <Contact>{project.link}</Contact>}
                  dates={project.dates}
                  timeline={resolved.timeline}
                />
              ),
              children: (
                <>
                  {project.bullets.length > 0 && (
                    <ul className={styles.bullets}>
                      {project.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                  {project.skills.length > 0 && (
                    <p className={styles.entrySkills}>
                      <span className={styles.accent}>{`${labels.skills} · `}</span>
                      {project.skills.join(", ")}
                    </p>
                  )}
                </>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.education.length > 0 && (
      <DocumentSection key="education" title={labels.education}>
        {content.education.map((entry) => (
          <Fragment key={entry.id}>
            {renderUnit({
              id: `education:${entry.id}`,
              className: styles.entry,
              head: <EntryHead title={entry.degree} at={entry.school} dates={entry.dates} timeline={resolved.timeline} />,
              children: entry.notes && <p className={styles.muted}>{entry.notes}</p>,
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    content.references.length > 0 && (
      <DocumentSection key="references" title={labels.references}>
        <div className={styles.references}>
          {content.references.map((reference) => (
            <div key={reference.id}>
              <p className={styles.entryTitle}>{reference.name}</p>
              {reference.role && <p className={styles.muted}>{reference.role}</p>}
              {reference.contact && <p>{reference.contact}</p>}
            </div>
          ))}
        </div>
      </DocumentSection>
    ),
  ].filter(Boolean);

  // Reading order matches what you see: the sidebar comes first in sidebar
  // layouts (and keeps its column even when empty) unless it's at the end of
  // the line, and its sections follow the main ones in a single column.
  const columns = !resolved.split
    ? [main, sidebar].filter((sections) => sections.length > 0)
    : resolved.sidebarEnd
      ? [main, sidebar]
      : [sidebar, main];
  // A tinted sidebar is drawn as a panel, unless there's nothing in it.
  const panel = resolved.tintedSidebar && sidebar.length > 0 ? sidebar : null;

  return (
    <DocumentPage theme={resolved} paper={paper} lang={lang} dir={dir} label="Resume">
      <header className={styles.header}>
        <h1 className={styles.name}>{content.name}</h1>
        {content.headline && <p className={styles.headline}>{content.headline}</p>}
        {!resolved.split && content.contacts.length > 0 && <ContactLine items={content.contacts} />}
      </header>
      <div className={styles.columns}>
        {columns.map((sections, index) => (
          <div key={index} className={cn(styles.column, sections === panel && styles.sidebarPanel)}>
            {sections}
          </div>
        ))}
      </div>
    </DocumentPage>
  );
}

/** "Sep 2015 – May 2018" that, in a narrow column, only wraps after the dash. */
const breakAfterDash = (dates: string) =>
  dates
    .split(" – ")
    .map((part) => part.replaceAll(" ", " "))
    .join(" – ");

/**
 * "Senior Product Designer, Northwind Logistics" with the dates at the end of
 * the line, or before it in a timeline column (the dates come first then, so
 * they float into the column next to the title).
 */
function EntryHead({ title, at, dates, timeline }: { title: string; at: ReactNode; dates: string; timeline: boolean }) {
  const datesSpan = dates && <span className={styles.dates}>{timeline ? breakAfterDash(dates) : dates}</span>;
  return (
    <div className={styles.entryHead}>
      {timeline && datesSpan}
      <p>
        <span className={styles.entryTitle}>{title}</span>
        {at && (
          <>
            {title && ", "}
            {at}
          </>
        )}
      </p>
      {!timeline && datesSpan}
    </div>
  );
}
