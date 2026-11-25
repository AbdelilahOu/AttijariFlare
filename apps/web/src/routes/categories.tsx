import { categoryKinds } from "@finance-ttijari/api/enums";
import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";

import { useSession } from "~/lib/auth-client";
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

export default function Categories() {
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
      <div class="mx-auto w-full max-w-3xl space-y-4 p-4">
        <h1 class="text-2xl font-bold">Categories</h1>
        <CategoryManager />
      </div>
    </Show>
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

function CategoryManager() {
  const categories = useQuery(() => orpc.categories.list.queryOptions());
  const invalidate = useInvalidateCategories();

  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<CategoryKind>("expense");
  const [color, setColor] = createSignal(DEFAULT_COLOR);
  const [parentId, setParentId] = createSignal("");
  const [error, setError] = createSignal<string>();

  const create = useMutation(() =>
    orpc.categories.create.mutationOptions({
      onSuccess: async () => {
        setError();
        setName("");
        setParentId("");
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const topLevel = () => (categories.data ?? []).filter((category) => !category.parentId);

  return (
    <div class="space-y-4">
      <form
        class="flex flex-wrap items-end gap-2 rounded border p-3 text-sm"
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
        <label class="flex flex-col">
          <span>Name</span>
          <input
            class="rounded border p-1"
            maxlength="60"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label class="flex flex-col">
          <span>Kind</span>
          <select
            class="rounded border p-1"
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as CategoryKind)}
          >
            <For each={[...categoryKinds]}>{(value) => <option value={value}>{value}</option>}</For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Parent</span>
          <select
            class="rounded border p-1"
            value={parentId()}
            onChange={(e) => setParentId(e.currentTarget.value)}
          >
            <option value="">None</option>
            <For each={topLevel()}>
              {(category) => <option value={category.id}>{category.name}</option>}
            </For>
          </select>
        </label>
        <label class="flex flex-col">
          <span>Color</span>
          <input
            type="color"
            class="h-8 w-12 rounded border"
            value={color()}
            onInput={(e) => setColor(e.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="rounded bg-indigo-600 px-3 py-1 text-white disabled:opacity-50"
          disabled={create.isPending}
        >
          Add category
        </button>
        <Show when={error()}>{(message) => <p class="w-full text-red-600">{message()}</p>}</Show>
      </form>

      <Show when={categories.data} fallback={<p>Loading...</p>}>
        {(rows) => (
          <ul class="divide-y rounded border">
            <For each={rows()} keyed={(row) => row.id}>
              {(row) => <CategoryRow category={row()} topLevel={topLevel()} />}
            </For>
          </ul>
        )}
      </Show>
    </div>
  );
}

function CategoryRow(props: { category: Category; topLevel: readonly Category[] }) {
  const invalidate = useInvalidateCategories();
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal(props.category.name);
  const [kind, setKind] = createSignal<CategoryKind>(props.category.kind);
  const [color, setColor] = createSignal(props.category.color ?? DEFAULT_COLOR);
  const [parentId, setParentId] = createSignal(props.category.parentId ?? "");
  const [error, setError] = createSignal<string>();

  const update = useMutation(() =>
    orpc.categories.update.mutationOptions({
      onSuccess: async () => {
        setError();
        setEditing(false);
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );
  const remove = useMutation(() =>
    orpc.categories.delete.mutationOptions({
      onSuccess: async () => {
        setError();
        await invalidate();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const parentName = () =>
    props.topLevel.find((category) => category.id === props.category.parentId)?.name;

  return (
    <li class="space-y-1 p-2 text-sm">
      <Show
        when={editing()}
        fallback={
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-block h-3 w-3 rounded-full"
              style={{ background: props.category.color ?? DEFAULT_COLOR }}
            />
            <span class="font-medium">{props.category.name}</span>
            <span class="text-xs text-gray-500">
              {props.category.kind}
              <Show when={parentName()}>{(parent) => <> in {parent()}</>}</Show>
              {" - "}
              {props.category.transactions} transaction
              {props.category.transactions === 1 ? "" : "s"}
            </span>
            <span class="flex-1" />
            <button type="button" class="rounded border px-2 py-1" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              class="rounded border px-2 py-1 disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => {
                const used = props.category.transactions;
                const message = used
                  ? `Delete "${props.category.name}"? ${used} transaction(s) become uncategorized.`
                  : `Delete "${props.category.name}"?`;
                if (window.confirm(message)) remove.mutate({ id: props.category.id });
              }}
            >
              Delete
            </button>
          </div>
        }
      >
        <form
          class="flex flex-wrap items-center gap-2"
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
          <input
            aria-label="Name"
            class="rounded border p-1"
            maxlength="60"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <select
            aria-label="Kind"
            class="rounded border p-1"
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as CategoryKind)}
          >
            <For each={[...categoryKinds]}>{(value) => <option value={value}>{value}</option>}</For>
          </select>
          <select
            aria-label="Parent"
            class="rounded border p-1"
            value={parentId()}
            onChange={(e) => setParentId(e.currentTarget.value)}
          >
            <option value="">No parent</option>
            <For each={props.topLevel.filter((category) => category.id !== props.category.id)}>
              {(category) => <option value={category.id}>{category.name}</option>}
            </For>
          </select>
          <input
            aria-label="Color"
            type="color"
            class="h-8 w-12 rounded border"
            value={color()}
            onInput={(e) => setColor(e.currentTarget.value)}
          />
          <button
            type="submit"
            class="rounded bg-indigo-600 px-2 py-1 text-white disabled:opacity-50"
            disabled={update.isPending}
          >
            Save
          </button>
          <button type="button" class="rounded border px-2 py-1" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </Show>
      <Show when={error()}>{(message) => <p class="text-red-600">{message()}</p>}</Show>
    </li>
  );
}
