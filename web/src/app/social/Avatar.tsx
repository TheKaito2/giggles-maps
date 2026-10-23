import { type AvatarLook, AvatarSvg } from "../avatar/parts";

/** A person's avatar: their built character, or a round initial in their colour until they make one. Never photos. */
export default function Avatar({ name, colour, avatar, size = 36 }: { name: string; colour: string; avatar?: AvatarLook | null; size?: number }) {
  if (avatar && Object.keys(avatar).length) return <span className="avatar built" style={{ width: size, height: size }}><AvatarSvg look={avatar} size={size} /></span>;
  return (
    <span className={`avatar c-${colour}`} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}
