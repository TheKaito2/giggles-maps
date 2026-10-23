/** A round initial in the user's colour. Nicknames and colours only: no photos, no emails. */
export default function Avatar({ name, colour, size = 36 }: { name: string; colour: string; size?: number }) {
  return (
    <span className={`avatar c-${colour}`} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}
