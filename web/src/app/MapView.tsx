import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { type LatLng, mapPlaces, type MapPlace, type RouteStop, type Stop, type TripMember } from "../lib/api";
import { addPinIcons } from "./pinIcons";
import { colourOf, kindIdOf } from "./kinds";
import { isNight, type MapLook, offlineStyle, styleUrl } from "./mapLayers";
import { useTheme } from "../lib/theme";
import { SAKON } from "../lib/demoGps";

interface Props {
  origin: LatLng | null;
  dest: LatLng | null;
  stops: RouteStop[];
  geometry: [number, number][];
  alternates?: [number, number][][];   // the other plans' routes, drawn faint behind this one
  focus?: LatLng | null;               // fly here (a stop tapped in the list)
  estimated?: boolean;
  picking: "origin" | "dest" | null;
  onPick: (p: LatLng) => void;
  onSelectStop: (id: number) => void;
  nearby?: Stop[];        // PokéStop-style places around the user
  here?: LatLng | null;   // the user's live position
  inZone?: number[];      // stops the user is standing in the check-in zone of
  members?: TripMember[]; // ride along: trip-mates with a fresh position
  skin?: string;           // coin-shop map skin (daytime basemap)
  look?: MapLook;          // night map (Layers button)
  kinds?: string[] | null;          // Explore chip filter for the place pins (null = the default mix for the zoom)
  onPlace?: (p: MapPlace) => void;  // a place pin was tapped
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
// shared defaults: a fresh [] each render would refit the map on every GPS fix
const NO_ALTS: [number, number][][] = [];
// on phones the bottom sheet covers the map's lower part (its height is in --sheet-h): keep the route above it
const padding = () => {
  const sheet = innerWidth < 960 ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-h")) || 0 : 0;
  return { top: 70, bottom: Math.min(sheet + 30, innerHeight * 0.6), left: 40, right: 60 };
};

const pin = (cls: string, text: string, label: string) => {
  const el = document.createElement("button");
  el.className = `pin ${cls}`;
  el.textContent = text;
  el.setAttribute("aria-label", label);
  return el;
};

export default function MapView({ origin, dest, stops, geometry, alternates = NO_ALTS, focus = null, estimated = false, picking, onPick, onSelectStop,
  nearby = [], here = null, inZone = [], members = [], skin = "liberty", look = { night: "auto" }, kinds = null, onPlace }: Props) {
  const night = isNight(look.night, useTheme() === "dark");
  const [online, setOnline] = useState(navigator.onLine);
  const lookRef = useRef({ night });
  lookRef.current = { night };
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const poisRef = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const pinRequest = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const lineRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const altRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const estimatedRef = useRef(estimated);
  estimatedRef.current = estimated;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!, style: styleUrl(skin, night), center: [SAKON.lng, SAKON.lat], zoom: 13.4,
      attributionControl: { compact: true, customAttribution: "Routing: Valhalla" },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // the credits start folded into their (i) button (a short "© OpenStreetMap" stays visible, see app.css); the open
    // two-line pill sat in the middle of a phone screen
    m.once("load", () => box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    // follow the box, not just the window: the iOS app's web view settles its size after the map is made
    const sized = new ResizeObserver(() => m.resize());
    sized.observe(box.current!);
    m.on("click", (e) => { if (pickingRef.current) pickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    m.on("style.load", () => {   // also after a skin, night or offline change, which drops every source and layer
      // our own place pins replace the basemap's POI icons
      for (const l of m.getStyle().layers ?? []) if (l.id.startsWith("poi")) m.setLayoutProperty(l.id, "visibility", "none");
      // street, town and area names in English where OpenStreetMap has it (the app is in English; Thai-only labels lost
      // visitors), Thai otherwise. Road numbers and other non-name labels are left alone.
      for (const l of m.getStyle().layers ?? []) {
        if (l.type !== "symbol" || l.id.startsWith("poi")) continue;
        const field = JSON.stringify(m.getLayoutProperty(l.id, "text-field") ?? "");
        if (field.includes("name") && !field.includes("ref")) {
          m.setLayoutProperty(l.id, "text-field", ["to-string", ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]]]);
        }
      }
      m.addSource("gm-pois", { type: "geojson", data: poisRef.current });
      addPinIcons(m).then(() => {
        if (m.getLayer("gm-pois") || !m.getSource("gm-pois")) return;
        m.addLayer({ id: "gm-pois", type: "symbol", source: "gm-pois", layout: {
          "icon-image": ["concat", "k-", ["get", "icon"]], "icon-allow-overlap": false, "symbol-sort-key": ["get", "rank"],
          "text-field": ["step", ["zoom"], "", 15, ["get", "name"]], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top",
          "text-optional": true, "text-max-width": 9, "text-font": ["Noto Sans Regular"],
        }, paint: { "text-color": lookRef.current.night ? "#e3eafa" : ["get", "colour"],   // at night the kind colours were too dark to read
          "text-halo-color": lookRef.current.night ? "#1c1f26" : "#ffffff", "text-halo-width": 1.6 } }, "route-casing");
      }).catch((e) => console.error("place pin icons failed", e));
      m.addSource("alternates", { type: "geojson", data: altRef.current });
      m.addLayer({ id: "alternates", type: "line", source: "alternates", paint: { "line-color": "#8a93ad", "line-width": 5, "line-opacity": 0.45 },
        layout: { "line-cap": "round", "line-join": "round" } });
      m.addSource("route", { type: "geojson", data: lineRef.current }); // picks up a route planned before the style loaded
      m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": lookRef.current.night ? "#0b1530" : "#ffffff", "line-width": 9, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": lookRef.current.night ? "#6cb8ff" : "#0864c0", "line-width": 5 },
        layout: { "line-cap": "round", "line-join": "round" } });
      m.setPaintProperty("route", "line-dasharray", estimatedRef.current ? [2, 2] : [1, 0]);
      m.setPaintProperty("route-casing", "line-dasharray", estimatedRef.current ? [2, 2] : [1, 0]);
    });
    // load the pins for the visible box after each pan/zoom (newest request wins)
    const loadPins = () => {
      const b = m.getBounds(), id = ++pinRequest.current;
      mapPlaces(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), m.getZoom(), kindsRef.current).then((list) => {
        if (id !== pinRequest.current) return;
        poisRef.current = { type: "FeatureCollection", features: list.map((p, i) => ({ type: "Feature",
          properties: { ...p, rank: i, colour: colourOf(p.kind, p.category), icon: kindIdOf(p.kind, p.category) },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) };
        (m.getSource("gm-pois") as maplibregl.GeoJSONSource | undefined)?.setData(poisRef.current);
      }).catch(() => undefined);
    };
    let t: ReturnType<typeof setTimeout>;
    m.on("moveend", () => { clearTimeout(t); t = setTimeout(loadPins, 250); });
    m.on("load", loadPins);
    // the basemap asks for icons its sprite lacks ("office", "atm", "gate"): a blank one instead of a console warning each time
    m.on("styleimagemissing", (e) => { if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
    m.on("click", "gm-pois", (e) => {
      const f = e.features?.[0];
      if (f && !pickingRef.current) onPlaceRef.current?.(f.properties as unknown as MapPlace);
    });
    m.on("mouseenter", "gm-pois", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", "gm-pois", () => { m.getCanvas().style.cursor = pickingRef.current ? "crosshair" : ""; });
    reloadPins.current = loadPins;
    map.current = m;
    return () => { clearTimeout(t); sized.disconnect(); m.remove(); };
  }, []);
  const reloadPins = useRef<() => void>(() => undefined);
  useEffect(() => { reloadPins.current(); }, [kinds]);

  // basemap: skin by day, dark at night, a saved province pack when offline
  // ponytail: the offline pack is picked at the map centre; panning into another saved province needs a look change
  const shown = useRef(`${skin}|${night}|true`), styleRequest = useRef(0);
  useEffect(() => {
    const key = `${skin}|${night}|${online}`, m = map.current;
    if (!m || key === shown.current) return;
    const id = ++styleRequest.current, c = m.getCenter();
    (online ? Promise.resolve(null) : offlineStyle(c.lng, c.lat, night).catch(() => null)).then((offline) => {
      if (id !== styleRequest.current || map.current !== m) return;   // a newer change won, or the map is gone
      if (!online && !offline) return;   // no saved map here: keep what's on screen (cached tiles), retry when back online
      shown.current = key;
      m.setStyle(offline ?? styleUrl(skin, night), { diff: false });
    });
  }, [skin, night, online]);

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
    altRef.current = { type: "FeatureCollection", features: alternates.map((g) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: g } })) };
    (m.getSource("alternates") as maplibregl.GeoJSONSource | undefined)?.setData(altRef.current);
    (m.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineRef.current);
    if (m.getLayer("route")) {
      m.setPaintProperty("route", "line-dasharray", estimated ? [2, 2] : [1, 0]);
      m.setPaintProperty("route-casing", "line-dasharray", estimated ? [2, 2] : [1, 0]);
    }

    const pts: [number, number][] = geometry.length ? geometry : [origin, dest].filter(Boolean).map((p) => [p!.lng, p!.lat]);
    // fitBounds throws (NaN camera) when the map is shorter or narrower than its padding, e.g. a landscape phone
    const pad = padding();
    if (pts.length > 1 && m.getContainer().clientHeight > pad.top + pad.bottom + 40 && m.getContainer().clientWidth > 100) {
      const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: pad, maxZoom: 16, duration: 600 });
    }
  }, [origin, dest, stops, geometry, alternates, estimated, onSelectStop]);

  useEffect(() => {
    if (focus) map.current?.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 15), padding: padding(), duration: 700 });
  }, [focus]);

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
      // the place pins show every stop; only the ones you're standing in get a glowing check-in marker
      if (routeIds.has(s.id) || !inZone.includes(s.id)) continue;
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
