import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Share2 } from "lucide-react";

/** LINE-style "my QR": a link that opens the app and adds you. Phone cameras scan it, no in-app scanner needed. */
export default function QrLink({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#161b3d", light: "#ffffff" } }).then(setSrc).catch(() => setSrc("")); }, [url]);
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="qr-link">
      {src && <img src={src} width={160} height={160} alt={label} />}
      <div className="row">
        <button type="button" className="btn soft" onClick={copy}><Copy size={15} aria-hidden /> {copied ? "Copied" : "Copy link"}</button>
        {"share" in navigator && <button type="button" className="btn soft" onClick={() => navigator.share({ url, title: "Giggles Maps" }).catch(() => undefined)}>
          <Share2 size={15} aria-hidden /> Share</button>}
      </div>
    </div>
  );
}
