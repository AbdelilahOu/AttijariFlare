import { For } from "solid-js";

// Fine-line rosette in the manner of banknote security printing. Each band is a set of
// closed curves r(t) = radius + amplitude * sin(lobes * t + phase), drawn with hairlines so
// the overlapping phases weave. Paths are computed once at module load.

type Band = { radius: number; amplitude: number; lobes: number; curves: number; steps: number };

const BANDS: Band[] = [
  { radius: 96, amplitude: 9, lobes: 18, curves: 4, steps: 216 },
  { radius: 68, amplitude: 11, lobes: 12, curves: 3, steps: 168 },
  { radius: 38, amplitude: 9, lobes: 8, curves: 3, steps: 112 },
];

function curve(band: Band, phase: number): string {
  let d = "";
  for (let i = 0; i <= band.steps; i++) {
    const t = (i / band.steps) * Math.PI * 2;
    const r = band.radius + band.amplitude * Math.sin(band.lobes * t + phase);
    const x = (r * Math.cos(t)).toFixed(1);
    const y = (r * Math.sin(t)).toFixed(1);
    d += `${i === 0 ? "M" : "L"}${x} ${y}`;
  }
  return `${d}Z`;
}

const PATHS: string[] = BANDS.flatMap((band) =>
  Array.from({ length: band.curves }, (_, index) =>
    curve(band, (index / band.curves) * Math.PI * 2),
  ),
);

export default function Guilloche(props: { class?: string; draw?: boolean }) {
  return (
    <svg
      viewBox="-112 -112 224 224"
      fill="none"
      stroke="currentColor"
      stroke-width="0.6"
      class={`${props.draw ? "guilloche-draw" : ""} ${props.class ?? ""}`}
      aria-hidden="true"
    >
      <For each={PATHS}>
        {(d, index) => (
          <path
            d={d}
            pathLength="1"
            style={props.draw ? { "animation-delay": `${index() * 70}ms` } : undefined}
          />
        )}
      </For>
      <circle r="106" stroke-width="0.4" />
      <circle r="24" stroke-width="0.4" />
    </svg>
  );
}
