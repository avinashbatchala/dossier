import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { zipSync, type Zippable } from "fflate";
import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { resolveFileName } from "@/lib/file-name";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

import { defineJob } from "./runner";

/** Where finished zips wait to be downloaded, in DOSSIER_DATA_DIR. */
export const downloadsDir = () => path.join(env.DOSSIER_DATA_DIR, "downloads");

/** Zips nobody downloaded are removed after this long. */
const KEEP_MS = 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, "0");
/** "dossier-pdfs-2026-09-28.zip" */
export const zipFileName = (now: Date) => `dossier-pdfs-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;

/** A company as a folder name: no characters a file system refuses. */
function folderName(company: string): string {
  const name = company.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return name || "No company";
}

/** Adds " (2)", " (3)"… before ".pdf" while a name is taken. */
function unique(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLocaleLowerCase()); n++) candidate = name.replace(/\.pdf$/, ` (${n}).pdf`);
  taken.add(candidate.toLocaleLowerCase());
  return candidate;
}

/** Removes zips nobody downloaded in time; the job sweep calls it too. */
export async function removeOldZips(now: number): Promise<void> {
  const dir = downloadsDir();
  const names = await readdir(dir).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: now }));
      if (now - mtimeMs > KEEP_MS) await unlink(file).catch(() => {});
    }),
  );
}

/** Removes every zip waiting to be downloaded (Delete everything, E10-8). */
export async function deleteAllDownloads(): Promise<void> {
  await rm(downloadsDir(), { recursive: true, force: true });
}

/** The documents that are printed: an application's email isn't. */
const PRINTED = [DocumentKind.RESUME, DocumentKind.COVER_LETTER];

/** The tailored documents there are to zip. */
export async function countTailoredDocuments(): Promise<number> {
  return prisma.document.count({ where: { kind: { in: PRINTED } } });
}

/**
 * "Download all PDFs" (E10-5, SET-10): renders every application's resume
 * and cover letter, named with the file-name pattern, into one folder per
 * company, and zips them into DOSSIER_DATA_DIR/downloads. The PDF service's
 * cap keeps it to two renders at a time.
 */
export const zipPdfsJob = defineJob({
  type: "zip-pdfs",
  input: z.object({}),
  result: z.object({
    /** The zip's name in the downloads folder, not a path. */
    file: z.string().regex(/^[\w-]+\.zip$/),
    fileName: z.string(),
    documents: z.number().int(),
  }),
  async run(_input, { step, signal }) {
    const now = new Date();
    await removeOldZips(now.getTime());
    const [applications, name, settings] = await Promise.all([
      prisma.application.findMany({
        where: { documents: { some: { kind: { in: PRINTED } } } },
        orderBy: { createdAt: "asc" },
        select: { id: true, company: true, role: true, documents: { where: { kind: { in: PRINTED } }, select: { kind: true }, orderBy: { kind: "asc" } } },
      }),
      loadProfileName(),
      loadSettings(),
    ]);
    const documents = applications.flatMap((application) => application.documents.map(({ kind }) => ({ application, kind })));

    let done = 0;
    await step(`Rendering ${documents.length} documents`);
    const rendered = await Promise.all(
      documents.map(async ({ application, kind }) => {
        signal.throwIfAborted();
        const pdf = await renderPdf(`/print/${kind === DocumentKind.RESUME ? "resume" : "letter"}/${application.id}`);
        done += 1;
        await step(`Rendered ${done} of ${documents.length}`);
        return { application, kind, pdf };
      }),
    );

    await step("Zipping");
    const files: Zippable = {};
    const taken = new Map<string, Set<string>>();
    for (const { application, kind, pdf } of rendered) {
      const folder = folderName(application.company);
      const names = taken.get(folder.toLocaleLowerCase()) ?? new Set<string>();
      taken.set(folder.toLocaleLowerCase(), names);
      const fileName = unique(
        resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: kind, date: now }),
        names,
      );
      // PDFs are compressed already: store them as they are.
      files[`${folder}/${fileName}`] = [pdf, { level: 0 }];
    }
    await mkdir(downloadsDir(), { recursive: true });
    const file = `${randomUUID()}.zip`;
    await writeFile(path.join(downloadsDir(), file), zipSync(files));
    return { file, fileName: zipFileName(now), documents: documents.length };
  },
});
