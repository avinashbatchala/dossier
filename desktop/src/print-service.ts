import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { BrowserWindow, session } from "electron";

// PDFs for "On this computer". Electron already holds a Chromium, so no second
// browser ships: the server asks here, on this computer, with its launch's token,
// and a hidden window prints the page. Like the image's renderer, it may only
// talk to the app itself and refuses a page that redirected.

const PARTITION = "print";
const MAX_AT_ONCE = 2;
const PRINT_TOKEN_HEADER = "x-dossier-print-token";
const DESKTOP_TOKEN_HEADER = "x-dossier-desktop-token";
const NAVIGATION_TIMEOUT_MS = 20_000;

async function printPage(origin: string, page: string, printToken: string): Promise<Buffer> {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION } });
  try {
    const contents = window.webContents;
    let redirected = false;
    let status = 0;
    contents.on("did-redirect-navigation", () => {
      redirected = true;
    });
    contents.on("did-navigate", (_event, _url, code) => {
      status = code;
    });
    const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`The print page ${page} took too long.`)), NAVIGATION_TIMEOUT_MS).unref());
    await Promise.race([contents.loadURL(`${origin}${page}`, { extraHeaders: `${PRINT_TOKEN_HEADER}: ${printToken}\n` }), timeout]);
    if (redirected) throw new Error(`The print page ${page} redirected.`);
    if (status < 200 || status >= 300) throw new Error(`The print page ${page} answered ${status}.`);
    await contents.executeJavaScript("document.fonts.ready.then(() => true)");
    // Margins come from the page's own CSS; Electron's default would add to them.
    return await contents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    window.destroy();
  }
}

export type PrintService = { url: string; useOrigin: (origin: string, token: string) => void; close: () => void };

/** Starts listening, on this computer only. It prints nothing until it's told the server's origin and token. */
export async function startPrintService(): Promise<PrintService> {
  let origin = "";
  let token = "";
  let printing = 0;
  const waiting: (() => void)[] = [];

  session.fromPartition(PARTITION).webRequest.onBeforeRequest({ urls: ["*://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
    callback({ cancel: new URL(details.url).origin !== origin });
  });

  const server: Server = createServer((request, response) => {
    const given = Buffer.from(String(request.headers[DESKTOP_TOKEN_HEADER] ?? ""));
    const expected = Buffer.from(token);
    if (!token || given.length !== expected.length || !timingSafeEqual(given, expected) || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      if (printing >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
      printing += 1;
      try {
        const { page, printToken } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { page: string; printToken: string };
        if (!page.startsWith("/print/")) throw new Error("That's not a print page.");
        const pdf = await printPage(origin, page, printToken);
        response.writeHead(200, { "content-type": "application/pdf" }).end(pdf);
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain" }).end(error instanceof Error ? error.message : "It couldn't be printed.");
      } finally {
        printing -= 1;
        waiting.shift()?.();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    useOrigin: (nextOrigin, nextToken) => {
      origin = nextOrigin;
      token = nextToken;
    },
    close: () => server.close(),
  };
}
