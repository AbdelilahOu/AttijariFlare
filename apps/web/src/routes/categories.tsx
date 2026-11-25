import { categoryKinds } from "@finance-ttijari/api/enums";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Pencil, Plus, Tags, Trash } from "lucide";
import { createSignal, For, Show } from "solid-js";

import { ConfirmDialog } from "~/components/dialog";
import Icon from "~/components/icon";
import {
  EmptyState,
  ErrorNotice,
  FieldError,
  PageHeader,
  RequireSession,
  SavedStamp,
  SkeletonRows,
} from "~/components/ui";
import { plural } from "~/lib/format";
import { orpc } from "~/utils/orpc";

type CategoryKind = (typeof categoryKinds)[number];

type Category = {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string | null;
  parentId: string | null;
  transactions: number;
};

const DEFAULT_COLOR = "#6b7280";

const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

export default function Categories() {
  return (
    <RequireSession>
      <PageHeader
        title="Categories"
        description="Group spending the way you think about it. Subcategories roll up into their parent."
      />
      <CategoryManager />
    </RequireSession>
  );
}

function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.categories.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.allocations.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.transactions.key() }),
    ]);
}

/** Parents first, each followed by its subcategories; orphans keep their place at the end. */
function grouped(rows: readonly Category[]): { category: Category; depth: number }[] {
  const ids = new Set(rows.map((row) => row.id));
  const result: { category: Category; depth: number }[] = [];
  for (const row of rows) {
    if (row.parentId && ids.has(row.parentId)) continue;
    result.push({ category: row, depth: 0 });
    for (const child of rows) {
      if (child.parentId === row.id) result.push({ category: child, depth: 1 });
    }
  }
  return result;
}

function CategoryManager() {
  const categories = useQuery(() => orpc.categories.list.queryOptions());
  const invalidate = useInvalidateCategories();

  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<CategoryKind>("expense");
  const [color, setColor] = createSignal(DEFAULT_COLOR);
  const [parentId, setParentId] = createSignal("");
  const [error, setError] = createSignal<string>();
  const [added, setAdded] = createSignal<string>();

  const create = useMutation(() =>
    orpc.categories.create.mutationOptions({
      onSuccess: async (_result, variables) => {
        setError();
        setAdded(variables.name);
        setTimeout(() => setAdded(), 2600);
        setName("");
        setParentId("");
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const topLevel = () => (categories.data ?? []).filter((category) => !category.parentId);

  return (
    <div class="space-y-8">
      <form
        class="panel p-4 sm:p-5"
        aria-labelledby="add-category-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name().trim()) {
            setError("Enter a name");
            return;
          }
          create.mutate({
            name: name().trim(),
            kind: kind(),
            color: color(),
            parentId: parentId() || null,
          });
        }}
      >
        <h2 id="add-category-title" class="mb-4 text-lg font-semibold">
          Add a category
        </h2>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_12rem_4.5rem_auto] lg:items-end">
          <label class="block sm:col-span-2 lg:col-span-1">
            <span class="field-label">Name</span>
            <input
              class="field"
              maxlength="60"
              placeholder="Groceries"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <label class="block">
            <span class="field-label">Kind</span>
            <select
              class="field-select"
              value={kind()}
              onChange={(e) => setKind(e.currentTarget.value as CategoryKind)}
            >
              <For each={[...categoryKinds]}>
                {(value) => <option value={value}>{kindLabel(value)}</option>}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="field-label">Parent</span>
            <select
              class="field-select"
              value={parentId()}
              onChange={(e) => setParentId(e.currentTarget.value)}
            >
              <option value="">None</option>
              <For each={topLevel()}>
                {(category) => <option value={category.id}>{category.name}</option>}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="field-label">Color</span>
            <ColorInput value={color()} onInput={setColor} />
          </label>
          <button type="submit" class="btn-primary" disabled={create.isPending}>
            <Icon icon={Plus} size={18} />
            Add category
          </button>
        </div>
        <div class="mt-3 flex min-h-6 items-center">
          <FieldError message={error()} />
          <Show when={added()}>{(value) => <SavedStamp label={`Added ${value()}`} />}</Show>
        </div>
      </form>

      <Show when={categories.isError}>
        <ErrorNotice title="Could not load categories" message={categories.error?.message} />
      </Show>

      <Show when={categories.data} fallback={<SkeletonRows rows={5} />}>
        {(rows) => (
          <Show
            when={rows().length > 0}
            fallback={
              <EmptyState icon={Tags} title="No categories yet">
                Add your first category above. Transactions can then be sorted into it.
              </EmptyState>
            }
          >
            <section aria-labelledby="category-list-title">
              <h2 id="category-list-title" class="mb-3 text-lg font-semibold">
                {plural(rows().length, "category", "categories")}
              </h2>
              <ul class="divide-y divide-rule overflow-hidden rounded-panel border border-rule bg-paper-raised">
                <For each={grouped(rows())} keyed={(entry) => entry.category.id}>
                  {(entry) => (
                    <CategoryRow
                      category={entry().category}
                      depth={entry().depth}
                      topLevel={topLevel()}
                    />
                  )}
                </For>
              </ul>
            </section>
          </Show>
        )}
      </Show>
    </div>
  );
}

function ColorInput(props: { value: string; onInput: (value: string) => void; label?: string }) {
  return (
    <span class="relative block h-11 w-full overflow-hidden rounded-control border border-rule-strong bg-paper-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-action">
      <span
        class="absolute inset-1.5 rounded-[0.4rem] transition-colors duration-200"
        style={{ background: props.value }}
        aria-hidden="true"
      />
      <input
        type="color"
        aria-label={props.label}
        class="absolute inset-0 size-full cursor-pointer opacity-0"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </span>
  );
}

function CategoryRow(props: { category: Category; depth: number; topLevel: readonly Category[] }) {
  const invalidate = useInvalidateCategories();
  const [editing, setEditing] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [name, setName] = createSignal(props.category.name);
  const [kind, setKind] = createSignal<CategoryKind>(props.category.kind);
  const [color, setColor] = createSignal(props.category.color ?? DEFAULT_COLOR);
  const [parentId, setParentId] = createSignal(props.category.parentId ?? "");
  const [error, setError] = createSignal<string>();
  const [saved, setSaved] = createSignal(false);

  const update = useMutation(() =>
    orpc.categories.update.mutationOptions({
      onSuccess: async () => {
        setError();
        setEditing(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2600);
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );
  const remove = useMutation(() =>
    orpc.categories.delete.mutationOptions({
      onSuccess: async () => {
        setError();
        setConfirming(false);
        await invalidate();
      },
      onError: (err) => {
        setConfirming(false);
        setError(err.message);
      },
    }),
  );

  const parentName = () =>
    props.topLevel.find((category) => category.id === props.category.parentId)?.name;
  const deleteMessage = () => {
    const used = props.category.transactions;
    return used
      ? `${plural(used, "transaction")} in "${props.category.name}" will become uncategorized.`
      : `"${props.category.name}" has no transactions.`;
  };

  return (
    <li class={["px-4 py-3", { "bg-paper-sunken/35": props.depth > 0 }]}>
      <Show
        when={editing()}
        fallback={
          <div class={["flex items-center gap-3", { "pl-6 sm:pl-8": props.depth > 0 }]}>
            <span
              class="size-4 shrink-0 rounded-full ring-2 ring-paper-raised outline outline-1 outline-rule-strong transition-colors duration-300"
              style={{ background: props.category.color ?? DEFAULT_COLOR }}
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2">
                <span class="font-medium break-words" dir="auto">
                  {props.category.name}
                </span>
                <Show when={saved()}>
                  <SavedStamp />
                </Show>
              </p>
              <p class="figures text-xs text-ink-soft">
                {kindLabel(props.category.kind)}
                <Show when={parentName()}>{(parent) => <>{`, in ${parent()}`}</>}</Show>
                {", "}
                {plural(props.category.transactions, "transaction")}
              </p>
            </div>
            <button
              type="button"
              class="btn-ghost min-h-10 px-3"
              aria-label={`Edit ${props.category.name}`}
              onClick={() => setEditing(true)}
            >
              <Icon icon={Pencil} size={16} />
              <span class="hidden sm:inline">Edit</span>
            </button>
            <button
              type="button"
              class="btn-ghost min-h-10 px-3 hover:bg-garnet-tint hover:text-garnet"
              aria-label={`Delete ${props.category.name}`}
              disabled={remove.isPending}
              onClick={() => setConfirming(true)}
            >
              <Icon icon={Trash} size={16} />
              <span class="hidden sm:inline">Delete</span>
            </button>
          </div>
        }
      >
        <form
          class="arrive grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_11rem_4rem_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({
              id: props.category.id,
              name: name().trim(),
              kind: kind(),
              color: color(),
              parentId: parentId() || null,
            });
          }}
        >
          <label class="block sm:col-span-2 lg:col-span-1">
            <span class="field-label">Name</span>
            <input
              class="field"
              maxlength="60"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <label class="block">
            <span class="field-label">Kind</span>
            <select
              class="field-select"
              value={kind()}
              onChange={(e) => setKind(e.currentTarget.value as CategoryKind)}
            >
              <For each={[...categoryKinds]}>
                {(value) => <option value={value}>{kindLabel(value)}</option>}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="field-label">Parent</span>
            <select
              class="field-select"
              value={parentId()}
              onChange={(e) => setParentId(e.currentTarget.value)}
            >
              <option value="">No parent</option>
              <For each={props.topLevel.filter((category) => category.id !== props.category.id)}>
                {(category) => <option value={category.id}>{category.name}</option>}
              </For>
            </select>
          </label>
          <label class="block">
            <span class="field-label">Color</span>
            <ColorInput value={color()} onInput={setColor} />
          </label>
          <div class="flex gap-2">
            <button type="button" class="btn-quiet flex-1" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" class="btn-primary flex-1" disabled={update.isPending}>
              Save
            </button>
          </div>
        </form>
      </Show>
      <div class={{ "mt-2": !!error() }}>
        <FieldError message={error()} />
      </div>
      <ConfirmDialog
        open={confirming()}
        title={`Delete ${props.category.name}?`}
        message={deleteMessage()}
        confirmLabel={remove.isPending ? "Deleting" : "Delete category"}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ id: props.category.id })}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}
