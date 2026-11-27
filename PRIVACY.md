# Privacy

> Not legal advice. This document describes what the AttijariFlare code does with personal
> data. It is not a legal opinion, and it does not replace the operator's own obligations
> under Moroccan loi 09-08 or any other law. The public notice users accept is the `/privacy`
> page (`apps/web/src/routes/privacy.tsx`); keep the two in step.

Version: 2026-11-27.2 (`PRIVACY_POLICY_VERSION` in `packages/api/src/privacy.ts`).

## Who is responsible

The hosted instance at https://finance.ar7al.dev is run by one individual in Morocco, who is the
controller (responsable du traitement) for its users' data. Anyone who deploys this code is the
controller for their own instance (see "Self-hosting").

Privacy contact: **contact@ar7al.dev**

## What is stored, and why

The only purpose is to show each user their own spending from their own Attijariwafa bank
statements. There is no advertising, profiling, credit scoring, resale or sharing.

| Data                                                                               | Why                                           | Where                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| Name, email, password hash                                                         | Sign-in                                       | D1 `user`, `account`                |
| Sessions with IP address and user agent                                            | Keep you signed in (better-auth records both) | D1 `session`                        |
| The statement PDF as uploaded, with its file name                                  | Source of truth; "View PDF"                   | R2 `statements/{id}/original.pdf`   |
| Statement period, balances, account label                                          | Reports, reconciliation                       | D1 `statements`                     |
| Transactions: dates, description as printed, amount, running balance, type         | Reports                                       | D1 `transactions`                   |
| Merchants derived from descriptions, including the names of people in transfers    | Categorization                                | D1 `merchants`, Vectorize           |
| Merchant name embeddings with `user_id`, `merchant_id`, `category_id`, `confirmed` | Category suggestions from similar merchants   | Vectorize `merchants`               |
| Categories, corrections, splits and their notes                                    | Reports                                       | D1                                  |
| When the privacy notice was accepted, and which version                            | Upload consent                                | D1 `user`                           |
| Temporary extraction files: the PDF's text and the model's answer                  | Debugging a statement that did not reconcile  | R2, see "Retention"                 |
| Rate-limit counters: your IP or user id with the path, and a count                 | Stop password guessing and upload abuse       | Cloudflare rate limiter, one minute |

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

All processing runs on Cloudflare, acting as processor: Workers, D1, R2, Queues, Vectorize,
Workers Rate Limiting (counters only) and Workers AI.

Every resource that supports a Cloudflare jurisdiction uses `eu` in every deployed stage
(previews and prod; local dev declares it too but runs on the developer's machine). Data in an
EU-jurisdiction resource is stored only in the European Union.

- Prod D1 database: jurisdiction `eu`, read replication disabled.
- Prod R2 bucket: jurisdiction `eu`.
- Prod Queues (statement ingest, transaction enrichment, and their dead-letter queues):
  jurisdiction `eu`.
- These were checked with `cf d1 list`, `cf r2 buckets list --cf-r2-jurisdiction eu` and
  `cf queues list` on 2026-11-27. Until 2026-11-27 the prod D1 database and R2 bucket were in
  WNAM (western North America); they were copied to the EU resources then.
- Vectorize: Cloudflare documents no location or jurisdiction option, so the merchant
  embeddings are stored wherever Cloudflare places the index.
- Workers (the code) and Workers Rate Limiting counters: no jurisdiction option. Requests run
  in the Cloudflare data center that receives them. Cloudflare's Regional Services, which can
  restrict this, is an Enterprise-only add-on.
- Workers AI: Cloudflare's data usage page says it does not use customer content processed by
  Workers AI to train models and does not retain inputs or outputs once they are no longer
  needed for the request: https://developers.cloudflare.com/workers-ai/platform/data-usage/.
  Cloudflare's subprocessor list names CoreWeave, Inc. (United States) and Nebius BV (England)
  for Workers AI: https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/.
- Workers Logs: stored by Cloudflare, possibly in its core data centers globally.

The stored data (D1, R2, Queues) is therefore in the EU, outside Morocco. Merchant embeddings
(Vectorize), Workers AI inference and request handling can happen outside the EU.

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

## Visit analytics (hosted instance)

- The hosted instance (finance.ar7al.dev) has Cloudflare Web Analytics (Real User Monitoring)
  turned on at the zone level. Cloudflare injects its beacon script into the HTML pages, and each
  page view posts to `/cdn-cgi/rum`: page path, load timings (Core Web Vitals), referrer,
  browser, device type and country.
- Cloudflare states that Web Analytics sets no cookies, uses no local storage and does not
  fingerprint visitors: https://www.cloudflare.com/web-analytics/ . To confirm against
  Cloudflare's current documentation before the CNDP filing.
- It measures page loads, not page content: statement data is never part of what it sends.
- Purpose: site performance and page popularity. Recipient: Cloudflare (the same processor that
  hosts everything else). Retention: as set by Cloudflare for Web Analytics.
- It is a Cloudflare dashboard setting, not code. Turning it off (Web Analytics, or the zone's
  automatic RUM setup) removes it without a deploy; this section must then be updated.

## Self-hosting

- The code sends no telemetry or analytics. better-auth telemetry is pinned off. Cloudflare Web
  Analytics is a per-zone dashboard setting; self-hosters decide on it for their own zone.
- The Alchemy CLI sends its own telemetry unless `ALCHEMY_TELEMETRY_DISABLED=1` (or
  `DO_NOT_TRACK=1`) is set; the GitHub workflows set it, and self-hosters should set it locally.
- Whoever deploys an instance is the controller for its data and must make their own
  declarations and publish their own contact. The stack creates D1, R2 and every queue in the
  `eu` jurisdiction by default. A jurisdiction can only be set at creation: changing it in
  Alchemy replaces the resource (delete then create), so migrate the data first.
