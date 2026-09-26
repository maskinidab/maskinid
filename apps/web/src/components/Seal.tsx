import { useId } from "react";

/**
 * Verifieringssigillet – bara på dokument som faktiskt är utfärdade ur registret.
 * Minsta storlek 96 px. Ringen och ramen följer `text`, ID:t är alltid `id-gul`.
 */
export function Seal({ size = 112 }: { size?: number }) {
  const pathId = `sigill-bana-${useId().replace(/:/g, "")}`;
  const s = Math.max(96, size);
  return (
    <svg className="mid-sigill" width={s} height={s} viewBox="0 0 200 200" role="img" aria-label="MaskinID – verifierat registerutdrag">
      <defs>
        <path id={pathId} d="M100 100m-82 0a82 82 0 1 1 164 0a82 82 0 1 1 -164 0" />
      </defs>
      <circle className="ring" cx="100" cy="100" r="96" strokeWidth="3" />
      <circle className="ring" cx="100" cy="100" r="68" strokeWidth="1.5" />
      <text className="skrift">
        <textPath href={`#${pathId}`} textLength="512" lengthAdjust="spacing">
          MASKINID · VERIFIERAT REGISTERUTDRAG ·
        </textPath>
      </text>
      <g transform="translate(52.00 63.78) scale(0.19906)">
        <path
          className="id"
          d="M76.55 76.55L131.1 76.55L131.1 287.391L76.55 287.391L76.55 76.55ZM270.4 250.742C288.76 250.742 306.13 248.818 319.1 240.827C336.72 230.17 337.94 216.259 337.94 181.923C337.94 147.588 336.72 133.677 319.1 123.021C306.13 115.029 288.76 113.105 270.4 113.105L220.73 113.105L220.73 250.742L270.4 250.742ZM152.95 76.55L278.48 76.55C308.58 76.55 343.08 80.546 369.26 96.382C404.74 117.842 405.72 138.709 405.72 181.923C405.72 225.138 404.74 246.006 369.26 267.465C343.08 283.301 308.58 287.297 278.48 287.297L152.95 287.297L152.95 76.55Z"
        />
        <path
          className="ram"
          d="M0.000 0.000L104.000 0.000L104.000 36.550L36.550 36.550L36.550 104.000L0.000 104.000ZM482.271 0.000L378.271 0.000L378.271 36.550L445.721 36.550L445.721 104.000L482.271 104.000ZM0.000 363.941L104.000 363.941L104.000 327.391L36.550 327.391L36.550 259.941L0.000 259.941ZM482.271 363.941L378.271 363.941L378.271 327.391L445.721 327.391L445.721 259.941L482.271 259.941Z"
        />
      </g>
    </svg>
  );
}
