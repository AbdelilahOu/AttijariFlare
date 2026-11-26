import Seo from "~/components/seo";
import { useQuery } from "@tanstack/solid-query";
import { Banknote, ChevronDown, CreditCard, Split } from "lucide";
import { createSignal, For, Show } from "solid-js";

import AllocationEditor from "~/components/allocation-editor";
import Icon from "~/components/icon";
import {
  EmptyState,
  ErrorNotice,
  Money,
  PageHeader,
  RequireSession,
  SkeletonRows,
} from "~/components/ui";
import { formatDate, plural } from "~/lib/format";
import { orpc } from "~/utils/orpc";

export default function Withdrawals() {
  return (
    <>
      <Seo title="Split debits - AttijariFlare" path="/withdrawals" noindex />
      <RequireSession>
        <PageHeader
          title="Split debits"
          description="Say how a debit was spent. Cash withdrawals are listed first; any part left unallocated stays on the transaction's own category."
        />
        <DebitList />
      </RequireSession>
    </>
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
    <>
      <Show when={debits.isError}>
        <ErrorNotice title="Could not load debits" message={debits.error?.message} />
      </Show>
      <Show when={debits.data} fallback={<SkeletonRows rows={4} />}>
        {(rows) => (
          <Show
            when={rows().length > 0}
            fallback={
              <EmptyState icon={Split} title="No debits to split yet">
                Debits from your statements appear here once a statement is parsed.
              </EmptyState>
            }
          >
            <ul class="space-y-3">
              <For each={rows()} keyed={(row) => row.id}>
                {(row) => {
                  const isCash = () => row().type === "cash_withdrawal";
                  const isOpen = () => isCash() !== toggled().has(row().id);
                  const editorId = `split-${row().id}`;
                  const status = () =>
                    row().parts === 0
                      ? { text: "Not split", class: "bg-paper-sunken text-ink-soft" }
                      : row().remainder === 0
                        ? {
                            text: `${plural(row().parts, "part")}, fully split`,
                            class: "bg-mint-tint text-mint",
                          }
                        : {
                            text: `${plural(row().parts, "part")}`,
                            class: "bg-saffron-tint text-saffron",
                          };
                  return (
                    <li class="panel overflow-hidden">
                      <div class="flex flex-wrap items-start gap-x-4 gap-y-3 p-4">
                        <span
                          class={[
                            "grid size-10 shrink-0 place-items-center rounded-full",
                            isCash()
                              ? "bg-saffron-tint text-saffron"
                              : "bg-action-tint text-action",
                          ]}
                        >
                          <Icon icon={isCash() ? Banknote : CreditCard} size={20} />
                        </span>
                        <div class="min-w-0 flex-1 basis-48">
                          <p class="font-medium break-words" dir="auto">
                            {row().descriptionRaw}
                          </p>
                          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                            <span class="figures">{formatDate(row().bookingDate)}</span>
                            <span>{isCash() ? "Cash withdrawal" : "Debit"}</span>
                            <span
                              class={`rounded-full px-2 py-0.5 font-medium transition-colors duration-300 ${status().class}`}
                            >
                              {status().text}
                            </span>
                            <Show when={row().parts > 0 && row().remainder > 0}>
                              <span>
                                <Money centimes={row().remainder} class="text-saffron" /> left
                              </span>
                            </Show>
                          </p>
                        </div>
                        <div class="ml-auto flex items-center gap-3">
                          <Money centimes={row().amount} signed class="text-base font-semibold" />
                          <button
                            type="button"
                            class={[
                              "btn-quiet min-h-10 px-3",
                              { "border-action text-action": isOpen() },
                            ]}
                            aria-expanded={isOpen() ? "true" : "false"}
                            aria-controls={editorId}
                            onClick={() => toggle(row().id)}
                          >
                            {isOpen() ? "Hide" : "Split"}
                            <Icon
                              icon={ChevronDown}
                              size={16}
                              class={[
                                "transition-transform duration-200",
                                { "rotate-180": isOpen() },
                              ].join(" ")}
                            />
                          </button>
                        </div>
                      </div>
                      <Show when={isOpen()}>
                        <div
                          id={editorId}
                          class="arrive border-t border-rule bg-paper-sunken/40 p-3 sm:p-4"
                        >
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
    </>
  );
}
