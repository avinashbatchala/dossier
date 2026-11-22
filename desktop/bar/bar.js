// Opens the app's menus from the top bar, and takes its colours from main.ts.
for (const button of document.querySelectorAll("button[data-menu]")) {
  button.addEventListener("click", () => {
    const { left, bottom } = button.getBoundingClientRect();
    window.bar.openMenu(Number(button.dataset.menu), Math.round(left), Math.round(bottom));
  });
}

window.bar.onColors(({ background, ink }) => {
  document.body.style.setProperty("--bar", background);
  document.body.style.setProperty("--bar-ink", ink);
});
