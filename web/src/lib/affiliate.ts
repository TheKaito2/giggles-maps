// Booking partner links at the destination ("Stay or do more near ..."): Agoda for hotels, Klook for activities.
// Each opens the provider's own search for the destination name, carrying our affiliate id.
// ponytail: public search deep links with the id as a query parameter. Agoda's site id is `cid`; Klook's is `aid`. Both are
// the providers' usual names, not checked against a signed-up partner account: confirm in each partner dashboard when the
// ids arrive (Klook also offers affiliate.klook.com/redirect?aid=...&k_site=<url> if the plain parameter doesn't track).
const AGODA_SEARCH = "https://www.agoda.com/search", AGODA_ID_PARAM = "cid", AGODA_QUERY_PARAM = "textToSearch";
const KLOOK_SEARCH = "https://www.klook.com/search/result/", KLOOK_ID_PARAM = "aid", KLOOK_QUERY_PARAM = "query";

/** Both links, or null when either affiliate id is missing (the row is hidden then). */
export function bookingLinks(place: string, ids: { agoda?: string; klook?: string }): { hotels: string; activities: string } | null {
  const q = place.trim();
  if (!ids.agoda || !ids.klook || !q) return null;
  return {
    hotels: `${AGODA_SEARCH}?${new URLSearchParams({ [AGODA_ID_PARAM]: ids.agoda, [AGODA_QUERY_PARAM]: q })}`,
    activities: `${KLOOK_SEARCH}?${new URLSearchParams({ [KLOOK_QUERY_PARAM]: q, [KLOOK_ID_PARAM]: ids.klook })}`,
  };
}

// set at build time (web/.env); empty = no partner links
export const AFFILIATE_IDS = {
  agoda: import.meta.env.VITE_AGODA_CID as string | undefined,
  klook: import.meta.env.VITE_KLOOK_AID as string | undefined,
};
