/**
 * Grunduppsättningen ikoner ur profilen: 24 px-rutnät, 2 px linje, raka linjeändar,
 * spetsiga hörn. Ärver textens färg. Inga fyllda ikoner.
 */
export type IconName =
  | "bock"
  | "hanglas"
  | "varning"
  | "sok"
  | "nedladdning"
  | "pil-vanster"
  | "plus"
  | "skrivare"
  | "sol"
  | "mane"
  | "meny"
  | "stang"
  | "dokument"
  | "byt"
  | "skold"
  | "logga-ut";

const PATHS: Record<IconName, React.ReactNode> = {
  bock: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  hanglas: (
    <>
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  varning: (
    <>
      <path d="M12 3.5L21 20H3z" />
      <path d="M12 10v4.5M12 17v.5" />
    </>
  ),
  sok: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  nedladdning: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  "pil-vanster": <path d="M19 12H5M11 6l-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  skrivare: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" />
      <path d="M7 14h10v6H7z" />
    </>
  ),
  sol: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  mane: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  meny: <path d="M4 7h16M4 12h16M4 17h16" />,
  stang: <path d="M6 6l12 12M18 6L6 18" />,
  dokument: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  byt: <path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" />,
  skold: <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />,
  "logga-ut": <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
