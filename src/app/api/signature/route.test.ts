import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { SIGNATURE_MESSAGES } from "@/lib/signature";
import { removeSignature, saveSignature } from "@/lib/signature-data";

import { DELETE, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/signature-data", () => ({ saveSignature: vi.fn(async () => {}), removeSignature: vi.fn(async () => {}) }));

const origin = "http://localhost:3000";
const request = (method: string, body?: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest(`${origin}/api/signature`, {
    method,
    ...(body === undefined ? {} : { body }),
    headers: { origin, host: "localhost:3000", ...headers },
  });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 13]);

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(saveSignature).mockClear();
  vi.mocked(removeSignature).mockClear();
});

describe("POST /api/signature (E17)", () => {
  it("stores a PNG sent as the body", async () => {
    const response = await POST(request("POST", PNG, { "content-type": "image/png" }), undefined);
    expect(await response.json()).toEqual({ ok: true });
    expect(saveSignature).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png");
  });

  it("stores a JPEG too", async () => {
    const response = await POST(request("POST", JPEG, { "content-type": "image/jpeg" }), undefined);
    expect(await response.json()).toEqual({ ok: true });
    expect(saveSignature).toHaveBeenCalledWith(expect.any(Uint8Array), "image/jpeg");
  });

  it("refuses another type, bytes that aren't an image, and a file that's too big", async () => {
    expect((await POST(request("POST", PNG, { "content-type": "image/gif" }), undefined)).status).toBe(415);
    expect((await POST(request("POST", Buffer.from("hello"), { "content-type": "image/png" }), undefined)).status).toBe(415);
    const big = new Uint8Array(513 * 1024);
    big.set(PNG);
    expect((await POST(request("POST", big, { "content-type": "image/png" }), undefined)).status).toBe(413);
    expect(saveSignature).not.toHaveBeenCalled();
  });

  it("says the same thing whatever went wrong, without leaking the body", async () => {
    const response = await POST(request("POST", Buffer.from("hello"), { "content-type": "image/png" }), undefined);
    expect(await response.json()).toEqual({ error: SIGNATURE_MESSAGES.notImage });
  });

  it("needs a signed-in session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request("POST", PNG, { "content-type": "image/png" }), undefined)).status).toBe(401);
    expect(saveSignature).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/signature", () => {
  it("removes the stored signature", async () => {
    const response = await DELETE(request("DELETE"), undefined);
    expect(await response.json()).toEqual({ ok: true });
    expect(removeSignature).toHaveBeenCalled();
  });
});
