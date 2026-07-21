// The parts kit. Each export is one group of the character, drawn from the data in
// paths.ts and taking only what it needs to know which frame it is on.
//
// Split this way so a part can be swapped without touching the driver: the mouth
// is the only piece that changes sixty times a second, and keeping it in its own
// element is what lets React leave the rest of the head alone between renders.

import * as P from "./paths";
import type { Mouth } from "../../../lib/voice";

export function Head() {
  return (
    <>
      <path fill="currentColor" d={P.FACE} />
      <path fill="currentColor" d={P.HAIR} />
      <path fill="currentColor" d={P.NOSE} />
    </>
  );
}

/**
 * The eyes. Only the pupils move for gaze — the lids stay put, because an eye
 * whose whole shape slides is a head turning, and the head has its own transform.
 * The offset is a transform rather than new coordinates so `.face .pu` can tween
 * it; a pupil that teleports reads as a glitch, not a glance.
 */
export function Eyes({ shut, gaze }: { shut: boolean; gaze: P.Gaze }) {
  if (shut) return <path fill="currentColor" d={P.EYES_SHUT} />;
  const [dx, dy] = P.GAZE_OFFSET[gaze];
  return (
    <>
      <path fill="currentColor" d={P.EYES_OPEN} />
      <g className="pu" style={{ transform: `translate(${dx}px, ${dy}px)` }}>
        {P.PUPILS.map((p) => (
          <circle key={p.cx} fill="currentColor" cx={p.cx} cy={p.cy} r={p.r} />
        ))}
      </g>
    </>
  );
}

/** Brows carry the expression. `className` is the tween hook — see theme.css. */
export function Brows({ state }: { state: P.Brow }) {
  return <path className="br" fill="currentColor" d={P.BROWS[state]} />;
}

export function Glasses() {
  return (
    <g fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
      <circle cx="47" cy="64" r={P.GLASS_R} />
      <circle cx="73" cy="64" r={P.GLASS_R} />
      <path d={P.GLASSES} />
    </g>
  );
}

export function MouthPart({ mouth, smiling }: { mouth: Mouth; smiling: boolean }) {
  return (
    <path
      className="m"
      fill="currentColor"
      fillOpacity={P.MOUTH_FILL}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      d={P.mouthPath(mouth, smiling)}
    />
  );
}
