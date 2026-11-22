// Starts the Dossier server for the desktop app. The app holds this process's
// stdin open, so if the app goes away, even by crashing, the server goes too and
// doesn't keep the port.
process.stdin.resume();
process.stdin.on("close", () => process.exit(0));
await import("./server.js");
