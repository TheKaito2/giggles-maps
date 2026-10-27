import { Capacitor, registerPlugin } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";

// The iOS app is this same web app inside a Capacitor shell. These wrappers pick the native way on the phone and keep the
// web way everywhere else, so screens call one function and never check the platform themselves.
export const isNative = Capacitor.isNativePlatform();
const SITE = "https://giggles-maps.pages.dev";   // = SITE in api.ts (not imported: api needs the Vite env, tests run without it)
export const AUTH_CALLBACK = "giggles://auth-callback";

/** A buzz for a moment in a ceremony. iPhones have no navigator.vibrate, so the app uses the Taptic Engine. */
export function buzz(kind: "shake" | "tap" | "done" | "big") {
  if (!isNative) {
    navigator.vibrate?.({ shake: [40, 60, 40, 60, 40], tap: 80, done: 120, big: [120, 60, 220] }[kind]);
    return;
  }
  if (kind === "big") { void Haptics.notification({ type: NotificationType.Success }); return; }
  if (kind === "shake") { [0, 100, 200].forEach((t) => setTimeout(() => void Haptics.impact({ style: ImpactStyle.Light }), t)); return; }
  void Haptics.impact({ style: kind === "done" ? ImpactStyle.Heavy : ImpactStyle.Medium });
}

/** Share a link. Returns false when there's nothing to share with (the caller copies the link instead). */
export async function shareLink(title: string, url: string, text?: string): Promise<boolean> {
  if (isNative) { await Share.share({ title, text, url }).catch(() => undefined); return true; }
  if (typeof navigator.share !== "function") return false;
  await navigator.share({ title, text, url }).catch(() => undefined);
  return true;
}

/** Share a link, or copy it where the device can't share. Callers say "Link copied." on "copied". */
export async function shareOrCopy(title: string, url: string, text?: string): Promise<"shared" | "copied" | "failed"> {
  if (await shareLink(title, url, text)) return "shared";
  return navigator.clipboard?.writeText(text ? `${text} ${url}` : url).then(() => "copied" as const, () => "failed" as const) ?? "failed";
}

/** Share image files (a share card, a trip album). Native: write them to the cache and hand them to the share sheet,
 *  which also has Save Image. Returns false where the browser can't share files (the caller downloads instead). */
export async function shareFiles(files: File[]): Promise<boolean> {
  if (isNative) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const uris = await Promise.all(files.map(async (f) => {
      const data = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => fail(r.error);
        r.readAsDataURL(f);
      });
      return (await Filesystem.writeFile({ path: f.name, data, directory: Directory.Cache })).uri;
    }));
    await Share.share({ files: uris }).catch(() => undefined);
    return true;
  }
  if (!navigator.canShare?.({ files })) return false;
  try { await navigator.share({ files }); } catch (e) { if ((e as Error).name !== "AbortError") return false; }   // Safari may refuse after a wait
  return true;
}

/** Download a file (web): the share sheet's Save, and where a browser can't share files. */
export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Open a page of the website (shop site, privacy): in the app that's the in-app browser, on the web a normal link. */
export function openSite(path: string) {
  if (isNative) void Browser.open({ url: SITE + path });
  else location.assign(path);
}

/** OAuth and email links can't finish inside the app's web view (Google refuses embedded views), so on the phone they
 *  open in the system browser and come back through giggles://auth-callback. */
export async function openAuth(url: string) { await Browser.open({ url, presentationStyle: "popover" }); }

/** Calls back with the query + hash of every giggles://auth-callback the app is opened with. */
export function onAuthCallback(cb: (params: URLSearchParams) => void) {
  if (!isNative) return;
  void CapApp.addListener("appUrlOpen", ({ url }) => {
    if (!url.startsWith(AUTH_CALLBACK)) return;
    const u = new URL(url);
    void Browser.close().catch(() => undefined);
    cb(new URLSearchParams(`${u.hash.slice(1)}&${u.search.slice(1)}`));
  });
}

/** iOS: calls back with each https://giggles-maps.pages.dev/app/ link the app is opened with (universal links, see
 *  public/.well-known/apple-app-site-association). The web app reads the same links from location.search instead. */
export function onSiteLink(cb: (params: URLSearchParams) => void) {
  if (!isNative) return;
  void CapApp.addListener("appUrlOpen", ({ url }) => {
    if (url.startsWith(`${SITE}/app/`)) cb(new URL(url).searchParams);
  });
}

// ── our own Swift plugins (ios/App/App/Plugins) ──
type Tx = { jws: string; id: string; product: string };
interface AttestPlugin {
  supported(): Promise<{ supported: boolean }>;
  generateKey(): Promise<{ keyId: string }>;
  attestKey(o: { keyId: string; challenge: string }): Promise<{ attestation: string }>;
  assert(o: { keyId: string; data: string }): Promise<{ assertion: string }>;
}
interface PurchasesPlugin {
  buy(o: { product: "membership" | "plus"; account?: string }): Promise<Tx | { cancelled: true } | { pending: true }>;
  finish(o: { id: string }): Promise<void>;
  pending(): Promise<{ transactions: Tx[] }>;
  restore(): Promise<{ transactions: Tx[] }>;
  addListener(e: "transaction", cb: (tx: Tx) => void): Promise<{ remove: () => Promise<void> }>;
}
interface TripPlugin {
  start(o: { destination: string; stops: { id: number; name: string; lat: number; lng: number; eta?: string }[] }): Promise<void>;
  checkedIn(o: { placeId: number }): Promise<void>;
  end(): Promise<void>;
}
interface LocationFixPlugin { current(): Promise<{ lat: number; lng: number; accuracy: number; isMock: boolean }> }
const Attest = registerPlugin<AttestPlugin>("Attest");
export const Purchases = registerPlugin<PurchasesPlugin>("Purchases");
export const Trip = registerPlugin<TripPlugin>("Trip");
const LocationFix = registerPlugin<LocationFixPlugin>("LocationFix");

/** Hand one App Store transaction to the server (apple-plus), then tell StoreKit it's delivered. Undelivered ones
 *  stay unfinished and are retried at the next launch. */
async function deliver(tx: Tx) {
  const { callFn } = await import("./supabase");
  await callFn("apple-plus", { jws: tx.jws });
  await Purchases.finish({ id: tx.id });
}
/** Buy in the iOS app. Returns false if the buyer cancelled; true once the server has it (or Ask to Buy is waiting). */
async function buyInApp(product: "membership" | "plus", account: string): Promise<boolean> {
  const r = await Purchases.buy({ product, account });
  if ("cancelled" in r) return false;
  if ("pending" in r) return true;
  await deliver(r);
  return true;
}
export async function restorePurchases(): Promise<number> {
  const { transactions } = await Purchases.restore();
  for (const tx of transactions) await deliver(tx);
  return transactions.length;
}
/** At launch: deliver anything paid for but not yet delivered, and renewals as they arrive. */
export function deliverPurchases(onDone: () => void) {
  if (!isNative) return;
  const run = (tx: Tx) => deliver(tx).then(onDone).catch((e) => console.error("purchase delivery", e));
  void Purchases.pending().then(({ transactions }) => transactions.forEach(run)).catch(() => undefined);
  void Purchases.addListener("transaction", run);
}

/** Membership or Plus: the App Store in the iOS app (guideline 3.1.1), Stripe on the web (leaves the page).
 *  Resolves true when the iOS purchase is done, false if cancelled; on the web it doesn't come back. */
export async function purchase(kind: "membership" | "plus" | "plus_year", account: string | undefined): Promise<boolean> {
  if (isNative) {
    if (!account) throw new (await import("./supabase")).ApiError("sign_in_required");
    // ponytail: StoreKit sells monthly Plus only; the app hides yearly, so a stray one buys monthly
    return buyInApp(kind === "plus_year" ? "plus" : kind, account);
  }
  const { startCheckout } = await import("./api");
  location.href = (await startCheckout({ kind })).url;
  return false;
}

/** The check-in's client block. In the iOS app it carries an App Attest assertion over the same fields the server
 *  rebuilds (`placeId|lat|lng|selfiePath`, numbers as JS prints them); no App Attest (Simulator, web) = no token. */
export async function checkinClient(placeId: number, lat: number, lng: number, selfiePath: string, demo: boolean) {
  if (!isNative) return { platform: "web" as const, demo };
  let attest: string | undefined;
  try {
    if ((await Attest.supported()).supported) {
      const keyId = await attestKey();
      const { assertion } = await Attest.assert({ keyId, data: `${placeId}|${lat}|${lng}|${selfiePath}` });
      attest = JSON.stringify({ key_id: keyId, assertion });
    }
  } catch (e) { console.error("app attest", e); }   // the server only logs attest_ok for now: check in anyway
  return { platform: "ios" as const, demo, attest };
}
const ATTEST_KEY = "gm-attest-key";
async function attestKey(): Promise<string> {
  const saved = localStorage.getItem(ATTEST_KEY);
  if (saved) return saved;
  const { callFn } = await import("./supabase");
  const { keyId } = await Attest.generateKey();
  const { challenge } = await callFn<{ challenge: string }>("app-attest", { action: "challenge" });
  const { attestation } = await Attest.attestKey({ keyId, challenge });
  await callFn("app-attest", { action: "register", key_id: keyId, challenge, attestation });
  localStorage.setItem(ATTEST_KEY, keyId);
  return keyId;
}

/**
 * In the iOS app, navigator.geolocation answers from Core Location (the Geolocation plugin), so the only prompt is the app's
 * own. WebKit's location asked a second time and named the page "localhost". Everything keeps reading navigator.geolocation;
 * call this before installDemoGps, which wraps whatever is there.
 */
export function installNativeGeolocation() {
  if (!isNative || !navigator.geolocation) return;
  const geo = navigator.geolocation;
  const asError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    const code = /denied|permission|not authori/i.test(message) ? 1 : /time ?out/i.test(message) ? 3 : 2;
    return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
  };
  const options = (o?: PositionOptions) => ({ enableHighAccuracy: !!o?.enableHighAccuracy, timeout: o?.timeout ?? 15000, maximumAge: o?.maximumAge ?? 0 });
  // the plugin's Position has the same coords fields the app reads
  geo.getCurrentPosition = (ok, fail, o) => {
    Geolocation.getCurrentPosition(options(o)).then((p) => ok(p as unknown as GeolocationPosition), (e) => fail?.(asError(e)));
  };
  // navigator's watch ids are numbers handed back at once; the plugin's are strings that arrive later
  const watches = new Map<number, Promise<string>>();
  let next = 1;
  geo.watchPosition = (ok, fail, o) => {
    const id = next++;
    watches.set(id, Geolocation.watchPosition(options(o), (p, e) => {
      if (p) ok(p as unknown as GeolocationPosition); else if (e) fail?.(asError(e));
    }));
    return id;
  };
  geo.clearWatch = (id) => {
    const w = watches.get(id);
    watches.delete(id);
    void w?.then((callbackId) => Geolocation.clearWatch({ id: callbackId })).catch(() => undefined);
  };
}

/** A check-in location: the iOS app asks Core Location, which also says whether software faked it. */
export async function checkinFix(): Promise<{ lat: number; lng: number; accuracy: number; isMock: boolean }> {
  if (isNative) return LocationFix.current();
  const pos = await new Promise<GeolocationPosition>((ok, fail) =>
    navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, isMock: false };
}

/** The trip on the Lock Screen (Live Activity) and "you're at a stop" alerts. No-ops on the web. */
export const liveTrip = {
  start(stops: { id?: number; name: string; lat: number; lng: number }[], destination: string) {
    if (isNative) void Trip.start({ destination, stops: stops.filter((s): s is typeof s & { id: number } => s.id != null) }).catch(() => undefined);
  },
  checkedIn(placeId: number) { if (isNative) void Trip.checkedIn({ placeId }).catch(() => undefined); },
  end() { if (isNative) void Trip.end().catch(() => undefined); },
};

const PURCHASE_ERR: Record<string, string> = {
  sign_in_required: "Sign in first so it stays with your account.",
  already_member: "You're already a member.",
  payments_not_configured: "Payments aren't switched on yet.",
  purchase_on_another_account: "This Apple ID bought it for another Giggles account.",
  subscription_on_another_account: "This Apple ID bought it for another Giggles account.",
};
/** What to tell the buyer when purchase() fails (ApiError codes from checkout or apple-plus). */
export const purchaseErrorText = (e: unknown) =>
  PURCHASE_ERR[(e as { code?: string } | null)?.code ?? ""] ?? "Couldn't finish the purchase. Try again.";
