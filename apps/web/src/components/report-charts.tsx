import { centimesToMad } from "@finance-ttijari/api/allocations/money";
import { For, Show } from "solid-js";

// Plain SVG / CSS charts for the dashboard. Colors are mid tones that read on light
// and dark backgrounds; every chart has a text alternative (aria-label or table).

/** Centimes as "1 234.50 MAD" (space thousands separator, as on Attijari statements). */
export function formatMad(centimes: number): string {
  const [whole = "0", fraction = "00"] = centimesToMad(centimes).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}.${fraction} MAD`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-03" -> "Mar 2026" (or "Mar" when `short`). */
export function formatMonth(month: string, short = false): string {
  const [year, mon] = month.split("-");
  const name = MONTH_NAMES[Number(mon) - 1] ?? mon;
  return short ? `${name}` : `${name} ${year}`;
}

export type MonthPoint = { month: string; moneyIn: number; moneyOut: number; net: number };

const BAR_WIDTH = 14;
const GROUP_GAP = 14;
const CHART_HEIGHT = 140;
const LABEL_HEIGHT = 18;

/**
 * Paired bars per month: money in (up) and money out (down from the same baseline would
 * hide small months, so both grow upward side by side). Selected months are highlighted.
 */
export function MonthlyChart(props: {
  points: readonly MonthPoint[];
  isSelected: (month: string) => boolean;
  onSelect: (month: string) => void;
}) {
  const max = () =>
    Math.max(1, ...props.points.map((p) => Math.max(p.moneyIn, Math.abs(p.moneyOut))));
  const groupWidth = BAR_WIDTH * 2 + GROUP_GAP;
  const width = () => Math.max(groupWidth, props.points.length * groupWidth);
  const barHeight = (value: number) => Math.round((Math.abs(value) / max()) * (CHART_HEIGHT - 4));
  const label = () =>
    props.points
      .map(
        (p) =>
          `${formatMonth(p.month)}: in ${formatMad(p.moneyIn)}, out ${formatMad(Math.abs(p.moneyOut))}`,
      )
      .join("; ");

  return (
    <div class="overflow-x-auto">
      <svg
        role="img"
        aria-label={`Money in and out per month. ${label()}`}
        viewBox={`0 0 ${width()} ${CHART_HEIGHT + LABEL_HEIGHT}`}
        width={width()}
        height={CHART_HEIGHT + LABEL_HEIGHT}
        class="block"
      >
        <line
          x1="0"
          x2={width()}
          y1={CHART_HEIGHT}
          y2={CHART_HEIGHT}
          class="stroke-neutral-500/40"
          stroke-width="1"
        />
        <For each={props.points}>
          {(point, index) => {
            const x = () => index() * groupWidth + GROUP_GAP / 2;
            const inHeight = () => barHeight(point.moneyIn);
            const outHeight = () => barHeight(point.moneyOut);
            return (
              <g
                class="cursor-pointer"
                opacity={props.isSelected(point.month) ? 1 : 0.45}
                onClick={() => props.onSelect(point.month)}
              >
                <title>
                  {`${formatMonth(point.month)}\nIn ${formatMad(point.moneyIn)}\nOut ${formatMad(Math.abs(point.moneyOut))}\nNet ${formatMad(point.net)}`}
                </title>
                <rect
                  x={x() - GROUP_GAP / 2}
                  y={0}
                  width={groupWidth}
                  height={CHART_HEIGHT + LABEL_HEIGHT}
                  fill="transparent"
                />
                <rect
                  x={x()}
                  y={CHART_HEIGHT - inHeight()}
                  width={BAR_WIDTH}
                  height={inHeight()}
                  rx="2"
                  class="fill-emerald-500"
                />
                <rect
                  x={x() + BAR_WIDTH}
                  y={CHART_HEIGHT - outHeight()}
                  width={BAR_WIDTH}
                  height={outHeight()}
                  rx="2"
                  class="fill-rose-500"
                />
                <text
                  x={x() + BAR_WIDTH}
                  y={CHART_HEIGHT + LABEL_HEIGHT - 4}
                  text-anchor="middle"
                  class="fill-current text-[10px]"
                >
                  {formatMonth(point.month, true)}
                </text>
              </g>
            );
          }}
        </For>
      </svg>
      <div class="mt-1 flex gap-4 text-xs text-neutral-500">
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Money in
        </span>
        <span class="flex items-center gap-1">
          <span class="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> Money out
        </span>
      </div>
    </div>
  );
}

export type BarItem = {
  key: string;
  label: string;
  amount: number;
  color?: string | null;
  /** Tailwind background class used when no color is given. */
  barClass?: string;
  href?: string;
  note?: string;
};

/** Horizontal bars as a list; each row reads as "label, amount, share" for screen readers. */
export function CategoryBars(props: { items: readonly BarItem[]; total: number }) {
  const max = () => Math.max(1, ...props.items.map((item) => item.amount));
  const share = (amount: number) =>
    props.total > 0 ? Math.round((amount / props.total) * 1000) / 10 : 0;

  return (
    <ul class="space-y-2">
      <For each={props.items}>
        {(item) => (
          <li>
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="truncate">
                <Show when={item.href} fallback={item.label}>
                  <a class="underline" href={item.href}>
                    {item.label}
                  </a>
                </Show>
                <Show when={item.note}>
                  <span class="ml-2 text-xs text-neutral-500">{item.note}</span>
                </Show>
              </span>
              <span class="shrink-0 tabular-nums">
                {formatMad(item.amount)}{" "}
                <span class="text-xs text-neutral-500">{share(item.amount)}%</span>
              </span>
            </div>
            <div
              class="mt-1 h-2 w-full overflow-hidden rounded bg-neutral-500/15"
              aria-hidden="true"
            >
              <div
                class={`h-full rounded ${item.color ? "" : (item.barClass ?? "bg-sky-500")}`}
                style={{
                  width: `${(item.amount / max()) * 100}%`,
                  "background-color": item.color ?? undefined,
                }}
              />
            </div>
          </li>
        )}
      </For>
    </ul>
  );
}
