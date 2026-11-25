import { splitEqually } from "@finance-ttijari/api/allocations/math";
import { centimesToMad, parseMadToCentimes } from "@finance-ttijari/api/allocations/money";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Plus, Trash } from "lucide";
import { createMemo, createSignal, For, Show } from "solid-js";

import Icon from "~/components/icon";
import { FieldError, Money, SavedStamp, SkeletonRows, Spinner } from "~/components/ui";
import { formatMad } from "~/lib/format";
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

/** Centimes as an editable amount with a comma decimal ("1234,50"), matching the display. */
const toInput = (centimes: number) => centimesToMad(centimes).replace(".", ",");

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
      amountText: toInput(allocation.amount),
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
    <Show when={state.data && categories.data} fallback={<SkeletonRows rows={2} />}>
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
  const [savedKey, setSavedKey] = createSignal(0);

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
        const key = savedKey() + 1;
        setSavedKey(key);
        setTimeout(() => {
          if (savedKey() === key) setSavedKey(0);
        }, 2600);
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
          row.key === last.key ? { ...row, amountText: toInput(left) } : row,
        );
      }
      return [...current, newRow({ amountText: toInput(left) })];
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
          amountText: toInput(value),
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
        setError(`Part ${i + 1}: enter an amount above 0, in MAD with up to 2 decimals`);
        return;
      }
      if (!row.categoryId) {
        setError(`Part ${i + 1}: choose a category`);
        return;
      }
    }
    if (remainder() < 0) {
      setError(`Parts exceed the transaction by ${formatMad(-remainder())}`);
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

  const meterRatio = () => (total() > 0 ? Math.min(1, allocated() / total()) : 0);
  const balanceTone = () =>
    remainder() < 0 ? "text-garnet" : remainder() === 0 ? "text-mint" : "text-saffron";

  return (
    <form onSubmit={submit} class="space-y-4 rounded-panel border border-rule bg-paper p-3 sm:p-4">
      <div>
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span class="text-ink-soft">
            Allocated <Money centimes={allocated()} class="font-medium text-ink" /> of{" "}
            <Money centimes={total()} class="font-medium text-ink" />
          </span>
          <span class={`font-medium ${balanceTone()}`} aria-live="polite">
            <Show when={remainder() !== 0} fallback={<span>Fully allocated</span>}>
              <Show
                when={remainder() < 0}
                fallback={
                  <span>
                    <Money centimes={remainder()} /> left
                  </span>
                }
              >
                <span>
                  Over by <Money centimes={-remainder()} />
                </span>
              </Show>
            </Show>
          </span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunken" aria-hidden="true">
          <div
            class={[
              "meter h-full w-full rounded-full",
              remainder() < 0 ? "bg-garnet" : remainder() === 0 ? "bg-mint" : "bg-flare",
            ]}
            style={{ transform: `scaleX(${meterRatio()})` }}
          />
        </div>
      </div>

      <Show
        when={rows().length > 0}
        fallback={
          <p class="text-sm text-ink-soft">
            No parts yet. Add a part, or split the amount into equal parts.
          </p>
        }
      >
        <ol class="space-y-3">
          <For each={rows()} keyed={(row) => row.key}>
            {(row, index) => (
              <li class="arrive grid grid-cols-[1.25rem_minmax(0,8.5rem)_minmax(0,1fr)_2.5rem] items-center gap-2 lg:grid-cols-[1.25rem_9rem_minmax(0,14rem)_minmax(0,1fr)_2.5rem]">
                <span class="figures text-right text-sm text-ink-faint">{index() + 1}</span>
                <div class="relative">
                  <input
                    aria-label={`Part ${index() + 1} amount in MAD`}
                    inputmode="decimal"
                    placeholder="0,00"
                    class={[
                      "field figures min-h-10 pr-12 text-right",
                      { "border-garnet": row().amountText !== "" && parsed()[index()] === null },
                    ]}
                    value={row().amountText}
                    onInput={(e) => updateRow(row().key, { amountText: e.currentTarget.value })}
                  />
                  <span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-faint">
                    MAD
                  </span>
                </div>
                <select
                  aria-label={`Part ${index() + 1} category`}
                  class="field-select col-span-2 min-h-10 text-sm lg:col-span-1"
                  value={row().categoryId}
                  onChange={(e) => updateRow(row().key, { categoryId: e.currentTarget.value })}
                >
                  <option value="">Choose a category</option>
                  <For each={props.categories}>
                    {(category) => <option value={category.id}>{category.name}</option>}
                  </For>
                </select>
                <input
                  aria-label={`Part ${index() + 1} note`}
                  placeholder="Note (optional)"
                  maxlength="200"
                  class="field col-span-2 col-start-2 min-h-10 text-sm lg:col-span-1 lg:col-start-auto"
                  value={row().note}
                  onInput={(e) => updateRow(row().key, { note: e.currentTarget.value })}
                />
                <button
                  type="button"
                  class="btn-icon btn-ghost min-h-10 w-10 justify-self-end hover:text-garnet"
                  aria-label={`Remove part ${index() + 1}`}
                  onClick={() => removeRow(row().key)}
                >
                  <Icon icon={Trash} size={18} />
                </button>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <div class="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" class="btn-quiet min-h-10" onClick={addRow}>
          <Icon icon={Plus} size={16} />
          Add part
        </button>
        <button
          type="button"
          class="btn-quiet min-h-10"
          disabled={remainder() <= 0}
          onClick={fillRemainder}
        >
          Fill remainder
        </button>
        <div class="flex items-center gap-2">
          <label for={`${props.transactionId}-parts`} class="text-ink-soft">
            Split into
          </label>
          <input
            id={`${props.transactionId}-parts`}
            type="number"
            min="1"
            max="50"
            class="field figures min-h-10 w-16 px-2 text-center"
            value={splitCount()}
            onInput={(e) => setSplitCount(e.currentTarget.value)}
          />
          <button type="button" class="btn-quiet min-h-10" onClick={splitIntoParts}>
            equal parts
          </button>
        </div>
      </div>

      <FieldError message={error()} />

      <div class="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
        <button type="submit" class="btn-primary" disabled={save.isPending || remainder() < 0}>
          <Show when={save.isPending} fallback={<Icon icon={Check} size={18} />}>
            <Spinner class="size-[18px]" />
          </Show>
          {save.isPending ? "Saving split" : "Save split"}
        </button>
        <Show when={savedKey() > 0}>
          <For each={[savedKey()]}>{() => <SavedStamp label="Split saved" />}</For>
        </Show>
      </div>
    </form>
  );
}
