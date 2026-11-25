# Product

<!-- impeccable:product-schema 1 -->

Facts below come from the repository and from the project's GitHub issues. Items marked
(inferred) were not confirmed in an interview: the Impeccable launcher is not vendored, and
this file was written in an unattended session from the issue brief.

## Platform

web

## Users

One person, the owner of the account, tracking their own money. They bank with Attijariwafa
bank in Morocco and receive a monthly PDF statement. They read French and Arabic; statement
descriptions mix both scripts. They open the app on a phone as often as on a laptop
(inferred from the brief's mobile-first requirement).

## Product Purpose

AttijariFlare turns monthly Attijari PDF statements into a categorized ledger. The owner
uploads a statement, AI extracts its transactions, a categorizer assigns categories and learns
from corrections, and cash withdrawals can be split into the categories the cash was spent on.
The dashboard shows money in, money out, net, closing balance and spend by category for any
range of months. Success is a month reviewed in a few minutes: upload, fix the few rows the
app was unsure about, split the cash, read the totals.

## Positioning

Built for one bank's statement format and one person's spending, not a general budgeting app.
It reads the statements the owner already gets, so there is no bank connection to set up.

## Operating Context

- Statements arrive monthly as PDFs. Upload, extraction and categorization run in the
  background; statement status moves through queued, extracting, parsed, needs review, failed.
- Review work: uncategorized or low-confidence rows (below 70 percent), cash withdrawals that
  are not fully allocated, and statements that need review.
- Amounts are Moroccan dirhams (MAD), stored as integer centimes.

## Capabilities and Constraints

- Routes: `/` landing, `/login` (sign in and sign up), `/dashboard`, `/upload` (statements),
  `/transactions`, `/withdrawals` (split debits), `/categories`, and a 404.
- Single user. Sign-up is guarded so only the first account can be created.
- Runs on the Cloudflare free tier: keep the client bundle lean for mobile networks.
- No API contract changes for visual work.

## Brand Commitments

- Name: AttijariFlare (the browser title used `finance-ttijari`). It is a personal tool, not
  an Attijariwafa bank product, so it must not use the bank's logo or brand colors.
- No emojis or Unicode pictographs anywhere. SVG UI icons are allowed in the interface.

## Evidence on Hand

- A real statement exists only in the git-ignored `samples/` folder. Never use it in
  screenshots, fixtures or docs. All demo and screenshot data is made up.

## Product Principles

1. Precision first: every amount is exact, signed and comparable at a glance.
2. Show what needs attention before what is fine.
3. Corrections are cheap: one change, and the app learns from it.
4. The app works the same on a phone in the street as on a desk.

## Accessibility & Inclusion

WCAG AA contrast, visible focus, keyboard-reachable dialogs and editors, labelled form
controls, text alternatives for charts, reduced motion respected. Mixed French and Arabic text
must render correctly, including right-to-left runs inside left-to-right rows.
