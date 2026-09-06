# Court IQ — Covenant · agent notes

A volleyball lineup + sub planner for The Covenant School's middle school
team, built to grow into high school via a Level dial. Three-file static site
(`app.js`, `index.html`, `styles.css`), **no build step**, served from the
repo root via GitHub Pages. Forked from `court-iq-college` at `b66e0d5`.

- **Live**: https://demerson-code.github.io/court-iq-covenant/
- **Local preview**: `python -m http.server 3470` → http://localhost:3470/
- **Tests**: `npm test` (Playwright, algorithm assertions, ~4s)
- **Deploy**: `git push origin main` (GitHub Pages auto-deploys, 30–90s)
- **Plan**: `PLAN.md` (untracked by intent — owns the per-block scope; don't
  duplicate it here)
- **Version**: `APP_VERSION` in `app.js` + `?v=` on the script/style tags.
  Run `python bump-version.py` before every commit that changes app.js /
  styles.css / index.html — it's how we tell a stale browser cache from a bug.
  The stamp shows in the topbar tooltip and the print footer.

## Rules baseline

WVSSAC §127-3-30.1: NFHS volleyball rules govern, middle school included
(§30.10 changes only season dates). `LEVELS` defaults are NFHS: 18 subs per
set, same-slot re-entry, libero may serve from ONE spot per set
(`resolveLiberoServeRot` + the `rotIdx` argument to
`effectiveRotationWithLibero`). Always pass the rotation index when you
apply the libero, or she will serve from two spots.

## Level dial (do not bypass)

`settings.level` is `'ms' | 'hs'`. It is the ONE switch that decides what a
coach sees. Read it only through `currentLevel(settings)` (returns the
`LEVELS` preset merged with `settings.levelOverrides`) and `isHS()`.

- HS-only controls carry `data-hs-only` in the HTML; `applyLevelGates()`
  toggles them. Add the attribute, don't write a new `if`.
- System `<option>`s carry `data-system`; the level's `systems` list decides
  which are offered.
- Nothing is deleted when the level changes. Positions, tempo, height, hand
  all stay in the data; they're hidden, not dropped.

## Skill set (do not change without asking)

Six skills: **serving, serveReceive, defense, hitting, blocking, setting**.
No "passing" skill — `serveReceive` is passing the serve, `defense` covers
digging + free-ball. Blocking is scaled down at MS via `LEVELS.ms.blockingScale`,
not removed. Setters get an optional `setterTempo` (HS-only toggle).

Two **intangibles**, `attitude` and `athleticism`, are rated separately and
only ever act as tiebreakers and bench-order — they never outrank skill for a
starting spot. See `TIEBREAK_WEIGHT`.

**Positions**: `ROLES` are the lineup slots. A player's primary may also be
`'ANY'` ("All-around — no position yet"), the default for new players. It is
not a slot: the optimizer treats her as eligible everywhere and scores every
starter by the role she was given (`result.roleOf`), not her primary.

## State and persistence rules

- `S` is the global state. Mutate it then call `save()` — never bypass.
- Storage key: `court_iq_covenant_v1`. No legacy migration (`LEGACY_KEY = null`).
- Theme lives under its own key (`THEME_KEY`) — it's a device preference.
- Wrap localStorage via `safeStorage` (mobile Safari private-mode safety).
- **Tonight-only state stays local, never in the share link**: theme,
  match/bench state, scrimmage attendance/teams, `currentTab`, sort prefs.
- **Team-forever state goes in the share link**: roster (incl. intangibles),
  weights, settings (level + overrides), lineup config (overrides, libero,
  coach-authored sub patterns, pairings, everybodyPlays, planExclude), team
  name. The auto sub plan is NOT saved or shared — Generate re-derives it.

## Share link (v:2 envelope)

Hash format: `#d=<base64url-JSON>`. Player tuples:
`[id, name, [pri,sec], hand, height, jersey, [skills], setterTempo, available, [intangibles]]`.
**Player IDs must survive encode/decode** — pairings, overrides, libero, and
sub patterns all reference them. A college-era link (9-element tuples)
decodes with intangibles defaulting to 5.

## Coding conventions

- **No `innerHTML`** — a pre-edit security hook blocks it. Use `el(tag, opts, children)`
  or `document.createTextNode` for user-supplied strings.
- **`generateLineup(state)` return shapes**:
  - `result.arrangement` is `{rotations: [...6], startOrder: [...]}`. Use
    `result.arrangement.rotations`.
  - `result.libero` is `{player, replaces, servesInRotation}`. Use
    `result.libero.player`.
- **Sub patterns with `auto: true`** are written by the everybody-plays
  planner. `generateLineup` ignores them; the display pipeline applies them.
  Coach-authored patterns have no `auto` flag.
- **Window-property recursion footgun**: `window.fn = () => fn()` infinite-loops
  if `fn` is also a function declaration. Use `window.fn = fn`.
- **Algorithm functions are exposed on `window`** for `page.evaluate` tests.
  `window.S` is exposed via a getter. Don't break this.

## Tutorial + phone

`startTour()` / `tourSteps()` in app.js: a spotlight overlay (four mask
panels + ring + card). Steps target selectors; "do it" steps (`doClick`)
wait for the real tap. The Playwright test walks every step — if you move
or rename a control, update the step's `target` or the test will tell you.
Phone rules live under `@media (max-width: 639px)`: bottom tab bar, compact
court, two-column bench (no horizontal scroll, on purpose — it would fight
finger drags).

## Print

`#printSheet` is a hidden div. Click handlers populate it with a fresh DOM
tree, add `body.printing`, call `window.print()`, then clean up on `afterprint`
(with a 4s `setTimeout` fallback).

## What's deferred / rejected (don't reintroduce without asking)

- **Two-team (MS + HS) tabs** — retracted 2026-09-05. One team per app.
- **JSON export/import buttons** — share link covers it.
- **A separate "passing" skill** — rejected (see Skill set).
- **GitHub Pages workflow file** — none; default Pages-from-`main` is fine.

## Working with the user

**Two non-negotiable rules — read first:**

1. **For any non-trivial feature work — 3+ files, new state shape, a new
   tab, or anything spanning blocks — invoke the `grill-me` skill before
   writing code.** It walks the decision tree one question at a time,
   self-serves from the codebase to avoid asking what it can answer, and
   produces an Intent Summary for sign-off. Single-file fixes and obvious
   changes can skip it.
2. **When asking the user a question with a finite option set, use the
   `AskUserQuestion` tool, not plain text.** The user gets a clickable
   picker with an "Other" free-text escape hatch. Plain text is reserved
   for open-ended questions ("why", "describe X", error reports).

Beyond those:

- Prefer plain English over jargon. Coaching jargon is fine; software jargon
  needs a one-line gloss.
- Recommend defaults with reasoning rather than open-ended menus when there's
  a clear lean. In the picker, mark the recommendation `(Recommended)` and
  put it first.
- The user reviews local preview before pushing. Don't push without explicit
  approval.
- Covenant logo and colors come from the user. Until they arrive, brand
  tokens are navy placeholders in `styles.css`.

## Block status

- Live on GitHub Pages since 2026-09-05 (public repo demerson-code/court-iq-covenant,
  Pages from main / root). 36 Playwright tests. See `PLAN.md` for the
  round-by-round history after the coach's first look.
- Pending: real Covenant logo/colors (placeholder navy + "C" mark in place),
  iPad device check, the coach's league sub cap.

## Libero

Coverage is by player: `liberoConfig.covers` (starter ids), set by dragging
the libero from the bench onto starters (`liberoCoverDrop`). `replaces`
(positions) is only the seed applied when Suggest lineup runs, and the
fallback for saves with no `covers`. `liberoCoversPlayer()` is the single
matcher; the libero is always listed first on the bench.

## Lineup tab

**The board is the lineup.** `S.lineup.board = { startOrder: [6 ids], liberoId }`
travels with the team. "Suggest lineup" runs `generateLineup` once and writes
the board; after that drags edit the board directly (`boardPutPlayer`,
`boardSwap`) and `resultFromBoard()` re-scores it into the same result shape
`generateLineup` returns, so every renderer downstream is board-agnostic.
Nothing else moves on a drag in rotation 1. **In rotations 2–6 a drag is a
coach substitution** (`coachSubDrop` / `coachSubOut` → sub pattern with
`coach:true`); the court view (`courtEffective`) shows starters + coach subs
+ libero, never the automatic plan. **Do not reintroduce pins/overrides** — Derek
rejected them (2026-09-05): `S.lineup.overrides` is legacy and always empty.

The main view is ONE rotation (`renderCourtView`, `S.viewRot` in memory only):
big court, rotation dots + Rotate, a score card, and the bench full-width
below. The six-card grid lives under the collapsed "All six rotations" panel. The Bench tab is hidden unless
`settings.showBench` (Advanced) — the coaches run scenarios at home, not at
the game.

## Bench / match state

`S.match` is tonight-only (local, never shared). At Start set it snapshots
`starters`, `liberoId` and `plan` as ids, so the bench renders after a reload
with `S.result === null`. Legality lives in `canSub()`; every sub goes through
`applySub()`; both are pure and on `window`.
