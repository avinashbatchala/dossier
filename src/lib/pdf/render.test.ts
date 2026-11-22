import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake Chromium: each page waits until the test lets it print.
const fake = vi.hoisted(() => {
  type Handler = () => void;
  const state = {
    launches: 0,
    printing: 0,
    maxPrinting: 0,
    releases: [] as (() => void)[],
    routes: [] as string[],
    disconnect: undefined as Handler | undefined,
    redirected: false,
  };
  const launch = async () => {
    state.launches += 1;
    return {
      on: (event: string, handler: Handler) => {
        if (event === "disconnected") state.disconnect = handler;
      },
      close: async () => {},
      newContext: async () => ({
        route: async (_pattern: string, handler: (route: unknown) => void) => {
          for (const url of ["http://localhost:3000/_next/static/app.css", "https://fonts.example/font.woff2"]) {
            handler({
              request: () => ({ url: () => url }),
              continue: () => state.routes.push(`continue ${url}`),
              abort: () => state.routes.push(`abort ${url}`),
            });
          }
        },
        newPage: async () => ({
          goto: async () => ({ ok: () => true, status: () => 200, request: () => ({ redirectedFrom: () => (state.redirected ? {} : null) }) }),
          url: () => "http://localhost:3000/login?next=%2Fprint%2Fbase",
          evaluate: async () => {},
          pdf: async () => {
            state.printing += 1;
            state.maxPrinting = Math.max(state.maxPrinting, state.printing);
            await new Promise<void>((resolve) => state.releases.push(resolve));
            state.printing -= 1;
            return new Uint8Array([37, 80, 68, 70]);
          },
        }),
        close: async () => {},
      }),
    };
  };
  return { state, launch };
});

vi.mock("playwright-core", () => ({ chromium: { launch: fake.launch } }));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const { MAX_CONCURRENT_RENDERS, renderPdf } = await import("./render");

/** Lets the pages that are printing finish, one tick at a time. */
async function settle() {
  for (let i = 0; i < 20; i++) {
    fake.state.releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  fake.state.routes = [];
  fake.state.maxPrinting = 0;
});

describe("renderPdf", () => {
  it("prints a page to PDF, letting Chromium reach only the app", async () => {
    const rendering = renderPdf("/print/base");
    await settle();
    expect(await rendering).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(fake.state.routes).toEqual([
      "continue http://localhost:3000/_next/static/app.css",
      "abort https://fonts.example/font.woff2",
    ]);
  });

  it("refuses to print a page that redirected, rather than print the sign-in page as the document (#328)", async () => {
    fake.state.redirected = true;
    try {
      await expect(renderPdf("/print/base?fit=1")).rejects.toThrow("The print page /print/base?fit=1 redirected to /login.");
    } finally {
      fake.state.redirected = false;
    }
  });

  it("reuses one browser and prints at most two pages at once, queueing the rest", async () => {
    const launches = fake.state.launches;
    const renders = Array.from({ length: 5 }, () => renderPdf("/print/base"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.state.printing).toBe(MAX_CONCURRENT_RENDERS);
    await settle();
    await Promise.all(renders);
    expect(fake.state.maxPrinting).toBe(MAX_CONCURRENT_RENDERS);
    expect(fake.state.launches).toBe(launches);
  });

  it("starts a new browser after the old one crashed", async () => {
    const launches = fake.state.launches;
    fake.state.disconnect?.();
    const rendering = renderPdf("/print/base");
    await settle();
    await rendering;
    expect(fake.state.launches).toBe(launches + 1);
  });
});
