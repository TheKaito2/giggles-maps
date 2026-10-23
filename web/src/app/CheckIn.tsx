import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/supabase";
import ShareCard from "./ShareCard";
import { BILLING_TEXT, type CheckinResult, type CheckinTarget, REASON_TEXT, uploadSelfie, verifyCheckin } from "../lib/api";

const CONSENT_KEY = "giggles.selfieConsent.v1";
const readConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === "yes"; } catch { return false; } };
const saveConsent = () => { try { localStorage.setItem(CONSENT_KEY, "yes"); } catch { /* storage blocked: ask again next time */ } };

type Step = "consent" | "camera" | "working" | "result" | "error";

const getPosition = () => new Promise<GeolocationPosition>((ok, fail) =>
  navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));

interface Props { target: CheckinTarget; initialCode?: string; hasPlus: boolean; onClose: () => void; onDone: (r: CheckinResult) => void }

export default function CheckIn({ target, initialCode, hasPlus, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>(readConsent() ? "camera" : "consent");
  const [demo, setDemo] = useState(false);
  const [code, setCode] = useState(initialCode ?? "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [camOk, setCamOk] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (step !== "camera") return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: false })
      .then((s) => { stream.current = s; if (video.current) video.current.srcObject = s; })
      .catch(() => setCamOk(false));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [step]);

  const toCanvas = (src: CanvasImageSource, w: number, h: number) => {
    const scale = Math.min(1, 720 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };

  const submit = async (canvas: HTMLCanvasElement) => {
    setStep("working");
    stream.current?.getTracks().forEach((t) => t.stop());
    try {
      setStatus("Looking for a face…");
      const { countFaces } = await import("../lib/face"); // load the face model only when needed
      const faces = await countFaces(canvas);
      let lat = target.lat, lng = target.lng, accuracy = 5;
      if (!demo) {
        setStatus("Getting your location…");
        const pos = await getPosition().catch(() => { throw new Error("We need your location to check in. Allow location access and try again."); });
        ({ latitude: lat, longitude: lng, accuracy } = pos.coords);
      }
      setStatus("Uploading selfie…");
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read the photo."))), "image/jpeg", 0.82));
      const path = await uploadSelfie(blob);
      setStatus("Checking…");
      const r = await verifyCheckin({
        place_id: target.id, lat, lng, accuracy_m: accuracy, selfie_path: path, face_count: faces,
        qr_code: code.trim() || null, client: { platform: "web", demo },
      });
      setResult(r);
      setStep("result");
      onDone(r);
    } catch (e) {
      setError(e instanceof ApiError ? "Check-in failed. Try again in a moment." : (e as Error).message);
      setStep("error");
    }
  };

  const capture = () => {
    const v = video.current!;
    submit(toCanvas(v, v.videoWidth, v.videoHeight));
  };

  const fromFile = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => submit(toCanvas(img, img.naturalWidth, img.naturalHeight));
    img.src = URL.createObjectURL(f);
  };

  const billing = result ? BILLING_TEXT[result.billing] : undefined;

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="ci-title">
      <div className="modal">
        <header className="modal-head">
          <h2 id="ci-title">Check in at {target.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {step === "consent" && (
          <div className="stack">
            <p>To stamp your passport we take one selfie and your location at this place.</p>
            <ul className="fine">
              <li>We only check that a face is in the photo. No face recognition.</li>
              <li>Your selfie is private and deleted automatically after 30 days.</li>
              <li>You can delete your account and all check-ins any time in Passport.</li>
            </ul>
            <button className="btn" onClick={() => { saveConsent(); setStep("camera"); }}>I agree, open camera</button>
          </div>
        )}

        {step === "camera" && (
          <div className="stack">
            {camOk
              ? <video ref={video} className="cam" autoPlay playsInline muted />
              : <p className="fine">Camera isn't available here. Take a selfie with your phone camera instead.</p>}
            {target.is_partner && (
              <label className="field">
                <span>Counter code <span className="fine">(under the Giggles QR sticker at the counter)</span></span>
                <input id="qr-code" className="text-in code-in" value={code} maxLength={16} autoCapitalize="characters"
                  placeholder={target.is_demo ? "DEMO" : "ABC123"} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                {target.is_demo && <span className="fine">Example shops use the code DEMO.</span>}
              </label>
            )}
            <label className="toggle">
              <input id="demo-toggle" type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
              <span>I'm not in Sakon Nakhon: simulate being here (never charges a real shop)</span>
            </label>
            <div className="row">
              {camOk && <button className="btn" onClick={capture}>Take selfie</button>}
              <label className="btn ghost">
                Upload photo
                <input type="file" accept="image/*" capture="user" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        )}

        {step === "working" && <p className="working" aria-live="polite">{status}</p>}

        {step === "result" && result && (
          <div className="stack result">
            {result.status === "approved" && result.rewarded && (
              <div className="stamp" aria-label="Stamped">STAMPED<span>{target.name}</span></div>
            )}
            <p className={`verdict ${result.status}`}>
              {result.status === "approved" ? (result.rewarded ? "Checked in!" : "Checked in, no new stamp.")
                : result.status === "review" ? "Sent for review." : "Check-in not accepted."}
            </p>
            {result.reasons.map((r) => <p key={r} className="fine">
              {r === "level_locked" && result.required_level ? `Needs member level ${result.required_level}.` : REASON_TEXT[r] ?? r}
            </p>)}
            {!!result.xp_gained && <p className="xp-gain num">+{result.xp_gained} XP</p>}
            {result.level_up && <p className="badge-earned">{result.member
              ? `Level up! You're now level ${result.level}.`
              : `Level ${result.level} banked. Become a member to unlock it.`}</p>}
            {result.new_badges.map((b) => <p key={b.slug} className="badge-earned">New badge: {b.name}</p>)}

            {result.spin && (
              <div className={`spin ${result.spin.won ? "won" : ""}`}>
                <span className="spin-label">Free spin</span>
                {result.spin.won
                  ? <>
                      <b>{result.spin.title}</b>
                      <span className="fine">at {result.spin.place}</span>
                      <span className="coupon-code num">{result.spin.code}</span>
                      <span className="fine">Show this code at the counter. Chance of this prize: {Math.round(result.spin.odds * 100)}%.</span>
                    </>
                  : <span>No prize this time. Every spin has a 50% chance to win a nearby coupon.</span>}
              </div>
            )}

            {result.status === "approved" && result.rewarded && (
              <ShareCard place={target.name} level={result.member ? result.level ?? null : null} hasPlus={hasPlus} />
            )}

            {billing && (
              <p className="fine biz">Business view: {billing}{result.billed_thb > 0 && <> (<span className="num">฿{result.billed_thb}</span>)</>}</p>
            )}
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        )}

        {step === "error" && (
          <div className="stack">
            <p className="verdict rejected">{error}</p>
            <button className="btn" onClick={() => setStep("camera")}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
