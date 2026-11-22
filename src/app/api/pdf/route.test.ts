import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { profileSettingsFrom } from "@/lib/profile-settings";
import { loadProfileSettings } from "@/lib/profiles";
import { settingsFromRows } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { GET as GET_HELD } from "./[id]/route";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn() }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/profiles", () => ({ loadProfileSettings: vi.fn(), profileIdOr: async (id: string | null) => id ?? "first" }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { findUnique: vi.fn() } } }));

const get = (query: string) => GET(new NextRequest(`http://localhost:3000/api/pdf${query}`), undefined);
const post = (query: string) =>
  POST(
    new NextRequest(`http://localhost:3000/api/pdf${query}`, { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }),
    undefined,
  );
const getHeld = (url: string) => {
  const id = url.split("/").at(-1)!;
  return GET_HELD(new NextRequest(`http://localhost:3000${url}`), { params: Promise.resolve({ id }) });
};

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(renderPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  // The defaults, with the pattern "{name} – {company} – {doc}".
  vi.mocked(loadSettings).mockResolvedValue(settingsFromRows([]));
  vi.mocked(loadProfileSettings).mockResolvedValue(profileSettingsFrom({}));
  vi.mocked(renderPdf).mockClear();
  // An application with both documents.
  vi.mocked(prisma.application.findUnique).mockReset().mockResolvedValue({
    company: "Ledgerly",
    role: "Senior Product Designer",
    documents: [{ id: "doc-1" }],
  } as never);
});

describe("GET /api/pdf", () => {
  it("downloads the base resume, named by the file-name pattern (RES-5, SET-8)", async () => {
    const response = await get("?doc=base");
    expect(response.status).toBe(200);
    expect(renderPdf).toHaveBeenCalledWith("/print/base?profile=first");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Jane Doe - Resume.pdf\"; filename*=UTF-8''Jane%20Doe%20%E2%80%93%20Resume.pdf",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("squeezes the base resume a step at a time until it fits one page, when Fit to one page is on (public issue 69)", async () => {
    const pages = (count: number) => new TextEncoder().encode(`%PDF ${"/Type /Page ".repeat(count)}`);
    vi.mocked(loadProfileSettings).mockResolvedValue(profileSettingsFrom({ fitBaseResume: "true" }));
    vi.mocked(renderPdf).mockImplementation(async (path) => (path === "/print/base?profile=first&fit=2" ? pages(1) : pages(2)));
    expect((await get("?doc=base")).status).toBe(200);
    expect(vi.mocked(renderPdf).mock.calls.map(([path]) => path)).toEqual(["/print/base?profile=first", "/print/base?profile=first&fit=1", "/print/base?profile=first&fit=2"]);

    // At its tightest it may still run over: the last try is what's sent.
    vi.mocked(renderPdf).mockClear().mockResolvedValue(pages(2));
    expect((await get("?doc=base")).status).toBe(200);
    expect(vi.mocked(renderPdf).mock.calls.map(([path]) => path)).toEqual(["/print/base?profile=first", "/print/base?profile=first&fit=1", "/print/base?profile=first&fit=2", "/print/base?profile=first&fit=3", "/print/base?profile=first&fit=4"]);

    // Off: one render, pages or not.
    vi.mocked(loadProfileSettings).mockResolvedValue(profileSettingsFrom({}));
    vi.mocked(renderPdf).mockClear().mockResolvedValue(pages(2));
    await get("?doc=base");
    expect(vi.mocked(renderPdf).mock.calls.map(([path]) => path)).toEqual(["/print/base?profile=first"]);
  });

  it("answers 404 for documents it doesn't know", async () => {
    expect((await get("?doc=resume:abc")).status).toBe(404);
    expect((await get("")).status).toBe(404);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await get("?doc=base")).status).toBe(401);
  });

  it("turns a failed render into a friendly 500", async () => {
    vi.mocked(renderPdf).mockRejectedValue(new Error("Chromium crashed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get("?doc=base");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/^Something went wrong/) });
  });

  it("downloads an application's tailored resume and cover letter (APP-12)", async () => {
    const resume = await get("?doc=resume&application=app1");
    expect(renderPdf).toHaveBeenLastCalledWith("/print/resume/app1");
    expect(resume.headers.get("content-disposition")).toContain("filename*=UTF-8''Jane%20Doe%20%E2%80%93%20Ledgerly%20%E2%80%93%20Resume.pdf");

    const letter = await get("?doc=letter&application=app1");
    expect(renderPdf).toHaveBeenLastCalledWith("/print/letter/app1");
    expect(letter.headers.get("content-disposition")).toContain("Ledgerly%20%E2%80%93%20Cover%20letter.pdf");
    expect(prisma.application.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "app1" }, select: expect.objectContaining({ documents: { where: { kind: "COVER_LETTER" }, select: { id: true } } }) }),
    );
  });

  it("says which document an application doesn't have", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue({ company: "Ledgerly", role: "", documents: [] } as never);
    const response = await get("?doc=letter&application=app1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "This application has no cover letter." });
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("never prints for an application that isn't there, or an id that isn't one", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
    expect((await get("?doc=resume&application=gone")).status).toBe(404);
    expect((await get("?doc=resume&application=..%2Fbase")).status).toBe(404);
    expect((await get("?doc=resume")).status).toBe(404);
    expect(renderPdf).not.toHaveBeenCalled();
  });
});

describe("POST /api/pdf, then GET /api/pdf/{id}", () => {
  it("renders once and holds the PDF, for the browser to download from its own link", async () => {
    const response = await post("?doc=resume&application=app1");
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(/^\/api\/pdf\/[0-9a-f-]{36}$/);
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(renderPdf).toHaveBeenCalledWith("/print/resume/app1");

    const download = await getHeld(url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(download.headers.get("content-disposition")).toContain("Jane%20Doe%20%E2%80%93%20Ledgerly%20%E2%80%93%20Resume.pdf");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(renderPdf).toHaveBeenCalledTimes(1);
  });

  it("answers with the same errors as a direct download", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null);
    const response = await post("?doc=letter&application=gone");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That application no longer exists." });
  });

  it("says when a held PDF isn't there any more", async () => {
    const response = await getHeld("/api/pdf/not-held");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That PDF isn't here any more. Download it again." });
  });

  it("needs a session and the app's own origin", async () => {
    const other = await POST(new NextRequest("http://localhost:3000/api/pdf?doc=base", { method: "POST", headers: { origin: "https://evil.example" } }), undefined);
    expect(other.status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post("?doc=base")).status).toBe(401);
    expect((await getHeld("/api/pdf/anything")).status).toBe(401);
    expect(renderPdf).not.toHaveBeenCalled();
  });
});
