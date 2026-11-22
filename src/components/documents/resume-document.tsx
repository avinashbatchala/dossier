import { Fragment, type CSSProperties, type ReactNode } from "react";

import { CitationText } from "@/components/citation";
import { PhotoPosition, PhotoShape, type PaperSize, type ThemeLayout } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import type { ProfileData } from "@/lib/profile";
import { resumeContent, type ResumeContent, type ResumeOptions, type ResumeRole } from "@/lib/resume-content";
import { customKey, DEFAULT_SECTION_LAYOUT, inSidebar, sectionHeading, type SectionLayout, shownSections } from "@/lib/resume-sections";
import { skillLine } from "@/lib/skill-groups";
import { PHOTO_SHAPES, resolveTheme, type ThemeData } from "@/lib/themes";

import { Contact, ContactDetail, ContactLine, DocumentPage, DocumentSection, plainUnit, type UnitRenderer } from "./document-page";
import styles from "./document.module.css";

type ResumeDocumentProps = ResumeOptions & {
  theme: ThemeData;
  profile: ProfileData;
  paper: PaperSize;
  /** Overrides the theme's layout, e.g. a tailored resume in a single column. */
  layout?: ThemeLayout;
  /** The sections' order and which are off (#297); without it, the order resumes have always had. */
  sections?: SectionLayout;
  /** The language it's written in (SET-7), for its headings too; without one, it's read from the text and the headings are English. */
  language?: string | null;
  /** Draws each tailored part; the preview's adds editing (E8-3). */
  renderUnit?: UnitRenderer;
  /** How far the spacing and type are squeezed to fit one page (public issue 69); 0 for the theme as it is. */
  fit?: number;
};

/** Enough of a resume's own words to tell its script and direction. */
const sampleText = (content: ResumeContent) =>
  [
    content.name,
    content.headline,
    content.summary,
    ...[...content.experience, ...content.volunteering].flatMap((role) => [role.role, ...role.bullets]),
    ...content.projects.flatMap((project) => [project.name, ...project.bullets]),
    ...content.customSections.flatMap((section) => section.items.flatMap((item) => [item.title, ...item.bullets])),
  ].join(" ");

/**
 * A resume (RES-1, RES-6, APP-4), the same markup for the preview and the
 * PDF. The base resume passes the profile alone; a tailored resume also
 * passes its units, which replace the profile's text.
 *
 * Sections without content are left out. Each tailored part is drawn by
 * `renderUnit` with its unit id, for editing it in place (E8-3).
 */
export function ResumeDocument({ theme, profile, paper, layout, sections = DEFAULT_SECTION_LAYOUT, language, renderUnit = plainUnit, fit = 0, ...options }: ResumeDocumentProps) {
  const resolved = resolveTheme(theme, layout, fit);
  const labels = documentLabels(language);
  const content = resumeContent(profile, options, labels);
  const { lang, dir } = documentLanguage(language, sampleText(content));
  const { shape, position } = resolved.photo;
  const photo = (size: "header" | "sidebar", className?: string) =>
    content.photo && <ResumePhoto key="photo" src={content.photo} name={content.name} shape={shape} size={size} className={className} />;
  // A role, paid or volunteering (#294).
  const role = (entry: ResumeRole) => (
    <Fragment key={entry.id}>
      {renderUnit({
        id: `experience:${entry.id}`,
        className: styles.entry,
        head: <EntryHead title={entry.role} at={entry.company} dates={entry.dates} timeline={resolved.timeline} />,
        children: (
          <>
            {entry.descriptor && <p className={styles.descriptor}>{entry.descriptor}</p>}
            {entry.bullets.length > 0 && (
              <ul className={styles.bullets}>
                {entry.bullets.map((bullet, index) => (
                  <li key={index}>
                    <CitationText text={bullet} />
                  </li>
                ))}
              </ul>
            )}
            {entry.skills.length > 0 && (
              <p className={styles.entrySkills}>
                <span className={styles.accent}>{`${labels.skills} · `}</span>
                {entry.skills.join(", ")}
              </p>
            )}
          </>
        ),
      })}
    </Fragment>
  );

  // What the sidebar starts with, in a sidebar layout: these don't move.
  const sidebarTop = [
    position === PhotoPosition.SIDEBAR && photo("sidebar"),
    resolved.split && content.contacts.length > 0 && (
      <DocumentSection key="contact" title={labels.contact}>
        <ul className={styles.contactList}>
          {content.contacts.map((item, index) => (
            <li key={index}>
              <ContactDetail>{item}</ContactDetail>
            </li>
          ))}
        </ul>
      </DocumentSection>
    ),
  ].filter(Boolean);

  const drawn: Record<string, ReactNode> = {
    summary: content.summary && (
      <DocumentSection key="summary" title={sectionHeading(sections, "summary", labels.profile)}>
        {renderUnit({ id: "summary", children: <p className={styles.summary}>{content.summary}</p> })}
      </DocumentSection>
    ),
    experience: content.experience.length > 0 && (
      <DocumentSection key="experience" title={sectionHeading(sections, "experience", labels.experience)}>
        {content.experience.map(role)}
      </DocumentSection>
    ),
    volunteering: content.volunteering.length > 0 && (
      <DocumentSection key="volunteering" title={sectionHeading(sections, "volunteering", labels.volunteering)}>
        {content.volunteering.map(role)}
      </DocumentSection>
    ),
    projects: content.projects.length > 0 && (
      <DocumentSection key="projects" title={sectionHeading(sections, "projects", labels.projects)}>
        {content.projects.map((project) => (
          <Fragment key={project.id}>
            {renderUnit({
              id: `project:${project.id}`,
              className: styles.entry,
              head: (
                <EntryHead
                  title={project.name}
                  at={project.link && <DocumentLink link={project.link} href={project.href} />}
                  dates={project.dates}
                  timeline={resolved.timeline}
                />
              ),
              children: (
                <>
                  {project.bullets.length > 0 && (
                    <ul className={styles.bullets}>
                      {project.bullets.map((bullet, index) => (
                        <li key={index}>
                          <CitationText text={bullet} />
                        </li>
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
    education: content.education.length > 0 && (
      <DocumentSection key="education" title={sectionHeading(sections, "education", labels.education)}>
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
    certifications: content.certifications.length > 0 && (
      <DocumentSection key="certifications" title={sectionHeading(sections, "certifications", labels.certifications)}>
        {content.certifications.map((entry) => (
          <Fragment key={entry.id}>
            {renderUnit({
              id: `certification:${entry.id}`,
              className: styles.entry,
              head: <EntryHead title={entry.name} at={entry.issuer} dates={entry.date} timeline={resolved.timeline} />,
              children: (entry.details.length > 0 || entry.link) && (
                <p className={styles.muted}>
                  {[...entry.details, ...(entry.link ? [<DocumentLink key="link" link={entry.link} href={entry.href} />] : [])].map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 && " · "}
                      {part}
                    </Fragment>
                  ))}
                </p>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    publications: content.publications.length > 0 && (
      <DocumentSection key="publications" title={sectionHeading(sections, "publications", labels.publications)}>
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
                      <DocumentLink link={entry.link} href={entry.href} />
                    </>
                  )}
                </p>
              ),
            })}
          </Fragment>
        ))}
      </DocumentSection>
    ),
    references: content.references.length > 0 && (
      <DocumentSection key="references" title={sectionHeading(sections, "references", labels.references)}>
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
    skills: content.skills && (
      <DocumentSection key="skills" title={sectionHeading(sections, "skills", labels.skills)}>
        {renderUnit({ id: "skills", children: <SkillLines text={content.skills} /> })}
      </DocumentSection>
    ),
    languages: content.languages && (
      <DocumentSection key="languages" title={sectionHeading(sections, "languages", labels.languages)}>
        {renderUnit({ id: "languages", children: <p>{content.languages}</p> })}
      </DocumentSection>
    ),
  };

  for (const section of content.customSections) {
    const key = customKey(section.id);
    drawn[key] = (
      <DocumentSection key={key} title={sectionHeading(sections, key, section.title)}>
        <CustomSectionItems section={section} timeline={resolved.timeline} renderUnit={renderUnit} />
      </DocumentSection>
    );
  }

  const order = shownSections(sections, Object.keys(drawn).filter((key) => drawn[key]));
  const isSidebar = (key: string) => inSidebar(key, profile.customSections);
  const sidebar = [...sidebarTop, ...order.filter(isSidebar).map((key) => drawn[key])];
  const main = order.filter((key) => !isSidebar(key)).map((key) => drawn[key]);

  // Reading order matches what you see: the sidebar comes first in sidebar
  // layouts (and keeps its column even when empty) unless it's at the end of
  // the line. A single column simply follows the order.
  const columns = !resolved.split
    ? [[...sidebarTop, ...order.map((key) => drawn[key])]].filter((column) => column.length > 0)
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
        {columns.map((column, index) => (
          <div key={index} className={cn(styles.column, column === panel && styles.sidebarPanel)}>
            {column}
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

/** A custom section's items in its format (#298). */
function CustomSectionItems({ section, timeline, renderUnit }: { section: ResumeContent["customSections"][number]; timeline: boolean; renderUnit: UnitRenderer }) {
  if (section.format === "INLINE") {
    return renderUnit({ id: `custom-inline:${section.id}`, children: <p>{section.items.map((item) => item.title).join(" · ")}</p> });
  }
  return section.items.map((item) => (
    <Fragment key={item.id}>
      {section.format === "LINES"
        ? renderUnit({
            id: `custom-line:${item.id}`,
            className: styles.publication,
            children: (
              <p>
                <CitationText text={item.title} />
                {item.link && (
                  <>
                    {" "}
                    <DocumentLink link={item.link} href={item.href} />
                  </>
                )}
              </p>
            ),
          })
        : renderUnit({
            id: `custom-entry:${item.id}`,
            className: styles.entry,
            head: <EntryHead title={item.title} at={item.subtitle} dates={item.dates} timeline={timeline} />,
            children: (
              <>
                {item.bullets.length > 0 && (
                  <ul className={styles.bullets}>
                    {item.bullets.map((bullet, index) => (
                      <li key={index}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {item.link && (
                  <p className={styles.muted}>
                    <DocumentLink link={item.link} href={item.href} />
                  </p>
                )}
              </>
            ),
          })}
    </Fragment>
  ));
}

/** A publication's, certification's or custom item's link: clickable in the PDF when it's a web address. */
function DocumentLink({ link, href }: { link: string; href: string | null }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={styles.link}>
      <Contact>{link}</Contact>
    </a>
  ) : (
    <span className={styles.link}>
      <Contact>{link}</Contact>
    </span>
  );
}

/** The Skills section: a line per group, led by the group's name (#280). */
function SkillLines({ text }: { text: string }) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const { label, text: skills } = skillLine(line);
      return (
        <p key={index} className={styles.skillLine}>
          {label && <strong className={styles.skillLabel}>{label}: </strong>}
          {skills}
        </p>
      );
    });
}
