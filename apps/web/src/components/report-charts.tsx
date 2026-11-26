import { createSignal, For, onSettled, Show } from "solid-js";

import { formatMad, formatMonth } from "~/lib/format";

// Plain SVG / CSS charts for the dashboard, colored from the theme tokens. Every chart has a
// text alternative: the monthly chart's bars are labelled buttons, and the category bars are
// a list whose rows read as "label, amount, share".

export { formatMad, formatMonth };

export type MonthPoint = { month: string; moneyIn: number; moneyOut: number; net: number };

const BAR_WIDTH = 13;
const BAR_GAP = 3;
const GROUP_WIDTH = 46;
const AXIS_WIDTH = 44;
const CHART_HEIGHT = 168;
const LABEL_HEIGHT = 24;
const TOP_PAD = 8;

/** Compact axis label: 12 500 MAD -> "12.5k". */
function compact(centimes: number): string {
  const mad = Math.abs(centimes) / 100;
  if (mad >= 1_000_000) return `${(mad / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (mad >= 1000) return `${(mad / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(mad)}`;
}

export function MonthlyChart(props: {
  points: readonly MonthPoint[];
  isSelected: (month: string) => boolean;
  onSelect: (month: string) => void;
}) {
  let scroller: HTMLDivElement | undefined;
  const [available, setAvailable] = createSignal(0);
  const max = () =>
    Math.max(1, ...props.points.map((p) => Math.max(p.moneyIn, Math.abs(p.moneyOut))));
  // Months spread across the panel when they fit; past that the chart scrolls sideways.
  const groupWidth = () =>
    Math.min(
      GROUP_WIDTH * 3,
      Math.max(GROUP_WIDTH, (available() - AXIS_WIDTH) / Math.max(1, props.points.length)),
    );
  const barWidth = () => Math.min(22, Math.max(BAR_WIDTH, Math.round(groupWidth() * 0.22)));
  const plotWidth = () => Math.max(groupWidth(), props.points.length * groupWidth());
  const width = () => AXIS_WIDTH + plotWidth();
  const plotHeight = CHART_HEIGHT - TOP_PAD;
  const barHeight = (value: number) =>
    Math.max(1, Math.round((Math.abs(value) / max()) * plotHeight));
  const gridValues = () => [max(), max() / 2];

  // Start scrolled to the latest months on narrow screens.
  onSettled(() => {
    if (!scroller) return;
    const element = scroller;
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth - 8));
    observer.observe(element);
    setAvailable(element.clientWidth - 8);
    element.scrollLeft = element.scrollWidth;
    return () => observer.disconnect();
  });

  return (
    <figure>
      <div
        ref={(element) => {
          scroller = element;
        }}
        class="-mx-1 overflow-x-auto px-1 pb-1"
      >
        <svg
          viewBox={`0 0 ${width()} ${CHART_HEIGHT + LABEL_HEIGHT}`}
          width={width()}
          height={CHART_HEIGHT + LABEL_HEIGHT}
          class="block overflow-visible"
          aria-labelledby="monthly-chart-caption"
        >
          <For each={gridValues()}>
            {(value) => {
              const y = () => CHART_HEIGHT - barHeight(value);
              return (
                <g>
                  <line
                    x1={AXIS_WIDTH}
                    x2={width()}
                    y1={y()}
                    y2={y()}
                    class="stroke-rule"
                    stroke-dasharray="2 4"
                  />
                  <text
                    x={AXIS_WIDTH - 8}
                    y={y() + 4}
                    text-anchor="end"
                    class="figures fill-ink-faint text-[11px]"
                  >
                    {compact(value)}
                  </text>
                </g>
              );
            }}
          </For>
          <line
            x1={AXIS_WIDTH}
            x2={width()}
            y1={CHART_HEIGHT + 0.5}
            y2={CHART_HEIGHT + 0.5}
            class="stroke-rule-strong"
          />
          <For each={props.points}>
            {(point, index) => {
              const x = () => AXIS_WIDTH + index() * groupWidth();
              const barsX = () => x() + (groupWidth() - barWidth() * 2 - BAR_GAP) / 2;
              const inHeight = () => barHeight(point.moneyIn);
              const outHeight = () => barHeight(point.moneyOut);
              const selected = () => props.isSelected(point.month);
              return (
                <g
                  role="button"
                  tabindex="0"
                  aria-pressed={selected() ? "true" : "false"}
                  aria-label={`${formatMonth(point.month)}: in ${formatMad(point.moneyIn)}, out ${formatMad(Math.abs(point.moneyOut))}, net ${formatMad(point.net)}`}
                  class="group cursor-pointer outline-none"
                  onClick={() => props.onSelect(point.month)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onSelect(point.month);
                    }
                  }}
                >
                  <rect
                    x={x() + 2}
                    y={0}
                    width={groupWidth() - 4}
                    height={CHART_HEIGHT + LABEL_HEIGHT}
                    rx="8"
                    class={[
                      "transition-[fill] duration-200",
                      selected()
                        ? "fill-action-tint"
                        : "fill-transparent group-hover:fill-paper-sunken",
                    ]}
                  />
                  <rect
                    x={x() + 1}
                    y={1}
                    width={groupWidth() - 2}
                    height={CHART_HEIGHT + LABEL_HEIGHT - 2}
                    rx="9"
                    fill="none"
                    stroke-width="2"
                    class="stroke-action opacity-0 group-focus-visible:opacity-100"
                  />
                  <g class="transition-opacity duration-200" opacity={selected() ? 1 : 0.42}>
                    <rect
                      x={barsX()}
                      y={CHART_HEIGHT - inHeight()}
                      width={barWidth()}
                      height={inHeight()}
                      rx="3"
                      class="fill-mint"
                    />
                    <rect
                      x={barsX() + barWidth() + BAR_GAP}
                      y={CHART_HEIGHT - outHeight()}
                      width={barWidth()}
                      height={outHeight()}
                      rx="3"
                      class="fill-chart-out"
                    />
                  </g>
                  <text
                    x={x() + groupWidth() / 2}
                    y={CHART_HEIGHT + LABEL_HEIGHT - 6}
                    text-anchor="middle"
                    class={[
                      "text-[11px]",
                      selected() ? "fill-action font-medium" : "fill-ink-faint",
                    ]}
                  >
                    {formatMonth(point.month, true)}
                  </text>
                </g>
              );
            }}
          </For>
        </svg>
      </div>
      <figcaption
        id="monthly-chart-caption"
        class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-soft"
      >
        <span class="sr-only">Money in and out per month, in MAD. Select a month to view it.</span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block size-2.5 rounded-[3px] bg-mint" aria-hidden="true" /> Money in
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block size-2.5 rounded-[3px] bg-chart-out" aria-hidden="true" /> Money
          out
        </span>
        <span class="text-ink-faint">Select a month to view it</span>
      </figcaption>
    </figure>
  );
}

export type BarItem = {
  key: string;
  label: string;
  amount: number;
  color?: string | null;
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
    <ul class="space-y-3.5">
      <For each={props.items}>
        {(item) => (
          <li>
            <div class="flex items-baseline justify-between gap-3 text-sm">
              <span class="flex min-w-0 items-baseline gap-2">
                <span
                  class={`inline-block size-2.5 shrink-0 translate-y-[1px] rounded-full ${item.color ? "" : (item.barClass ?? "bg-flare")}`}
                  style={{ "background-color": item.color ?? undefined }}
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <Show when={item.href} fallback={<span dir="auto">{item.label}</span>}>
                    <a class="link" href={item.href} dir="auto">
                      {item.label}
                    </a>
                  </Show>
                  <Show when={item.note}>
                    <span class="ml-2 text-xs text-ink-faint">{item.note}</span>
                  </Show>
                </span>
              </span>
              <span class="shrink-0 text-right">
                <span class="figures font-medium">{formatMad(item.amount)}</span>
                <span class="figures ml-2 inline-block w-12 text-xs text-ink-faint">
                  {share(item.amount)}%
                </span>
              </span>
            </div>
            <div
              class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-sunken"
              aria-hidden="true"
            >
              <div
                class={`meter h-full w-full rounded-full ${item.color ? "" : (item.barClass ?? "bg-flare")}`}
                style={{
                  transform: `scaleX(${item.amount / max()})`,
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
