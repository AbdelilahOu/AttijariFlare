import { useQuery } from "@tanstack/solid-query";
import { FileSearch, FileUp, LayoutDashboard } from "lucide";
import { For, Show } from "solid-js";

import Guilloche from "~/components/guilloche";
import Icon from "~/components/icon";
import { Money } from "~/components/ui";
import { useSession } from "~/lib/auth-client";
import { orpc } from "~/utils/orpc";

const EXAMPLE_LINES = [
  {
    date: "3 Mar",
    text: "PAIEMENT CARTE مخبزة الأمل",
    category: "Groceries",
    color: "#2f9e6b",
    amount: -48230,
  },
  {
    date: "5 Mar",
    text: "VIREMENT RECU SALAIRE",
    category: "Salary",
    color: "#3f5bd8",
    amount: 1250000,
  },
  {
    date: "9 Mar",
    text: "RETRAIT GAB",
    category: "Cash, split 3 ways",
    color: "#c98a1b",
    amount: -100000,
  },
];

const STEPS = [
  {
    icon: FileUp,
    title: "Upload the statement",
    text: "Drop the monthly PDF. Transactions are read out of it in the background.",
  },
  {
    icon: FileSearch,
    title: "Check what is unsure",
    text: "Fix the few categories the app guessed with low confidence and split cash withdrawals.",
  },
  {
    icon: LayoutDashboard,
    title: "Read the month",
    text: "Money in, money out, balance and spending by category for any range of months.",
  },
];

export default function Home() {
  const session = useSession();
  const healthCheck = useQuery(() => ({
    ...orpc.healthCheck.queryOptions(),
    deferStream: true,
  }));
  const isConnected = () => healthCheck.data === "OK";

  return (
    <div class="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <section class="relative overflow-hidden rounded-[1.25rem] bg-rail px-6 py-10 text-rail-ink sm:px-10 sm:py-14 lg:px-14 lg:py-16">
        <Guilloche
          draw
          class="pointer-events-none absolute -right-32 -bottom-40 size-[34rem] text-flare/35 sm:-right-20 sm:-bottom-28"
        />
        <div class="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
          <div>
            <h1
              class="max-w-[16ch] text-3xl leading-[1.08] font-semibold sm:text-[2.75rem]"
              style={{ "font-variation-settings": '"HEXP" 70' }}
            >
              Your Attijari statements, read and sorted.
            </h1>
            <p class="mt-5 max-w-[48ch] text-rail-ink-soft">
              A private ledger for one account holder. Upload the monthly PDF and every line lands
              in a category you can trust, French and Arabic descriptions alike.
            </p>
            <div class="mt-8 flex flex-wrap gap-3">
              <Show
                when={!session().isPending && session().data}
                fallback={
                  <a href="/login" class="btn-primary">
                    Sign in
                  </a>
                }
              >
                <a href="/dashboard" class="btn-primary">
                  Open dashboard
                </a>
              </Show>
            </div>
          </div>

          <figure class="rounded-panel bg-paper-raised p-4 text-ink shadow-overlay">
            <figcaption class="mb-2 flex items-baseline justify-between text-xs text-ink-faint">
              <span>Example lines</span>
              <span>Made-up figures</span>
            </figcaption>
            <ul class="divide-y divide-rule">
              <For each={EXAMPLE_LINES}>
                {(line) => (
                  <li class="flex items-start justify-between gap-3 py-2.5">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">{line.text}</p>
                      <p class="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                        <span class="figures">{line.date}</span>
                        <span
                          class="inline-block size-2 rounded-full"
                          style={{ background: line.color }}
                          aria-hidden="true"
                        />
                        {line.category}
                      </p>
                    </div>
                    <Money centimes={line.amount} signed class="shrink-0 text-sm font-semibold" />
                  </li>
                )}
              </For>
            </ul>
          </figure>
        </div>
      </section>

      <section aria-labelledby="how-title" class="mt-14">
        <h2 id="how-title" class="text-xl font-semibold">
          A month in three steps
        </h2>
        <ol class="mt-6 grid gap-8 sm:grid-cols-3">
          <For each={STEPS}>
            {(step, index) => (
              <li class="border-t border-rule-strong pt-4">
                <div class="flex items-center gap-3">
                  <span class="figures grid size-8 place-items-center rounded-full bg-action-tint text-sm font-semibold text-action">
                    {index() + 1}
                  </span>
                  <Icon icon={step.icon} class="text-ink-faint" />
                </div>
                <h3 class="mt-4 font-semibold">{step.title}</h3>
                <p class="mt-1.5 max-w-[36ch] text-sm text-ink-soft">{step.text}</p>
              </li>
            )}
          </For>
        </ol>
      </section>

      <footer class="mt-16 flex items-center gap-2 border-t border-rule pt-4 text-xs text-ink-soft">
        <span
          class={[
            "inline-block size-2 rounded-full",
            healthCheck.isPending ? "bg-saffron" : isConnected() ? "bg-mint" : "bg-garnet",
          ]}
          aria-hidden="true"
        />
        <span role="status">
          {healthCheck.isPending
            ? "Checking the API"
            : isConnected()
              ? "API connected"
              : "API unreachable"}
        </span>
      </footer>
    </div>
  );
}
