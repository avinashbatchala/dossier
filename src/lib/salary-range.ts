// Amounts in a salary as written (E30-7), for the offer's range bar:
// "€75,000–€90,000", "75k-90k", "€82.000 a year".

/** The amounts in `text`, in order: thousands written out or with k; small numbers (days, hours) left out. */
export function salaryAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const [, digits, k] of text.matchAll(/(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*([kK])?\b/g)) {
    const grouped = /[.,\s]\d{3}$/.test(digits) && !/[.,]\d{1,2}$/.test(digits);
    const value = grouped ? Number(digits.replace(/[.,\s]/g, "")) : Number(digits.replace(",", ".")) * (k ? 1000 : 1);
    if (Number.isFinite(value) && value >= 1000) amounts.push(value);
  }
  return amounts;
}

/** Where an offered amount falls on the posted range: 0 at its low end, 1 at its high end, clamped; null without both. */
export function rangePosition(posted: string, offered: string): { low: number; high: number; amount: number; at: number } | null {
  const [low, high] = salaryAmounts(posted);
  const [amount] = salaryAmounts(offered);
  if (!low || !high || !amount || high <= low) return null;
  return { low, high, amount, at: Math.min(1, Math.max(0, (amount - low) / (high - low))) };
}
