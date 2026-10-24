import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LatLng, type Stop, stopsNear } from "../lib/api";
import { metres } from "./nav/progress";


/**
 * PokéStop-style stops: while watching, follow the user's position, load places around them (again after moving
 * 300 m) and report the ones whose check-in zone they're standing in, unstamped landmarks first.
 */
export function useStops(refreshKey: number) {
  const [here, setHere] = useState<LatLng | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [watching, setWatching] = useState(false);
  const loadedAt = useRef<LatLng | null>(null);
  const watchId = useRef<number | null>(null);

  const [problem, setProblem] = useState("");   // why stops near you can't show (the button gave no feedback before)
  const start = useCallback(() => {
    if (watchId.current != null) return;
    if (!navigator.geolocation) { setProblem("This browser can't share your location."); return; }
    setWatching(true); setProblem("");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => { setWatching(false); watchId.current = null;
        setProblem(e.code === e.PERMISSION_DENIED ? "Location is off for Giggles Maps. Turn it on in your browser or phone settings to see stops near you."
          : "Couldn't find where you are. Try again outdoors or in a moment."); },
      { enableHighAccuracy: true, maximumAge: 10_000 });
  }, []);

  // start on its own when location was already allowed, so stops just appear
  useEffect(() => {
    navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") start(); }).catch(() => undefined);
    return () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); };
  }, [start]);

  useEffect(() => {
    if (!here || (loadedAt.current && metres(loadedAt.current, here) < 300)) return;
    loadedAt.current = here;
    stopsNear(here).then(setStops).catch(() => undefined);
  }, [here]);

  // a check-in may have stamped one: reload around the same spot
  useEffect(() => {
    if (loadedAt.current) stopsNear(loadedAt.current).then(setStops).catch(() => undefined);
  }, [refreshKey]);

  // memoised: the map redraws its nearby markers whenever these arrays change identity
  const inZone = useMemo(() => here
    ? stops.filter((s) => metres(here, s) <= s.zone_m)
        .sort((a, b) => Number(a.stamped) - Number(b.stamped) || b.tier - a.tier || metres(here, a) - metres(here, b))
    : [], [here, stops]);
  const inZoneIds = useMemo(() => inZone.map((s) => s.id), [inZone]);
  return { here, stops, inZone, inZoneIds, watching, start, problem };
}
