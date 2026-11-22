// Dossier's website: theme switch, tabs, copy buttons, scroll effects, the tour
// video, and the star count and latest version from GitHub. The page works
// without it.

const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Light or dark, remembered on this browser only.
const themeButton = document.querySelector("[data-theme-toggle]");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => root.dataset.theme || (systemDark.matches ? "dark" : "light");
const labelThemeButton = () => {
  themeButton.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode");
};
themeButton.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  labelThemeButton();
});
systemDark.addEventListener("change", labelThemeButton);
labelThemeButton();

// The navigation gets a background once the page scrolls.
const nav = document.querySelector("[data-nav]");
const markScrolled = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", markScrolled, { passive: true });
markScrolled();

// Tabs, with arrow keys between them.
for (const group of document.querySelectorAll("[data-tabs]")) {
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

// "Self-host it" in the hero opens the install section on its server tab.
for (const link of document.querySelectorAll("[data-show-tab]")) {
  link.addEventListener("click", () => document.getElementById(link.dataset.showTab)?.click());
}

// Copy buttons copy the commands without their "$" prompts.
for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector("span");
  button.addEventListener("click", async () => {
    const code = button.closest("[data-code]").querySelector("code");
    const text = [...code.childNodes]
      .filter((node) => !(node instanceof Element && node.classList.contains("c-mute")))
      .map((node) => node.textContent)
      .join("")
      .replace(/^ /gm, "");
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Select and copy";
    }
    button.classList.add("is-done");
    setTimeout(() => {
      label.textContent = "Copy";
      button.classList.remove("is-done");
    }, 1800);
  });
}

// Sections ease in as they arrive.
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const element of reveals) observer.observe(element);
} else {
  for (const element of reveals) element.classList.add("is-in");
}

// How it works: the window shows the step in the middle of the screen.
const steps = [...document.querySelectorAll("[data-step]")];
const frames = [...document.querySelectorAll("[data-frame]")];
if ("IntersectionObserver" in window && steps.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = entry.target.dataset.step;
        for (const step of steps) step.classList.toggle("is-active", step.dataset.step === index);
        for (const frame of frames) frame.classList.toggle("is-active", frame.dataset.frame === index);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  for (const step of steps) observer.observe(step);
}

// The hero's floating cards drift a little against the window.
const floats = [...document.querySelectorAll("[data-parallax]")];
const stage = document.querySelector("[data-parallax-root]");
if (floats.length && stage) {
  let queued = false;
  const drift = () => {
    queued = false;
    if (reducedMotion.matches) return;
    const offset = stage.getBoundingClientRect().top - window.innerHeight / 2;
    for (const card of floats) {
      card.style.transform = `translateY(${(offset * Number(card.dataset.parallax)).toFixed(1)}px)`;
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(drift);
    },
    { passive: true },
  );
  drift();
}

// The tour video. Nothing comes from YouTube until someone presses play; without
// scripts, or with a modifier key, these are plain links to the video.
const player = document.querySelector("[data-player]");
const theatre = document.querySelector("[data-theatre]");
const playLinks = [...document.querySelectorAll("[data-video-play]")];
const showVideo = (start) => {
  let video = player.querySelector("iframe");
  if (!video) {
    video = document.createElement("iframe");
    video.title = "Dossier: tailored resumes and cover letters, self-hosted (install + tour)";
    video.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
    video.allowFullscreen = true;
    // YouTube refuses to play an embed that sends no referrer.
    video.referrerPolicy = "strict-origin-when-cross-origin";
    player.append(video);
  }
  video.src = `https://www.youtube-nocookie.com/embed/kygD5cApjqA?autoplay=1&rel=0&playsinline=1&start=${start}`;
  theatre.classList.add("is-playing");
  video.focus({ preventScroll: true });
  const box = player.getBoundingClientRect();
  if (box.top < 88 || box.bottom > window.innerHeight) {
    player.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
  }
};
for (const link of playLinks) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showVideo(Number(link.dataset.start ?? 0));
    for (const other of playLinks) other.removeAttribute("aria-current");
    if (link.dataset.start) link.setAttribute("aria-current", "true");
  });
}

// Stars and the latest release, from GitHub's API. Left out if it doesn't answer.
const repo = "https://api.github.com/repos/AienTech/dossier";
const getJson = (url) => fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then((r) => (r.ok ? r.json() : null));

getJson(repo)
  .then((data) => {
    if (!data || typeof data.stargazers_count !== "number") return;
    const stars = document.querySelector("[data-stars]");
    stars.textContent = new Intl.NumberFormat("en", { notation: "compact" }).format(data.stargazers_count);
    stars.setAttribute("aria-label", `${data.stargazers_count} stars`);
    stars.hidden = false;
  })
  .catch(() => {});

// The desktop app's files in a release, by the names release.yml gives them.
const DESKTOP_FILES = { windows: /-win-x64\.exe$/, deb: /-linux-amd64\.deb$/, appimage: /-linux-x86_64\.AppImage$/ };

/** "windows" or "linux" when the visitor is on one, as far as the browser says. */
function desktopSystem() {
  const said = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`;
  if (/android|iphone|ipad|mobile/i.test(said)) return null;
  if (/win/i.test(said)) return "windows";
  if (/mac/i.test(said)) return null;
  if (/linux|x11/i.test(said)) return "linux";
  return null;
}

/**
 * Each download link gets its file from the latest release, and the hero's
 * says which system it's for. Until a release has the file (or without
 * scripts), they all lead to the release page.
 */
function offerDownloads(release) {
  const fileFor = (kind) => release.assets?.find((asset) => DESKTOP_FILES[kind].test(asset.name))?.browser_download_url;
  for (const link of document.querySelectorAll("[data-download-asset]")) {
    const file = fileFor(link.dataset.downloadAsset);
    if (file) link.href = file;
  }
  const system = desktopSystem();
  const file = system && fileFor(system === "windows" ? "windows" : "deb");
  const hero = document.querySelector("[data-download]");
  const note = document.querySelector("[data-download-note]");
  if (!file || !hero || !note) return;
  hero.href = file;
  hero.querySelector("[data-download-label]").textContent = system === "windows" ? "Download for Windows" : "Download for Linux";
  // The other system, and the AppImage, are on the install section's Desktop app tab.
  const other = document.createElement("a");
  other.href = "#install";
  other.textContent = system === "windows" ? "Linux" : "an AppImage";
  other.addEventListener("click", () => document.getElementById("tab-desktop")?.click());
  note.replaceChildren(
    system === "windows" ? "Free. One click to install, nothing to set up. Also for " : "Free. A .deb for Ubuntu and Debian, nothing to set up. Also as ",
    other,
    system === "windows" ? "." : ", and for Windows.",
  );
}

getJson(`${repo}/releases/latest`)
  .then((data) => {
    if (!data || typeof data.tag_name !== "string") return;
    document.querySelector("[data-release-text]").textContent = `Version ${data.tag_name.replace(/^v/, "")} is out`;
    offerDownloads(data);
  })
  .catch(() => {});
