# Vendored design skills

- `frontend-design/`: Anthropic's frontend-design skill, from `anthropics/skills` (license in `frontend-design/LICENSE.txt`). Copied unchanged.
- `impeccable/`: Impeccable 4.11.0 by Paul Bakaus, from `pbakaus/impeccable` (Apache 2.0). Only `SKILL.md` and `reference/` are vendored. The `scripts/` launcher (which downloads and runs a prebuilt engine binary) and `agents/` are left out on purpose, as are its hooks. When the skill asks to run `scripts/impeccable context`, use its documented "Launcher unavailable" fallback: read PRODUCT.md and DESIGN.md directly.

To update, re-download with `npx skills add <repo> --skill <name> --agent claude-code` into a scratch folder, review the diff, and copy the markdown over.
