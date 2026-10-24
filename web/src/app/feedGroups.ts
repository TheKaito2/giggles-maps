import type { FeedItem } from "../lib/api";

/** One feed card: a single item, or a day of one person's stamps (newest first; reactions and comments go on items[0]). */
export interface FeedGroup { key: string; items: FeedItem[] }

const bangkokDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Merge a person's stamps from one Bangkok day into one card (Strava-style), placed where the newest one was. Badges and quests in between stay single. */
export function groupFeed(items: FeedItem[]): FeedGroup[] {
  const out: FeedGroup[] = [];
  const days = new Map<string, FeedGroup>();
  for (const it of items) {
    const day = it.kind === "stamp" ? `${it.who.id}|${bangkokDay(it.at)}` : null;
    const g = day ? days.get(day) : undefined;
    if (g) { g.items.push(it); continue; }
    const fresh = { key: String(it.id), items: [it] };
    if (day) days.set(day, fresh);
    out.push(fresh);
  }
  return out;
}
