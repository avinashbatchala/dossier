// The start screen: which mode, which server, and what to do when it can't be
// reached. All it can do is make the three calls in preload.ts.
const app = window.dossier;
const element = (id) => document.getElementById(id);

function show(id) {
  for (const section of ["choose", "server", "unreachable", "starting", "local-problem"]) element(section).hidden = section !== id;
}

const MESSAGES = {
  invalid: "That doesn't look like an address. Try something like https://dossier.example.com.",
  unreachable: "Couldn't reach that address. Check it, and that the server is running.",
  certificate: "That server's certificate can't be trusted, so Dossier won't connect to it.",
  "not-dossier": "That doesn't look like a Dossier server.",
  unencrypted: "This address isn't encrypted, so your password would travel in the open. Use https:// unless you trust this network. Press Connect again to go ahead.",
};

let confirmedAddress = null;

function setMessage(status) {
  const message = element("server-message");
  message.textContent = MESSAGES[status] ?? "";
  message.classList.toggle("warning", status === "unencrypted");
}

function showServerForm(address = "") {
  show("server");
  element("address").value = address;
  setMessage(null);
  element("address").focus();
}

element("pick-server").addEventListener("click", () => showServerForm());
element("pick-local").addEventListener("click", () => void app.useThisComputer());
element("problem-retry").addEventListener("click", () => void app.retry());
element("problem-download").addEventListener("click", () => void app.openReleases());
element("problem-choose").addEventListener("click", () => {
  show("choose");
  element("pick-local").focus();
});
element("back").addEventListener("click", () => {
  show("choose");
  element("pick-server").focus();
});
element("address").addEventListener("input", () => {
  confirmedAddress = null;
  setMessage(null);
});

element("server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = element("address").value;
  const connect = element("connect");
  connect.disabled = true;
  connect.textContent = "Connecting…";
  setMessage(null);
  try {
    const { status } = await app.connect(address, confirmedAddress === address);
    if (status === "unencrypted") confirmedAddress = address;
    if (status !== "ok") {
      setMessage(status);
      element("address").focus();
    }
  } finally {
    connect.disabled = false;
    connect.textContent = "Connect";
  }
});

element("retry").addEventListener("click", async () => {
  const retry = element("retry");
  retry.disabled = true;
  retry.textContent = "Trying…";
  element("retry-message").textContent = "";
  try {
    const { status } = await app.retry();
    if (status !== "ok") element("retry-message").textContent = status === "unreachable" ? "Still no answer." : MESSAGES[status];
  } finally {
    retry.disabled = false;
    retry.textContent = "Try again";
    retry.focus();
  }
});

function showProblem({ kind, detail, log }) {
  const newer = kind === "newer-database";
  element("problem-title").textContent = newer ? "This data needs a newer Dossier" : kind === "port-busy" ? "Another program is in the way" : "Dossier couldn't start";
  element("problem-text").textContent = newer ? "Your data was last used by a newer version of Dossier, so this one won't open it. Nothing was changed. Download the latest version from the release page." : detail;
  element("problem-log").textContent = newer ? "" : `The log is at ${log}`;
  element("problem-retry").hidden = newer;
  element("problem-download").hidden = !newer;
  show("local-problem");
  element(newer ? "problem-download" : "problem-retry").focus();
}

async function start() {
  const state = await app.state();
  element("version").textContent = `Dossier ${state.version}`;
  element("change").onclick = () => showServerForm(state.address);
  element("pick-local").disabled = !state.localAvailable;
  element("local-note").hidden = state.localAvailable;
  if (state.screen === "starting") return show("starting");
  if (state.screen === "local-problem") return showProblem(state);
  if (state.screen === "server") return showServerForm(state.address);
  if (state.screen === "unreachable") {
    element("unreachable-title").textContent = state.certificate ? "Can't trust your server's certificate" : "Can't reach your server";
    element("unreachable-text").textContent = state.certificate
      ? `${state.address} sent a certificate Dossier can't trust, so it won't connect.`
      : `${state.address} isn't answering. Check that it's running and that you're online.`;
    show("unreachable");
    element("retry").focus();
    return;
  }
  show("choose");
}

void start();
