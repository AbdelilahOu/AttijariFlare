# Design

The visual system of the AttijariFlare web app (`apps/web`), as built. Product facts live in
`PRODUCT.md`; the direction and its history live in `.impeccable/surfaces/app.md`.

Mode: Operate. The app is a working tool: scanability and exact figures come first, and the
identity lives in a few precise details.

## Palette

Cloudflare's palette, chosen by the owner: neutral grays with the brand orange. Every color is
a CSS variable in `apps/web/src/styles.css`, written once with `light-dark()`. The theme
follows the system; the account menu can pin light or dark (`data-theme` on `<html>`, stored in
`localStorage`, applied before first paint).

| Token                            | Light                    | Dark                        | Role                                                                 |
| -------------------------------- | ------------------------ | --------------------------- | -------------------------------------------------------------------- |
| `paper`                          | #f7f7f7                  | #141414                     | Page ground                                                          |
| `paper-raised`                   | #ffffff                  | #1d1d1d                     | Panels, inputs, dialogs                                              |
| `paper-sunken`                   | #efefef                  | #0f0f0f                     | Tracks, skeletons, hover fills                                       |
| `ink` / `ink-soft` / `ink-faint` | #222 / #595959 / #6e6e6e | #f2f2f2 / #b3b3b3 / #8f8f8f | Text levels                                                          |
| `rule` / `rule-strong`           | #e2e2e2 / #c8c8c8        | #2c2c2c / #404040           | Hairlines, control borders                                           |
| `flare`                          | #f6821f                  | #f6821f                     | Brand orange: primary buttons, active nav, money-out bars, guilloche |
| `flare-ink`                      | #1b1b1b                  | #1b1b1b                     | Text on orange fills (AA contrast)                                   |
| `action`                         | #b34a00                  | #fbad41                     | Orange for text, links, focus rings, selection                       |
| `action-tint` / `flare-tint`     | #fdeedc                  | #3a2410                     | Selected and active backgrounds                                      |
| `rail`                           | #262626                  | #222222                     | Charcoal brand surface: ledger strip, landing hero, sign-in panel    |
| `mint`                           | #13803d                  | #4cc27a                     | Credits, money in, parsed, saved                                     |
| `saffron`                        | #9a5b00                  | #fbad41                     | Needs attention, unallocated cash                                    |
| `garnet`                         | #c4291d                  | #ff8a80                     | Failures and destructive actions only                                |

There is no blue in the system. Category colors are user data and are shown as given.

## Typography

- One family: Readex Pro (variable, self-hosted through `@fontsource-variable/readex-pro`),
  designed for Latin and Arabic together, so mixed French and Arabic statement descriptions
  render in one voice. The Arabic and Latin Extended files load only when such characters
  appear (`unicode-range`).
- Headings use the wide `HEXP` axis (`font-variation-settings: "HEXP" 40`, 60 to 80 for the
  wordmark and hero) at semibold. Body text is regular.
- Scale (rem, root 15px on phones and 17px from 1024px): 0.8125, 0.875, 0.9375 (body),
  1.1875, 1.4375, 1.75, 2.125.
- Figures: the `figures` utility turns on tabular lining numerals. Every amount, date and count
  uses it.
- Descriptions and merchant names carry `dir="auto"` so Arabic runs read right to left.

## Money

`apps/web/src/lib/format.ts` formats integer centimes as `1 234,56 MAD`: narrow no-break space
for thousands, comma decimal, a real minus sign. The `Money` component shows debits in ink with
a minus sign and credits in mint with a plus sign. Split inputs accept and show the comma
decimal too.

## Layout

- Mobile first. Below 1024px: a sticky top bar (wordmark, account menu) and a five-item bottom
  tab bar. From 1024px: a fixed 15.5rem sidebar with the nav and the account menu.
- Content is left aligned, max 72rem wide.
- Transactions and statements are cards below 1280px and a column grid with a header row from
  1280px.
- Panels: 14px radius, 1px `rule` border, no shadow. Controls: 10px radius, 44px tall
  (40px inside dense rows). Pills only for small badges.
- Sections are open headings on the page, not cards in cards.

## Signature

A guilloche rosette (`components/guilloche.tsx`), the fine-line pattern of banknote security
printing, drawn in brand orange: in the sidebar, the wordmark, the ledger strip, the landing
hero, the sign-in panel and the 404 page.

## Motion

- The one orchestrated entrance: the guilloche strokes draw themselves once when the sidebar,
  hero or sign-in panel first mounts (1.6s, staggered).
- Feedback: upload progress and allocation meters grow with `transform: scaleX`; inserted
  editors and banners arrive with `@starting-style`; a "Saved" stamp confirms category changes,
  saved splits and edited categories; dialogs and the filter sheet slide in.
- Easing `cubic-bezier(0.16, 1, 0.3, 1)`, 150 to 420ms. `prefers-reduced-motion` turns it all
  off.

## Components

`components/ui.tsx` holds `Money`, `StatusBadge`, `PageHeader`, `Section`, `EmptyState`,
`ErrorNotice`, `FieldError`, `Spinner`, `SkeletonRows`, `PageLoader`, `SavedStamp` and
`RequireSession`. `components/dialog.tsx` wraps native `<dialog>` as `ConfirmDialog` and
`Sheet` (bottom sheet on phones). Icons come from `lucide` through `components/icon.tsx`
(lucide-solid only supports Solid 1). Button and field styles are Tailwind utilities in
`styles.css`: `btn-primary`, `btn-quiet`, `btn-ghost`, `btn-danger`, `btn-icon`, `field`,
`field-select`, `field-label`, `panel`, `link`.

## Accessibility

Visible focus rings in `action`, 44px touch targets, labelled controls, keyboard-operable
chart (each month is a button), a table alternative for the monthly chart, text alternatives
for category bars, `aria-live` on counts and split balances, and native dialogs for focus
handling.
