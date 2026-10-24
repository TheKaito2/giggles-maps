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

/** One line of text at a type size (or the surrounding one), keeping the surrounding line height like the real text does:
 *  as tall as the real line, with a bar in it. */
const T = ({ w = "100%", fs }: { w?: string | number; fs?: string }) =>
  <span className="skel-txt" style={{ width: w, ...(fs && { fontSize: `var(--fs-${fs})` }) }}><span className="skel" /></span>;
const many = (n: number) => Array.from({ length: n }, (_, i) => i);

// The placeholders below are built from the real screens' own classes, so they take the same space as what replaces them.

/** Feed posts: who, what happened, and the reaction row. */
export function SkelPosts({ n = 2 }: { n?: number }) {
  return (
    <ul className="feed" role="status" aria-label="Loading">
      {many(n).map((i) => (
        <li key={i} className="feed-item">
          <header><Bar w={44} h={44} round /><span className="person-main"><T w="70%" /><T w="25%" fs="caption" /></span></header>
          <div className="feed-body"><Bar w={64} h={64} round /><T w="40%" fs="label" /></div>
          <footer className="feed-react">{many(3).map((j) => <Bar key={j} w={52} h={36} />)}</footer>
        </li>
      ))}
    </ul>
  );
}

/** Quest rows: chest, name, progress bar, reward. */
export function SkelQuests({ n = 3 }: { n?: number }) {
  return (
    <ul className="quest-list" role="status" aria-label="Loading">
      {many(n).map((i) => (
        <li key={i} className="quest">
          <Bar w={44} h={39} />
          <div className="quest-main"><T w="60%" /><T w="40%" fs="caption" /><span className="quest-bar" /></div>
          <span className="quest-reward"><T w={52} /><T w={52} /></span>
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
    <div className="stack" role="status" aria-label="Loading">
      <ol className="podium">
        {[2, 1, 3].map((r) => (
          <li key={r} className={`place-${r}`}>
            <div className="podium-who"><Bar w={r === 1 ? 76 : 60} h={r === 1 ? 76 : 60} round /><T w={64} /><T w={48} fs="caption" /></div>
            <span className="podium-block skel" />
          </li>
        ))}
      </ol>
      <ol className="board">
        {many(3).map((i) => (
          <li key={i} className="board-row">
            <span className="rank" /><Bar w={40} h={40} round />
            <span className="person-main"><T w="45%" /><T w="65%" fs="caption" /></span><T w={56} fs="label" />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Province champion cards. */
export function SkelChamps() {
  return (
    <ul className="champ-row" role="status" aria-label="Loading">
      {many(3).map((i) => <li key={i} className="champ"><Bar w={72} h={72} round /><T w="70%" fs="label" /><T w="60%" fs="caption" /><T w="80%" fs="caption" /></li>)}
    </ul>
  );
}

/** A profile page: hero in the cover colours, showcase, quick buttons, stats. */
export function SkelProfile({ theme = "classic", self = true }: { theme?: string; self?: boolean }) {
  return (
    <div className="stack profile" role="status" aria-label="Loading">
      <header className={`profile-hero cover-bg theme-${theme} skel-hero`}>
        <Bar w={112} h={112} round />
        <span className="profile-id"><T w="55%" fs="display" /><T w="80%" fs="label" /><T w="60%" fs="caption" /></span>
      </header>
      <section className="showcase">
        {many(3).map((i) => <span key={i} className="show-pin"><Bar w={54} h={54} round /><T w="70%" fs="caption" /><T w="40%" fs="caption" /></span>)}
      </section>
      <div className="profile-actions">{many(self ? 5 : 2).map((i) => <span key={i}><Bar w={24} h={24} /><T w="60%" fs="caption" /></span>)}</div>
      <ul className="stat-strip">{many(6).map((i) => <li key={i}><T w={44} fs="headline" /><T w={60} fs="caption" /></li>)}</ul>
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
