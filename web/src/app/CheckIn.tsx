import { demoOn } from "../lib/demoGps";
import Fortune from "./fortune/Fortune";
import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { ApiError } from "../lib/supabase";
import ShareSheet, { type CardOption } from "./share/ShareSheet";
import { type Billing, type CheckinResult, type CheckinTarget, setPhoto, setPublicPhoto, uploadSelfie, verifyCheckin } from "../lib/api";
import { Spinner } from "./Skeleton";
import ProvinceStamp from "./passport/ProvinceStamp";
import { checkinClient, checkinFix } from "../lib/native";
import { useProvinces } from "./passport/useProvinces";
import { ROMAN, STAMP_TIER } from "../lib/format";
import { PhotoConsentTerms, readConsent, saveConsent } from "./PhotoConsent";

const REASON_TEXT: Record<string, string> = {
  too_far: "You're outside this place's check-in zone (150 m for landmarks and parks, 50 m elsewhere).",
  no_face: "We couldn't see a face in the selfie.",
  no_selfie: "The photo didn't upload.",
  mock_location: "Your location looks simulated.",
  speed_jump: "You moved faster than a car since your last check-in.",
  low_accuracy: "GPS was too imprecise (over 75 m) to verify you're here, so no stamp. Try again with better signal, e.g. outdoors.",
  already_rewarded_today: "Already stamped here today. Come back tomorrow.",
  already_stamped: "You already have this stamp. The photo is added to your passport.",
  level_locked: "This place is for members at a higher level.",
  slow_down: "You're stamping fast! Stamps here are paused for a bit; your photo is saved. Check in again later for the stamp.",
};

// what happened on the shop's side (shown as "Business view" for the demo)
const BILLING_TEXT: Partial<Record<Billing, string>> = {
  charged: "The shop paid its bid for this verified visit.",
  no_qr: "No counter code, so the shop isn't charged.",
  not_shown_on_route: "This shop wasn't on your route in the last 3 hours, so it isn't charged.",
  repeat_visit_30d: "Already counted for this shop in the last 30 days, so it isn't charged again.",
  wallet_empty: "The shop's credit ran out, so it isn't charged.",
  demo: "Demo mode: shops are never charged.",
};

type Step = "consent" | "camera" | "working" | "result" | "error";

interface Props { target: CheckinTarget; initialCode?: string; hasPlus: boolean; luck?: number; nickname?: string | null; onClose: () => void; onDone: (r: CheckinResult) => void }

export default function CheckIn({ target, initialCode, hasPlus, luck = 0, nickname, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>(readConsent() ? "camera" : "consent");
  const provinces = useProvinces();
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
  const [photo, setPhotoUrl] = useState("");   // the photo just taken, for the share card
  const [sharing, setSharing] = useState(false);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
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
      let lat = target.lat, lng = target.lng, accuracy = 5, isMock = false;
      if (!demo) {
        setStatus("Getting your location…");
        ({ lat, lng, accuracy, isMock } = await checkinFix().catch(() => { throw new Error("We need your location to check in. Allow location access and try again."); }));
      }
      setStatus("Uploading photo…");
      const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read the photo."))), "image/jpeg", 0.82));
      setPhotoUrl(URL.createObjectURL(blob));
      const path = await uploadSelfie(blob);
      setStatus("Checking…");
      const r = await verifyCheckin({
        place_id: target.id, lat, lng, accuracy_m: accuracy, selfie_path: path,
        qr_code: code.trim() || null,   // demo mode: the location is faked
        client: { ...await checkinClient(target.id, lat, lng, path, demo || demoOn()), is_mock: isMock },
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
    const img = new Image(), src = URL.createObjectURL(f);
    img.onload = () => { URL.revokeObjectURL(src); submit(toCanvas(img, img.naturalWidth, img.naturalHeight)); };
    img.onerror = () => { URL.revokeObjectURL(src); setError("That file isn't a photo this phone can open. Pick a JPG, PNG or HEIC picture."); setStep("error"); };
    img.src = src;
  };

  const billing = result ? BILLING_TEXT[result.billing] : undefined;
  const shareOptions = (r: CheckinResult): CardOption[] => {
    const at = new Date(), name = nickname ?? "Explorer";
    const base = { place: target.name, placeTh: null, tier: r.stamp?.tier ?? 2, province: r.stamp?.province ?? null, at,
      level: r.level ?? null };
    const list: CardOption[] = [{ id: "story", label: "Story", card: { kind: "photo", ...base, photo: photo || undefined } },
      { id: "sticker", label: "Sticker", card: { kind: "sticker", ...base } }];
    if (r.stamp?.new_province && r.stamp.province) {
      list.unshift({ id: "province", label: "New province", card: { kind: "milestone", what: "province", province: r.stamp.province, at, name } });
    }
    if (r.level_up && r.level) list.push({ id: "level", label: "Level up", card: { kind: "milestone", what: "level", level: r.level, name } });
    return list;
  };

  return (
    <>
    <Modal labelledBy="ci-title" onClose={onClose}>
        <header className="modal-head">
          <h2 id="ci-title">Check in at {target.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {step === "consent" && (
          <div className="stack">
            <p>Check in with one photo of the moment and your location at this place.</p>
            <PhotoConsentTerms />
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

        {step === "working" && <p className="working" aria-live="polite"><Spinner size={18} /> {status}</p>}

        {step === "result" && result && (
          <div className="stack result">
            {result.stamp && (
              <div className={`stamp tier-${result.stamp.tier}`} aria-label="New stamp">
                {STAMP_TIER[result.stamp.tier]}<span>{target.name}</span>
              </div>
            )}
            <p className={`verdict ${result.status}`}>
              {result.status === "approved" ? (result.stamp ? "New stamp!" : "Photo added to your passport.")
                : result.status === "review" ? "Couldn't verify your location." : "Check-in not accepted."}
            </p>
            {result.stamp?.new_province && (() => {
              const f = provinces.find((x) => x.properties.name_en === result.stamp!.province || x.id === Number(result.stamp!.province));
              return <>
                {f && <div className="checkin-province"><ProvinceStamp f={f} earnedAt={new Date().toISOString()} size={180} fresh /></div>}
                <p className="badge-earned">New province: {result.stamp!.province}!</p>
              </>;
            })()}
            {result.group_bonus && <p className="badge-earned">Group bonus: +50% XP and coins with your ride-along crew</p>}
            {result.badges?.map((b) => <p key={b.slug} className="badge-earned">Badge unlocked: {b.name_en} {ROMAN[b.tier]}</p>)}
            {result.reasons.filter((r) => r !== "already_stamped" || !result.stamp).map((r) => <p key={r} className="fine">
              {r === "level_locked" && result.required_level ? `Needs member level ${result.required_level}.` : REASON_TEXT[r] ?? r}
            </p>)}
            {result.challenges?.map((c) => (
              <p key={c.slug} className="challenge-done">✓ Quest done: {c.title}. Open its chest in Quests <span className="num">(+{c.xp} XP · +{c.coins} coins)</span></p>
            ))}
            {!!result.xp_gained && <p className="xp-gain num">+{result.xp_gained} XP · {result.coins ?? 0} coins</p>}
            {result.level_up && <p className="badge-earned">Level up! You're now level {result.level}. Pick your level reward on your Profile:
              +10% luck or +10% coins, for good.</p>}

            {result.status === "approved" && result.rewarded && (
              <button type="button" className="btn soft" onClick={() => setSharing(true)}>Share your stamp</button>
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
    </Modal>
      {sharing && result && <ShareSheet hasPlus={hasPlus} onClose={() => setSharing(false)} options={shareOptions(result)} />}
      {fortuneOpen && result && <Fortune checkin={result.checkin_id} name={nickname ?? undefined} hasPlus={hasPlus} luck={luck} onClose={() => setFortuneOpen(false)} onShaken={() => setShaken(true)} />}
    </>
  );
}
