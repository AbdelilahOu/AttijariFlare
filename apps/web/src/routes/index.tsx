import { useQuery } from "@tanstack/solid-query";
import type { IconNode } from "lucide";
import {
  ArrowDown,
  Banknote,
  Check,
  FileCheck,
  FileText,
  LayoutDashboard,
  Link2,
  Lock,
  Minus,
  Plus,
  ScanText,
  ServerCog,
  Smartphone,
  Sparkles,
  Split,
  Tags,
  Upload,
} from "lucide";
import { For, Show } from "solid-js";

import Guilloche from "~/components/guilloche";
import Icon from "~/components/icon";
import Seo from "~/components/seo";
import { Money } from "~/components/ui";
import { useSession } from "~/lib/auth-client";
import { SITE_NAME, SITE_URL } from "~/lib/seo";
import { orpc } from "~/utils/orpc";

// Landing copy lives in these constants so a French version can be added later without
// touching the markup.

const DESCRIPTION =
  "Personal finance app for Morocco. Upload your Attijariwafa bank PDF statement, AI extracts every transaction in MAD, checks it against your balances, sorts it into categories and splits your cash withdrawals. Free.";

/** Made-up rows for the hero mockup. Never real statement data. */
const EXAMPLE_LINES = [
  {
    date: "3 Oct",
    text: "PAIEMENT CARTE مخبزة الأمل",
    category: "Groceries",
    color: "#2f9e6b",
    amount: -48230,
  },
  {
    date: "5 Oct",
    text: "VIREMENT RECU SALAIRE",
    category: "Salary",
    color: "#3f5bd8",
    amount: 1250000,
  },
  {
    date: "9 Oct",
    text: "RETRAIT GAB AGENCE DEMO",
    category: "Cash, split 3 ways",
    color: "#c98a1b",
    amount: -100000,
  },
  {
    date: "12 Oct",
    text: "FACTURE TELEPHONE MOBILE",
    category: "Telecom",
    color: "#0d9488",
    amount: -19900,
  },
];

const STEPS: { icon: IconNode; title: string; text: string }[] = [
  {
    icon: Smartphone,
    title: "Export the PDF",
    text: "In the Attijari mobile app, download your monthly account statement as a PDF.",
  },
  {
    icon: Upload,
    title: "Upload it",
    text: "Drop one or several statements. A file you already uploaded is recognized and skipped.",
  },
  {
    icon: ScanText,
    title: "AI reads every row",
    text: "Dates, labels, amounts and running balances are extracted, then checked against the opening and closing balance.",
  },
  {
    icon: Tags,
    title: "Review and split",
    text: "Fix the few categories the app was unsure about and split cash withdrawals into what the cash paid for.",
  },
];

const FEATURES: { icon: IconNode; title: string; text: string }[] = [
  {
    icon: FileCheck,
    title: "Extraction checked against your balances",
    text: "The sum of every extracted row has to land on the statement's closing balance. If it does not, the statement is flagged for review instead of quietly filling your dashboard with wrong totals.",
  },
  {
    icon: Sparkles,
    title: "Categories that learn from you",
    text: "Each merchant is matched against the ones you have already categorized. Correct one transaction and the app offers to apply it to the merchant's other rows, and remembers it next month.",
  },
  {
    icon: Split,
    title: "Cash withdrawals you can split",
    text: "A 1 000 MAD ATM withdrawal is rarely one thing. Split it into groceries, transport and the rest, with equal-split and fill-remainder shortcuts.",
  },
  {
    icon: LayoutDashboard,
    title: "A monthly dashboard",
    text: "Money in, money out, net and closing balance for any range of months, spending by category, and a list of what still needs your attention.",
  },
  {
    icon: Link2,
    title: "Every row linked to its PDF",
    text: "Any transaction opens the original statement it came from, so checking a figure takes one tap.",
  },
];

type Cell = { text: string; yes?: boolean; no?: boolean };

const ALTERNATIVES = [
  { name: "YNAB", href: "https://www.ynab.com/" },
  { name: "Monarch", href: "https://www.monarch.com/" },
  { name: "A spreadsheet" },
];

/**
 * Comparison rows. Every claim about another product is taken from its official site
 * (sources are listed in the pull request); rows that could not be verified were left out.
 */
const COMPARISON: { label: string; us: Cell; them: Cell[] }[] = [
  {
    label: "How transactions get in",
    us: { text: "You upload the monthly PDF statement" },
    them: [
      { text: "Direct import for select US, Canadian, UK and EU banks, or a CSV file" },
      { text: "Syncs with 13,000+ institutions through data providers" },
      { text: "You type them in" },
    ],
  },
  {
    label: "Needs a bank API connection",
    us: { text: "Not needed", yes: true },
    them: [
      { text: "For direct import (Plaid)" },
      { text: "Yes, for syncing" },
      { text: "No", no: true },
    ],
  },
  {
    label: "Built for Moroccan statements in MAD",
    us: { text: "Yes, Attijariwafa bank, French and Arabic labels", yes: true },
    them: [
      { text: "One currency per budget, which you choose" },
      { text: "Prices billed in USD; Morocco not listed" },
      { text: "If you build it" },
    ],
  },
  {
    label: "Split a transaction across categories",
    us: { text: "Yes, including cash withdrawals", yes: true },
    them: [{ text: "Yes", yes: true }, { text: "Yes", yes: true }, { text: "By hand" }],
  },
  {
    label: "Price",
    us: { text: "Free", yes: true },
    them: [
      { text: "$14.99 a month or $109 a year, 34-day trial" },
      { text: "$14.99 a month or $99.99 a year, 7-day trial" },
      { text: "Free" },
    ],
  },
];

const PRIVACY: { icon: IconNode; title: string; text: string }[] = [
  {
    icon: Lock,
    title: "No bank login, ever",
    text: "There is nothing to connect. You never type your bank password or share credentials with the app.",
  },
  {
    icon: ServerCog,
    title: "Processed on Cloudflare",
    text: "Statements are read by Cloudflare Workers AI. Your PDFs and transactions are stored on Cloudflare (R2 and D1), and every query is scoped to your account.",
  },
  {
    icon: FileText,
    title: "Your statements stay yours",
    text: "Delete a statement and its transactions and the stored PDF are deleted with it.",
  },
];

const FAQ: { question: string; answer: string }[] = [
  {
    question: "Which banks does it work with?",
    answer:
      "Attijariwafa bank today. The app reads the monthly PDF account statement, so it needs no bank API and no partnership with the bank.",
  },
  {
    question: "Is it free?",
    answer: "Yes. Create an account and upload your statements at no cost.",
  },
  {
    question: "Is my data safe?",
    answer:
      "You never share your bank login. Statements are processed by Cloudflare Workers AI and stored on Cloudflare, only your account can see them, and you can delete any statement with its transactions at any time.",
  },
  {
    question: "What if the AI gets something wrong?",
    answer:
      "Every statement is checked against its opening and closing balance. When the totals do not match, the statement is marked Needs review. Categories the app was unsure about appear in the review list on your dashboard, and you can correct any of them. Deleting a statement and uploading it again runs the extraction again.",
  },
  {
    question: "Does it work on my phone?",
    answer:
      "Yes. It is a web app built for phones first: export the PDF from the Attijari mobile app, then upload it from your phone's browser.",
  },
  {
    question: "Can I split a cash withdrawal?",
    answer:
      "Yes. Split any debit into parts with their own category and note. Reports count the parts instead of the withdrawal.",
  },
];

function jsonLd() {
  return JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any (web browser)",
      browserRequirements: "Requires a modern web browser",
      inLanguage: "en",
      offers: { "@type": "Offer", price: "0", priceCurrency: "MAD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ]).replaceAll("<", "\\u003c");
}

export default function Home() {
  const session = useSession();
  const signedIn = () => !session().isPending && !!session().data;

  return (
    <>
      <Seo
        title="AttijariFlare: personal finance app for Morocco, from your Attijariwafa bank PDF statement"
        description={DESCRIPTION}
        path="/"
      />
      <script type="application/ld+json" innerHTML={jsonLd()} />

      <div class="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
        <Hero signedIn={signedIn()} />
        <Joke />
        <HowItWorks />
        <Features />
        <Comparison />
        <Privacy />
        <Faq />
        <ClosingCall signedIn={signedIn()} />
      </div>
      <SiteFooter />
    </>
  );
}

function PrimaryCta(props: { signedIn: boolean; class?: string }) {
  return (
    <Show
      when={props.signedIn}
      fallback={
        <a href="/login" class={`btn-primary ${props.class ?? ""}`}>
          Create a free account
        </a>
      }
    >
      <a href="/dashboard" class={`btn-primary ${props.class ?? ""}`}>
        Open your dashboard
      </a>
    </Show>
  );
}

function Hero(props: { signedIn: boolean }) {
  return (
    <section
      aria-labelledby="hero-title"
      class="relative overflow-hidden rounded-[1.25rem] bg-rail px-6 py-10 text-rail-ink sm:px-10 sm:py-14 lg:px-14 lg:py-16"
    >
      <Guilloche
        draw
        class="pointer-events-none absolute -right-32 -bottom-40 size-[34rem] text-flare/35 sm:-right-20 sm:-bottom-28"
      />
      <div class="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-center">
        <div>
          <p class="text-sm font-medium text-flare-soft">
            For Attijariwafa bank accounts in Morocco
          </p>
          <h1
            id="hero-title"
            class="mt-3 max-w-[17ch] text-3xl leading-[1.08] font-semibold sm:text-[2.75rem]"
            style={{ "font-variation-settings": '"HEXP" 70' }}
          >
            Your bank statement, turned into a budget in MAD.
          </h1>
          <p class="mt-5 max-w-[52ch] text-rail-ink-soft">
            Upload the monthly PDF from the Attijari mobile app. AI reads every line, checks it
            against your balances and sorts it into categories, French and Arabic labels included.
            Then split those cash withdrawals into what they really paid for.
          </p>
          <p class="mt-3 max-w-[52ch] text-sm text-rail-ink-soft" lang="fr">
            Suivi des dépenses au Maroc à partir de votre relevé de compte PDF, budget en MAD.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <PrimaryCta signedIn={props.signedIn} />
            <a
              href="#how-it-works"
              class="btn border border-rail-line text-rail-ink hover:bg-rail-line"
            >
              <Icon icon={ArrowDown} size={18} />
              See how it works
            </a>
          </div>
        </div>
        <HeroMockup />
      </div>
    </section>
  );
}

function HeroMockup() {
  return (
    <figure class="rounded-panel bg-paper-raised p-4 text-ink shadow-overlay">
      <figcaption class="mb-3 flex items-baseline justify-between text-xs text-ink-faint">
        <span>October, example</span>
        <span>Made-up figures</span>
      </figcaption>
      <dl class="grid grid-cols-2 gap-3 rounded-control bg-paper-sunken p-3">
        <div>
          <dt class="text-xs text-ink-soft">Money in</dt>
          <dd class="mt-0.5 text-lg font-semibold">
            <Money centimes={1250000} signed currency={false} />
          </dd>
        </div>
        <div>
          <dt class="text-xs text-ink-soft">Money out</dt>
          <dd class="mt-0.5 text-lg font-semibold">
            <Money centimes={-168130} currency={false} />
          </dd>
        </div>
      </dl>
      <ul class="mt-2 divide-y divide-rule">
        <For each={EXAMPLE_LINES}>
          {(line) => (
            <li class="flex items-start justify-between gap-3 py-2.5">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium" dir="auto">
                  {line.text}
                </p>
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
  );
}

function Joke() {
  return (
    <section
      aria-labelledby="joke-title"
      class="mt-14 grid gap-4 border-y border-rule py-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-8"
    >
      <span class="grid size-14 place-items-center rounded-full bg-flare-tint text-flare">
        <Icon icon={FileText} size={26} />
      </span>
      <div>
        <h2 id="joke-title" class="text-xl font-semibold">
          No bank API? No problem.
        </h2>
        <p class="mt-2 max-w-[70ch] text-ink-soft">
          Most budgeting apps plug straight into your bank through an open banking API. In Morocco
          there is no such API to plug into. So AttijariFlare reads your PDF statement, like it is
          2009. It works better than it sounds, and it is exactly why it works for Moroccan
          accounts.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" class="mt-16 scroll-mt-6">
      <h2 id="how-title" class="text-2xl font-semibold">
        How it works
      </h2>
      <p class="mt-2 max-w-[60ch] text-ink-soft">
        From the PDF on your phone to a month you can read, in four steps.
      </p>
      <ol class="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <For each={STEPS}>
          {(step, index) => (
            <li class="border-t border-rule-strong pt-4">
              <div class="flex items-center gap-3">
                <span class="figures grid size-8 place-items-center rounded-full bg-flare-tint text-sm font-semibold text-action">
                  {index() + 1}
                </span>
                <Icon icon={step.icon} class="text-ink-faint" />
              </div>
              <h3 class="mt-4 font-semibold">{step.title}</h3>
              <p class="mt-1.5 text-sm text-ink-soft">{step.text}</p>
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

function Features() {
  const [lead, ...rest] = FEATURES;
  return (
    <section aria-labelledby="features-title" class="mt-20">
      <h2 id="features-title" class="text-2xl font-semibold">
        Built for how money moves in Morocco
      </h2>
      <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Show when={lead}>
          {(feature) => (
            <article class="relative overflow-hidden rounded-panel bg-rail p-6 text-rail-ink sm:p-8">
              <Guilloche class="pointer-events-none absolute -top-20 -right-20 size-72 text-flare/25" />
              <span class="relative grid size-11 place-items-center rounded-full bg-flare text-flare-ink">
                <Icon icon={feature().icon} size={22} />
              </span>
              <h3 class="relative mt-5 text-xl font-semibold">{feature().title}</h3>
              <p class="relative mt-2 max-w-[52ch] text-rail-ink-soft">{feature().text}</p>
              <BalanceCheckMockup />
            </article>
          )}
        </Show>
        <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
          <For each={rest}>
            {(feature) => (
              <li class="flex gap-4">
                <span class="grid size-10 shrink-0 place-items-center rounded-full bg-flare-tint text-action">
                  <Icon icon={feature.icon} size={20} />
                </span>
                <div>
                  <h3 class="font-semibold">{feature.title}</h3>
                  <p class="mt-1 text-sm text-ink-soft">{feature.text}</p>
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}

/** A small, static picture of the balance check: made-up figures. */
function BalanceCheckMockup() {
  const rows = [
    { label: "Opening balance", value: 2340000 },
    { label: "Sum of 21 extracted rows", value: 368812 },
    { label: "Closing balance on the PDF", value: 2708812 },
  ];
  return (
    <figure class="relative mt-6 rounded-control bg-paper-raised p-4 text-sm text-ink">
      <figcaption class="sr-only">Example balance check with made-up figures</figcaption>
      <dl class="space-y-2">
        <For each={rows}>
          {(row) => (
            <div class="flex items-baseline justify-between gap-3">
              <dt class="text-ink-soft">{row.label}</dt>
              <dd>
                <Money centimes={row.value} class="font-medium" />
              </dd>
            </div>
          )}
        </For>
      </dl>
      <p class="mt-3 flex items-center gap-1.5 border-t border-rule pt-3 font-medium text-mint">
        <Icon icon={Check} size={16} strokeWidth={2.25} />
        Totals match. Statement parsed.
      </p>
    </figure>
  );
}

function CellView(props: { cell: Cell }) {
  return (
    <span class="flex items-start gap-1.5">
      <Show when={props.cell.yes}>
        <Icon icon={Check} size={16} strokeWidth={2.25} class="mt-0.5 text-mint" />
      </Show>
      <Show when={props.cell.no}>
        <Icon icon={Minus} size={16} strokeWidth={2.25} class="mt-0.5 text-ink-faint" />
      </Show>
      <span>{props.cell.text}</span>
    </span>
  );
}

function Comparison() {
  return (
    <section aria-labelledby="compare-title" class="mt-20">
      <h2 id="compare-title" class="text-2xl font-semibold">
        AttijariFlare and the alternatives
      </h2>
      <p class="mt-2 max-w-[64ch] text-ink-soft">
        Good apps, built for banks that offer an API. Here is how they compare when your bank
        account is in Morocco.
      </p>
      <div class="relative mt-6 overflow-x-auto rounded-panel border border-rule bg-paper-raised">
        <table class="w-full min-w-[46rem] border-collapse text-left text-sm">
          <caption class="sr-only">
            AttijariFlare compared with YNAB, Monarch and a spreadsheet
          </caption>
          <thead>
            <tr class="border-b border-rule">
              <th scope="col" class="w-[22%] p-4 font-medium text-ink-soft">
                <span class="sr-only">Feature</span>
              </th>
              <th scope="col" class="w-[22%] bg-flare-tint p-4 font-semibold text-ink">
                AttijariFlare
              </th>
              <For each={ALTERNATIVES}>
                {(alternative) => (
                  <th scope="col" class="p-4 font-semibold">
                    <Show when={alternative.href} fallback={alternative.name}>
                      {(href) => (
                        <a class="link" href={href()} rel="noopener" target="_blank">
                          {alternative.name}
                          <span class="sr-only"> (opens in a new tab)</span>
                        </a>
                      )}
                    </Show>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={COMPARISON}>
              {(row) => (
                <tr class="border-b border-rule last:border-0">
                  <th scope="row" class="p-4 align-top font-medium">
                    {row.label}
                  </th>
                  <td class="bg-flare-tint/60 p-4 align-top font-medium">
                    <CellView cell={row.us} />
                  </td>
                  <For each={row.them}>
                    {(cell) => (
                      <td class="p-4 align-top text-ink-soft">
                        <CellView cell={cell} />
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <p class="mt-3 text-xs text-ink-faint">
        Facts about other apps come from their official websites as of November 2026; prices are in
        US dollars. If your bank offers an API, those apps will sync it for you. Ours will not. It
        reads the PDF, and it is rather proud of it.
      </p>
    </section>
  );
}

function Privacy() {
  return (
    <section aria-labelledby="privacy-title" class="mt-20">
      <h2 id="privacy-title" class="text-2xl font-semibold">
        Privacy and trust
      </h2>
      <ul class="mt-8 grid gap-8 md:grid-cols-3">
        <For each={PRIVACY}>
          {(item) => (
            <li>
              <Icon icon={item.icon} size={24} class="text-action" />
              <h3 class="mt-3 font-semibold">{item.title}</h3>
              <p class="mt-1.5 text-sm text-ink-soft">{item.text}</p>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function Faq() {
  return (
    <section aria-labelledby="faq-title" class="mt-20">
      <h2 id="faq-title" class="text-2xl font-semibold">
        Questions
      </h2>
      <div class="mt-6 divide-y divide-rule border-y border-rule">
        <For each={FAQ}>
          {(item) => (
            <details class="group">
              <summary class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium select-none [&::-webkit-details-marker]:hidden">
                <h3 class="text-base">{item.question}</h3>
                <span
                  class="grid size-7 shrink-0 place-items-center rounded-full bg-paper-sunken text-ink-soft transition-transform duration-200 group-open:rotate-45"
                  aria-hidden="true"
                >
                  <Icon icon={Plus} size={16} strokeWidth={2} />
                </span>
              </summary>
              <p class="max-w-[70ch] pb-5 text-ink-soft">{item.answer}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}

function ClosingCall(props: { signedIn: boolean }) {
  return (
    <section
      aria-labelledby="closing-title"
      class="relative mt-20 overflow-hidden rounded-[1.25rem] bg-rail px-6 py-10 text-rail-ink sm:px-10"
    >
      <Guilloche class="pointer-events-none absolute -top-24 -right-24 size-80 text-flare/25" />
      <div class="relative flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 id="closing-title" class="text-2xl font-semibold">
            Read your next statement in minutes
          </h2>
          <p class="mt-2 max-w-[48ch] text-rail-ink-soft">
            Upload last month's PDF and see where the dirhams went.
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <PrimaryCta signedIn={props.signedIn} />
          <Show when={!props.signedIn}>
            <a
              href="/login?mode=signin"
              class="btn border border-rail-line text-rail-ink hover:bg-rail-line"
            >
              Sign in
            </a>
          </Show>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const healthCheck = useQuery(() => ({
    ...orpc.healthCheck.queryOptions(),
    deferStream: true,
  }));
  const isConnected = () => healthCheck.data === "OK";

  return (
    <footer class="border-t border-rule">
      <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-ink-soft sm:px-6">
        <p class="flex items-center gap-2">
          <Icon icon={Banknote} size={18} class="text-flare" />
          AttijariFlare, made in Morocco. Not affiliated with Attijariwafa bank.
        </p>
        <nav aria-label="Footer" class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a class="hover:text-ink hover:underline" href="/login?mode=signin">
            Sign in
          </a>
          <a class="hover:text-ink hover:underline" href="/login">
            Create an account
          </a>
          <a class="hover:text-ink hover:underline" href="#faq-title">
            Questions
          </a>
          <a
            class="hover:text-ink hover:underline"
            href="https://github.com/AbdelilahOu/AttijariFlare"
            rel="noopener"
            target="_blank"
          >
            Source code on GitHub
            <span class="sr-only"> (opens in a new tab)</span>
          </a>
          <span class="flex items-center gap-2 text-xs">
            <span
              class={[
                "inline-block size-2 rounded-full",
                healthCheck.isPending ? "bg-saffron" : isConnected() ? "bg-mint" : "bg-garnet",
              ]}
              aria-hidden="true"
            />
            <span role="status">
              {healthCheck.isPending
                ? "Checking the service"
                : isConnected()
                  ? "Service online"
                  : "Service unreachable"}
            </span>
          </span>
        </nav>
      </div>
    </footer>
  );
}
