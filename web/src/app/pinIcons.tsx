import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type maplibregl from "maplibre-gl";
import { GROUPS, KINDS } from "./kinds";

const SIZE = 56;   // drawn at 2x, shown at 28 px

/** One Google-style pin per kind: a circle in the group colour with the kind's white icon, as map images "k-<kind>". */
export async function addPinIcons(map: maplibregl.Map) {
  const div = document.createElement("div");
  const root = createRoot(div);
  await Promise.all(Object.entries(KINDS).map(async ([id, k]) => {
    if (map.hasImage(`k-${id}`)) return;
    const Icon = k.icon;
    flushSync(() => root.render(<Icon color="#fff" size={SIZE * 0.5} strokeWidth={2.4} />));
    const img = new Image(SIZE * 0.5, SIZE * 0.5);
    const svg = div.innerHTML.includes("xmlns=") ? div.innerHTML : div.innerHTML.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d")!;
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = GROUPS[k.group].colour; g.fill();
    g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
    g.drawImage(img, SIZE * 0.25, SIZE * 0.25, SIZE * 0.5, SIZE * 0.5);
    if (!map.hasImage(`k-${id}`)) map.addImage(`k-${id}`, g.getImageData(0, 0, SIZE, SIZE), { pixelRatio: 2 });
  }));
  root.unmount();
}
