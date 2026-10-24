// Loading placeholders shaped like what's coming (lists, cards, tiles, a page), and a small spinner for short waits on an
// action (saving, checking in, finding a route). Screen readers hear one "Loading" per placeholder, not every bar.

const Bar = ({ w = "100%", h = 12, round = false }: { w?: string | number; h?: number; round?: boolean }) =>
  <span className={`skel${round ? " round" : ""}`} style={{ width: w, height: h }} />;

/** A few lines of text. */
export function SkelLines({ n = 3 }: { n?: number }) {
  return <div className="skel-lines" role="status" aria-label="Loading">{Array.from({ length: n }, (_, i) => <Bar key={i} w={i === n - 1 ? "60%" : "100%"} />)}</div>;
}

/** List rows: an avatar or picture, a name and a detail line (people, quests, comments, leaderboard rows). */
export function SkelRows({ n = 4, avatar = 40, square = false }: { n?: number; avatar?: number; square?: boolean }) {
  return (
    <ul className="skel-rows" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i}>
          {avatar > 0 && <Bar w={avatar} h={avatar} round={!square} />}
          <span className="skel-text"><Bar w={`${55 + ((i * 17) % 30)}%`} h={13} /><Bar w={`${35 + ((i * 11) % 25)}%`} h={10} /></span>
        </li>
      ))}
    </ul>
  );
}

/** Feed posts: who, what, and a big picture. */
export function SkelPosts({ n = 2 }: { n?: number }) {
  return (
    <ul className="skel-posts" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i}>
          <span className="skel-head"><Bar w={44} h={44} round /><span className="skel-text"><Bar w="70%" h={13} /><Bar w="25%" h={10} /></span></span>
          <Bar h={180} />
        </li>
      ))}
    </ul>
  );
}

/** A grid of tiles (shop items, cards). */
export function SkelTiles({ n = 6, h = 150, min = 130 }: { n?: number; h?: number; min?: number }) {
  return (
    <ul className="skel-tiles" role="status" aria-label="Loading" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => <li key={i}><Bar h={h} /></li>)}
    </ul>
  );
}

/** One block (a hero, a picture, a map). */
export function SkelBlock({ h = 120, radius = 18 }: { h?: number; radius?: number }) {
  return <span className="skel skel-block" role="status" aria-label="Loading" style={{ height: h, borderRadius: radius }} />;
}

/** Top-3 podium plus a few rows. */
export function SkelBoard() {
  return (
    <div className="skel-board" role="status" aria-label="Loading">
      <div className="skel-podium">{[60, 76, 60].map((s, i) => <span key={i}><Bar w={s} h={s} round /><Bar w={56} h={10} /><Bar w={80} h={[52, 72, 40][i]} /></span>)}</div>
      <SkelRows n={3} />
    </div>
  );
}

/** A profile page: hero, showcase, quick buttons, stats. */
export function SkelProfile() {
  return (
    <div className="page-col stack" role="status" aria-label="Loading">
      <SkelBlock h={200} radius={24} />
      <SkelTiles n={3} h={110} min={90} />
      <SkelTiles n={4} h={64} min={64} />
      <SkelBlock h={120} />
    </div>
  );
}

/** A place page: picture, name, buttons, details. */
export function SkelPlace() {
  return (
    <div className="skel-place" role="status" aria-label="Loading">
      <Bar h={170} />
      <Bar w="65%" h={22} /><Bar w="40%" h={12} />
      <span className="skel-buttons">{[0, 1, 2, 3].map((i) => <Bar key={i} w={64} h={52} />)}</span>
      <SkelLines n={4} />
    </div>
  );
}

/** A small spinner for a short wait on an action. */
export const Spinner = ({ size = 16 }: { size?: number }) =>
  <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
