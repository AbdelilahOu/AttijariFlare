import { splitEqually } from "@finance-ttijari/api/allocations/math";
import { centimesToMad, parseMadToCentimes } from "@finance-ttijari/api/allocations/money";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";

import { orpc } from "~/utils/orpc";

type Category = { id: string; name: string };

type SavedAllocation = {
  id: string;
  amount: number;
  categoryId: string;
  note: string | null;
};

type Row = {
  key: string;
  amountText: string;
  categoryId: string;
  note: string;
};

let rowCounter = 0;
const newRow = (init: Partial<Omit<Row, "key">> = {}): Row => ({
  key: `row-${++rowCounter}`,
  amountText: "",
  categoryId: "",
  note: "",
  ...init,
});

const toRows = (allocations: readonly SavedAllocation[]): Row[] =>
  allocations.map((allocation) =>
    newRow({
      amountText: centimesToMad(allocation.amount),
      categoryId: allocation.categoryId,
      note: allocation.note ?? "",
    }),
  );

/**
 * Splits one debit transaction into parts (amount in MAD + category + note).
 * Loads its saved allocations and the user's categories, and saves through `allocations.set`.
 */
export default function AllocationEditor(props: { transactionId: string; onSaved?: () => void }) {
  const state = useQuery(() =>
    orpc.allocations.list.queryOptions({ input: { transactionId: props.transactionId } }),
  );
  const categories = useQuery(() => orpc.allocations.categories.queryOptions());

  return (
    <Show when={state.data && categories.data} fallback={<p class="text-sm">Loading...</p>}>
      <AllocationForm
        transactionId={props.transactionId}
        amount={state.data!.transaction.amount}
        saved={state.data!.allocations}
        categories={categories.data!}
        onSaved={props.onSaved}
      />
    </Show>
  );
}

function AllocationForm(props: {
  transactionId: string;
  /** Signed centimes; debits are negative. */
  amount: number;
  saved: readonly SavedAllocation[];
  categories: readonly Category[];
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  // Re-seeded from the saved allocations whenever they change (for example after a save).
  const [rows, setRows] = createSignal<Row[]>(() => toRows(props.saved));
  const [splitCount, setSplitCount] = createSignal("3");
  const [error, setError] = createSignal<string>();

  const total = () => Math.abs(props.amount);
  const parsed = createMemo(() => rows().map((row) => parseMadToCentimes(row.amountText)));
  const allocated = createMemo(() =>
    parsed().reduce<number>((sum, value) => sum + (value ?? 0), 0),
  );
  const remainder = () => total() - allocated();

  const save = useMutation(() =>
    orpc.allocations.set.mutationOptions({
      onSuccess: async () => {
        setError();
        await queryClient.invalidateQueries({ queryKey: orpc.allocations.key() });
        props.onSaved?.();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const updateRow = (key: string, patch: Partial<Omit<Row, "key">>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeRow = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  const addRow = () => setRows((current) => [...current, newRow()]);

  const fillRemainder = () => {
    const left = remainder();
    if (left <= 0) return;
    setRows((current) => {
      const last = current[current.length - 1];
      if (last && parseMadToCentimes(last.amountText) === null) {
        return current.map((row) =>
          row.key === last.key ? { ...row, amountText: centimesToMad(left) } : row,
        );
      }
      return [...current, newRow({ amountText: centimesToMad(left) })];
    });
  };

  const splitIntoParts = () => {
    const count = Number(splitCount());
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setError("Number of parts must be between 1 and 50");
      return;
    }
    if (count > total()) {
      setError("More parts than centimes to split");
      return;
    }
    setError();
    const amounts = splitEqually(total(), count);
    setRows((current) =>
      amounts.map((value, i) =>
        newRow({
          amountText: centimesToMad(value),
          categoryId: current[i]?.categoryId ?? "",
          note: current[i]?.note ?? "",
        }),
      ),
    );
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const current = rows();
    const amounts = parsed();
    for (const [i, row] of current.entries()) {
      const value = amounts[i];
      if (value === null || value === undefined || value <= 0) {
        setError(`Part ${i + 1}: enter an amount greater than 0 (MAD, up to 2 decimals)`);
        return;
      }
      if (!row.categoryId) {
        setError(`Part ${i + 1}: choose a category`);
        return;
      }
    }
    if (remainder() < 0) {
      setError(`Parts exceed the transaction by ${centimesToMad(-remainder())} MAD`);
      return;
    }
    setError();
    save.mutate({
      transactionId: props.transactionId,
      parts: current.map((row, i) => ({
        amount: amounts[i] as number,
        categoryId: row.categoryId,
        note: row.note.trim() || null,
      })),
    });
  };

  return (
    <form onSubmit={submit} class="space-y-2 rounded border p-3">
      <For each={rows()} keyed={(row) => row.key}>
        {(row, index) => (
          <div class="flex flex-wrap items-center gap-2">
            <span class="w-6 text-right text-sm text-gray-500">{index() + 1}.</span>
            <input
              aria-label="Amount in MAD"
              inputmode="decimal"
              placeholder="0.00"
              class={[
                "w-28 rounded border p-1 text-right",
                { "border-red-500": row().amountText !== "" && parsed()[index()] === null },
              ]}
              value={row().amountText}
              onInput={(e) => updateRow(row().key, { amountText: e.currentTarget.value })}
            />
            <span class="text-sm">MAD</span>
            <select
              aria-label="Category"
              class="rounded border p-1"
              value={row().categoryId}
              onChange={(e) => updateRow(row().key, { categoryId: e.currentTarget.value })}
            >
              <option value="">Category...</option>
              <For each={props.categories}>
                {(category) => <option value={category.id}>{category.name}</option>}
              </For>
            </select>
            <input
              aria-label="Note"
              placeholder="Note"
              maxlength="200"
              class="min-w-32 flex-1 rounded border p-1"
              value={row().note}
              onInput={(e) => updateRow(row().key, { note: e.currentTarget.value })}
            />
            <button
              type="button"
              class="rounded border px-2 py-1 text-sm"
              onClick={() => removeRow(row().key)}
            >
              Remove
            </button>
          </div>
        )}
      </For>

      <div class="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" class="rounded border px-2 py-1" onClick={addRow}>
          Add part
        </button>
        <button
          type="button"
          class="rounded border px-2 py-1 disabled:opacity-50"
          disabled={remainder() <= 0}
          onClick={fillRemainder}
        >
          Fill remainder
        </button>
        <span class="ml-2">Split into</span>
        <input
          aria-label="Number of equal parts"
          type="number"
          min="1"
          max="50"
          class="w-16 rounded border p-1"
          value={splitCount()}
          onInput={(e) => setSplitCount(e.currentTarget.value)}
        />
        <button type="button" class="rounded border px-2 py-1" onClick={splitIntoParts}>
          equal parts
        </button>
      </div>

      <p class="text-sm">
        Total {centimesToMad(total())} MAD, allocated {centimesToMad(allocated())} MAD,{" "}
        <span class={{ "font-semibold text-red-600": remainder() < 0 }}>
          {remainder() < 0
            ? `over by ${centimesToMad(-remainder())} MAD`
            : `unallocated ${centimesToMad(remainder())} MAD`}
        </span>
      </p>

      <Show when={error()}>{(message) => <p class="text-sm text-red-600">{message()}</p>}</Show>

      <button
        type="submit"
        class="rounded bg-indigo-600 px-3 py-1 text-white hover:bg-indigo-700 disabled:opacity-50"
        disabled={save.isPending || remainder() < 0}
      >
        {save.isPending ? "Saving..." : "Save split"}
      </button>
    </form>
  );
}
