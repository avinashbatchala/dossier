import { Fragment } from "react";

import { ThemeLayout, type DateFormat, type PaperSize, type Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import { defaultFrame, isFrameUnit, withFrame, type FrameUnitId } from "@/lib/letter-frame";
import type { Basics } from "@/lib/profile";
import { resolveTheme, type ThemeData } from "@/lib/themes";
import { TONES } from "@/lib/tones";

import { ContactLine, DocumentPage, plainUnit, type UnitRenderer } from "./document-page";
import styles from "./document.module.css";

type CoverLetterDocumentProps = {
  theme: ThemeData;
  paper: PaperSize;
  /** The sender, for a letter without its own sender and signature units. */
  basics: Basics;
  /** The letter's parts: frame units, paragraphs ("paragraph:1", …) and its "sign-off" (E8-11). */
  units: Unit[];
  company: string;
  location: string;
  tone: Tone;
  /** The date for a letter without its own date unit, at UTC midnight. */
  date: Date;
  dateFormat: DateFormat;
  /** Overrides the "sign-off" unit; without either, the tone's sign-off. */
  signOff?: string;
  /** The language it's written in (SET-7); without one, it's read from the text. */
  language?: string | null;
  /** Draws each part; the preview's adds editing (E8-3). */
  renderUnit?: UnitRenderer;
};

/** The contact items in a typed contact line ("a · b · c"). */
const contactsIn = (line: string) =>
  line
    .split(/\s+·\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * A cover letter (APP-10) in the theme's fonts, colours and spacing, always
 * in a single column: sender, date, recipient, greeting, paragraphs, sign-off
 * and the name under it. Every part is a unit (E8-11); a letter written
 * before that shows the parts it lacks as letters always had them.
 */
export function CoverLetterDocument({
  theme,
  paper,
  basics,
  units,
  company,
  location,
  tone,
  date,
  dateFormat,
  signOff,
  language,
  renderUnit = plainUnit,
}: CoverLetterDocumentProps) {
  const resolved = resolveTheme(theme, ThemeLayout.SINGLE);
  const parts = withFrame(units, defaultFrame({ basics, company, location, date, dateFormat, labels: documentLabels(language) }));
  const text = (id: FrameUnitId) => parts.find((unit) => unit.id === id)?.text.trim() ?? "";
  const paragraphs = parts.filter((unit) => !isFrameUnit(unit.id) && unit.id !== SIGN_OFF_UNIT);
  const closing = signOff ?? parts.find((unit) => unit.id === SIGN_OFF_UNIT)?.text.trim() ?? TONES[tone].signOff;
  const [name = "", ...contactLines] = text("sender").split("\n");
  const { lang, dir } = documentLanguage(language, paragraphs.map((unit) => unit.text).join(" "));

  return (
    <DocumentPage theme={resolved} paper={paper} lang={lang} dir={dir} label="Cover letter" className={styles.letter}>
      {renderUnit({
        id: "sender",
        className: styles.sender,
        children: (
          <>
            <p className={styles.senderName}>{name.trim()}</p>
            {contactLines.map((line, index) => contactsIn(line).length > 0 && <ContactLine key={index} items={contactsIn(line)} />)}
          </>
        ),
      })}
      {renderUnit({ id: "date", className: styles.letterDate, children: text("date") })}
      {renderUnit({
        id: "recipient",
        className: styles.recipient,
        children: text("recipient")
          .split("\n")
          .map((line, index) => line.trim() && <p key={index}>{line.trim()}</p>),
      })}
      {renderUnit({ id: "greeting", className: styles.greeting, children: text("greeting") })}
      <div className={styles.paragraphs}>
        {paragraphs.map(
          (unit) =>
            unit.text.trim() && (
              <Fragment key={unit.id}>
                {renderUnit({ id: unit.id, className: styles.paragraph, children: unit.text.trim() })}
              </Fragment>
            ),
        )}
      </div>
      <div className={styles.signOff}>
        {renderUnit({ id: SIGN_OFF_UNIT, children: closing })}
        {renderUnit({ id: "signature", children: text("signature") })}
      </div>
    </DocumentPage>
  );
}
