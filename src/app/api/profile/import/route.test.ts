import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAiConfigured } from "@/lib/ai/config";
import { getSession } from "@/lib/auth/session";
import { discardProfileImports } from "@/lib/jobs/import-profile";
import { startJob } from "@/lib/jobs/runner";
import { RESUME_MESSAGES } from "@/lib/resume-text";
import { docxWith } from "@/test/resume-files";

import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: vi.fn(async () => true) }));
vi.mock("@/lib/jobs/runner", () => ({ startJob: vi.fn(async () => "job-1"), defineJob: (definition: unknown) => definition }));
vi.mock("@/lib/jobs/import-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/import-profile")>()),
  discardProfileImports: vi.fn(async () => {}),
}));

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost:3000/api/profile/import", {
      method: "POST",
      body,
      headers: { origin: "http://localhost:3000", host: "localhost:3000", ...headers },
    }),
    undefined,
  );

const resume = docxWith(["John Doe", "Design Lead, Acme Payments, 2021 – present", "Led the redesign of the payout flow for merchants"]);

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(startJob).mockClear();
  vi.mocked(discardProfileImports).mockClear();
});

describe("POST /api/profile/import (E4-10)", () => {
  it("reads the file and starts a job with its text", async () => {
    const response = await post(Buffer.from(resume));
    expect(await response.json()).toEqual({ jobId: "job-1" });
    expect(startJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "import-profile" }),
      { resume: expect.stringContaining("Led the redesign of the payout flow") },
      { key: "profile-import" },
    );
    // Only one resume's text is kept: earlier readings go first.
    expect(vi.mocked(discardProfileImports).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(startJob).mock.invocationCallOrder[0]);
  });

  it("reads a Markdown file as plain text", async () => {
    const markdown = "# John Doe\n\n## Experience\n\n**Design Lead**, Acme Payments, 2021 – present\n\n* Led the redesign of the payout flow for merchants";
    const response = await post(markdown, { "content-type": "text/markdown" });
    expect(await response.json()).toEqual({ jobId: "job-1" });
    expect(startJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "import-profile" }),
      { resume: "John Doe\n\nExperience\n\nDesign Lead, Acme Payments, 2021 – present\n\n- Led the redesign of the payout flow for merchants" },
      { key: "profile-import" },
    );
  });

  it("explains a file it can't use, and starts nothing", async () => {
    const response = await post(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: RESUME_MESSAGES.wrongType });
    expect(startJob).not.toHaveBeenCalled();
    expect(discardProfileImports).not.toHaveBeenCalled();
  });

  it("refuses a file that's too big before reading it", async () => {
    const response = await post(Buffer.from(resume), { "content-length": String(6 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: RESUME_MESSAGES.tooBig });
  });

  it("asks for an AI provider first", async () => {
    vi.mocked(isAiConfigured).mockResolvedValueOnce(false);
    const response = await post(Buffer.from(resume));
    expect(response.status).toBe(409);
    expect(startJob).not.toHaveBeenCalled();
  });
});
