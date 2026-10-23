import Fortune from "./fortune/Fortune";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/supabase";
import ShareCard from "./ShareCard";
import { BILLING_TEXT, type CheckinResult, type CheckinTarget, REASON_TEXT, setPhoto, setPublicPhoto, uploadSelfie, verifyCheckin } from "../lib/api";

const TIER_NAME = { 3: "Landmark", 2: "Worth a visit", 1: "Everyday" } as const;
const CONSENT_KEY = "giggles.photoConsent.v2";   // v2: photos are kept for the passport album
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
  // a first visit earns a Siam Si shake: the ceremony opens over the result, and can be reopened until it's used
  const [fortuneOpen, setFortuneOpen] = useState(false);
  const [shaken, setShaken] = useState(false);
  const [camOk, setCamOk] = useState(true);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [caption, setCaption] = useState("");
  const [sharePublic, setSharePublic] = useState(false);   // off by default: photos stay friends-only
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (step !== "camera") return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1080 } }, audio: false })
      .then((s) => { stream.current = s; if (video.current) video.current.srcObject = s; })
      .catch(() => setCamOk(false));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, [step, facing]);

  const toCanvas = (src: CanvasImageSource, w: number, h: number) => {
    const scale = Math.min(1, 1080 / Math.max(w, h));   // album-quality photo, still small enough to upload fast
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };

  const submit = async (canvas: HTMLCanvasElement) => {
    setStep("working");
    stream.current?.getTracks().forEach((t) => t.stop());
    try {
      let lat = target.lat, lng = target.lng, accuracy = 5;
      if (!demo) {
        setStatus("Getting your location…");
        const pos = await getPosition().catch(() => { throw new Error("We need your location to check in. Allow location access and try again."); });
        ({ latitude: lat, longitude: lng, accuracy } = pos.coords);
      }
      setStatus("Uploading photo…");
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read the photo."))), "image/jpeg", 0.82));
      const path = await uploadSelfie(blob);
      setStatus("Checking…");
      const r = await verifyCheckin({
        place_id: target.id, lat, lng, accuracy_m: accuracy, selfie_path: path,
        qr_code: code.trim() || null, client: { platform: "web", demo },
      });
      if (caption.trim() && r.status !== "rejected") await setPhoto(r.checkin_id, false, caption).catch(() => undefined);
      if (sharePublic && r.status !== "rejected") await setPublicPhoto(r.checkin_id, true).catch(() => undefined);
      setResult(r);
      if (r.shake) setFortuneOpen(true);
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
            <p>Check in with one photo of the moment and your location at this place.</p>
            <ul className="fine">
              <li>Any photo: you, your friends, the view, the food. We don't analyse faces.</li>
              <li>Your photos go into your passport album. Only you can see them, and you can hide or delete any of them.</li>
              <li>You can delete your account, check-ins and photos any time in Passport.</li>
            </ul>
            <button className="btn" onClick={() => { saveConsent(); setStep("camera"); }}>I agree, open camera</button>
          </div>
        )}

        {step === "camera" && (
          <div className="stack">
            {camOk
              ? <video ref={video} className="cam" autoPlay playsInline muted />
              : <p className="fine">Camera isn't available here. Use Upload photo instead.</p>}
            <input className="text-in" value={caption} maxLength={140} placeholder="Caption (optional)" aria-label="Caption"
              onChange={(e) => setCaption(e.target.value)} />
            <label className="toggle">
              <input type="checkbox" checked={sharePublic} onChange={(e) => setSharePublic(e.target.checked)} />
              <span>Share this photo on the place page (anyone on Giggles Maps can see it; you can hide it later)</span>
            </label>
            {target.is_partner && (
              <label className="field">
                <span>Counter code <span className="fine">(under the Giggles QR sticker at the counter)</span></span>
                <input id="qr-code" className="text-in code-in" value={code} maxLength={16} autoCapitalize="characters"
                  placeholder={target.is_demo ? "DEMO" : "ABC123"} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                {target.is_demo && <span className="fine">Example shops use the code DEMO.</span>}
              </label>
            )}
            {target.is_demo && (
              <label className="toggle">
                <input id="demo-toggle" type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
                <span>Example place: simulate being here (never charges a real shop)</span>
              </label>
            )}
            <div className="row">
              {camOk && <button className="btn" onClick={capture}>Take photo</button>}
              {camOk && <button className="btn ghost" onClick={() => setFacing((f) => f === "user" ? "environment" : "user")}>Flip camera</button>}
              <label className="btn ghost">
                Upload photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        )}

        {step === "working" && <p className="working" aria-live="polite">{status}</p>}

        {step === "result" && result && (
          <div className="stack result">
            {result.stamp && (
              <div className={`stamp tier-${result.stamp.tier}`} aria-label="New stamp">
                {TIER_NAME[result.stamp.tier]}<span>{target.name}</span>
              </div>
            )}
            <p className={`verdict ${result.status}`}>
              {result.status === "approved" ? (result.stamp ? "New stamp!" : "Photo added to your passport.")
                : result.status === "review" ? "Sent for review." : "Check-in not accepted."}
            </p>
            {result.stamp?.new_province && <p className="badge-earned">New province: {result.stamp.province}!</p>}
            {result.group_bonus && <p className="badge-earned">Group bonus: +50% XP and coins with your ride-along crew</p>}
            {result.badges?.map((b) => <p key={b.slug} className="badge-earned">Badge unlocked: {b.name_en} {["", "I", "II", "III", "IV", "V"][b.tier]}</p>)}
            {result.reasons.filter((r) => r !== "already_stamped" || !result.stamp).map((r) => <p key={r} className="fine">
              {r === "level_locked" && result.required_level ? `Needs member level ${result.required_level}.` : REASON_TEXT[r] ?? r}
            </p>)}
            {result.challenges?.map((c) => (
              <p key={c.slug} className="challenge-done">✓ {c.title} <span className="num">+{c.xp} XP · +{c.coins} coins</span></p>
            ))}
            {!!result.xp_gained && (result.member
              ? <p className="xp-gain num">+{result.xp_gained} XP · {result.coins ?? 0} coins</p>
              : <p className="fine">+{result.xp_gained} XP banked. Become a member to turn XP into levels and coins.</p>)}
            {result.level_up && result.member && <p className="badge-earned">Level up! You're now level {result.level}.</p>}

            {result.status === "approved" && result.rewarded && (
              <ShareCard place={target.name} level={result.member ? result.level ?? null : null} hasPlus={hasPlus} />
            )}

            {billing && (
              <p className="fine biz">Business view: {billing}{result.billed_thb > 0 && <> (<span className="num">฿{result.billed_thb}</span>)</>}</p>
            )}
            {result.shake && !shaken && !fortuneOpen && <button className="btn gold" onClick={() => setFortuneOpen(true)}>Shake your Siam Si stick</button>}
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
      {fortuneOpen && result && <Fortune checkin={result.checkin_id} onClose={() => setFortuneOpen(false)} onShaken={() => setShaken(true)} />}
    </div>
  );
}
