/**
 * Human-readable label for a past run time (e.g. "today at 3:45 PM").
 */
export function formatExecutedAtLabel(iso: string | undefined | null, now = new Date()): string {
  if (!iso || typeof iso !== "string") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (day.getTime() === today.getTime()) {
    return `today at ${timeStr}`;
  }
  if (day.getTime() === yest.getTime()) {
    return `yesterday at ${timeStr}`;
  }

  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
