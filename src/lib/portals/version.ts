/** "1.10.0" is after "1.9.2": a config's version, three numbers. */
export function newerVersion(a: string, b: string): boolean {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] > y[index];
  return false;
}
