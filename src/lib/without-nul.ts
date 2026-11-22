// PostgreSQL refuses the NUL character, in jsonb ("\u0000 cannot be
// converted to text") and in text columns alike, and a model can put one in
// its answer (public issue 127).

/** `value` with NUL characters left out of its strings, in arrays and plain objects too; keys are left alone. */
export function withoutNul<T>(value: T): T;
export function withoutNul(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("\u0000", "");
  if (Array.isArray(value)) return value.map(withoutNul);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutNul(item)]));
  }
  return value;
}
