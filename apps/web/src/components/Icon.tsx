/**
 * The profile's icon set: 24 px grid, 2 px stroke, square caps, mitred corners. Inherits text colour. Never filled.
 */
export type IconName =
  | "bock" | "hanglas" | "varning" | "sok" | "nedladdning" | "pil-vanster" | "pil-hoger" | "plus" | "skrivare" | "sol" | "mane"
  | "meny" | "stang" | "dokument" | "byt" | "skold" | "logga-ut" | "qr" | "inkorg" | "klocka" | "hem" | "maskin" | "installningar"
  | "personer" | "flagga" | "diagram" | "lank" | "kamera" | "uppladdning" | "nyckel" | "plats" | "tid" | "oga" | "chevron-ned"
  | "chevron-hoger" | "extern" | "filter" | "lista" | "bank" | "verktyg" | "bygg" | "tagg" | "kvitto" | "sigill" | "info" | "kopiera" | "penna";

const PATHS: Record<IconName, React.ReactNode> = {
  bock: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  penna: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  hanglas: (<><rect x="5" y="11" width="14" height="9" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></>),
  varning: (<><path d="M12 3.5L21 20H3z" /><path d="M12 10v4.5M12 17v.5" /></>),
  sok: (<><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>),
  nedladdning: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  "pil-vanster": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "pil-hoger": <path d="M5 12h14M13 6l6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  skrivare: (<><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" /><path d="M7 14h10v6H7z" /></>),
  sol: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>),
  mane: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  meny: <path d="M4 7h16M4 12h16M4 17h16" />,
  stang: <path d="M6 6l12 12M18 6L6 18" />,
  dokument: (<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>),
  byt: <path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4" />,
  skold: <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />,
  "logga-ut": <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />,
  qr: (<><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2M14 18v2M17 17h3v3h-3" /></>),
  inkorg: (<><path d="M4 13l2.5-8h11L20 13v6H4z" /><path d="M4 13h5l1 2h4l1-2h5" /></>),
  klocka: (<><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z" /><path d="M10 21h4" /></>),
  hem: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6" />,
  maskin: (<><path d="M3 17h11v-5H9l-2-4H3z" /><path d="M14 13l4-7 3 2-3 5" /><circle cx="6" cy="19" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>),
  installningar: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>),
  personer: (<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c.5-4 3-6 6-6s5.5 2 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c1.8.7 3 2.6 3 6" /></>),
  flagga: <path d="M5 21V4h11l-2 4 2 4H5" />,
  diagram: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  lank: <path d="M10 14l4-4M8.5 11.5L6 14a3.5 3.5 0 0 0 5 5l2.5-2.5M15.5 12.5L18 10a3.5 3.5 0 0 0-5-5l-2.5 2.5" />,
  kamera: (<><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>),
  uppladdning: <path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" />,
  nyckel: (<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></>),
  plats: (<><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
  tid: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 3" /></>),
  oga: (<><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  "chevron-ned": <path d="M6 9l6 6 6-6" />,
  "chevron-hoger": <path d="M9 6l6 6-6 6" />,
  extern: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  lista: <path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />,
  bank: <path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  verktyg: <path d="M14.5 4.5a4 4 0 0 0 5 5L12 17l-3 3-4-4 3-3 7.5-7.5a4 4 0 0 1-1-1z" />,
  bygg: <path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6" />,
  tagg: (<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>),
  kvitto: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />,
  sigill: (<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  info: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.5v.5" /></>),
  kopiera: (<><rect x="8" y="8" width="12" height="12" /><path d="M16 8V4H4v12h4" /></>),
};

export function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square"
      strokeLinejoin="miter" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} focusable="false">
      {PATHS[name]}
    </svg>
  );
}
