# CNDP preparation

> Not legal advice. These are the facts about the hosted instance that the operator needs to
> fill in the CNDP forms under loi 09-08, gathered from the code and from Cloudflare. Which
> forms apply, and in what order, is for the CNDP to say. Every point marked **to confirm with
> the CNDP** is an assumption, not a verified rule.

## Sources and what could not be checked

- The CNDP website (https://www.cndp.ma/) could not be reached on 2026-11-26: every request
  from this machine (a web fetcher, `curl` and a browser) was reset by the server. The form
  titles and the submission order below therefore come from the external privacy review the
  operator received, and from the general structure of loi 09-08. None of them has been checked
  against cndp.ma. Before filing, download the forms from the CNDP site and check each point
  marked **to confirm with the CNDP**.
- Cloudflare facts were read on developers.cloudflare.com and cloudflare.com on 2026-11-26
  (links inline), and the account's resources were inspected with the `cf` CLI (read-only).

## Which forms

| Form  | What it is understood to be                                                                              | Applies?                                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-211 | Normal declaration (déclaration normale) of a processing                                                 | Likely, if the processing only needs a declaration. A natural person can be the controller on it: **to confirm with the CNDP**                                                                                                                                                  |
| F-214 | Simplified declaration, only for processing covered by a CNDP decision (délibération) setting a standard | Only if a CNDP decision covers personal finance tracking. None is known: **to confirm with the CNDP**                                                                                                                                                                           |
| F-112 | Request for prior authorization (demande d'autorisation préalable)                                       | If the CNDP considers this processing needs authorization rather than declaration (loi 09-08, article 12 and following). Financial data of individuals, data about third parties (transfer counterparties) and storage abroad may weigh toward it: **to confirm with the CNDP** |
| F-118 | Request for authorization to transfer data abroad                                                        | Likely needed: the data is stored in the EU and partly processed elsewhere (see "Data location"). **To confirm with the CNDP** whether the destination is considered to offer adequate protection, and whether a transfer authorization is still required                       |

Order of submission (from the review, **to confirm with the CNDP**): file the main processing
first (F-211, or F-112 if authorization is required) and obtain its receipt or approval; then
file F-118 for the transfer, referring to that processing.

Sign-ups on the hosted instance stay paused (#24) until the CNDP has answered.

## Facts for the forms

### Controller (responsable du traitement)

- A natural person (personne physique) based in Morocco, operating https://finance.ar7al.dev as a
  personal, free project. Controller: Abdelilah Ouaadouch, Tinghir, Morocco. Contact:
  contact@ar7al.dev.
- No representative, no joint controller.

### Name and purpose of the processing

- Name: AttijariFlare, personal finance tracker for Attijariwafa bank statements.
- Purpose: let each user upload their own monthly PDF account statements to see their spending:
  extraction of transactions, automatic categorization, monthly reports. Each user sees only
  their own data.
- Not done: advertising, profiling, credit or risk scoring, sale, sharing, marketing emails.
- Legal basis: the user's consent, recorded before the first upload (`user.privacy_accepted_at`
  and `privacy_policy_version`), and the provision of the service the user signed up for.

### Data subjects

- Users (adults with an Attijariwafa account who sign up).
- Third parties named in users' statements: people who send money to or receive money from the
  user (their names appear in transfer descriptions). They are not informed directly.

### Data categories

- Identification: name, email.
- Connection: password hash, session tokens, IP address and user agent of each session.
- Financial: the full statement PDF (holder name, address, account number, balances, every
  transaction), the extracted transactions (dates, descriptions, amounts, balances), account
  label, categories, splits and notes.
- Derived: merchant names (including counterparties' names) and their embeddings.
- Consent record: acceptance time and version.
- Sensitive data (article 1: racial or ethnic origin, political, religious or philosophical
  beliefs, union membership, health, sex life): not collected as such, but transaction
  descriptions can reveal some indirectly (a payment to a clinic, a donation). **To confirm with
  the CNDP** how to declare this.

The field-by-field inventory is in `docs/privacy-audit.md` section 1.

### Source of the data

The user, by uploading their own statements. Nothing is collected from the bank or any other
source.

### Recipients

- No recipient other than the user.
- Visit analytics: Cloudflare Web Analytics (page path, load timings, referrer, browser,
  device type, country, per page view), received by Cloudflare. See PRIVACY.md.
- Processor: Cloudflare, Inc. (hosting, storage, AI inference), with its subprocessors for
  Workers AI: CoreWeave, Inc. (United States) and Nebius BV (England), per
  https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/.

### Retention

- Statements, PDFs, transactions: until the user deletes them or the account.
- Temporary extraction files: deleted when a statement parses cleanly; kept while it needs
  review or failed; deleted with the statement.
- Account data: until account deletion.
- Logs: 3 days (Workers Logs, Free plan), no personal content.
- Backups: D1 Time Travel keeps 7 days of history on the Free plan.
- Details: `PRIVACY.md` "Retention".

### Rights of the data subjects (articles 7 to 9)

- Information: the `/privacy` page and the consent notice on the upload page.
- Access and rectification: in the app.
- Deletion: per statement, or the whole account, from the app.
- Opposition and other requests: privacy contact, contact@ar7al.dev.

### Security measures (article 23)

Summarized from `SECURITY.md`: HTTPS only; passwords hashed with scrypt; HttpOnly, Secure,
SameSite cookies; every query filtered by the signed-in user; private R2 bucket, PDFs served only
to their owner and never cached; separate resources per environment; redacted logs; no
telemetry; production deploys only from CI; secrets outside the repository.

## Data location and transfer abroad

Read from the account with the `cf` CLI on 2026-11-27, after the move to the EU jurisdiction
(#30):

| Resource                         | Location                               | Jurisdiction | Notes                                                                                                                                                                           |
| -------------------------------- | -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod D1 database                 | EU                                     | `eu`         | Data stored only in the EU (https://developers.cloudflare.com/d1/configuration/data-location/). Read replication disabled                                                       |
| Prod R2 bucket                   | EU                                     | `eu`         | Data stored only in the EU (https://developers.cloudflare.com/r2/reference/data-location/)                                                                                      |
| Prod Queues (2 queues, 2 DLQs)   | EU                                     | `eu`         | Messages carry ids only (statement and transaction ids), no statement content                                                                                                   |
| Prod Vectorize index             | Not exposed                            | -            | Cloudflare documents no location or jurisdiction option for Vectorize. Holds merchant-name embeddings with `user_id` metadata                                                   |
| Workers AI                       | Not documented per request             | -            | No option to restrict where inference runs. Data usage page: https://developers.cloudflare.com/workers-ai/platform/data-usage/ ; subprocessors in the United States and England |
| Workers (compute), rate limiting | Cloudflare's network, near the user    | -            | No jurisdiction option. Regional Services (Data Localization Suite) can restrict processing but is an Enterprise-only add-on                                                    |
| Workers Logs                     | Cloudflare core data centers, globally | -            | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ . Invocation logs are off                                                                            |

Until 2026-11-27 the prod D1 database and R2 bucket were in WNAM (western North America). They
were copied to new EU resources (row counts and every object checked) and the Worker switched to
them; the WNAM resources are deleted once the owner confirms.

So the stored data (database, PDFs, queues) is in the EU. Merchant embeddings (Vectorize),
Workers AI inference (subprocessors in the United States and England), request handling and
logs can be outside the EU. Both cases are a transfer outside Morocco. No Cloudflare product
offers a Morocco location.

### F-118

F-118 is still likely needed: storage in the EU is a transfer abroad. The request should name
the EU as the storage location for the database, the PDFs and the queues, and say honestly that
Vectorize, Workers AI, Workers and Workers Logs run where Cloudflare places them, which may be
outside the EU (including the United States). **To confirm with the CNDP** whether the EU is
considered to offer adequate protection, and whether that changes what F-118 must contain.

## Cloudflare DPA and subprocessors

- Customer DPA: https://www.cloudflare.com/cloudflare-customer-dpa/ (version 6.4, effective
  2026-04-03 when read). It forms part of the main agreement, including the Self-Serve
  Subscription Agreement (https://www.cloudflare.com/terms/). Whether it applies automatically to
  a Free plan account was not confirmed; read the Self-Serve agreement and check the Cloudflare
  dashboard for an acceptance option.
- Subprocessors: https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/. Attach or
  cite it in the transfer request.

## Checklist before filing

- [ ] Reach cndp.ma and download F-211, F-112 and F-118 (and F-214 if a decision applies).
- [ ] Confirm with the CNDP whether declaration or authorization applies (financial data,
      third-party names, transfer abroad).
- [ ] Confirm the order: main processing first, then the transfer.
- [ ] Publish a privacy contact on `/privacy`, in `PRIVACY.md` and `SECURITY.md`.
- [ ] Review and, if offered, accept Cloudflare's DPA; review the subprocessor list.
- [x] Move D1, R2 and the queues to the EU jurisdiction (#30).
- [ ] After the receipt, show its number on `/privacy` and only then reopen sign-ups.
