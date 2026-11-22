import type { ApplicationRow } from "./applications-data";

/**
 * The order inside a board column (public issue 60): cards without a place
 * come first, newest first, then the rest in their order. So a column nobody
 * reordered stays newest first, and a new card or one just moved in goes on top.
 */
export function boardOrder(a: { boardSort: number | null; updatedAt: number | Date }, b: { boardSort: number | null; updatedAt: number | Date }) {
  if (a.boardSort === null && b.boardSort === null) return Number(b.updatedAt) - Number(a.updatedAt);
  if (a.boardSort === null) return -1;
  if (b.boardSort === null) return 1;
  return a.boardSort - b.boardSort;
}

/** One column's cards, in board order. */
export function orderedColumn(rows: ApplicationRow[], status: ApplicationRow["status"]) {
  return rows.filter((row) => row.status === status).sort(boardOrder);
}

/** The whole column with the cards on screen in their new order, sharing the places they held; hidden cards stay put. */
export function withShownOrder<Card extends { id: string }>(column: Card[], shown: string[]) {
  const ordered = [...new Set(shown)].flatMap((id) => column.filter((card) => card.id === id));
  let next = 0;
  return column.map((card) => (ordered.includes(card) ? ordered[next++] : card));
}
