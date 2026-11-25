import { useQuery } from "@tanstack/solid-query";
import type { IconNode } from "lucide";
import {
  Banknote,
  CircleCheck,
  FileSearch,
  FileText,
  FileUp,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide";
import { createMemo, createSignal, type Element, For, Show } from "solid-js";

import Guilloche from "~/components/guilloche";
import Icon from "~/components/icon";
import { type BarItem, CategoryBars, MonthlyChart } from "~/components/report-charts";
import {
  EmptyState,
  ErrorNotice,
  Money,
  PageHeader,
  RequireSession,
  Section,
  SkeletonRows,
  StatusBadge,
} from "~/components/ui";
import { formatDayMonth, formatMad, formatMonth, formatPeriod, plural } from "~/lib/format";
import { orpc } from "~/utils/orpc";

export default function Dashboard() {
  return (
    <RequireSession>
      <DashboardPage />
    </RequireSession>
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
    <div class="space-y-10">
      <PageHeader
        title="Dashboard"
        actions={
          <Show when={months().length > 0 && selected()}>
            {(r) => (
              <div class="flex items-end gap-2">
                <label class="w-36">
                  <span class="field-label">From</span>
                  <MonthSelect months={months()} value={r().from} onChange={setFrom} />
                </label>
                <label class="w-36">
                  <span class="field-label">To</span>
                  <MonthSelect months={months()} value={r().to} onChange={setTo} />
                </label>
              </div>
            )}
          </Show>
        }
      />

      <Show when={monthly.isError}>
        <ErrorNotice title="Could not load reports" message={monthly.error?.message} />
      </Show>

      <Show
        when={monthly.data && monthly.data.length > 0}
        fallback={
          <Show when={monthly.data} fallback={<SkeletonRows rows={3} />}>
            <EmptyState
              icon={FileUp}
              title="No transactions yet"
              action={
                <a href="/upload" class="btn-primary">
                  <Icon icon={FileUp} size={18} />
                  Upload a statement
                </a>
              }
            >
              Upload an Attijari PDF statement and its transactions show up here once they are
              extracted.
            </EmptyState>
          </Show>
        }
      >
        <section aria-labelledby="ledger-title" class="-mt-4">
          <h2 id="ledger-title" class="sr-only">
            Totals for {rangeLabel()}
          </h2>
          <div class="relative overflow-hidden rounded-panel bg-rail text-rail-ink">
            <Guilloche class="pointer-events-none absolute -top-16 -right-16 size-72 text-flare/25" />
            <dl class="relative grid grid-cols-2 lg:grid-cols-4">
              <LedgerFigure icon={TrendingUp} label="Money in">
                <Money centimes={rangeTotals().moneyIn} signed currency={false} />
              </LedgerFigure>
              <LedgerFigure icon={TrendingDown} label="Money out">
                <Money centimes={-Math.abs(rangeTotals().moneyOut)} currency={false} />
              </LedgerFigure>
              <LedgerFigure icon={Scale} label="Net">
                <Money centimes={rangeTotals().net} signed currency={false} />
              </LedgerFigure>
              <LedgerFigure icon={Wallet} label="Closing balance">
                <Show when={rangeTotals().closingBalance !== null} fallback={<span>Unknown</span>}>
                  <Money centimes={rangeTotals().closingBalance ?? 0} currency={false} />
                </Show>
              </LedgerFigure>
            </dl>
          </div>
          <p class="mt-3 text-xs text-ink-soft">
            {rangeLabel()}, {plural(rangeTotals().count, "transaction")}. Amounts in MAD. The
            closing balance comes from the latest statement ending in the range.
          </p>
        </section>

        <Section title="Monthly totals" titleId="monthly-title">
          <div class="panel p-4 sm:p-5">
            <MonthlyChart
              points={monthly.data ?? []}
              isSelected={isSelected}
              onSelect={selectMonth}
            />
            <details class="group mt-4 border-t border-rule pt-3">
              <summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium text-action select-none">
                Show the figures as a table
              </summary>
              <MonthlyTable
                rows={monthly.data ?? []}
                isSelected={isSelected}
                onSelect={selectMonth}
              />
            </details>
          </div>
        </Section>

        <Show when={selected()}>
          {(r) => <SpendSection from={r().from} to={r().to} label={rangeLabel()} />}
        </Show>
      </Show>

      <div class="grid gap-10 lg:grid-cols-2 lg:gap-8 [&>*]:min-w-0">
        <NeedsReviewSection />
        <StatementsSection />
      </div>
    </div>
  );
}

function LedgerFigure(props: { icon: IconNode; label: string; children: Element }) {
  return (
    <div class="border-rail-line px-4 py-4 odd:border-r nth-[-n+2]:border-b sm:px-6 sm:py-5 lg:border-r lg:border-b-0 lg:last:border-r-0 [&_.text-mint]:text-mint-on-rail">
      <dt class="flex items-center gap-1.5 text-xs text-rail-ink-soft sm:text-sm">
        <Icon icon={props.icon} size={16} />
        {props.label}
      </dt>
      <dd class="mt-1.5 text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{props.children}</dd>
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
      class="field-select"
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <For each={props.months}>
        {(month) => <option value={month}>{formatMonth(month)}</option>}
      </For>
    </select>
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
    <div class="-mx-4 mt-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table class="figures w-full min-w-[34rem] text-left text-sm">
        <caption class="sr-only">Monthly totals in MAD</caption>
        <thead class="text-ink-soft">
          <tr class="border-b border-rule">
            <th class="py-2 pr-3 font-medium">Month</th>
            <th class="py-2 pr-3 text-right font-medium">In</th>
            <th class="py-2 pr-3 text-right font-medium">Out</th>
            <th class="py-2 pr-3 text-right font-medium">Net</th>
            <th class="py-2 text-right font-medium">Closing balance</th>
          </tr>
        </thead>
        <tbody>
          <For each={[...props.rows].reverse()}>
            {(row) => (
              <tr
                class={[
                  "border-b border-rule transition-colors last:border-0",
                  { "bg-action-tint": props.isSelected(row.month) },
                ]}
              >
                <td class="py-1 pr-3">
                  <button
                    type="button"
                    class="link min-h-9"
                    aria-pressed={props.isSelected(row.month) ? "true" : "false"}
                    onClick={() => props.onSelect(row.month)}
                  >
                    {formatMonth(row.month)}
                  </button>
                </td>
                <td class="py-1 pr-3 text-right">
                  <Money centimes={row.moneyIn} signed currency={false} />
                </td>
                <td class="py-1 pr-3 text-right">
                  <Money centimes={-Math.abs(row.moneyOut)} currency={false} />
                </td>
                <td class="py-1 pr-3 text-right">
                  <Money centimes={row.net} signed currency={false} />
                </td>
                <td class="py-1 text-right">
                  {row.closingBalance === null ? (
                    <span class="text-ink-faint">Unknown</span>
                  ) : (
                    <Money centimes={row.closingBalance} currency={false} />
                  )}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function SpendSection(props: { from: string; to: string; label: string }) {
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
        barClass: "bg-saffron",
        href: "/withdrawals",
        note: "split withdrawals to categorize",
      });
    }
    if (data.uncategorized > 0) {
      bars.push({
        key: "uncategorized",
        label: "Uncategorized",
        amount: data.uncategorized,
        barClass: "bg-ink-faint",
      });
    }
    return bars;
  };

  return (
    <Section
      title={`Spending, ${props.label}`}
      titleId="spend-title"
      action={
        <Show when={spend.data}>
          {(data) => (
            <span class="text-sm text-ink-soft">
              Total <Money centimes={data().total} class="font-medium text-ink" />
            </span>
          )}
        </Show>
      }
    >
      <div class="panel p-4 sm:p-5">
        <Show when={spend.isError}>
          <ErrorNotice title="Could not load spending" message={spend.error?.message} />
        </Show>
        <Show when={spend.data} fallback={<SkeletonRows rows={3} />}>
          <Show
            when={items().length > 0}
            fallback={<p class="text-sm text-ink-soft">No spending in this period.</p>}
          >
            <CategoryBars items={items()} total={spend.data?.total ?? 0} />
          </Show>
        </Show>
      </div>
    </Section>
  );
}

function StatementsSection() {
  const statements = useQuery(() => orpc.reports.statements.queryOptions());
  return (
    <Section
      title="Statements"
      titleId="statements-title"
      action={
        <a class="link inline-flex min-h-11 items-center gap-1.5 text-sm" href="/upload">
          <Icon icon={FileUp} size={16} />
          Upload
        </a>
      }
    >
      <Show when={statements.data} fallback={<SkeletonRows rows={3} />}>
        {(rows) => (
          <Show
            when={rows().length > 0}
            fallback={
              <EmptyState icon={FileText} title="No statements yet">
                Uploaded statements appear here with their status.
              </EmptyState>
            }
          >
            <ol class="relative ml-1.5 space-y-5 border-l border-rule-strong pl-5">
              <For each={rows()}>
                {(statement) => (
                  <li class="relative">
                    <span
                      class={[
                        "absolute top-1.5 -left-[26.5px] size-2.5 rounded-full ring-4 ring-paper",
                        statement.status === "parsed"
                          ? "bg-mint"
                          : statement.status === "failed"
                            ? "bg-garnet"
                            : statement.status === "needs_review"
                              ? "bg-saffron"
                              : "bg-flare",
                      ]}
                      aria-hidden="true"
                    />
                    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span class="figures font-medium">
                        {formatPeriod(statement.periodStart, statement.periodEnd)}
                      </span>
                      <StatusBadge status={statement.status} />
                    </div>
                    <div class="mt-0.5 text-xs text-ink-soft">
                      <span class="break-all">{statement.fileName}</span>
                      <span class="figures">
                        {", "}
                        {plural(statement.transactionCount, "transaction")}
                        <Show when={statement.closingBalance !== null}>
                          {", closing "}
                          {formatMad(statement.closingBalance ?? 0)}
                        </Show>
                      </span>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        )}
      </Show>
    </Section>
  );
}

function NeedsReviewSection() {
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
    <Section title="Needs review" titleId="review-title">
      <Show when={review.data} fallback={<SkeletonRows rows={3} />}>
        {(data) => (
          <Show
            when={!isEmpty()}
            fallback={
              <div class="flex items-center gap-3 rounded-panel bg-mint-tint p-4 text-sm">
                <Icon icon={CircleCheck} class="text-mint" />
                <span>Nothing to review. Every transaction has a confident category.</span>
              </div>
            }
          >
            <div class="space-y-4">
              <Show when={data().statements.length > 0}>
                <ReviewGroup
                  icon={FileSearch}
                  title="Statements"
                  count={data().statements.length}
                  href="/upload"
                  linkLabel="Open statements"
                >
                  <For each={data().statements}>
                    {(statement) => (
                      <li class="flex flex-wrap items-start justify-between gap-2 py-2.5">
                        <span class="min-w-0">
                          <span class="block break-all">{statement.fileName}</span>
                          <Show when={statement.reason}>
                            <span class="block text-xs text-ink-soft">{statement.reason}</span>
                          </Show>
                        </span>
                        <StatusBadge status={statement.status} />
                      </li>
                    )}
                  </For>
                </ReviewGroup>
              </Show>

              <Show when={data().cashWithdrawals.total > 0}>
                <ReviewGroup
                  icon={Banknote}
                  title="Cash not fully split"
                  count={data().cashWithdrawals.total}
                  href="/withdrawals"
                  linkLabel="Split withdrawals"
                >
                  <For each={data().cashWithdrawals.items}>
                    {(row) => (
                      <li class="flex items-baseline justify-between gap-3 py-2.5">
                        <span class="min-w-0 truncate">
                          <span class="figures mr-2 text-ink-soft">
                            {formatDayMonth(row.bookingDate)}
                          </span>
                          <span dir="auto">{row.descriptionRaw}</span>
                        </span>
                        <span class="shrink-0 text-right text-xs text-ink-soft">
                          <Money
                            centimes={row.remainder}
                            class="text-sm font-medium text-saffron"
                          />{" "}
                          left
                        </span>
                      </li>
                    )}
                  </For>
                </ReviewGroup>
              </Show>

              <Show when={data().transactions.total > 0}>
                <ReviewGroup
                  icon={FileSearch}
                  title="Unsure categories"
                  count={data().transactions.total}
                  href="/transactions"
                  linkLabel="Review transactions"
                >
                  <For each={data().transactions.items}>
                    {(row) => (
                      <li class="flex items-baseline justify-between gap-3 py-2.5">
                        <span class="min-w-0">
                          <span class="block truncate">
                            <span class="figures mr-2 text-ink-soft">
                              {formatDayMonth(row.bookingDate)}
                            </span>
                            <a class="hover:underline" href="/transactions" dir="auto">
                              {row.descriptionRaw}
                            </a>
                          </span>
                          <span class="block text-xs text-ink-soft">
                            {row.reason === "uncategorized"
                              ? "No category"
                              : `${row.categoryName ?? "Category"}, confidence ${Math.round((row.confidence ?? 0) * 100)}%`}
                          </span>
                        </span>
                        <Money centimes={row.amount} signed class="shrink-0 text-sm" />
                      </li>
                    )}
                  </For>
                </ReviewGroup>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </Section>
  );
}

function ReviewGroup(props: {
  icon: IconNode;
  title: string;
  count: number;
  href: string;
  linkLabel: string;
  children: Element;
}) {
  return (
    <div class="panel px-4 pt-3 pb-1">
      <div class="flex items-center justify-between gap-2 border-b border-rule pb-2">
        <h3 class="flex items-center gap-2 text-sm font-semibold">
          <span class="grid size-7 place-items-center rounded-full bg-saffron-tint text-saffron">
            <Icon icon={props.icon} size={15} />
          </span>
          {props.title}
          <span class="figures rounded-full bg-paper-sunken px-2 text-xs font-medium text-ink-soft">
            {props.count}
          </span>
        </h3>
        <a class="link inline-flex min-h-11 items-center text-xs" href={props.href}>
          {props.linkLabel}
        </a>
      </div>
      <ul class="divide-y divide-rule text-sm">{props.children}</ul>
    </div>
  );
}
