// Demo mode's pretend community: shown ONLY while demo mode is on (lib/demoGps.ts `demoOn()`), never to real users and never
// written to the database. Everything here is made up for showing the app off; ids start with "demo-" (people) or are
// negative numbers (feed items, comments) so they can never collide with real rows.
import type { AvatarLook } from "../app/avatar/parts";
import type { Look, Who } from "../lib/api";

export interface DemoPerson {
  id: string;              // "demo-01" .. "demo-40"
  nickname: string;
  colour: string;          // one of COLOURS in lib/api.ts
  avatar: AvatarLook;      // only option ids that exist in app/avatar/parts.tsx SLOTS
  look: Look;              // e.g. { flair: "marigold", theme: "lotus" } from existing shop item ids, or {}
  title: string | null;    // display title, e.g. "Temple hopper"
  xp: number;              // all-time XP
  level: number;           // levelFor(xp) from lib/api.ts
  week_xp: number;         // XP this week
  provinces: number;       // 1..77
  stamps: number;
  landmarks: number; temples: number; food: number;   // counts for the leaderboard categories (all-time)
  home: string;            // home province name_en, for flavour
  friend: boolean;         // true = one of "your" friends in demo mode
  joined: string;          // ISO date
}

/** Deterministic pseudo-random numbers from a seed (same place id = same fake reviews every time). */
export function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** How a pretend person appears next to a post, review or comment. */
export const who = (p: DemoPerson): Who => ({ id: p.id, nickname: p.nickname, colour: p.colour, avatar: p.avatar, level: p.level });
