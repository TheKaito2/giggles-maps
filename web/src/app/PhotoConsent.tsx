// The photo consent (PDPA), asked once before the first photo: a check-in or a nominated shop (AddPlace).
const CONSENT_KEY = "giggles.photoConsent.v3";   // v2: photos are kept for the passport album; v3: who sees them, how long
export const readConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === "yes"; } catch { return false; } };
export const saveConsent = () => { try { localStorage.setItem(CONSENT_KEY, "yes"); } catch { /* storage blocked: ask again next time */ } };

export function PhotoConsentTerms() {
  return (
    <ul className="fine">
      <li>We check that you're inside this place's check-in zone (50 m, or 150 m for landmarks and parks).</li>
      <li>Any photo: you, your friends, the view, the food. We don't analyse faces.</li>
      <li>Your photos go into your passport album. Your friends can see them, and so can trip-mates for photos from a ride-along together.</li>
      <li>Photos of check-ins that aren't accepted are deleted after 30 days. The rest are kept until you delete your account (Profile → Settings → Delete account); to remove one photo, email kristpaulm@gmail.com.</li>
      <li>A photo of a shop you nominate isn't shown to anyone else: it helps us check the place, and it's deleted 30 days after the nomination goes live, expires or is turned down.</li>
    </ul>
  );
}
