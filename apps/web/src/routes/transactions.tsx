import Seo from "~/components/seo";
import { transactionTypes } from "@attijari-flare/api/enums";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Split,
  Tags,
  UserRound,
  Waypoints,
} from "lucide";
import { createSignal, For, Show } from "solid-js";

import AllocationEditor from "~/components/allocation-editor";
import { Sheet } from "~/components/dialog";
import Icon from "~/components/icon";
import {
  EmptyState,
  ErrorNotice,
  FieldError,
  Money,
  PageHeader,
  RequireSession,
  SavedStamp,
  SkeletonRows,
} from "~/components/ui";
import { ENV } from "~/env.public";
import { formatDate, formatDayMonth, formatMonth, formatPeriod, plural } from "~/lib/format";
import { orpc } from "~/utils/orpc";

const SERVER_URL = ENV.VITE_SERVER_URL.replace(/\/$/, "");
const PAGE_SIZE = 50;

type TransactionType = (typeof transactionTypes)[number];

const sourceMeta: Record<string, { label: string; class: string; icon: typeof Sparkles }> = {
  user: { label: "You", class: "bg-mint-tint text-mint", icon: UserRound },
  vector: { label: "Similar merchant", class: "bg-action-tint text-action", icon: Waypoints },
  llm: { label: "AI", class: "bg-saffron-tint text-saffron", icon: Sparkles },
};

const typeLabel = (value: string) => {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export default function Transactions() {
  return (
    <>
      <Seo title="Transactions - AttijariFlare" path="/transactions" noindex />
      <RequireSession>
        <PageHeader
          title="Transactions"
          description="Every line from your statements. Change a category and the app learns it for that merchant."
          actions={
            <a href="/categories" class="btn-quiet">
              <Icon icon={Tags} size={18} />
              Manage categories
            </a>
          }
        />
        <TransactionList />
      </RequireSession>
    </>
  );
}

function TransactionList() {
  const [month, setMonth] = createSignal("");
  const [categoryId, setCategoryId] = createSignal("");
  const [statementId, setStatementId] = createSignal("");
  const [type, setType] = createSignal("");
  const [searchText, setSearchText] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [page, setPage] = createSignal(1);
  const [filtersOpen, setFiltersOpen] = createSignal(false);

  const months = useQuery(() => orpc.transactions.months.queryOptions());
  const categories = useQuery(() => orpc.categories.list.queryOptions());
  const statementList = useQuery(() => orpc.statements.list.queryOptions());
  const list = useQuery(() =>
    orpc.transactions.list.queryOptions({
      input: {
        month: month() || undefined,
        categoryId: categoryId() || undefined,
        statementId: statementId() || undefined,
        type: (type() || undefined) as TransactionType | undefined,
        search: search() || undefined,
        page: page(),
        pageSize: PAGE_SIZE,
      },
    }),
  );

  // Any filter change goes back to the first page.
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const pageCount = () => Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const activeFilters = () => [month(), categoryId(), statementId(), type()].filter(Boolean).length;
  const clearFilters = () => {
    setMonth("");
    setCategoryId("");
    setStatementId("");
    setType("");
    setPage(1);
  };

  const filterFields = (idPrefix: string) => (
    <>
      <label class="block" for={`${idPrefix}-month`}>
        <span class="field-label">Month</span>
        <select
          id={`${idPrefix}-month`}
          class="field-select"
          value={month()}
          onChange={(e) => filter(setMonth)(e.currentTarget.value)}
        >
          <option value="">All months</option>
          <For each={months.data ?? []}>
            {(value) => <option value={value}>{formatMonth(value)}</option>}
          </For>
        </select>
      </label>
      <label class="block" for={`${idPrefix}-category`}>
        <span class="field-label">Category</span>
        <select
          id={`${idPrefix}-category`}
          class="field-select"
          value={categoryId()}
          onChange={(e) => filter(setCategoryId)(e.currentTarget.value)}
        >
          <option value="">All categories</option>
          <option value="none">Uncategorized</option>
          <For each={categories.data ?? []}>
            {(category) => <option value={category.id}>{category.name}</option>}
          </For>
        </select>
      </label>
      <label class="block" for={`${idPrefix}-statement`}>
        <span class="field-label">Statement</span>
        <select
          id={`${idPrefix}-statement`}
          class="field-select"
          value={statementId()}
          onChange={(e) => filter(setStatementId)(e.currentTarget.value)}
        >
          <option value="">All statements</option>
          <For each={statementList.data ?? []}>
            {(statement) => (
              <option value={statement.id}>
                {statement.periodStart
                  ? formatPeriod(statement.periodStart, statement.periodEnd)
                  : statement.fileName}
              </option>
            )}
          </For>
        </select>
      </label>
      <label class="block" for={`${idPrefix}-type`}>
        <span class="field-label">Type</span>
        <select
          id={`${idPrefix}-type`}
          class="field-select"
          value={type()}
          onChange={(e) => filter(setType)(e.currentTarget.value)}
        >
          <option value="">All types</option>
          <For each={[...transactionTypes]}>
            {(value) => <option value={value}>{typeLabel(value)}</option>}
          </For>
        </select>
      </label>
    </>
  );

  return (
    <div class="space-y-4">
      <div class="flex gap-2">
        <form
          role="search"
          class="relative flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            filter(setSearch)(searchText().trim());
          }}
        >
          <label for="transaction-search" class="sr-only">
            Search descriptions and merchants
          </label>
          <Icon
            icon={Search}
            size={18}
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            id="transaction-search"
            type="search"
            class="field pr-24 pl-10"
            placeholder="Description or merchant"
            maxlength="100"
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
          />
          <button
            type="submit"
            class="btn-ghost absolute top-1/2 right-1 min-h-9 -translate-y-1/2 px-3 text-action"
          >
            Search
          </button>
        </form>
        <button
          type="button"
          class="btn-quiet relative lg:hidden"
          aria-label={`Filters${activeFilters() ? `, ${activeFilters()} active` : ""}`}
          onClick={() => setFiltersOpen(true)}
        >
          <Icon icon={SlidersHorizontal} size={18} />
          <span class="hidden sm:inline">Filters</span>
          <Show when={activeFilters() > 0}>
            <span class="figures grid size-5 place-items-center rounded-full bg-flare text-[0.6875rem] text-flare-ink">
              {activeFilters()}
            </span>
          </Show>
        </button>
      </div>

      <div class="hidden grid-cols-4 gap-3 lg:grid">{filterFields("filter")}</div>

      <Sheet
        open={filtersOpen()}
        title="Filters"
        onClose={() => setFiltersOpen(false)}
        footer={
          <div class="flex gap-2">
            <button type="button" class="btn-quiet flex-1" onClick={clearFilters}>
              Clear
            </button>
            <button type="button" class="btn-primary flex-1" onClick={() => setFiltersOpen(false)}>
              Show {list.data ? plural(list.data.total, "result") : "results"}
            </button>
          </div>
        }
      >
        <div class="space-y-4">{filterFields("sheet")}</div>
      </Sheet>

      <Show when={list.isError}>
        <ErrorNotice title="Could not load transactions" message={list.error?.message} />
      </Show>

      <Show when={list.data} fallback={<SkeletonRows rows={6} />}>
        {(data) => (
          <>
            <div class="flex items-center justify-between gap-3 text-sm text-ink-soft">
              <span class="figures" aria-live="polite">
                {plural(data().total, "transaction")}
              </span>
              <Show when={activeFilters() > 0 || search()}>
                <button
                  type="button"
                  class="link min-h-11"
                  onClick={() => {
                    clearFilters();
                    setSearchText("");
                    setSearch("");
                  }}
                >
                  Clear search and filters
                </button>
              </Show>
            </div>
            <Show
              when={data().items.length > 0}
              fallback={
                <EmptyState icon={ReceiptText} title="No transactions match">
                  Try another month or category, or clear the search.
                </EmptyState>
              }
            >
              <div class="overflow-hidden rounded-panel border border-rule bg-paper-raised">
                <div
                  class="hidden grid-cols-[6.5rem_minmax(0,1fr)_19rem_9.5rem] gap-4 border-b border-rule bg-paper-sunken/60 px-4 py-2.5 text-xs font-medium text-ink-soft xl:grid"
                  aria-hidden="true"
                >
                  <span>Date</span>
                  <span>Description</span>
                  <span>Category</span>
                  <span class="text-right">Amount</span>
                </div>
                <ul class="divide-y divide-rule">
                  <For each={data().items} keyed={(row) => row.id}>
                    {(row) => <TransactionRow row={row()} categories={categories.data ?? []} />}
                  </For>
                </ul>
              </div>
            </Show>
            <Show when={pageCount() > 1}>
              <nav aria-label="Pages" class="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  class="btn-quiet"
                  disabled={page() <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  <Icon icon={ChevronLeft} size={18} />
                  Previous
                </button>
                <span class="figures text-ink-soft">
                  Page {page()} of {pageCount()}
                </span>
                <button
                  type="button"
                  class="btn-quiet"
                  disabled={page() >= pageCount()}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <Icon icon={ChevronRight} size={18} />
                </button>
              </nav>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

type Row = {
  id: string;
  statementId: string;
  statementFileName: string;
  bookingDate: string;
  descriptionRaw: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryColor: string | null;
  categorySource: string | null;
  confidence: number | null;
  merchantId: string | null;
  merchantName: string | null;
  allocationParts: number;
};

function TransactionRow(props: { row: Row; categories: readonly { id: string; name: string }[] }) {
  const queryClient = useQueryClient();
  const [splitOpen, setSplitOpen] = createSignal(false);
  const [offer, setOffer] = createSignal<{ categoryId: string; count: number } | null>(null);
  const [error, setError] = createSignal<string>();
  const [savedKey, setSavedKey] = createSignal(0);
  const editorId = `split-${props.row.id}`;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.transactions.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.categories.key() }),
    ]);

  const setCategory = useMutation(() =>
    orpc.transactions.setCategory.mutationOptions({
      onSuccess: async (result, variables) => {
        setError();
        setOffer(
          !variables.applyToMerchant && result.sameMerchantPending > 0
            ? { categoryId: variables.categoryId, count: result.sameMerchantPending }
            : null,
        );
        const key = savedKey() + 1;
        setSavedKey(key);
        setTimeout(() => {
          if (savedKey() === key) setSavedKey(0);
        }, 2600);
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const source = () =>
    props.row.categorySource ? sourceMeta[props.row.categorySource] : undefined;

  return (
    <li class="px-4 py-3.5">
      <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 xl:grid-cols-[6.5rem_minmax(0,1fr)_19rem_9.5rem] xl:items-center">
        <div class="figures hidden text-sm text-ink-soft xl:block">
          {formatDate(props.row.bookingDate)}
        </div>

        <div class="min-w-0">
          <p class="font-medium break-words" dir="auto">
            {props.row.descriptionRaw}
          </p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
            <span class="figures xl:hidden">{formatDayMonth(props.row.bookingDate)}</span>
            <span>{typeLabel(props.row.type)}</span>
            <Show when={props.row.merchantName}>
              {(name) => (
                <span dir="auto" class="text-ink-faint">
                  {name()}
                </span>
              )}
            </Show>
            <a
              class="inline-flex items-center gap-1 text-ink-faint hover:text-action"
              href={`${SERVER_URL}/api/statements/${props.row.statementId}/original`}
              target="_blank"
              rel="noopener"
            >
              Source PDF
              <Icon icon={ExternalLink} size={12} />
              <span class="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        </div>

        <div class="col-start-2 row-start-1 text-right xl:col-start-4">
          <Money centimes={props.row.amount} signed class="text-base font-semibold" />
        </div>

        <div class="col-span-2 flex flex-wrap items-center gap-2 xl:col-span-1 xl:col-start-3 xl:row-start-1">
          <div class="relative min-w-0 flex-1">
            <span
              class="pointer-events-none absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full transition-colors duration-300"
              style={{ background: props.row.categoryColor ?? "var(--rule-strong)" }}
              aria-hidden="true"
            />
            <select
              aria-label={`Category for ${props.row.descriptionRaw}`}
              class="field-select min-h-10 pl-8 text-sm"
              value={props.row.categoryId ?? ""}
              disabled={setCategory.isPending}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value) {
                  setCategory.mutate({
                    transactionId: props.row.id,
                    categoryId: value,
                    applyToMerchant: false,
                  });
                }
              }}
            >
              <option value="" disabled>
                Uncategorized
              </option>
              <For each={props.categories}>
                {(category) => <option value={category.id}>{category.name}</option>}
              </For>
            </select>
          </div>
          <Show when={props.row.amount < 0}>
            <button
              type="button"
              class={[
                "btn-quiet min-h-10 px-3",
                { "border-action text-action": splitOpen() || props.row.allocationParts > 0 },
              ]}
              aria-expanded={splitOpen() ? "true" : "false"}
              aria-controls={editorId}
              onClick={() => setSplitOpen((open) => !open)}
            >
              <Icon icon={Split} size={16} />
              {splitOpen()
                ? "Hide split"
                : props.row.allocationParts > 0
                  ? `Split (${props.row.allocationParts})`
                  : "Split"}
            </button>
          </Show>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-2 xl:ml-[calc(6.5rem+1rem)]">
        <Show
          when={source()}
          fallback={<span class="text-xs text-ink-faint">Not categorized yet</span>}
        >
          {(meta) => (
            <span
              class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta().class}`}
            >
              <Icon icon={meta().icon} size={13} strokeWidth={2} />
              {meta().label}
              <Show when={props.row.categorySource !== "user" && props.row.confidence !== null}>
                <span class="figures">{Math.round((props.row.confidence ?? 0) * 100)}%</span>
              </Show>
            </span>
          )}
        </Show>
        <Show when={savedKey() > 0}>
          <For each={[savedKey()]}>{() => <SavedStamp label="Category saved" />}</For>
        </Show>
      </div>

      <Show when={offer()}>
        {(current) => (
          <div class="arrive mt-3 flex flex-wrap items-center gap-3 rounded-control bg-action-tint p-3 text-sm xl:ml-[calc(6.5rem+1rem)]">
            <span class="min-w-0 flex-1">
              {plural(current().count, "other transaction")} from this merchant{" "}
              {current().count === 1 ? "has" : "have"} a different category.
            </span>
            <div class="flex gap-2">
              <button type="button" class="btn-ghost min-h-10" onClick={() => setOffer(null)}>
                Dismiss
              </button>
              <button
                type="button"
                class="btn-primary min-h-10"
                disabled={setCategory.isPending}
                onClick={() =>
                  setCategory.mutate({
                    transactionId: props.row.id,
                    categoryId: current().categoryId,
                    applyToMerchant: true,
                  })
                }
              >
                Apply to them
              </button>
            </div>
          </div>
        )}
      </Show>

      <div class="xl:ml-[calc(6.5rem+1rem)]">
        <FieldError message={error()} />
      </div>

      <Show when={splitOpen()}>
        <div id={editorId} class="arrive mt-3 xl:ml-[calc(6.5rem+1rem)]">
          <AllocationEditor transactionId={props.row.id} onSaved={() => void invalidate()} />
        </div>
      </Show>
    </li>
  );
}
