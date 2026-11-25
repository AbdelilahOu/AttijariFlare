import { centimesToMad } from "@finance-ttijari/api/allocations/money";
import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";

import AllocationEditor from "~/components/allocation-editor";
import { useSession } from "~/lib/auth-client";
import { orpc } from "~/utils/orpc";

export default function Withdrawals() {
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
      <div class="mx-auto w-full max-w-4xl space-y-4 p-4">
        <h1 class="text-2xl font-bold">Split debits</h1>
        <p class="text-sm text-gray-600">
          Say how a debit was spent. Cash withdrawals are listed first; any part left unallocated
          stays on the transaction's own category.
        </p>
        <DebitList />
      </div>
    </Show>
  );
}

function DebitList() {
  const debits = useQuery(() => orpc.allocations.debits.queryOptions({ input: { limit: 100 } }));
  // Ids whose editor visibility was toggled away from the default
  // (open for cash withdrawals, closed for other debits).
  const [toggled, setToggled] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Show when={debits.data} fallback={<p>Loading...</p>}>
      {(rows) => (
        <Show when={rows().length > 0} fallback={<p>No debit transactions yet.</p>}>
          <ul class="space-y-3">
            <For each={rows()} keyed={(row) => row.id}>
              {(row) => {
                const isOpen = () => (row().type === "cash_withdrawal") !== toggled().has(row().id);
                return (
                  <li class="rounded border p-3">
                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span class="font-mono text-sm">{row().bookingDate}</span>{" "}
                        <span>{row().descriptionRaw}</span>{" "}
                        <span class="text-xs text-gray-500">{row().type}</span>
                      </div>
                      <div class="flex items-center gap-3 text-sm">
                        <span class="font-semibold">{centimesToMad(row().amount)} MAD</span>
                        <span>
                          {row().parts > 0
                            ? `${row().parts} parts, ${centimesToMad(row().remainder)} unallocated`
                            : "not split"}
                        </span>
                        <button
                          type="button"
                          class="rounded border px-2 py-1"
                          onClick={() => toggle(row().id)}
                        >
                          {isOpen() ? "Hide" : "Split"}
                        </button>
                      </div>
                    </div>
                    <Show when={isOpen()}>
                      <div class="mt-2">
                        <AllocationEditor transactionId={row().id} />
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      )}
    </Show>
  );
}
