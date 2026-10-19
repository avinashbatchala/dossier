"use client";

import { useRef, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { DocumentKind, type DateFormat, type PaperSize, type Tone } from "@/generated/prisma/enums";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { FILE_NAME_TOKENS, resolveFileName } from "@/lib/file-name";
import { DATE_FORMATS } from "@/lib/settings";
import { PAPER_SIZES } from "@/lib/themes";
import { TONES } from "@/lib/tones";
import { useAutosave } from "@/hooks/use-autosave";

import { addDocumentLanguage, updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export type DocumentSettings = {
  paper: PaperSize;
  dateFormat: DateFormat;
  defaultTone: Tone;
  docLanguage: string | null;
  customLanguages: string[];
  fileNamePattern: string;
  includeRefs: boolean;
  onePage: boolean;
};

const POSTING_LANGUAGE = "__posting";
const OTHER_LANGUAGE = "__other";

/**
 * Settings → Documents (E10-3, SET-6 to SET-9): the defaults for every new
 * application. Choices save at once, the file name once typing pauses.
 */
export function DocumentsSection({
  initial,
  preview,
}: {
  initial: DocumentSettings;
  /** For the file name's preview: the user's name and the latest application, or sample values. */
  preview: { name: string; company: string; role: string };
}) {
  const track = useTrackSave();
  const [settings, setSettings] = useState(initial);
  const [addingLanguage, setAddingLanguage] = useState(false);
  const [newLanguage, setNewLanguage] = useState("");
  const pattern = useRef<HTMLInputElement>(null);

  const change = (next: Partial<DocumentSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...next });
    void track(updateSettings(next)).then((result) => {
      if (!toastResult(result).ok) setSettings(previous);
    });
  };

  const { flush } = useAutosave(settings.fileNamePattern, (fileNamePattern) =>
    track(updateSettings({ fileNamePattern })),
  );

  const insertToken = (token: string) => {
    const input = pattern.current;
    const value = settings.fileNamePattern;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    setSettings({ ...settings, fileNamePattern: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const addLanguage = async () => {
    const result = toastResult(await track(addDocumentLanguage({ name: newLanguage })));
    if (!result.ok) return;
    const { language, added } = result.data;
    setSettings((current) => ({
      ...current,
      docLanguage: language,
      customLanguages: added ? [...current.customLanguages, language] : current.customLanguages,
    }));
    setAddingLanguage(false);
    setNewLanguage("");
    if (added) toast(`Added ${language}. Output quality depends on how well your model knows it.`);
  };

  const languages = [...DOCUMENT_LANGUAGES.map((language) => language.name), ...settings.customLanguages];
  const previewName = resolveFileName(settings.fileNamePattern, { ...preview, doc: DocumentKind.RESUME, date: new Date() });

  return (
    <>
      <SettingsSectionIntro title="Documents">Defaults for every new application. You can still change them per job.</SettingsSectionIntro>
      <Card padding="none" className="grid gap-x-[18px] gap-y-5 px-7 py-[26px] sm:grid-cols-2">
        <Select label="Paper size" value={settings.paper} onChange={(event) => change({ paper: event.target.value as PaperSize })}>
          {Object.entries(PAPER_SIZES).map(([value, size]) => (
            <option key={value} value={value}>
              {size.label}
            </option>
          ))}
        </Select>
        <Select label="Date format" value={settings.dateFormat} onChange={(event) => change({ dateFormat: event.target.value as DateFormat })}>
          {DATE_FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </Select>
        <Select label="Cover letter tone" value={settings.defaultTone} onChange={(event) => change({ defaultTone: event.target.value as Tone })}>
          {Object.entries(TONES).map(([value, tone]) => (
            <option key={value} value={value}>
              {tone.label}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-2">
          <Select
            label="Write documents in"
            value={addingLanguage ? OTHER_LANGUAGE : (settings.docLanguage ?? POSTING_LANGUAGE)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === OTHER_LANGUAGE) return setAddingLanguage(true);
              setAddingLanguage(false);
              change({ docLanguage: value === POSTING_LANGUAGE ? null : value });
            }}
          >
            <option value={POSTING_LANGUAGE}>The posting&apos;s language</option>
            {languages.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
            <option value={OTHER_LANGUAGE}>Other language…</option>
          </Select>
          {addingLanguage && (
            <div className="flex gap-1.5">
              <Input
                aria-label="Other language"
                placeholder="e.g. Persian"
                // Picked on request, so the box takes focus.
                autoFocus
                className="min-w-0 flex-1"
                inputClassName="py-[9px]"
                value={newLanguage}
                onChange={(event) => setNewLanguage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addLanguage();
                  } else if (event.key === "Escape") setAddingLanguage(false);
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => void addLanguage()}>
                Add
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:col-span-2">
          <Input
            ref={pattern}
            label="PDF file name"
            inputClassName="font-mono text-[13.5px]"
            spellCheck={false}
            value={settings.fileNamePattern}
            onChange={(event) => setSettings({ ...settings, fileNamePattern: event.target.value })}
            onBlur={flush}
          />
          <span id="file-name-tokens" className="text-label text-muted">
            Click to insert
          </span>
          <div role="group" aria-labelledby="file-name-tokens" className="flex flex-wrap gap-1.5">
            {FILE_NAME_TOKENS.map(({ token, description }) => (
              <button
                key={token}
                type="button"
                title={description}
                onClick={() => insertToken(token)}
                className="flex items-baseline gap-2 rounded-control border border-line-field bg-input px-2.5 py-1.5 hover:border-line-strong"
              >
                <span className="font-mono text-label text-ink">{token}</span>{" "}
                <span className="text-xs text-muted">{description}</span>
              </button>
            ))}
          </div>
          <p className="flex flex-wrap items-baseline gap-2 text-meta text-muted">
            <span>Preview</span>
            <output className="font-mono text-label [overflow-wrap:anywhere] text-ink">{previewName}</output>
          </p>
        </div>
      </Card>

      <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-2.5">
        <Toggle
          className="py-4"
          label="Include references"
          description="Add your references to resumes when a posting asks for them. Otherwise they're left out."
          checked={settings.includeRefs}
          onCheckedChange={(includeRefs) => change({ includeRefs })}
        />
        <Toggle
          className="border-t border-line py-4"
          label="Keep resumes to one page"
          description="I'll trim the oldest roles first and tell you what was cut."
          checked={settings.onePage}
          onCheckedChange={(onePage) => change({ onePage })}
        />
      </Card>
    </>
  );
}
