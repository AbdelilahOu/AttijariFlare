# Privacy audit

> Not legal advice. This is an engineering audit of what the code does with personal data,
> written to support the operator's own compliance work under Moroccan loi 09-08. It does not
> say whether the processing is lawful.

Audited on 2026-11-26 against `main` at `0b2c9e0`, plus the fixes in this change (issue #25).
"Before" describes `main`; "Now" describes this branch. File references are repository paths;
function names are given so they survive line moves.

## 1. Data inventory (`packages/db`)

Every finance table carries `user_id` (`packages/db/src/schema/finance.ts`, helper `userId()`),
with `ON DELETE CASCADE` to `user.id`. Deletion code no longer relies on the cascade (see 4).

| Table.column                                                                 | Personal / financial content                                   | Purpose                         | Source                                                         | Retention                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `user.name`, `user.email`                                                    | Identity, contact                                              | Sign-in, account menu           | Sign-up form                                                   | Until account deletion                                                                            |
| `user.image`                                                                 | Unused (always null)                                           | -                               | -                                                              | -                                                                                                 |
| `user.privacy_accepted_at`, `user.privacy_policy_version`                    | Consent record                                                 | Upload consent (new)            | Upload page                                                    | Until account deletion                                                                            |
| `account.password`                                                           | scrypt hash of the password                                    | Sign-in                         | Sign-up                                                        | Until account deletion                                                                            |
| `account.access_token`, `refresh_token`, `id_token`                          | Unused (no OAuth provider)                                     | -                               | -                                                              | -                                                                                                 |
| `session.token`, `ip_address`, `user_agent`, `expires_at`                    | Session secret, IP, browser                                    | Sign-in sessions                | better-auth on sign-in                                         | 7 days (better-auth default `expiresIn`), deleted with the user                                   |
| `verification.*`                                                             | Unused today (no email verification, no reset)                 | -                               | -                                                              | -                                                                                                 |
| `statements.file_name`                                                       | Name of the uploaded file (may contain a name or date)         | Display, `Content-Disposition`  | Upload                                                         | Until statement deletion                                                                          |
| `statements.sha256`                                                          | Hash of the PDF                                                | Duplicate detection             | Upload                                                         | Until statement deletion                                                                          |
| `statements.account_label`                                                   | Account name or masked number as printed                       | Display                         | LLM extraction                                                 | Until statement deletion                                                                          |
| `statements.period_start/end`, `opening_balance`, `closing_balance`          | Financial                                                      | Reports, reconciliation         | LLM extraction                                                 | Until statement deletion                                                                          |
| `statements.error`                                                           | Extraction error summary (now redacted, see 6)                 | Shown to the owner              | Ingest consumer                                                | Until statement deletion or re-extraction                                                         |
| `statements.r2_key`, `status`, `model`                                       | Technical                                                      | Processing                      | Server                                                         | Until statement deletion                                                                          |
| `transactions.booking_date`, `value_date`, `amount`, `balance_after`, `type` | Financial                                                      | Reports                         | LLM extraction                                                 | Until statement deletion                                                                          |
| `transactions.description_raw`, `description_normalized`                     | Merchant names, and for transfers the name of the other person | Display, search, categorization | LLM extraction                                                 | Until statement deletion                                                                          |
| `transactions.category_id`, `category_source`, `confidence`, `merchant_id`   | Derived                                                        | Reports                         | Categorization or user                                         | Until statement deletion                                                                          |
| `transactions.fingerprint`                                                   | SHA-256 of user id and row fields                              | Idempotent re-ingest            | Server                                                         | Until statement deletion                                                                          |
| `merchants.normalized_name`                                                  | Merchant name, or `virement recu <person>` for transfers       | Categorization                  | Derived from descriptions (`categorization/utils/merchant.ts`) | Now: until no transaction references it (statement deletion) or account deletion. Before: forever |
| `merchants.default_category_id`, `vector_id`                                 | Learned preference                                             | Categorization                  | User correction                                                | As above                                                                                          |
| `categories.*`                                                               | User's category names and colors                               | Reports                         | Seeded defaults, user                                          | Until account deletion                                                                            |
| `transaction_allocations.amount`, `note`                                     | Financial, free text                                           | Splits                          | User                                                           | Until its transaction is deleted                                                                  |

Outside D1:

| Store                                            | Content                                                                                                                                                                                             | Retention                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R2 `statements/{id}/original.pdf`                | The full statement: holder name, address, account number, every transaction. `customMetadata` holds `userId` and `fileName`                                                                         | Until statement or account deletion                                                                                    |
| R2 `statements/{id}/extracted.md`                | Full text of the PDF from `toMarkdown`                                                                                                                                                              | Now: deleted when a run ends `parsed`; kept while `needs_review`/`failed`; deleted with the statement. Before: forever |
| R2 `statements/{id}/extraction.json`             | The model's answer (all transactions) and, on failure, each attempt's raw output                                                                                                                    | Same as `extracted.md`                                                                                                 |
| Vectorize `merchants`                            | bge-m3 embedding of `merchants.normalized_name`; metadata `user_id`, `merchant_id`, `category_id`, `confirmed` (`categorization/utils/decide.ts` `merchantVectorMetadata`). Vector id = merchant id | Now: deleted with its merchant. Before: never deleted                                                                  |
| Queues `statement-ingest`, `txn-enrich` (+ DLQs) | `{ statementId }` only (`packages/api/src/bindings.ts`)                                                                                                                                             | Queue retention                                                                                                        |
| Workers Logs                                     | Console lines (see 6)                                                                                                                                                                               | Cloudflare: 3 days on the Free plan                                                                                    |

## 2. What is sent to Workers AI

| Step           | Code                                                                                          | Model                                                                | Input                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF to text    | `extraction/ingest.ts` `ingestStatement`, `env.AI.toMarkdown`                                 | Workers AI Markdown conversion                                       | The whole PDF and its file name                                                                                                                                                    |
| Extraction     | `extraction/extract.ts` `extractStatement`, `extraction/workers-ai.ts`                        | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, JSON mode, temperature 0 | The statement text in chunks of up to 6,000 characters; for chunks after the first, the first 800 characters of the statement as context; on a retry, the validation error         |
| Embeddings     | `categorization/workers-ai.ts` `createWorkersAiEmbedder`                                      | `@cf/baai/bge-m3`                                                    | Merchant names only                                                                                                                                                                |
| Classification | `categorization/enrich.ts` step 4, `categorization/prompts/prompt.ts` `buildClassifyMessages` | Same Llama model                                                     | The user's category names and kinds; per undecided merchant: its name, one description cut to 80 characters, the transaction type and debit or credit. No amounts, dates, balances |

Findings:

- No account data (user name, email, id) is ever put in a prompt. Confirmed by reading every
  `buildChunkMessages` and `buildClassifyMessages` call site.
- The extraction input is the statement itself, which includes the header printed by the bank
  (holder name, address, account number). Sending it is needed to extract the period and the
  account label; the 800-character context repeats the header with every chunk. Stripping the
  holder's name and address before the call is possible but fragile across layouts; listed as
  a follow-up.
- Transfer counterparties (other people's names) reach the classifier as merchant names. This is
  data about third parties (the people the user pays or is paid by).
- No AI Gateway is configured, so no prompt or response logging on Cloudflare's side. Cloudflare's
  Workers AI data usage page says customer content is not used for training and inputs and
  outputs are not retained after the request
  (https://developers.cloudflare.com/workers-ai/platform/data-usage/).

## 3. Ownership checks

Every oRPC procedure that touches user data is a `protectedProcedure`
(`packages/api/src/index.ts`, `requireAuth`) and passes `context.session.user.id` down; the
only public procedure is `healthCheck`. The same router serves `/rpc` and `/api-reference`
(OpenAPI) with the same context (`apps/server/src/index.ts`).

| Procedure / route                                | Scoping                                                                                                   | Status                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `statements.list`, `get`                         | `statements.user_id` (`db/queries/statements.ts`)                                                         | OK                                                                                                      |
| `statements.upload`, `POST /api/statements`      | Session required; row inserted with the session user                                                      | OK; now also requires consent                                                                           |
| `statements.delete`                              | `getStatementFile` with `user_id`, then every delete filtered by `user_id` (`db/queries/privacy.ts`)      | OK                                                                                                      |
| `GET /api/statements/:id/original`               | `getStatementFile` with `user_id` before reading R2; 404 otherwise                                        | OK                                                                                                      |
| `extraction.reextract`                           | `getStatementForReextract` with `user_id`; the following update is by id after that check                 | OK                                                                                                      |
| `transactions.list`, `months`                    | `transactions.user_id`                                                                                    | OK                                                                                                      |
| `transactions.setCategory`                       | Transaction and category both checked with `user_id` (`getTransactionWithMerchant`, `getOwnedCategory`)   | OK. The two follow-up updates filtered by transaction id only; now also by `user_id` (defense in depth) |
| `allocations.*`                                  | Transaction and every category checked with `user_id`; deletes filtered by `user_id`                      | OK                                                                                                      |
| `categories.*`                                   | Every query filtered by `user_id`; parent must be the user's                                              | OK                                                                                                      |
| `reports.*`                                      | Every raw query takes `userId`                                                                            | OK                                                                                                      |
| `account.privacy`, `account.acceptPrivacy` (new) | Session user only                                                                                         | OK                                                                                                      |
| Queue consumers                                  | Trust the `statementId` in the message; messages are only produced by the server after an ownership check | OK (internal)                                                                                           |
| Vectorize kNN                                    | `filter: { user_id, confirmed: true }` (`categorization/enrich.ts`)                                       | OK                                                                                                      |

No gap that lets one user read or change another user's data was found.

## 4. R2 and deletion

- Bucket privacy: the prod bucket has its `r2.dev` URL disabled, no custom domain, no CORS
  rules and no lifecycle rules (checked with `cf r2 buckets ...` on 2026-11-26). Alchemy's
  `publicAccess` defaults to false and no stack sets it (`packages/infra/alchemy.*.ts`).
  Cloudflare documents buckets as private by default
  (https://developers.cloudflare.com/r2/buckets/public-buckets/).
- PDF download: `GET /api/statements/:id/original` checks the session and ownership, then
  streams the object with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`
  and an inline `Content-Disposition`. CORS only allows the web origin with credentials.
  Signed URLs were not added: they would be bearer links that work for anyone holding them
  until expiry, and the authenticated stream already gives the owner a one-click view.
- Statement deletion, before: deleted the D1 row (cascade to transactions and allocations) and
  the R2 prefix. Merchants and their vectors were never deleted, and an R2 failure after the
  D1 delete left the PDF behind with no row to retry from.
- Statement deletion, now (`packages/api/src/privacy.ts` `deleteStatementData`): ownership
  check, then R2 prefix (PDF and both artifacts), then the vectors of merchants no other
  transaction references, then one D1 batch (allocations, transactions, statement, those
  merchants). The D1 rows go last, so a failure at any step leaves the statement listed and a
  second delete finishes the job. Tested in `packages/api/src/privacy.test.ts`.
- Late writes: an extraction still running when its statement is deleted can write artifacts
  afterwards; the retry then finds no statement and now deletes the whole prefix
  (`extraction/ingest.ts`). An enrichment running at that moment can create merchants after the
  deletion; they have no transaction, so the next statement deletion or the account deletion
  removes them.

## 5. Auth and account deletion (`packages/auth/src/index.ts`)

- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, host-only (no `Domain`). Sessions last 7 days
  (better-auth default). Passwords are hashed with scrypt (better-auth default).
- `trustedOrigins` is the web origin only.
- Sign-up needs no email verification, so an email address is not proven to belong to the user.
- Rate limiting, before: better-auth enables it only when `NODE_ENV` is `production`, which the
  Worker does not set, and its default store is in memory per isolate, so it was off.
- Rate limiting, now (issue #28): enabled explicitly in every stage, counted by Workers Rate
  Limiting bindings (`packages/auth/src/rate-limit.ts`). Strict per-IP rules for sign-in (5 per
  minute), sign-up, account deletion, password and email change and password reset (3 per
  minute); uploads are limited to 3 per user per minute. The client IP comes from
  `cf-connecting-ip`. The app stores no counters and never logs IPs.
- Account deletion, before: did not exist.
- Account deletion, now: better-auth `user.deleteUser` is enabled. The account menu's "Delete my
  account" (`apps/web/src/components/delete-account-dialog.tsx`) sends the password;
  better-auth verifies it, then `beforeDelete` runs `purgeUserData`
  (`packages/api/src/privacy.ts`, wired in `apps/server/src/services.ts`): R2 objects of every
  statement, every merchant vector, then all finance rows in one D1 batch. Only then does
  better-auth delete the user, its sessions and accounts. A failure in the purge aborts the
  deletion, and a retry resumes. Tested in `packages/api/src/account-deletion.test.ts`
  (real better-auth endpoint) and `privacy.test.ts`.
- better-auth telemetry is off by default; now pinned off with `telemetry: { enabled: false }`.

## 6. Logging

| Location                                                  | Before                                                                                                                       | Now                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/server/src/index.ts` Hono `logger()`                | Full URL including query string                                                                                              | Query string removed                                                     |
| `apps/server/src/index.ts` oRPC `onError`                 | `console.error(error)`: Drizzle errors print `params:` with the bound values (descriptions, amounts, emails)                 | `logError` with a redacted summary (`packages/api/src/log.ts`)           |
| `apps/server/src/queues/ingest.ts` error                  | `error.message`, which for JSON parse failures quotes the model's answer and for zod failures could include a date or amount | Redacted summary; the same redacted text is stored in `statements.error` |
| `apps/server/src/queues/ingest.ts` status update failure  | Raw Drizzle error (params include the error text)                                                                            | Redacted                                                                 |
| `apps/server/src/queues/enrich.ts` error                  | Raw message                                                                                                                  | Redacted                                                                 |
| `apps/server/src/queues/*.ts` success                     | Counts and timings only (`IngestResult`, `EnrichResult`)                                                                     | Unchanged                                                                |
| `packages/api/src/statements.ts` enqueue failure          | Raw error                                                                                                                    | Redacted                                                                 |
| `packages/api/src/categorization/correct.ts` vector error | Message                                                                                                                      | Redacted                                                                 |
| `packages/auth/src/index.ts` seed failure                 | Raw Drizzle error (user id, category names)                                                                                  | Error kind only                                                          |
| `apps/server/src/queues/index.ts` unknown queue           | Queue name                                                                                                                   | Unchanged (structured)                                                   |

Also: `extraction/schema.ts` no longer puts the rejected date or amount in zod messages, and
`extract.ts` replaces a JSON parse error with a fixed message. Tests: "log redaction" in
`privacy.test.ts`.

Workers observability: Alchemy turns Workers Logs on by default with invocation logs, which
record request metadata such as the client IP and location. The three stacks now set
`observability: { enabled: true, logs: { enabled: true, invocationLogs: false } }`, so only the
lines above are stored. Cloudflare keeps Workers Logs 3 days on the Free plan
(https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## 7. Vectorize

- Metadata per vector: `user_id`, `merchant_id`, `category_id`, `confirmed`. No name, amount or
  description is stored as metadata, but the vector itself is an embedding of the merchant
  name.
- Before: vectors were never deleted. Now: deleted with their merchant on statement deletion,
  and all of a user's are deleted on account deletion (by merchant id, which covers vectors
  written before `vector_id` was recorded). Vectorize deletions are applied asynchronously by
  Cloudflare.
- Residual: a vector whose merchant row was already deleted cannot be found again without a
  metadata scan. The new code deletes vectors before rows, so this only happens if Cloudflare
  loses a delete.

## 8. Telemetry

- App: no analytics, tracking pixels or third-party scripts in `apps/web` (searched for
  analytics, gtag, beacon, telemetry; the only external links are plain `<a>` links).
- Zone: Cloudflare Web Analytics (RUM) is on for the hosted zone. Cloudflare injects its beacon
  into the HTML responses, and pages post to `/cdn-cgi/rum` (found during the #28 preview
  checks). The owner chose to keep it, and it is disclosed in `PRIVACY.md` and on `/privacy`
  (notice version 2026-11-27).
- better-auth: off (default), now pinned off.
- Alchemy CLI: sends telemetry unless `ALCHEMY_TELEMETRY_DISABLED`, `DO_NOT_TRACK` or
  `NO_TRACK` is set. Both workflows set `ALCHEMY_TELEMETRY_DISABLED: "1"`. A local
  `bun run dev` does not; self-hosters should export `DO_NOT_TRACK=1` (documented in
  `SECURITY.md`).

## 9. Landing page claims (`apps/web/src/routes/index.tsx`)

| Claim                                                                                                        | Supported?                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| "There is nothing to connect. You never type your bank password"                                             | Yes: only PDF upload exists                                                                          |
| "Statements are read by Cloudflare Workers AI"                                                               | Yes (section 2)                                                                                      |
| "Your PDFs and transactions are stored on Cloudflare (R2 and D1), and every query is scoped to your account" | Yes (section 3)                                                                                      |
| "Delete a statement and its transactions and the stored PDF are deleted with it"                             | Partly before (merchants and vectors stayed); yes now. Copy updated to also mention account deletion |
| FAQ "only your account can see them"                                                                         | Yes in the app. Cloudflare, as processor, holds the data                                             |
| FAQ "you can delete any statement with its transactions at any time"                                         | Yes; now also the account                                                                            |
| "Is it free? Yes"                                                                                            | Not a privacy claim                                                                                  |

The landing page footer now links to `/privacy`, and the FAQ answer points to it.

## 10. Follow-ups

Done since the audit (issue #28): auth and upload rate limiting (section 5), and security
headers on both workers (CSP with nonces, HSTS, nosniff, Referrer-Policy, Permissions-Policy,
COOP; see `SECURITY.md`).

Still open:

- Optional automatic PDF expiry (lifecycle rule or scheduled job).
- Strip the holder's name and address from the extraction context where the layout allows.
- Email verification before upload, so an account is tied to a real address.
- Done in #30: D1, R2 and the queues are in the EU jurisdiction (see `docs/cndp-preparation.md`).
