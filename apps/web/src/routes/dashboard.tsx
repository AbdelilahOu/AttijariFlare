import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, type Element, For, Show } from "solid-js";

import {
  type BarItem,
  CategoryBars,
  MonthlyChart,
  formatMad,
  formatMonth,
} from "~/components/report-charts";
import { useSession } from "~/lib/auth-client";
import { orpc } from "~/utils/orpc";

type StatementStatus = "uploaded" | "extracting" | "parsed" | "needs_review" | "failed";

const statusLabels: Record<StatementStatus, string> = {
  uploaded: "Queued",
  extracting: "Extracting",
  parsed: "Parsed",
  needs_review: "Needs review",
  failed: "Failed",
};

const statusClasses: Record<StatementStatus, string> = {
  uploaded: "bg-neutral-500/20",
  extracting: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  parsed: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  needs_review: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  failed: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
};

function StatusBadge(props: { status: StatementStatus }) {
  return (
    <span class={`rounded px-2 py-0.5 text-xs font-medium ${statusClasses[props.status]}`}>
      {statusLabels[props.status]}
    </span>
  );
}

function Card(props: { title: string; action?: Element; children: Element }) {
  return (
    <section class="space-y-3 rounded-lg border border-neutral-500/30 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const session = useSession();

  createEffect(
    () => !session().isPending && !session().data,
    (shouldRedirect) => {
      if (shouldRedirect) navigate("/login", { replace: true });
    },
  );

  return (
    <Show when={!session().isPending && session().data} fallback={<p>Loading...</p>}>
      <DashboardPage />
    </Show>
  );
}

function DashboardPage() {
  const monthly = useQuery(() => orpc.reports.monthly.queryOptions({ input: {} }));

  // The selected range; null means "the latest month with data".
  const [range, setRange] = createSignal<{ from: string; to: string } | null>(null);
  const months = () => monthly.data?.map((row) => row.month) ?? [];
  const latest = () => months()[months().length - 1];
  const selected = createMemo(() => {
    const chosen = range();
    if (chosen) return chosen;
    const month = latest();
    return month ? { from: month, to: month } : null;
  });
  const isSelected = (month: string) => {
    const r = selected();
    return !!r && month >= r.from && month <= r.to;
  };
  const selectMonth = (month: string) => setRange({ from: month, to: month });
  const setFrom = (from: string) => {
    const current = selected();
    setRange({ from, to: current && current.to >= from ? current.to : from });
  };
  const setTo = (to: string) => {
    const current = selected();
    setRange({ from: current && current.from <= to ? current.from : to, to });
  };

  const rangeTotals = createMemo(() => {
    const r = selected();
    const rows = (monthly.data ?? []).filter(
      (row) => r && row.month >= r.from && row.month <= r.to,
    );
    const moneyIn = rows.reduce((sum, row) => sum + row.moneyIn, 0);
    const moneyOut = rows.reduce((sum, row) => sum + row.moneyOut, 0);
    const withBalance = rows.filter((row) => row.closingBalance !== null);
    return {
      moneyIn,
      moneyOut,
      net: moneyIn + moneyOut,
      count: rows.reduce((sum, row) => sum + row.transactionCount, 0),
      closingBalance: withBalance[withBalance.length - 1]?.closingBalance ?? null,
    };
  });

  const rangeLabel = () => {
    const r = selected();
    if (!r) return "";
    return r.from === r.to ? formatMonth(r.from) : `${formatMonth(r.from)} to ${formatMonth(r.to)}`;
  };

  return (
    <div class="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h1 class="text-2xl font-bold">Dashboard</h1>
        <Show when={months().length > 0 && selected()}>
          {(r) => (
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <label class="flex items-center gap-1">
                From
                <MonthSelect months={months()} value={r().from} onChange={setFrom} />
              </label>
              <label class="flex items-center gap-1">
                To
                <MonthSelect months={months()} value={r().to} onChange={setTo} />
              </label>
            </div>
          )}
        </Show>
      </div>

      <Show when={monthly.isError}>
        <p class="text-sm text-rose-600">Could not load reports: {monthly.error?.message}</p>
      </Show>

      <Show
        when={monthly.data && monthly.data.length > 0}
        fallback={
          <Show when={monthly.data} fallback={<p>Loading...</p>}>
            <p class="text-sm text-neutral-500">
              No transactions yet.{" "}
              <a class="underline" href="/upload">
                Upload a statement
              </a>{" "}
              to get started.
            </p>
          </Show>
        }
      >
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Money in"
            value={formatMad(rangeTotals().moneyIn)}
            tone="text-emerald-600 dark:text-emerald-400"
          />
          <Stat
            label="Money out"
            value={formatMad(Math.abs(rangeTotals().moneyOut))}
            tone="text-rose-600 dark:text-rose-400"
          />
          <Stat label="Net" value={formatMad(rangeTotals().net)} />
          <Stat
            label="Closing balance"
            value={
              rangeTotals().closingBalance === null
                ? "-"
                : formatMad(rangeTotals().closingBalance ?? 0)
            }
          />
        </div>
        <p class="text-xs text-neutral-500">
          {rangeLabel()}: {rangeTotals().count} transactions. The closing balance comes from the
          latest statement ending in the range.
        </p>

        <Card title="Monthly totals">
          <MonthlyChart
            points={monthly.data ?? []}
            isSelected={isSelected}
            onSelect={selectMonth}
          />
          <MonthlyTable rows={monthly.data ?? []} isSelected={isSelected} onSelect={selectMonth} />
        </Card>

        <Show when={selected()}>
          {(r) => <SpendCard from={r().from} to={r().to} label={rangeLabel()} />}
        </Show>
      </Show>

      <div class="grid gap-4 md:grid-cols-2">
        <NeedsReviewCard />
        <StatementsCard />
      </div>
    </div>
  );
}

function MonthSelect(props: {
  months: string[];
  value: string;
  onChange: (month: string) => void;
}) {
  return (
    <select
      class="rounded border border-neutral-500/40 bg-transparent px-2 py-1"
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <For each={props.months}>
        {(month) => (
          <option value={month} class="text-black">
            {formatMonth(month)}
          </option>
        )}
      </For>
    </select>
  );
}

function Stat(props: { label: string; value: string; tone?: string }) {
  return (
    <div class="rounded-lg border border-neutral-500/30 p-3">
      <div class="text-xs text-neutral-500">{props.label}</div>
      <div class={`text-lg font-semibold tabular-nums ${props.tone ?? ""}`}>{props.value}</div>
    </div>
  );
}

type MonthRow = {
  month: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  transactionCount: number;
  closingBalance: number | null;
};

function MonthlyTable(props: {
  rows: readonly MonthRow[];
  isSelected: (month: string) => boolean;
  onSelect: (month: string) => void;
}) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">Monthly totals</caption>
        <thead class="border-b border-neutral-500/30 text-neutral-500">
          <tr>
            <th class="py-1 pr-2 font-medium">Month</th>
            <th class="py-1 pr-2 text-right font-medium">In</th>
            <th class="py-1 pr-2 text-right font-medium">Out</th>
            <th class="py-1 pr-2 text-right font-medium">Net</th>
            <th class="py-1 text-right font-medium">Closing balance</th>
          </tr>
        </thead>
        <tbody>
          <For each={[...props.rows].reverse()}>
            {(row) => (
              <tr
                class={`border-b border-neutral-500/20 tabular-nums ${props.isSelected(row.month) ? "bg-sky-500/10" : ""}`}
              >
                <td class="py-1 pr-2">
                  <button
                    type="button"
                    class="underline"
                    aria-pressed={props.isSelected(row.month) ? "true" : "false"}
                    onClick={() => props.onSelect(row.month)}
                  >
                    {formatMonth(row.month)}
                  </button>
                </td>
                <td class="py-1 pr-2 text-right">{formatMad(row.moneyIn)}</td>
                <td class="py-1 pr-2 text-right">{formatMad(Math.abs(row.moneyOut))}</td>
                <td class="py-1 pr-2 text-right">{formatMad(row.net)}</td>
                <td class="py-1 text-right">
                  {row.closingBalance === null ? "-" : formatMad(row.closingBalance)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function SpendCard(props: { from: string; to: string; label: string }) {
  const spend = useQuery(() =>
    orpc.reports.spendByCategory.queryOptions({ input: { from: props.from, to: props.to } }),
  );

  const items = (): BarItem[] => {
    const data = spend.data;
    if (!data) return [];
    const bars: BarItem[] = data.categories.map((category) => ({
      key: category.categoryId,
      label: category.name,
      amount: category.amount,
      color: category.color,
    }));
    if (data.unallocatedCash > 0) {
      bars.push({
        key: "unallocated-cash",
        label: "Unallocated cash",
        amount: data.unallocatedCash,
        barClass: "bg-amber-500",
        href: "/withdrawals",
        note: "split withdrawals to categorize",
      });
    }
    if (data.uncategorized > 0) {
      bars.push({
        key: "uncategorized",
        label: "Uncategorized",
        amount: data.uncategorized,
        barClass: "bg-neutral-500",
      });
    }
    return bars;
  };

  return (
    <Card
      title={`Spend by category, ${props.label}`}
      action={
        <Show when={spend.data}>
          {(data) => <span class="text-sm tabular-nums">Total {formatMad(data().total)}</span>}
        </Show>
      }
    >
      <Show when={spend.isError}>
        <p class="text-sm text-rose-600">Could not load spend: {spend.error?.message}</p>
      </Show>
      <Show when={spend.data} fallback={<p class="text-sm">Loading...</p>}>
        <Show
          when={items().length > 0}
          fallback={<p class="text-sm text-neutral-500">No spending in this period.</p>}
        >
          <CategoryBars items={items()} total={spend.data?.total ?? 0} />
        </Show>
      </Show>
    </Card>
  );
}

function StatementsCard() {
  const statements = useQuery(() => orpc.reports.statements.queryOptions());
  return (
    <Card
      title="Statements"
      action={
        <a class="text-sm underline" href="/upload">
          Upload
        </a>
      }
    >
      <Show when={statements.data} fallback={<p class="text-sm">Loading...</p>}>
        {(rows) => (
          <Show
            when={rows().length > 0}
            fallback={<p class="text-sm text-neutral-500">No statements yet.</p>}
          >
            <ol class="relative space-y-3 border-l border-neutral-500/30 pl-4">
              <For each={rows()}>
                {(statement) => (
                  <li class="relative">
                    <span
                      class="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-neutral-500"
                      aria-hidden="true"
                    />
                    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span class="font-medium tabular-nums">
                        {statement.periodStart || statement.periodEnd
                          ? `${statement.periodStart ?? "?"} to ${statement.periodEnd ?? "?"}`
                          : "Period unknown"}
                      </span>
                      <StatusBadge status={statement.status} />
                    </div>
                    <div class="text-xs text-neutral-500">
                      <span class="break-all">{statement.fileName}</span>
                      {", "}
                      {statement.transactionCount} transactions
                      <Show when={statement.closingBalance !== null}>
                        {", closing "}
                        {formatMad(statement.closingBalance ?? 0)}
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        )}
      </Show>
    </Card>
  );
}

function NeedsReviewCard() {
  const review = useQuery(() => orpc.reports.needsReview.queryOptions());
  const isEmpty = () => {
    const data = review.data;
    return (
      !!data &&
      data.statements.length === 0 &&
      data.transactions.total === 0 &&
      data.cashWithdrawals.total === 0
    );
  };

  return (
    <Card title="Needs review">
      <Show when={review.data} fallback={<p class="text-sm">Loading...</p>}>
        {(data) => (
          <Show
            when={!isEmpty()}
            fallback={<p class="text-sm text-neutral-500">Nothing to review.</p>}
          >
            <div class="space-y-4 text-sm">
              <Show when={data().statements.length > 0}>
                <ReviewSection
                  title={`Statements (${data().statements.length})`}
                  href="/upload"
                  linkLabel="Open statements"
                >
                  <For each={data().statements}>
                    {(statement) => (
                      <li class="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          <span class="break-all">{statement.fileName}</span>
                          <Show when={statement.reason}>
                            <span class="block text-xs text-neutral-500">{statement.reason}</span>
                          </Show>
                        </span>
                        <StatusBadge status={statement.status} />
                      </li>
                    )}
                  </For>
                </ReviewSection>
              </Show>

              <Show when={data().cashWithdrawals.total > 0}>
                <ReviewSection
                  title={`Cash withdrawals not fully allocated (${data().cashWithdrawals.total})`}
                  href="/withdrawals"
                  linkLabel="Split withdrawals"
                >
                  <For each={data().cashWithdrawals.items}>
                    {(row) => (
                      <li class="flex items-baseline justify-between gap-2">
                        <span class="truncate">
                          <span class="tabular-nums">{row.bookingDate}</span> {row.descriptionRaw}
                        </span>
                        <span class="shrink-0 tabular-nums">
                          {formatMad(row.remainder)} of {formatMad(Math.abs(row.amount))} left
                        </span>
                      </li>
                    )}
                  </For>
                </ReviewSection>
              </Show>

              <Show when={data().transactions.total > 0}>
                <ReviewSection
                  title={`Uncategorized or low confidence (${data().transactions.total})`}
                >
                  <For each={data().transactions.items}>
                    {(row) => (
                      <li class="flex items-baseline justify-between gap-2">
                        <span class="truncate">
                          <span class="tabular-nums">{row.bookingDate}</span> {row.descriptionRaw}
                          <span class="block text-xs text-neutral-500">
                            {row.reason === "uncategorized"
                              ? "No category"
                              : `${row.categoryName ?? "Category"}, confidence ${Math.round((row.confidence ?? 0) * 100)}%`}
                          </span>
                        </span>
                        <span class="shrink-0 tabular-nums">{formatMad(row.amount)}</span>
                      </li>
                    )}
                  </For>
                </ReviewSection>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </Card>
  );
}

function ReviewSection(props: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: Element;
}) {
  return (
    <div class="space-y-1">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-medium">{props.title}</h3>
        <Show when={props.href}>
          <a class="text-xs underline" href={props.href}>
            {props.linkLabel}
          </a>
        </Show>
      </div>
      <ul class="space-y-1">{props.children}</ul>
    </div>
  );
}
