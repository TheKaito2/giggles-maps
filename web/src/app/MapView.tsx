import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { LatLng, RouteStop, Stop, TripMember } from "../lib/api";

// map skins from the coin shop: OpenFreeMap styles
const styleUrl = (skin: string) => `https://tiles.openfreemap.org/styles/${["bright", "positron"].includes(skin) ? skin : "liberty"}`;
export const SAKON: LatLng = { lat: 17.163, lng: 104.149 };

interface Props {
  origin: LatLng | null;
  dest: LatLng | null;
  stops: RouteStop[];
  geometry: [number, number][];
  baseGeometry?: [number, number][];
  estimated?: boolean;
  picking: "origin" | "dest" | null;
  onPick: (p: LatLng) => void;
  onSelectStop: (id: number) => void;
  nearby?: Stop[];        // PokéStop-style places around the user
  here?: LatLng | null;   // the user's live position
  inZone?: number[];      // stops the user is standing in the check-in zone of
  members?: TripMember[]; // ride along: trip-mates with a fresh position
  skin?: string;
}

const pin = (cls: string, text: string, label: string) => {
  const el = document.createElement("button");
  el.className = `pin ${cls}`;
  el.textContent = text;
  el.setAttribute("aria-label", label);
  return el;
};

export default function MapView({ origin, dest, stops, geometry, baseGeometry = [], estimated = false, picking, onPick, onSelectStop,
  nearby = [], here = null, inZone = [], members = [], skin = "liberty" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const lineRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const baseRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const estimatedRef = useRef(estimated);
  estimatedRef.current = estimated;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!, style: styleUrl(skin), center: [SAKON.lng, SAKON.lat], zoom: 13.4,
      attributionControl: { compact: true, customAttribution: "Routing: Valhalla" },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => { if (pickingRef.current) pickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    m.on("style.load", () => {   // also after a skin change, which drops every source and layer
      m.addSource("baseline", { type: "geojson", data: baseRef.current });
      m.addLayer({ id: "baseline", type: "line", source: "baseline", paint: { "line-color": "#777f97", "line-width": 4, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
      m.addSource("route", { type: "geojson", data: lineRef.current }); // picks up a route planned before the style loaded
      m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#27348b", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.setPaintProperty("route", "line-dasharray", estimatedRef.current ? [2, 2] : [1, 0]);
      m.setPaintProperty("route-casing", "line-dasharray", estimatedRef.current ? [2, 2] : [1, 0]);
    });
    map.current = m;
    return () => m.remove();
  }, []);

  const firstSkin = useRef(skin);
  useEffect(() => {
    if (skin !== firstSkin.current) { firstSkin.current = skin; map.current?.setStyle(styleUrl(skin), { diff: false }); }
  }, [skin]);

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking]);

  // redraw markers + line whenever the route changes
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const add = (el: HTMLElement, p: LatLng) => markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m));
    if (origin) add(pin("start", "A", "Start"), origin);
    if (dest) add(pin("end", "B", "Destination"), dest);
    stops.forEach((s, i) => {
      const el = pin(s.is_partner ? "stop partner" : "stop", String(i + 1), `Stop ${i + 1}: ${s.name}`);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); onSelectStop(s.id); });
      add(el, s);
    });

    lineRef.current = { type: "FeatureCollection", features: geometry.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geometry } }] : [] };
    baseRef.current = { type: "FeatureCollection", features: baseGeometry.length && stops.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: baseGeometry } }] : [] };
    (m.getSource("baseline") as maplibregl.GeoJSONSource | undefined)?.setData(baseRef.current);
    (m.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineRef.current);
    if (m.getLayer("route")) {
      m.setPaintProperty("route", "line-dasharray", estimated ? [2, 2] : [1, 0]);
      m.setPaintProperty("route-casing", "line-dasharray", estimated ? [2, 2] : [1, 0]);
    }

    const pts: [number, number][] = geometry.length ? geometry : [origin, dest].filter(Boolean).map((p) => [p!.lng, p!.lat]);
    if (pts.length > 1) {
      const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: { top: 60, bottom: 60, left: 40, right: 40 }, maxZoom: 16, duration: 600 });
    }
  }, [origin, dest, stops, geometry, baseGeometry, estimated, onSelectStop]);

  // nearby stops + "you are here": their own markers, so moving around never refits the map
  const nearbyMarkers = useRef<maplibregl.Marker[]>([]);
  const centred = useRef(false);   // fly to the user once, on their first position fix
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    nearbyMarkers.current.forEach((mk) => mk.remove());
    nearbyMarkers.current = [];
    const routeIds = new Set(stops.map((s) => s.id));
    for (const s of nearby) {
      if (routeIds.has(s.id)) continue;   // route stops already have a numbered pin
      const el = document.createElement("span");
      el.className = `stop-dot tier-${s.tier}${inZone.includes(s.id) ? " in-zone" : ""}${s.stamped ? " stamped" : ""}`;
      el.title = s.name;
      nearbyMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }
    if (here && !centred.current) { centred.current = true; m.flyTo({ center: [here.lng, here.lat], zoom: 15.5, duration: 900 }); }
    if (here) {
      const me = document.createElement("span");
      me.className = "me-dot";
      me.setAttribute("aria-label", "You are here");
      nearbyMarkers.current.push(new maplibregl.Marker({ element: me }).setLngLat([here.lng, here.lat]).addTo(m));
    }
  }, [nearby, here, inZone, stops]);

  const memberMarkers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    memberMarkers.current.forEach((mk) => mk.remove());
    memberMarkers.current = members.filter((p) => !p.me && p.lat != null && p.lng != null).map((p) => {
      const el = document.createElement("span");
      el.className = `member-dot c-${p.colour}`;
      el.textContent = [...p.nickname][0]?.toUpperCase() ?? "?";
      el.title = p.nickname;
      el.setAttribute("aria-label", `${p.nickname} is here`);
      return new maplibregl.Marker({ element: el }).setLngLat([p.lng!, p.lat!]).addTo(m);
    });
  }, [members]);

  return <div ref={box} className="map" role="application" aria-label="Trip map of Thailand" />;
}
