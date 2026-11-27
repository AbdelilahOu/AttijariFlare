import { For, type Element, Show } from "solid-js";

import Seo from "~/components/seo";

// The public privacy notice. Keep it in step with PRIVACY.md (the long form) and bump
// PRIVACY_POLICY_VERSION in packages/api/src/privacy.ts when a change needs new consent:
// uploads are refused until the user accepts the current version.
const PRIVACY_VERSION = "2026-11-27";

/** Privacy contact of the operator. Empty until the operator publishes one. */
const PRIVACY_CONTACT = "";

type Block = { title: string; body: Element };

const BLOCKS: Block[] = [
  {
    title: "Who processes your data",
    body: (
      <p>
        AttijariFlare is a personal project run by one individual in Morocco, who is the controller
        of the data described here. It is not affiliated with Attijariwafa bank. The declaration of
        this processing to the CNDP (Commission nationale de contrôle de la protection des données à
        caractère personnel, loi 09-08) is being prepared; its receipt number will be shown here.
      </p>
    ),
  },
  {
    title: "What is stored",
    body: (
      <ul>
        <li>
          Your account: name, email address, a hash of your password, and your sessions (with the IP
          address and browser user agent better-auth records for each session).
        </li>
        <li>The PDF statements you upload, unchanged, with their file name.</li>
        <li>
          What is read from each statement: account label, period, opening and closing balances, and
          every transaction (dates, description as printed, amount, running balance).
        </li>
        <li>
          What you and the app add: categories, merchants derived from descriptions (which can
          include the names of people you send money to or receive it from), split allocations and
          their notes.
        </li>
        <li>When you accepted this notice, and which version.</li>
      </ul>
    ),
  },
  {
    title: "Why",
    body: (
      <p>
        Only to show you your own spending: extract the transactions of your statements, categorize
        them, and report on them. Nothing is used for advertising, profiling, credit decisions or
        sold to anyone. There are no advertising or third-party tracking scripts, and the only
        cookie is the sign-in session cookie. Page visits are measured with Cloudflare Web
        Analytics, described below.
      </p>
    ),
  },
  {
    title: "How a statement is processed",
    body: (
      <ol>
        <li>The PDF is stored in a private Cloudflare R2 bucket.</li>
        <li>
          Cloudflare Workers AI converts it to text, and a language model (Llama 3.3 70B on Workers
          AI) reads the transactions from that text.
        </li>
        <li>The transactions are stored in a Cloudflare D1 database, tied to your account.</li>
        <li>
          Merchant names are turned into embeddings (bge-m3 on Workers AI) and stored in Cloudflare
          Vectorize to suggest categories. Merchants the app cannot place are sent with one sample
          description and your category names to the same language model.
        </li>
        <li>Your dashboard reads only your own rows; every query is scoped to your account.</li>
      </ol>
    ),
  },
  {
    title: "Where",
    body: (
      <p>
        Everything runs on Cloudflare, which acts as processor. The database and the PDF storage of
        this site were created in Cloudflare's Western North America region (no EU jurisdiction was
        chosen), so your data is stored outside Morocco. Cloudflare states that it does not use
        content processed by Workers AI to train models and does not keep inputs or outputs after
        the request. Cloudflare lists its own subprocessors for Workers AI.
      </p>
    ),
  },
  {
    title: "Visit analytics",
    body: (
      <p>
        Cloudflare, which hosts this site, adds its Web Analytics script to the pages. For each page
        view it reports which page was opened, how long it took to load, the referring site, and the
        browser, device type and country, to Cloudflare. Cloudflare states that it sets no cookies,
        stores nothing in your browser and does not fingerprint visitors. It never sees your
        statements or transactions: those are only shown to you after you sign in, and the script
        measures page loads, not page content. The figures are only used to see how fast the site
        is and which pages are visited.
      </p>
    ),
  },
  {
    title: "How long",
    body: (
      <ul>
        <li>
          Statements, transactions and the original PDF: until you delete them or your account.
        </li>
        <li>
          Temporary extraction files (the text of the PDF and the model's answer): deleted as soon
          as a statement is read without problems; kept while it needs review or failed, so it can
          be checked, and deleted with the statement.
        </li>
        <li>
          Deleted database rows can remain in Cloudflare D1's point-in-time recovery for up to 7
          days. Deleted PDFs are not kept.
        </li>
        <li>Server logs hold ids, counts and error kinds only, and expire after a few days.</li>
      </ul>
    ),
  },
  {
    title: "Your rights",
    body: (
      <ul>
        <li>See your data: it is all in the app (statements, transactions, categories).</li>
        <li>Correct it: change any category or split; delete and re-upload a statement.</li>
        <li>
          Delete it: deleting a statement deletes its PDF, its transactions and splits, and the
          merchants only it used. "Delete my account" in the account menu deletes everything,
          including the PDFs and embeddings, then the account itself.
        </li>
        <li>
          Under loi 09-08 you can also ask the controller for access, rectification or deletion, or
          object to the processing, and you can complain to the CNDP.
        </li>
      </ul>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        Traffic is encrypted (HTTPS). The session cookie is HttpOnly, Secure and SameSite=Lax. PDFs
        are only served to their owner after a session check, never cached. The source code is
        public on GitHub, so these claims can be checked.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <Seo
        title="Privacy - AttijariFlare"
        description="What AttijariFlare stores from your Attijariwafa bank statements, why, where it is processed (Cloudflare), how long it is kept and how to delete it."
        path="/privacy"
      />
      <article class="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6 lg:pt-12">
        <h1 class="text-3xl font-semibold lg:text-4xl">Privacy</h1>
        <p class="mt-3 text-ink-soft">
          Your bank statements are personal and financial data. This page says what happens to them.
          Version {PRIVACY_VERSION}.
        </p>
        <div class="mt-10 space-y-10">
          <For each={BLOCKS}>
            {(block) => (
              <section>
                <h2 class="text-xl font-semibold">{block.title}</h2>
                <div class="prose-notice mt-3 text-ink-soft">{block.body}</div>
              </section>
            )}
          </For>
          <section>
            <h2 class="text-xl font-semibold">Contact</h2>
            <div class="prose-notice mt-3 text-ink-soft">
              <Show
                when={PRIVACY_CONTACT}
                fallback={
                  <p>
                    A privacy contact address will be published here before sign-ups reopen. Until
                    then, you can delete your data yourself at any time from the app.
                  </p>
                }
              >
                {(contact) => (
                  <p>
                    Write to{" "}
                    <a class="link" href={`mailto:${contact()}`}>
                      {contact()}
                    </a>{" "}
                    for any request about your data.
                  </p>
                )}
              </Show>
            </div>
          </section>
        </div>
      </article>
    </>
  );
}
