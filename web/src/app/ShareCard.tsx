import { useEffect, useState } from "react";

// Story-size image to post after a check-in. Classic is free; the other three come with Giggles Plus.
const DESIGNS = {
  classic: { name: "Classic", bg: ["#e8eafb", "#ffffff"], ink: "#283593", accent: "#c0392b", plus: false },
  postcard: { name: "Postcard", bg: ["#fff2d9", "#fad9b3"], ink: "#4d260d", accent: "#bf4019", plus: true },
  neon: { name: "Night neon", bg: ["#14052e", "#4d0d59"], ink: "#ffffff", accent: "#ff4dbf", plus: true },
  indigo: { name: "Indigo cloth", bg: ["#212b73", "#0d1238"], ink: "#ffffff", accent: "#e8a317", plus: true },
} as const;
type Design = keyof typeof DESIGNS;

function draw(place: string, level: number | null, d: Design): HTMLCanvasElement {
  const { bg, ink, accent } = DESIGNS[d];
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1920;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  g.textAlign = "center";
  g.fillStyle = ink; g.font = "700 66px system-ui, sans-serif"; g.fillText("Giggles Maps", 540, 520);
  g.save(); g.translate(540, 900); g.rotate(-6 * Math.PI / 180);
  g.strokeStyle = accent; g.lineWidth = 24; g.beginPath(); g.roundRect(-430, -190, 860, 380, 60); g.stroke();
  g.fillStyle = accent; g.font = "800 160px system-ui, sans-serif"; g.fillText("STAMPED", 0, 20);
  g.font = "600 64px system-ui, sans-serif"; g.fillText(place.length > 26 ? `${place.slice(0, 25)}…` : place, 0, 130);
  g.restore();
  g.fillStyle = ink;
  if (level) { g.font = "700 66px system-ui, sans-serif"; g.fillText(`Level ${level} explorer`, 540, 1300); }
  g.globalAlpha = 0.7; g.font = "500 54px system-ui, sans-serif"; g.fillText("Sakon Nakhon · สกลนคร", 540, 1420);
  return c;
}

export default function ShareCard({ place, level, hasPlus }: { place: string; level: number | null; hasPlus: boolean }) {
  const [design, setDesign] = useState<Design>("classic");
  const [url, setUrl] = useState("");
  const locked = DESIGNS[design].plus && !hasPlus;

  useEffect(() => { setUrl(draw(place, level, locked ? "classic" : design).toDataURL("image/png")); }, [place, level, design, locked]);

  const share = async () => {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], "giggles-stamp.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Stamped at ${place}` }).catch(() => { /* closed the share sheet */ });
    } else {
      const a = document.createElement("a");
      a.href = url; a.download = file.name; a.click();
    }
  };

  return (
    <div className="share-card">
      <label className="field">
        <span>Share card</span>
        <select value={design} onChange={(e) => setDesign(e.target.value as Design)}>
          {Object.entries(DESIGNS).map(([id, d]) => <option key={id} value={id}>{d.name}{d.plus && !hasPlus ? " (Plus)" : ""}</option>)}
        </select>
      </label>
      {url && <img src={url} alt={`Share card: stamped at ${place}`} />}
      {locked && <p className="fine">Premium designs come with Giggles Plus.</p>}
      <button className="btn" onClick={share} disabled={!url}>Share</button>
    </div>
  );
}
