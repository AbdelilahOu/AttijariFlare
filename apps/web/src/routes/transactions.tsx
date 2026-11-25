import { centimesToMad } from "@finance-ttijari/api/allocations/money";
import { transactionTypes } from "@finance-ttijari/api/enums";
import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";

import AllocationEditor from "~/components/allocation-editor";
import { ENV } from "~/env.public";
import { useSession } from "~/lib/auth-client";
import { orpc } from "~/utils/orpc";

const SERVER_URL = ENV.VITE_SERVER_URL.replace(/\/$/, "");
const PAGE_SIZE = 50;

type TransactionType = (typeof transactionTypes)[number];

const sourceLabels: Record<string, string> = {
  user: "You",
  vector: "Similar merchant",
  llm: "AI",
};

const sourceClasses: Record<string, string> = {
  user: "bg-green-100 text-green-800",
  vector: "bg-blue-100 text-blue-800",
  llm: "bg-amber-100 text-amber-800",
};

export default function Transactions() {
  const navigate = useNavigate();
  const session = useSession();

  createEffect(
    () => !session().isPending && !session().data,
    (shouldRedirect) => {
      if (shouldRedirect) {
        navigate("/login", { replace: true });
      }
    },
  );

  return (
    <Show when={!session().isPending && session().data} fallback={<p>Loading...</p>}>
      <div class="mx-auto w-full max-w-6xl space-y-4 p-4">
        <div class="flex items-baseline justify-between">
          <h1 class="text-2xl font-bold">Transactions</h1>
          <a href="/categories" class="text-sm underline">
            Manage categories
          </a>
        </div>
        <TransactionList />
      </div>
    </Show>
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

  return (
    <div class="space-y-3">
      <form
        class="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          filter(setSearch)(searchText().trim());
        }}
      >
        <label class="flex flex-col">
          <span>Month</span>
          <select
            class="rounded border p-1"
            value={month()}
            onChange={(e) => filter(setMonth)(e.currentTarget.value)}
          >
            <option value="">All</option>
            <For each={months.data ?? []}>{(value) => <option value={value}>{value}</option>}</For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Category</span>
          <select
            class="rounded border p-1"
            value={categoryId()}
            onChange={(e) => filter(setCategoryId)(e.currentTarget.value)}
          >
            <option value="">All</option>
            <option value="none">Uncategorized</option>
            <For each={categories.data ?? []}>
              {(category) => <option value={category.id}>{category.name}</option>}
            </For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Statement</span>
          <select
            class="max-w-48 rounded border p-1"
            value={statementId()}
            onChange={(e) => filter(setStatementId)(e.currentTarget.value)}
          >
            <option value="">All</option>
            <For each={statementList.data ?? []}>
              {(statement) => (
                <option value={statement.id}>
                  {statement.periodStart
                    ? `${statement.periodStart} to ${statement.periodEnd ?? "?"}`
                    : statement.fileName}
                </option>
              )}
            </For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Type</span>
          <select
            class="rounded border p-1"
            value={type()}
            onChange={(e) => filter(setType)(e.currentTarget.value)}
          >
            <option value="">All</option>
            <For each={[...transactionTypes]}>
              {(value) => <option value={value}>{value.replace("_", " ")}</option>}
            </For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Search</span>
          <input
            class="rounded border p-1"
            placeholder="Description or merchant"
            maxlength="100"
            value={searchText()}
            onInput={(e) => setSearchText(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="rounded border px-2 py-1">
          Search
        </button>
      </form>

      <Show when={list.data} fallback={<p>Loading...</p>}>
        {(data) => (
          <>
            <p class="text-sm text-gray-600">
              {data().total} transaction{data().total === 1 ? "" : "s"}
            </p>
            <Show when={data().items.length > 0} fallback={<p>No transactions match.</p>}>
              <ul class="divide-y rounded border">
                <For each={data().items} keyed={(row) => row.id}>
                  {(row) => <TransactionRow row={row()} categories={categories.data ?? []} />}
                </For>
              </ul>
            </Show>
            <div class="flex items-center gap-2 text-sm">
              <button
                type="button"
                class="rounded border px-2 py-1 disabled:opacity-50"
                disabled={page() <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <span>
                Page {page()} of {pageCount()}
              </span>
              <button
                type="button"
                class="rounded border px-2 py-1 disabled:opacity-50"
                disabled={page() >= pageCount()}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
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
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const source = () => props.row.categorySource;

  return (
    <li class="space-y-2 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-64 flex-1">
          <div>
            <span class="font-mono text-sm">{props.row.bookingDate}</span>{" "}
            <span>{props.row.descriptionRaw}</span>
          </div>
          <div class="text-xs text-gray-500">
            {props.row.type.replace("_", " ")}
            <Show when={props.row.merchantName}>{(name) => <> - merchant: {name()}</>}</Show>
            {" - "}
            <a
              class="underline"
              href={`${SERVER_URL}/api/statements/${props.row.statementId}/original`}
              target="_blank"
              rel="noopener"
            >
              source PDF
            </a>
          </div>
        </div>

        <span class={["w-32 text-right font-semibold", { "text-green-700": props.row.amount > 0 }]}>
          {centimesToMad(props.row.amount)} MAD
        </span>

        <div class="flex items-center gap-2 text-sm">
          <Show when={props.row.categoryColor}>
            {(color) => (
              <span class="inline-block h-3 w-3 rounded-full" style={{ background: color() }} />
            )}
          </Show>
          <select
            aria-label="Category"
            class="rounded border p-1"
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
          <Show
            when={source()}
            fallback={<span class="w-36 text-xs text-gray-500">not categorized</span>}
          >
            {(value) => (
              <span class={["w-36 rounded px-2 py-0.5 text-xs", sourceClasses[value()] ?? ""]}>
                {sourceLabels[value()] ?? value()}
                <Show when={value() !== "user" && props.row.confidence !== null}>
                  {" "}
                  {Math.round((props.row.confidence ?? 0) * 100)}%
                </Show>
              </span>
            )}
          </Show>
          <Show when={props.row.amount < 0}>
            <button
              type="button"
              class="rounded border px-2 py-1"
              onClick={() => setSplitOpen((open) => !open)}
            >
              {splitOpen()
                ? "Hide split"
                : props.row.allocationParts > 0
                  ? `Split (${props.row.allocationParts})`
                  : "Split"}
            </button>
          </Show>
        </div>
      </div>

      <Show when={offer()}>
        {(current) => (
          <div class="flex flex-wrap items-center gap-2 rounded bg-blue-50 p-2 text-sm">
            <span>
              {current().count} other transaction{current().count === 1 ? "" : "s"} of this merchant{" "}
              {current().count === 1 ? "has" : "have"} a different category.
            </span>
            <button
              type="button"
              class="rounded bg-indigo-600 px-2 py-1 text-white disabled:opacity-50"
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
            <button type="button" class="rounded border px-2 py-1" onClick={() => setOffer(null)}>
              Dismiss
            </button>
          </div>
        )}
      </Show>

      <Show when={error()}>{(message) => <p class="text-sm text-red-600">{message()}</p>}</Show>

      <Show when={splitOpen()}>
        <AllocationEditor transactionId={props.row.id} onSaved={() => void invalidate()} />
      </Show>
    </li>
  );
}
