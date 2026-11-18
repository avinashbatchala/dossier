import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, WebContentsView, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron";

import { checkServer, parseAddress } from "./address";
import { barColors, fallbackColors, READ_PAGE_COLORS, type BarColors } from "./bar-colors";
import { localBundle, LocalServerError, startLocalServer, type LocalProblem, type RunningServer } from "./local-server";
import { readPreferences, writePreferences, type Preferences } from "./preferences";
import { startPrintService, type PrintService } from "./print-service";
import { googleConnectPath, mayOpenExternally, navigationFor, permissionAllowed, redirectAllowed } from "./window-rules";

// The desktop app: one window with the app's own top bar, and below it either
// its start screen or Dossier, from the user's server or from a server the app
// starts on this computer. Dossier is the same either way, as a web page in a view.

const RELEASES_URL = "https://github.com/AienTech/dossier/releases/latest";
const REPOSITORY_URL = "https://github.com/AienTech/dossier";
const COFFEE_URL = "https://buymeacoffee.com/aientech";
const DISCORD_URL = "https://discord.gg/4pfxADVSf9";
const SERVER_SESSION = "persist:dossier";
/** Added to the user agent, so a sign-in from this window keeps its session across launches (#359; isDesktopClient in src/lib/desktop-client.ts). */
const DESKTOP_CLIENT = "DossierDesktop";
const LOCAL_SESSION = "persist:local";
const DESKTOP_TOKEN_HEADER = "x-dossier-desktop-token";
/** Where the server and Node that come with the app are. */
const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "build-server");
/** The cookie the sidebar's light/dark switch sets on the server's page. */
const THEME_COOKIE = "dossier_theme";
const ICON = path.join(__dirname, "icon.png");
const BAR_PAGE = path.join(__dirname, "bar", "index.html");
const START_PAGE = path.join(__dirname, "start", "index.html");
/** The same as the height in bar/bar.css. */
const BAR_HEIGHT = 32;

/** Errors Chromium reports for a certificate it won't accept. */
const isCertificateError = (code: number) => code <= -200 && code > -300;
/** Reported when a navigation is replaced or becomes a download: nothing went wrong. */
const ABORTED = -3;

type StartScreen =
  | { screen: "choose" }
  | { screen: "server"; address: string }
  | { screen: "unreachable"; address: string; certificate: boolean }
  | { screen: "starting" }
  | ({ screen: "local-problem" } & LocalProblem);

let window: BrowserWindow | null = null;
/** What the window shows below the bar. */
let content: WebContentsView | null = null;
let startScreen: StartScreen = { screen: "choose" };
let preferences: Preferences = { mode: null, serverOrigin: null };
/** The server on this computer, while it's running. */
let local: RunningServer | null = null;
let printService: PrintService | null = null;

const preferencesFile = () => path.join(app.getPath("userData"), "desktop.json");

function savePreferences(next: Preferences) {
  preferences = next;
  writePreferences(preferencesFile(), next);
  buildMenu();
}

/** The bar and the window's own buttons, in these colours. */
function paintBar(colors: BarColors) {
  if (!window) return;
  window.webContents.send("bar:colors", colors);
  window.setBackgroundColor(colors.background);
  window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.ink });
}

/** Paints the bar like the page below it. What the page answers is only ever used as colours. */
async function matchBarToPage() {
  const shown = content;
  if (!shown || shown.webContents.isDestroyed()) return;
  const answer: unknown = await shown.webContents.executeJavaScriptInIsolatedWorld(1000, [{ code: READ_PAGE_COLORS }]).catch(() => null);
  if (shown === content) paintBar(barColors(answer, nativeTheme.shouldUseDarkColors));
}

function layoutContent() {
  if (!window || !content) return;
  const { width, height } = window.getContentBounds();
  content.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) });
}

/** Shows this view below the bar, in place of the one before. */
function showContent(view: WebContentsView) {
  if (!window) return;
  const previous = content;
  content = view;
  window.contentView.addChildView(view);
  layoutContent();
  if (previous) {
    window.contentView.removeChildView(previous);
    previous.webContents.close();
  }
  view.webContents.on("did-finish-load", () => void matchBarToPage());
  view.webContents.on("did-navigate-in-page", () => void matchBarToPage());
  // What the page calls itself is the window's name, as the taskbar shows it.
  view.webContents.on("page-title-updated", (_event, title) => window?.setTitle(title));
  view.webContents.focus();
}

function showStart(screen: StartScreen) {
  startScreen = screen;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: "start",
    },
  });
  // The start screen never goes anywhere by itself.
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  showContent(view);
  void view.webContents.loadFile(START_PAGE);
}

/** Shows Dossier from this address. With a token, it's the server on this computer, which the app signs in to by itself. */
function showServer(origin: string, signInToken?: string) {
  const view = new WebContentsView({
    webPreferences: {
      // No preload: the page comes from elsewhere, so it's treated as any web page.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      partition: signInToken ? LOCAL_SESSION : SERVER_SESSION,
    },
  });
  const contents = view.webContents;

  contents.setWindowOpenHandler(({ url }) => {
    if (mayOpenExternally(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event) => {
    // Google refuses its sign-in inside an app: Connect Google goes to the browser,
    // signed in by the app on this computer, as it is on a server (#327).
    const connect = googleConnectPath(event.url, origin);
    if (connect !== null) {
      event.preventDefault();
      void (signInToken ? openSignedIn(origin, signInToken, connect) : shell.openExternal(event.url));
      return;
    }
    const navigation = navigationFor(event.url, { server: origin, current: contents.getURL() });
    if (navigation === "stay") return;
    event.preventDefault();
    if (navigation === "external") void shell.openExternal(event.url);
  });
  contents.on("will-redirect", (event) => {
    if (!redirectAllowed(event.url)) event.preventDefault();
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === ABORTED || content !== view) return;
    if (signInToken) showStart({ screen: "local-problem", kind: "failed", detail: "The window couldn't reach the server on this computer.", log: logFile() });
    else showStart({ screen: "unreachable", address: origin, certificate: isCertificateError(code) });
  });

  const load = () => (signInToken ? contents.loadURL(`${origin}/api/desktop/sign-in`, { extraHeaders: `${DESKTOP_TOKEN_HEADER}: ${signInToken}\n` }) : contents.loadURL(origin));
  if (signInToken) {
    // A long-open window can outlive its session, and there's no password to ask for.
    let signedInAt = Date.now();
    contents.on("did-navigate", (_event, url) => {
      if (new URL(url).pathname !== "/login" || Date.now() - signedInAt < 60_000) return;
      signedInAt = Date.now();
      void load();
    });
  }

  showContent(view);
  void load();
}

const logFile = () => path.join(app.getPath("userData"), "logs", "server.log");

/**
 * Opens `next` on the server on this computer in the system browser, signed
 * in (#365, #327): the server gives the app a one-time link for its token,
 * which signs the browser in for its session. For Connect Google, and for an
 * MCP app's approval page, which wait in the browser.
 */
async function openSignedIn(origin: string, token: string, next: string) {
  try {
    const response = await fetch(`${origin}/api/desktop/browser-link`, {
      method: "POST",
      headers: { [DESKTOP_TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({ next }),
    });
    if (!response.ok) throw new Error(`The server answered ${response.status}.`);
    const { path: link } = (await response.json()) as { path: string };
    await shell.openExternal(new URL(link, origin).href);
  } catch (error) {
    dialog.showErrorBox("Couldn't open your browser", error instanceof Error ? error.message : String(error));
  }
}

/** Starts the server on this computer if it isn't running, and shows it. */
async function openLocal() {
  const bundle = localBundle(RESOURCES);
  if (!bundle) return showStart({ screen: "choose" });
  showStart({ screen: "starting" });
  try {
    if (!local) {
      printService ??= await startPrintService();
      local = await startLocalServer({
        bundle,
        dataDir: app.getPath("userData"),
        version: app.getVersion(),
        printUrl: printService.url,
        isHealthy: async (origin) => (await checkServer(origin, fetchHealth)) === "ok",
      });
      printService.useOrigin(local.origin, local.token);
    }
    showServer(local.origin, local.token);
  } catch (error) {
    const problem: LocalProblem = error instanceof LocalServerError ? error.problem : { kind: "failed", detail: error instanceof Error ? error.message : "Dossier couldn't start.", log: logFile() };
    showStart({ screen: "local-problem", ...problem });
  }
}

function stopLocal() {
  local?.stop();
  local = null;
}

/** Only what's asked for is allowed in the sessions that show Dossier, and the bar follows its light/dark switch. */
function prepareSessions() {
  for (const partition of [SERVER_SESSION, LOCAL_SESSION]) {
    const serverSession = session.fromPartition(partition);
    serverSession.setUserAgent(`${serverSession.getUserAgent()} ${DESKTOP_CLIENT}/${app.getVersion()}`);
    serverSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permissionAllowed(permission)));
    serverSession.setPermissionCheckHandler((_contents, permission) => permissionAllowed(permission));
    serverSession.cookies.on("changed", (_event, cookie) => {
      if (cookie.name === THEME_COOKIE) void matchBarToPage();
    });
  }
}

/** The health check, through the session that shows the server, so it trusts what that does. */
const fetchHealth: typeof fetch = (url, init) => session.fromPartition(SERVER_SESSION).fetch(url as string, init);

/** Handles a call only from the app's own start screen. */
function fromStartScreen<A extends unknown[], R>(handler: (...args: A) => R) {
  const page = pathToFileURL(START_PAGE).href;
  return (event: IpcMainInvokeEvent, ...args: A): R => {
    if (!event.senderFrame?.url.startsWith(page)) throw new Error("Not the start screen.");
    return handler(...args);
  };
}

function registerCalls() {
  ipcMain.handle("start:state", fromStartScreen(() => ({ ...startScreen, version: app.getVersion(), localAvailable: localBundle(RESOURCES) !== null })));

  ipcMain.handle(
    "start:local",
    fromStartScreen(() => {
      savePreferences({ ...preferences, mode: "local" });
      void openLocal();
    }),
  );

  ipcMain.handle(
    "start:releases",
    fromStartScreen(() => void shell.openExternal(RELEASES_URL)),
  );

  ipcMain.handle(
    "start:connect",
    fromStartScreen(async (input: string, confirmedUnencrypted: boolean) => {
      const address = parseAddress(String(input));
      if (!address) return { status: "invalid" };
      const check = await checkServer(address.origin, fetchHealth);
      if (check !== "ok") return { status: check };
      if (!address.encrypted && !confirmedUnencrypted) return { status: "unencrypted" };
      savePreferences({ mode: "server", serverOrigin: address.origin });
      stopLocal();
      showServer(address.origin);
      return { status: "ok" };
    }),
  );

  // The view only changes once the server answers, so trying again while it's down doesn't flicker.
  ipcMain.handle(
    "start:retry",
    fromStartScreen(async () => {
      if (preferences.mode === "local") {
        void openLocal();
        return { status: "ok" };
      }
      const origin = preferences.serverOrigin;
      if (!origin) return { status: "unreachable" };
      const check = await checkServer(origin, fetchHealth);
      if (check === "ok") showServer(origin);
      return { status: check };
    }),
  );

  ipcMain.on("bar:menu", (event, index: number, x: number, y: number) => {
    if (!window || event.sender !== window.webContents) return;
    const menu = Menu.getApplicationMenu()?.items[index]?.submenu;
    // Back to the page first, so Edit's Copy and Paste act on it and not on the bar.
    content?.webContents.focus();
    menu?.popup({ window, x, y });
  });
}

const changeZoom = (by: number) => {
  const contents = content?.webContents;
  if (contents) contents.setZoomLevel(contents.getZoomLevel() + by);
};

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Where to keep your data…", click: () => showStart({ screen: "choose" }) },
        ...(preferences.mode === "server"
          ? [{ label: "Change server…", click: () => showStart({ screen: "server", address: preferences.serverOrigin ?? "" }) }]
          : []),
        ...(preferences.mode === "local" ? [{ label: "Open the data folder", click: () => void shell.openPath(app.getPath("userData")) }] : []),
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      // Not the built-in roles: they'd act on the bar, not on the page below it.
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => content?.webContents.reload() },
        { label: "Force reload", accelerator: "CmdOrCtrl+Shift+R", click: () => content?.webContents.reloadIgnoringCache() },
        { type: "separator" },
        { label: "Actual size", accelerator: "CmdOrCtrl+0", click: () => content?.webContents.setZoomLevel(0) },
        { label: "Zoom in", accelerator: "CmdOrCtrl+=", click: () => changeZoom(0.5) },
        { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: () => changeZoom(-0.5) },
        { type: "separator" },
        { role: "togglefullscreen" },
        { label: "Developer tools", accelerator: "CmdOrCtrl+Shift+I", click: () => content?.webContents.toggleDevTools() },
      ],
    },
    {
      label: "Help",
      submenu: [
        // For an MCP app's approval page, which opens in the browser (#365).
        ...(preferences.mode === "local"
          ? [{ label: "Sign in my browser", click: () => void (local ? openSignedIn(local.origin, local.token, "/") : undefined) }, { type: "separator" as const }]
          : []),
        { label: "Download the latest version", click: () => void shell.openExternal(RELEASES_URL) },
        { label: "Dossier on GitHub", click: () => void shell.openExternal(REPOSITORY_URL) },
        { label: "Dossier on Discord", click: () => void shell.openExternal(DISCORD_URL) },
        { label: "Buy me a coffee", click: () => void shell.openExternal(COFFEE_URL) },
        { type: "separator" },
        { role: "about" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const colors = fallbackColors(nativeTheme.shouldUseDarkColors);
  const next = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 480,
    minHeight: 480,
    show: false,
    title: "Dossier",
    icon: ICON,
    backgroundColor: colors.background,
    autoHideMenuBar: true,
    // No title bar or menu row of the system's: the bar is the app's own, in
    // the page's colours, with the system's window buttons drawn over it.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: colors.background, symbolColor: colors.ink, height: BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, "bar-preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window = next;
  next.on("resize", layoutContent);
  next.on("focus", () => content?.webContents.focus());
  next.once("ready-to-show", () => next.show());
  next.on("closed", () => {
    if (content && !content.webContents.isDestroyed()) content.webContents.close();
    content = null;
    window = null;
  });
  next.webContents.on("will-navigate", (event) => event.preventDefault());
  next.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void next.loadFile(BAR_PAGE);
}

function start() {
  preferences = readPreferences(preferencesFile());
  app.setAboutPanelOptions({ applicationName: "Dossier", applicationVersion: app.getVersion(), copyright: "Free software under the AGPL-3.0", website: REPOSITORY_URL, iconPath: ICON });
  prepareSessions();
  registerCalls();
  buildMenu();
  createWindow();
  nativeTheme.on("updated", () => void matchBarToPage());
  if (preferences.mode === "server" && preferences.serverOrigin) showServer(preferences.serverOrigin);
  else if (preferences.mode === "local" && localBundle(RESOURCES)) void openLocal();
  else showStart({ screen: "choose" });
}

app.setName("Dossier");
// %LOCALAPPDATA%, not Roaming: a database doesn't belong in a folder that follows a person between computers.
if (process.platform === "win32" && process.env.LOCALAPPDATA) app.setPath("userData", path.join(process.env.LOCALAPPDATA, "Dossier"));

// One app at a time: a second launch brings the running one forward.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  // Closing the window quits, on every system (decided 5 November 2026).
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    stopLocal();
    printService?.close();
  });
  void app.whenReady().then(start);
} else {
  app.quit();
}
