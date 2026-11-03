import "server-only";

/**
 * Logs an unexpected server error without the data it was handling.
 *
 * Only the first line of the message is kept: some libraries put the call's
 * arguments on the following lines (Prisma validation errors print the query
 * data, which can include API keys or profile details).
 */
export function logServerError(where: string, error: unknown): void {
  if (!(error instanceof Error)) {
    console.error(`[${where}] Unexpected error (${typeof error} thrown)`);
    return;
  }
  const code =
    "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  const message = error.message.split("\n", 1)[0];
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
  console.error(
    `[${where}] ${error.name}${code}: ${message}${frames ? `\n${frames}` : ""}`,
  );
}

/** Logs something worth knowing that isn't an error, such as an AI answer that didn't fit. `message` must hold no user data. */
export function logServerWarning(where: string, message: string): void {
  console.warn(`[${where}] ${message}`);
}
