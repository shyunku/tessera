const P = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  move: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="m12 11 3 2.5-3 2.5M8 13.5h7" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  dots: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  folderOpen: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" /><path d="M3 19 5.5 11h15.8L19 19z" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  all: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  down: <path d="M12 5v14M19 12l-7 7-7-7" />,
};

export function Icon({ name, size, style, ...rest }) {
  const s = size ? { width: size, height: size, ...style } : style;
  return (
    <svg className="ic" viewBox="0 0 24 24" style={s} aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}

// The Tessera mark: four rounded tiles turned into a diamond, one in cyan.
// Same drawing as resources/icon.svg; small sizes get wider gaps so the tiles stay apart.
const TILE_COLORS = { top: "#d3def6", left: "#7783b3", right: "#37d7dc", bottom: "#66709a" };
export function Mark({ size = 28 }) {
  const small = size <= 24;
  const s = small ? 5 : 5.4;
  const gap = small ? 1.5 : 0.9;
  const rx = small ? 0.8 : 1.1;
  const k = (s + gap) / Math.SQRT2;
  const sw = 28 / size; // one device pixel
  const tiles = [
    [14, 14 - k, TILE_COLORS.top],
    [14 - k, 14, TILE_COLORS.left],
    [14 + k, 14, TILE_COLORS.right],
    [14, 14 + k, TILE_COLORS.bottom],
  ];
  return (
    <svg className="mark" viewBox="0 0 28 28" width={size} height={size} aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="#121b3f" />
      <rect x={sw / 2} y={sw / 2} width={28 - sw} height={28 - sw} rx={7 - sw / 2} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={sw} />
      {tiles.map(([x, y, fill]) => (
        <rect key={fill} x={-s / 2} y={-s / 2} width={s} height={s} rx={rx} fill={fill} transform={`translate(${x} ${y}) rotate(45)`} />
      ))}
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <Mark />
      <b>Tessera</b>
    </div>
  );
}
