# Surface brief: the AttijariFlare web app

Scope: every route in `apps/web` (landing, auth, dashboard, statements, transactions, split
debits, categories, 404) plus shell, dialogs, loaders, empty and error states.
Mode: Operate. The owner comes to finish a task: upload, review, split, read totals.

## Token plan, first pass (frontend-design)

- Color: Night ink #0B0F1A ground, Ledger white #F5F5F0, one acid accent #C6F432 for
  credits and focus, grey #8A8F98 for secondary text, rose #F43F5E for debits.
- Type: Inter for UI, JetBrains Mono for amounts and dates.
- Layout: top bar with links; dashboard is a row of four stat cards, then a chart card, then
  two cards side by side.

  ```
  +------------------------------------------------+
  | logo   Dashboard Statements ...      [user]    |
  +------------------------------------------------+
  | [stat] [stat] [stat] [stat]                    |
  | [ chart card                              ]    |
  | [ review card      ] [ statements card   ]     |
  ```

- Principles: dark, techy, dense.

## Review against the generic defaults

- Near-black ground with one acid-green accent is default 2 on the frontend-design list. It
  came from the category ("finance dashboard"), not from the owner's world. Replaced.
- Mono for amounts and dates is default 5 (monospace as a costume for data). Tabular figures in
  the UI face do the alignment job. Replaced.
- Four identical stat cards plus a chart card plus two cards is the SaaS card kit (default 4)
  and the hero-metric template. Replaced with one ledger strip and open sections.
- Inter is the reflex UI face and has no Arabic. Replaced with a family designed for Arabic and
  Latin together.
- Rose for every debit paints most of the screen red, since most rows are debits. Replaced:
  debits keep the ink color with a minus sign, credits carry the green with a plus sign.
- Dark picked by category. Replaced by a use scene: the owner reviews on a phone in daylight
  and on a laptop in the evening, so both themes are first-class and the system preference
  decides.

## Token plan, revised

Source world: Moroccan dirham banknotes and the security printing on them (guilloche
rosettes, fine-line intaglio, the deep blue of the 200 dirham note, the green of the 50).
The world lends type, palette, density and one signature move; layout and controls stay the
standard ones for a web app.

- Color (light / dark):
  - Billet blue #1E2B6B / #8FA2F0: the rail, primary actions, selection, focus.
  - Security paper #F1F4F1 / #0D1226: the ground, a cool green-grey paper tint, never cream.
  - Ink #141B33 / #E6E9F2: text and debit amounts.
  - Mint #0E7A57 / #4ED3A1: credit amounts, money in, parsed.
  - Saffron #A86A00 / #F0B44C: needs attention, unallocated cash, queued work.
  - Garnet #B3263F / #FF8597: failures and destructive actions only.
- Type: Readex Pro (variable, Latin and Arabic in one family, weight 160 to 700 and the
  HEXP width axis). Headings use the expanded width (HEXP) at semibold; body at regular.
  Amounts and dates use tabular lining figures. Scale 1.2 ratio from a 15px base on phones
  and 16px on desktop: 13, 15/16, 19, 23, 28, 34.
- Layout: left aligned everywhere. Desktop: a billet-blue rail on the left with the
  wordmark, a guilloche field, icon plus label nav and the account at the bottom. Phones and
  tablets: a compact top bar and a five-item bottom tab bar. Content max 72rem.

  ```
  Desktop (>= 1024)                      Phone (< 1024)
  +--------+---------------------------+ +----------------------+
  | Attij. | Dashboard   [Mar] to [Mar] | | AttijariFlare  (acct)|
  | ~~~~~~ |                            | +----------------------+
  | > Dash | In      Out     Net   Bal. | | Dashboard            |
  |   Stmt | ledger strip, one band     | | In        Out        |
  |   Txns |                            | | Net       Balance    |
  |   Split| Monthly chart + table      | | chart (scrolls)      |
  |   Cats | Spend by category bars     | | spend bars           |
  |        | Needs review | Statements  | | needs review         |
  | (acct) |                            | +----------------------+
  +--------+---------------------------+ | Dash Stmt Txns Split Cat|
                                         +----------------------+
  ```

- Principles: precision over spectacle; attention states lead; one memorable thing (the
  guilloche) and everything else quiet; amounts always signed, grouped and aligned.

## Palette change requested by the owner (2026-11-25)

After reviewing the first build, the owner asked for Cloudflare's palette in both themes
instead of the banknote blue. This is a brief pin and wins over the plan above:

- Neutral gray grounds: light #f7f7f7 page, #ffffff panels; dark #141414 page, #1d1d1d panels.
- Brand orange #f6821f (with #fbad41) for the identity: wordmark, guilloche, active nav icon,
  money-out bars.
- Action blue #0051c3 (dark #5ea2ff) for buttons, links, focus and selection.
- Charcoal brand surface #262626 / #222222 for the ledger strip, landing hero and sign-in panel.
- State colors: green for credits, amber for attention, red for failure.

Type, layout, the guilloche signature and motion are unchanged.

## Direction contract

THESIS: The owner's ledger printed like a dirham note: one security-printed rail, and a
quiet, exact working surface. It refuses the dark finance dashboard of stat cards and neon.

OWN-WORLD: Billet blue rail with a fine-line guilloche rosette, cool security-paper ground,
ink text, mint for credits, saffron for attention, garnet only for failure. Readex Pro with
expanded headings and tabular figures. Panels are open sections on the paper separated by
hairlines, not a grid of identical cards.

STORY: The owner sees this period's money in, out, net and balance, sees what needs review,
fixes it in place (category, split, upload), and trusts the totals.

FIRST VIEWPORT: Dashboard. Rail left (desktop) or top bar plus bottom tabs (phone). Title and
month range on one line; the ledger strip directly under it with four signed figures at 28px;
the monthly chart starts above the fold on desktop. The primary action (upload) sits in the
rail and in the statements section.

FORM: Operate app shell, rail plus content, position 1 of 1 (pinned by the issue brief).
seed: none (unavailable)
Signature interaction: the guilloche lines draw in once when the app first loads (the one
orchestrated entrance), and a saved split or category change confirms with a short ink
stamp on the row. Motion grammar: 160 to 240ms exponential ease-out, reduced motion turns it
off.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, DESIGN.md, and every shipping raster carrying its provenance
