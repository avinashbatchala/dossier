import { Fragment, type CSSProperties, type ReactNode } from "react";

import { CitationText } from "@/components/citation";
import { PhotoPosition, PhotoShape, type PaperSize, type ThemeLayout } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import type { ProfileData } from "@/lib/profile";
import { resumeContent, type ResumeContent, type ResumeOptions } from "@/lib/resume-content";
import { PHOTO_SHAPES, resolveTheme, type ThemeData } from "@/lib/themes";

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
  const { shape, position } = resolved.photo;
  const photo = (size: "header" | "sidebar", className?: string) =>
    content.photo && <ResumePhoto key="photo" src={content.photo} name={content.name} shape={shape} size={size} className={className} />;

  const sidebar = [
    position === PhotoPosition.SIDEBAR && photo("sidebar"),
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
    content.publications.length > 0 && (
      <DocumentSection key="publications" title={labels.publications}>
        {content.publications.map((entry) => (
          <Fragment key={entry.id}>
            {renderUnit({
              id: `publication:${entry.id}`,
              className: styles.publication,
              children: (
                <p>
                  <CitationText text={entry.citation} />
                  {entry.link && (
                    <>
                      {" "}
                      {entry.href ? (
                        <a href={entry.href} target="_blank" rel="noreferrer" className={styles.link}>
                          <Contact>{entry.link}</Contact>
                        </a>
                      ) : (
                        <span className={styles.link}>
                          <Contact>{entry.link}</Contact>
                        </span>
                      )}
                    </>
                  )}
                </p>
              ),
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

  const title = (
    <>
      <h1 className={styles.name}>{content.name}</h1>
      {content.headline && <p className={styles.headline}>{content.headline}</p>}
      {!resolved.split && content.contacts.length > 0 && <ContactLine items={content.contacts} />}
    </>
  );
  // A photo beside the name puts the name, headline and contacts in a block of their own.
  const beside = content.photo && (position === PhotoPosition.HEADER_START || position === PhotoPosition.HEADER_END);

  return (
    <DocumentPage theme={resolved} paper={paper} lang={lang} dir={dir} label="Resume">
      <header className={cn(styles.header, beside && styles.headerWithPhoto)}>
        {position === PhotoPosition.ABOVE_NAME && photo("header", styles.photoAbove)}
        {position === PhotoPosition.HEADER_START && photo("header")}
        {beside ? <div className={styles.headerText}>{title}</div> : title}
        {position === PhotoPosition.HEADER_END && photo("header")}
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

const SHAPE_CLASSES: Record<PhotoShape, string | undefined> = {
  [PhotoShape.CIRCLE]: styles.photoCircle,
  [PhotoShape.ROUNDED]: styles.photoRounded,
  [PhotoShape.SQUARE]: undefined,
  [PhotoShape.PORTRAIT]: undefined,
};

/** The profile photo (#224) in the theme's shape, at its size in the header or the sidebar. */
function ResumePhoto({ src, name, shape, size, className }: { src: string; name: string; shape: PhotoShape; size: "header" | "sidebar"; className?: string }) {
  const { width, height } = PHOTO_SHAPES[shape][size];
  return (
    // A data URL drawn as it is, in the preview and in the PDF: there's nothing for next/image to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className={cn(styles.photo, SHAPE_CLASSES[shape], className)}
      style={{ "--photo-width": width, "--photo-height": height } as CSSProperties}
    />
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
