import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { LatLng, RouteStop } from "../lib/api";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const SAKON: LatLng = { lat: 17.163, lng: 104.149 };

interface Props {
  origin: LatLng | null;
  dest: LatLng | null;
  stops: RouteStop[];
  geometry: [number, number][];
  baseGeometry?: [number, number][];
  picking: "origin" | "dest" | null;
  onPick: (p: LatLng) => void;
  onSelectStop: (id: number) => void;
}

const pin = (cls: string, text: string, label: string) => {
  const el = document.createElement("button");
  el.className = `pin ${cls}`;
  el.textContent = text;
  el.setAttribute("aria-label", label);
  return el;
};

export default function MapView({ origin, dest, stops, geometry, baseGeometry = [], picking, onPick, onSelectStop }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  const lineRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });
  const baseRef = useRef<GeoJSON.FeatureCollection>({ type: "FeatureCollection", features: [] });

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!, style: STYLE, center: [SAKON.lng, SAKON.lat], zoom: 13.4,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => { if (pickingRef.current) pickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    m.on("load", () => {
      m.addSource("baseline", { type: "geojson", data: baseRef.current });
      m.addLayer({ id: "baseline", type: "line", source: "baseline", paint: { "line-color": "#777f97", "line-width": 4, "line-opacity": 0.6, "line-dasharray": [2, 2] } });
      m.addSource("route", { type: "geojson", data: lineRef.current }); // picks up a route planned before the style loaded
      m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#27348b", "line-width": 5 }, layout: { "line-cap": "round", "line-join": "round" } });
    });
    map.current = m;
    return () => m.remove();
  }, []);

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

    const pts: [number, number][] = geometry.length ? geometry : [origin, dest].filter(Boolean).map((p) => [p!.lng, p!.lat]);
    if (pts.length > 1) {
      const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: { top: 60, bottom: 60, left: 40, right: 40 }, maxZoom: 16, duration: 600 });
    }
  }, [origin, dest, stops, geometry, baseGeometry, onSelectStop]);

  return <div ref={box} className="map" role="application" aria-label="Trip map of Thailand" />;
}
