# Privacy

> Not legal advice. This document describes what the AttijariFlare code does with personal
> data. It is not a legal opinion, and it does not replace the operator's own obligations
> under Moroccan loi 09-08 or any other law. The public notice users accept is the `/privacy`
> page (`apps/web/src/routes/privacy.tsx`); keep the two in step.

Version: 2026-11-26 (`PRIVACY_POLICY_VERSION` in `packages/api/src/privacy.ts`).

## Who is responsible

The hosted instance at https://finance.ar7al.dev is run by one individual in Morocco, who is the
controller (responsable du traitement) for its users' data. Anyone who deploys this code is the
controller for their own instance (see "Self-hosting").

Privacy contact: **[to be filled in by the operator before sign-ups reopen]**

## What is stored, and why

The only purpose is to show each user their own spending from their own Attijariwafa bank
statements. There is no advertising, profiling, credit scoring, resale or sharing.

| Data                                                                               | Why                                           | Where                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| Name, email, password hash                                                         | Sign-in                                       | D1 `user`, `account`              |
| Sessions with IP address and user agent                                            | Keep you signed in (better-auth records both) | D1 `session`                      |
| The statement PDF as uploaded, with its file name                                  | Source of truth; "View PDF"                   | R2 `statements/{id}/original.pdf` |
| Statement period, balances, account label                                          | Reports, reconciliation                       | D1 `statements`                   |
| Transactions: dates, description as printed, amount, running balance, type         | Reports                                       | D1 `transactions`                 |
| Merchants derived from descriptions, including the names of people in transfers    | Categorization                                | D1 `merchants`, Vectorize         |
| Merchant name embeddings with `user_id`, `merchant_id`, `category_id`, `confirmed` | Category suggestions from similar merchants   | Vectorize `merchants`             |
| Categories, corrections, splits and their notes                                    | Reports                                       | D1                                |
| When the privacy notice was accepted, and which version                            | Upload consent                                | D1 `user`                         |
| Temporary extraction files: the PDF's text and the model's answer                  | Debugging a statement that did not reconcile  | R2, see "Retention"               |

The full field-by-field inventory is in `docs/privacy-audit.md`.

Statements also contain data about third parties: the people a user sends money to or
receives it from appear in transfer descriptions and become merchant names.

## Processing chain

1. Upload: the browser sends the PDF to the API Worker (`POST /api/statements`). The API checks
   the session and the privacy consent, validates the file and writes it to a private R2 bucket.
2. Extraction (queue `statement-ingest`): Workers AI `toMarkdown` turns the PDF into text, which
   is sent in chunks to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI to read the
   transactions. The result is checked against the opening and closing balances and stored in D1.
3. Categorization (queue `txn-enrich`): merchant names are embedded with `@cf/baai/bge-m3` on
   Workers AI and stored in Vectorize. A merchant gets its learned default category, or the
   category of a close confirmed merchant of the same user, or one batched call to the same
   Llama model with the merchant name, one description cut to 80 characters, the type and
   direction, and the user's category names. No account data goes into any prompt.
4. Dashboard: the web app reads only the signed-in user's rows.

## Processors and data location

All processing runs on Cloudflare, acting as processor: Workers, D1, R2, Queues, Vectorize and
Workers AI.

- Prod D1 database: region WNAM (western North America), no jurisdiction, read replication
  disabled (checked with `cf d1 get` on 2026-11-26).
- Prod R2 bucket: location WNAM, default jurisdiction (checked with `cf r2 buckets get`).
- Vectorize: Cloudflare documents no location or jurisdiction option.
- Workers AI: Cloudflare's data usage page says it does not use customer content processed by
  Workers AI to train models and does not retain inputs or outputs once they are no longer
  needed for the request: https://developers.cloudflare.com/workers-ai/platform/data-usage/.
  Cloudflare's subprocessor list names CoreWeave, Inc. (United States) and Nebius BV (England)
  for Workers AI: https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/.
- Workers Logs: stored by Cloudflare, possibly in its core data centers globally.

The data is therefore stored and processed outside Morocco.

Cloudflare's customer DPA is at https://www.cloudflare.com/cloudflare-customer-dpa/. Whether it
applies to a Free plan self-serve account depends on the Self-Serve Subscription Agreement
(https://www.cloudflare.com/terms/); the operator must review it (and accept it in the
dashboard if Cloudflare offers that) and review the subprocessor list.

## Retention

| Data                                                        | Kept until                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original PDFs, statements, transactions, splits             | The user deletes the statement or the account                                                                                                                                               |
| Merchants and their vectors                                 | No transaction references them any more (statement deletion), or account deletion                                                                                                           |
| `extracted.md`, `extraction.json`                           | Deleted as soon as an extraction run ends `parsed`. Kept while the statement is `needs_review` or `failed`, so the user or operator can see what the model read; deleted with the statement |
| Categories, consent record                                  | Account deletion                                                                                                                                                                            |
| Sessions                                                    | Expiry (7 days) or account deletion                                                                                                                                                         |
| Workers Logs (ids, counts, error kinds; no invocation logs) | 3 days on the Free plan                                                                                                                                                                     |
| D1 point-in-time recovery (Time Travel)                     | Deleted rows stay restorable for 7 days on the Free plan (30 on Paid): https://developers.cloudflare.com/d1/reference/time-travel/                                                          |
| R2                                                          | No versioning is enabled; a deleted object is gone                                                                                                                                          |

There are no other backups.

## User rights

- Access: everything stored is visible in the app (statements, PDFs, transactions, categories,
  splits).
- Correction: categories and splits can be edited; a statement can be re-extracted or deleted
  and uploaded again.
- Deletion: deleting a statement deletes its PDF and extraction files, its transactions and
  splits, and the merchants and vectors only it used. "Delete my account" (account menu) deletes
  every PDF, vector and finance row, then the user, its sessions and credentials. Both are
  retried safely if they fail part-way.
- Objection, and any other request: through the privacy contact above. Users can complain to
  the CNDP (https://www.cndp.ma/).

## Self-hosting

- The code sends no telemetry or analytics. better-auth telemetry is pinned off.
- The Alchemy CLI sends its own telemetry unless `ALCHEMY_TELEMETRY_DISABLED=1` (or
  `DO_NOT_TRACK=1`) is set; the GitHub workflows set it, and self-hosters should set it locally.
- Whoever deploys an instance is the controller for its data and must make their own
  declarations, choose their own Cloudflare data location (D1 and R2 jurisdictions can only be
  set at creation) and publish their own contact.
