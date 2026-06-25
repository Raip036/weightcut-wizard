/** Discipline to display for a week's recap — the one the takeaways are about,
 *  not the most-trained-by-volume stat. Mode of takeaway disciplines, ties
 *  broken by first occurrence; falls back to `fallback` (stats.topDiscipline)
 *  when there are no usable takeaway disciplines. */
export function deriveFocusDiscipline(
  takeaways: { discipline?: string }[] | undefined,
  fallback: string,
): string {
  const counts = new Map<string, { n: number; first: number }>();
  (takeaways ?? []).forEach((t, i) => {
    const d = (t.discipline ?? "").trim();
    if (!d) return;
    const cur = counts.get(d) ?? { n: 0, first: i };
    cur.n += 1;
    counts.set(d, cur);
  });
  let best: string | null = null;
  let bestN = 0;
  let bestFirst = Infinity;
  for (const [d, { n, first }] of counts) {
    if (n > bestN || (n === bestN && first < bestFirst)) {
      best = d; bestN = n; bestFirst = first;
    }
  }
  return best ?? fallback;
}
