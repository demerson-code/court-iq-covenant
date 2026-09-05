# Court IQ — Covenant · v1 Implementation Plan

**Plan dated**: 2026-09-05 · **Status**: Blocks 0–6 built locally, 26 tests green. Not yet on GitHub (0.1's `gh repo create` awaits approval); 3.4 real logo/colors pending; 6.4 device check pending · **Source repo**: `court-iq-college` (fork point `b66e0d5`)
**Target repo**: `court-iq-covenant` (new) · **Live (once created)**: https://demerson-code.github.io/court-iq-covenant/ · **Preview**: port 3470

Untracked by intent — this file owns per-block scope. `CLAUDE.md` in the new repo will point here.

---

## Goal

Turn the college lineup tool into a middle-school volleyball lineup tool for The Covenant School's MS coach: a 4-2 (or Simple 6, or 5-1) lineup builder that the coach pins her starters into, an "everybody plays" sub planner, and a bench screen she runs on an iPad during a set. Built MS-first with a Level dial so the same app grows into high school without a fork.

## Done When

- [ ] Fresh browser at the new URL loads a **light** Covenant-themed app; the topbar has a working dark toggle that survives reload and is **not** in the share link.
- [ ] Topbar shows **Level: Middle School / High School** and **System: 4-2 / Simple 6 / 5-1** (6-2 appears only at HS).
- [ ] At MS the roster card offers **Setter / Hitter / Middle / Libero** positions, jersey # on by default, no height/hand fields; flipping Level to HS reveals Right Side, Defensive Specialist, height, hand, setter tempo — and flipping back hides them again with no data lost.
- [ ] Every player has two extra ratings, **Attitude** and **Speed / Athleticism**, on their card in a group separate from the six skills. They do not move the AVG badge.
- [ ] Two players with identical skills but different Attitude → the higher Attitude is chosen for the last open starter slot (Playwright fixture).
- [ ] With a 12-player MS roster and System 4-2, Generate produces 2 S + 2 OH + 2 MB on the floor plus a libero; the front-row setter is scored as a setter and the back-row setter is scored as a back-row player (Playwright asserts `roleForScoring`).
- [ ] System **Simple 6** with exactly 6 available players produces a lineup (no libero); with 7+ it also names a libero.
- [ ] Nav has **Roster · Lineup · Scrimmage · Bench**. The Weights tab is gone; its content lives under an *Advanced* disclosure on the Lineup tab.
- [ ] After Generate, a **Sub plan** panel lists every bench player with "in for X at rotation N (when X rotates to serve), back out at rotation M"; the count of subs used never exceeds the Level's sub cap (Playwright fixture at cap 18 and cap 4).
- [ ] The **Bench** tab on a landscape iPad shows the current rotation's six on a court, score +/- buttons, a sub counter, a "hasn't played yet" strip, and — once the lead reaches the threshold and a planned sub's rotation is current — a one-tap "Sub in" prompt. Illegal subs (over cap, wrong re-entry slot) are refused with a reason.
- [ ] Bench state survives a page reload mid-set and is **not** in the share link.
- [ ] Print: lineup sheet includes the sub plan; roster sheet includes Attitude and Athleticism columns.
- [ ] `npm test` passes: all 10 existing assertions still green (5-1 / 6-2 untouched) plus the new ones listed in Block 6.
- [ ] No console errors on Chrome desktop, iPad Safari (real device), and mobile-Safari emulator.

## Approach

Fork in place, keep the three-file structure and the no-build-step deploy. Every HS-only concept stays in the code and the saved data and is gated by one `settings.level` value read through two helpers (`currentLevel()` / `isHS()`). All algorithm additions are pure functions on `window` so the Playwright harness reaches them via `page.evaluate`. The sub planner writes into the existing `subPatterns` shape (with `auto: true`) so the scoring pipeline, the rotation grid, and the print sheet all pick it up without new plumbing.

## Constraints

- **No build step, no dependencies**, GitHub Pages from repo root. CSP meta stays.
- **No `innerHTML`** — the pre-edit hook blocks it. `el()` / `textContent` only.
- **Player IDs must survive the share link** (v2 tuples). Any new per-player field goes in the tuple, not the object form.
- **Tonight-only state stays local**: theme, match/bench state, scrimmage, currentTab, sort prefs. Never in `encodeStateForUrl`.
- **`generateLineup` return shape is load-bearing** for tests and UI: `result.arrangement.rotations`, `result.libero.player`. Don't change it; extend it.
- **Coach's unknowns are settings, not constants**: sub cap, lead threshold, libero-serve rule all live in `LEVELS` defaults and are editable under Advanced.
- Covenant logo and colors arrive later. Build against tokens; the swap must be a token edit plus one file drop.

---

## File Map

| Action | File | Where |
|--------|------|-------|
| Create | `court-iq-covenant/` (new repo, copy of this tree minus `.git`) | Block 0 |
| Modify | `app.js` | 26-100 (constants), 102-166 (state), 255-305 (save), 362-431 (load), 459-560 (share), 594-636 (help), 797-1320 (algorithm), 1682-1712 (demo), 1714-1840 (print), 2085-2300 (roster card), 2364-2510 (lineup render), 2587-2700 (sub panel), 3168-3178 (setTab), 3220-3462 (init) |
| Modify | `index.html` | head (title/meta/apple tags), topbar, nav, weights tab (remove), lineup tab (advanced panel, sub plan panel), new bench tab |
| Modify | `styles.css` | 3-22 (tokens → light + dark sets), 44-155 (topbar), 173-230 (tabs), 1474-1490 (breakpoints), 1538-1862 (lineup builder), append bench + advanced + tablet-landscape sections, 2031+ (print) |
| Create | `assets/covenant-logo.svg` (placeholder until the real one arrives) | Block 3 |
| Create | `assets/icon-180.png` (iPad home-screen icon, placeholder) | Block 3 |
| Modify | `tests/algorithm.spec.js` | Block 6 |
| Create | `tests/fixtures/roster-ms-12.json`, `roster-simple-6.json`, `roster-tie-attitude.json` | Block 6 |
| Modify | `package.json` (preview port 3470), `playwright.config.js` (port 3470) | Block 0 |
| Modify | `CLAUDE.md`, `README.md` | Block 0 (rewrite for Covenant) |

---

## Block 0 — Fork, Level dial, light theme

**Goal**: A separate repo that loads as "Court IQ — Covenant Middle School", light by default with a dark toggle, with a Level setting wired through the whole app in place of the college ruleset dropdown.
**Files**: everything above marked Block 0 · **Scope**: M · **Depends on**: nothing

### Tasks

- [x] **0.1 — Create the repo.** ⚠️ *Ask Derek before running the `gh repo create` line — it's outward-facing.*
  ```bash
  cd C:/Users/demerson/Documents
  mkdir court-iq-covenant && cd court-iq-covenant
  git init -b main
  # copy tracked files only (no .git, no node_modules, no PLAN.md yet)
  git -C ../court-iq-college archive HEAD | tar -x -C .
  cp ../court-iq-college/.claude/worktrees/court-iq-covenant-school-c677f9/PLAN.md .
  npm install
  git add -A && git commit -m "Fork from court-iq-college b66e0d5 for Covenant MS"
  gh repo create demerson-code/court-iq-covenant --public --source=. --push
  ```
  Then in GitHub → Settings → Pages → Deploy from `main` / root. No workflow file.

- [x] **0.2 — Rename storage, team, title.** `app.js:98-102`:
  ```js
  const STORAGE_KEY = 'court_iq_covenant_v1';
  const LEGACY_KEY = null; // no prior tool on a Covenant coach's device — nothing to migrate
  const THEME_KEY = 'court_iq_covenant_theme'; // 'light' | 'dark' | null (= follow device)
  const DEFAULT_TEAM_NAME = 'Covenant Middle School';
  ```
  In `load()` (`app.js:311`), guard the legacy branch: `if (!raw && LEGACY_KEY) { ... }`.
  `index.html` head: title `Court IQ — Covenant`, description "Volleyball lineup and sub planner for The Covenant School", `theme-color` becomes a placeholder brand color (Block 3 finalizes). Add:
  ```html
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Court IQ">
  <link rel="apple-touch-icon" href="assets/icon-180.png">
  ```
  `package.json` preview → `python -m http.server 3470`; `playwright.config.js` baseURL/port → 3470.
  Rewrite `CLAUDE.md` (live URL, port, "Level dial" section replacing "Skill set", the two-rules block stays verbatim) and `README.md` (one paragraph: what it is, who it's for, live link).

- [x] **0.3 — Replace `RULESETS` with `LEVELS`.** `app.js:55-64`:
  ```js
  // One dial, four effects: which positions the coach sees, which systems
  // the picker offers, which controls are visible, and the rule preset.
  // Every value here is a DEFAULT — the coach can override subsPerSet,
  // leadThreshold and liberoMayServe under Advanced.
  const LEVELS = {
    ms: {
      label: 'Middle School',
      subsPerSet: 18,          // NFHS default; Covenant's league TBD — coach confirms
      liberoMayServe: true,    // confirmed by Derek 2026-09-04
      reentry: 'sameSlot',
      timeoutsPerSet: 2,
      roleStrict: false,       // never reject a roster for lacking a role
      blockingScale: 0.35,     // blocking rarely decides MS points; tall girls still get credit
      leadThreshold: 5,        // "winning enough" — coach adjusts
      roles: ['S', 'OH', 'MB', 'L'],
      systems: ['4-2', 'simple', '5-1']
    },
    hs: {
      label: 'High School',
      subsPerSet: 18,
      liberoMayServe: true,
      reentry: 'sameSlot',
      timeoutsPerSet: 2,
      roleStrict: true,        // deviation from first draft: the existing 5-1/6-2 error-path tests assert strict-role validation, and HS coaches assign positions
      blockingScale: 1,
      leadThreshold: 5,
      roles: ['S', 'OH', 'MB', 'OPP', 'L', 'DS'],
      systems: ['4-2', 'simple', '5-1', '6-2']
    }
  };
  function currentLevel(settings) {
    const s = settings || (typeof S !== 'undefined' ? S.settings : null) || {};
    const base = LEVELS[s.level] || LEVELS.ms;
    // Coach overrides (Advanced panel) layer over the level defaults.
    return { ...base, ...(s.levelOverrides || {}) };
  }
  function isHS(settings) { return ((settings || S.settings || {}).level) === 'hs'; }
  ```
  `defaultSettings()` (`app.js:104`):
  ```js
  function defaultSettings() {
    return {
      level: 'ms',
      levelOverrides: {},          // { subsPerSet?, leadThreshold?, liberoMayServe? }
      system: '4-2',
      showJersey: true,
      showSetterTempo: false
    };
  }
  ```
  Replace every `RULESETS[settings.ruleset] || RULESETS.rec` (`app.js:1253, 2415, 2515, 2592`) with `currentLevel(settings)`. In `applyLoadedState` (`app.js:393-399`) replace the `ruleset:` line with:
  ```js
  level: LEVELS[data.settings.level] ? data.settings.level : 'ms',
  levelOverrides: (data.settings.levelOverrides && typeof data.settings.levelOverrides === 'object') ? data.settings.levelOverrides : {},
  system: VALID_SYSTEMS.has(data.settings.system) ? data.settings.system : '4-2'
  ```
  (`VALID_SYSTEMS` is defined in Block 2 — for now `new Set(['5-1','6-2'])` next to `VALID_TABS`, updated in 2.1.)
  Delete the `rulesetSel` block in `init()` (`app.js:3284-3291`); add:
  ```js
  const levelSel = $('#levelSelect');
  if (levelSel) {
    levelSel.value = S.settings.level;
    levelSel.addEventListener('change', e => {
      S.settings.level = LEVELS[e.target.value] ? e.target.value : 'ms';
      if (!currentLevel().systems.includes(S.settings.system)) S.settings.system = '4-2';
      save();
      applyLevelGates();
      renderRoster();
      scheduleRegen();
    });
  }
  ```
  `index.html` topbar: replace the Ruleset `<label>` with
  ```html
  <label class="settings-field"><span>Level</span>
    <select id="levelSelect">
      <option value="ms">Middle School</option>
      <option value="hs">High School</option>
    </select>
  </label>
  ```

- [x] **0.4 — `applyLevelGates()`.** One function, called from `init()` after `renderRoster()` and from the level-change handler. Anything HS-only in the HTML carries `data-hs-only`; anything that is a *system option* carries `data-system`.
  ```js
  /* Level gating: HS-only controls are marked data-hs-only in the HTML.
     System <option>s are marked data-system and hidden when the current
     level doesn't offer that system. Called on init and on level change. */
  function applyLevelGates() {
    const hs = isHS();
    const lvl = currentLevel();
    $$('[data-hs-only]').forEach(n => { n.hidden = !hs; });
    $$('option[data-system]').forEach(o => {
      o.hidden = !lvl.systems.includes(o.dataset.system);
      o.disabled = o.hidden;
    });
    $$('#systemSelect, #systemSelectLineup').forEach(sel => { sel.value = S.settings.system; });
    document.body.dataset.level = S.settings.level;
  }
  window.applyLevelGates = applyLevelGates;
  ```
  Mark in `index.html`: the setter-tempo toggle label → `data-hs-only`; `<option value="6-2" data-system="6-2">` on both system selects (all four options get `data-system`).

- [x] **0.5 — Light theme + dark toggle.** `styles.css:3-22` becomes two token sets. Light is the default on bare `:root`; dark under both the explicit attribute and the system preference:
  ```css
  :root {
    /* Brand — placeholders until Covenant colors arrive (Block 3 swaps these 4 lines) */
    --brand: #1F3A5F; --brand-dark: #14263F; --brand-light: #3D5F8F; --brand-soft: #E3EAF3;
    /* Back-compat aliases — old rules still reference --green* */
    --green: var(--brand); --green-dark: var(--brand-dark); --green-light: var(--brand-light); --green-soft: var(--brand-soft);
    --court-navy: #1E2A3A; --court-deep: #121A26; --court-line: #FFFFFF;
    --bg: #F4F6F9; --card: #FFFFFF;
    --text: #17202B; --text-mute: #5B6878; --text-soft: #3E4B5B;
    --border: #D7DEE7; --border-soft: #E8EDF3;
    --overlay: rgba(0,0,0,.06); --overlay-strong: rgba(0,0,0,.12);
    --on-brand: #FFFFFF;
    --good: #1E9E4F; --warn: #C98A00; --bad: #C93B3B;
    --shadow-sm: 0 1px 2px rgba(16,24,40,.06); --shadow: 0 4px 12px rgba(16,24,40,.08); --shadow-lg: 0 12px 32px rgba(16,24,40,.12);
    --radius: 14px; --radius-sm: 8px; --radius-lg: 22px; --tap: 44px;
    color-scheme: light;
  }
  :root[data-theme="dark"] { /* dark set */ }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* same dark set */ } }
  ```
  The dark set is the current values from `styles.css:4-19` plus `--overlay: rgba(255,255,255,.06); --overlay-strong: rgba(255,255,255,.12); --on-brand:#fff; color-scheme: dark;`. CSS can't include, so the ~20 lines are duplicated in both places; keep them adjacent with a comment.
  Then audit hardcoded colors: `grep -n "rgba(0, 0, 0\|rgba(0,0,0\|rgba(255,255,255\|rgba(255, 255, 255" styles.css` → replace each with `--overlay` / `--overlay-strong` / `--on-brand` as appropriate. Expect ~40 hits; the court (`styles.css:600-772`) keeps its navy — it's a court, not a surface.
  Topbar toggle in `index.html` next to the share button:
  ```html
  <button class="icon-btn" id="themeToggle" title="Light / dark" aria-label="Toggle dark mode">🌙</button>
  ```
  `app.js`, above `init()`:
  ```js
  /* Theme: a per-device preference (never in the share link). null = follow
     the device. Stored under its own key so it survives "Clear team". */
  function applyTheme(pref) {
    const root = document.documentElement;
    if (pref === 'dark' || pref === 'light') root.dataset.theme = pref; else delete root.dataset.theme;
    const dark = pref === 'dark' || (!pref && matchMedia('(prefers-color-scheme: dark)').matches);
    const btn = $('#themeToggle'); if (btn) btn.textContent = dark ? '☀️' : '🌙';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--brand').trim();
  }
  function initTheme() {
    applyTheme(safeStorage.get(THEME_KEY));
    $('#themeToggle')?.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      safeStorage.set(THEME_KEY, next);
      applyTheme(next);
    });
  }
  ```
  Call `initTheme()` first thing in `init()`. Verify `THEME_KEY` never appears in `encodeStateForUrl`.

- [ ] **Verify**
  ```bash
  npm test          # 10/10 still green (5-1 / 6-2 paths untouched)
  npm run preview   # http://localhost:3470 — light by default; toggle → dark; reload keeps it;
                    # Level → HS reveals Setter tempo + 6-2; back to MS hides them
  ```
  Share link from MS device opened in a fresh profile: no theme carried, `level` carried.

---

## Block 1 — Vocabulary, positions, roster card, intangibles, Advanced panel

**Goal**: The roster screen reads like it was written for a middle school coach; two intangible ratings exist and act as tiebreakers; the Weights tab is gone.
**Files**: `app.js`, `index.html`, `styles.css` · **Scope**: M · **Depends on**: Block 0

### Tasks

- [x] **1.1 — Labels.** `app.js:27-34`, `77-84`:
  ```js
  const ROLE_LABELS = { OH: 'Hitter', MB: 'Middle', S: 'Setter', OPP: 'Right Side', L: 'Libero', DS: 'Defensive Specialist' };
  // HS shows the fuller names; MS shows the plain ones. Keys never change.
  const ROLE_LABELS_HS = { ...ROLE_LABELS, OH: 'Outside Hitter', MB: 'Middle Blocker' };
  function roleLabel(r) { return (isHS() ? ROLE_LABELS_HS : ROLE_LABELS)[r] || r; }
  const POSITION_NAMES = { 1: 'Right Back (serves)', 2: 'Right Front', 3: 'Middle Front', 4: 'Left Front', 5: 'Left Back', 6: 'Middle Back' };
  const SYSTEM_LABELS = {
    '4-2':   '4-2 — setter sets from the front row',
    'simple':'Simple 6 — best six, normal rotation',
    '5-1':   '5-1 — one setter, all six rotations',
    '6-2':   '6-2 — setters set from the back row'
  };
  ```
  Replace `ROLE_LABELS[...]` reads in render code (`app.js:869, 2160-2200, 2836`) with `roleLabel(...)`. Option text in `index.html` system selects uses the `SYSTEM_LABELS` strings.

- [x] **1.2 — Position picker honours the level.** In `buildRosterFields` (`app.js:2154`) replace both `ROLES.forEach` loops with:
  ```js
  const visible = currentLevel().roles.slice();
  // Never hide a role a player already has (e.g. after HS → MS) — show it, so nothing is silently lost.
  [p.positions?.[0], p.positions?.[1]].forEach(r => { if (r && !visible.includes(r)) visible.push(r); });
  visible.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = roleLabel(r); sel.appendChild(o); });
  ```
  Option text drops the `OH — ` prefix at MS (the code is jargon); keep `${r} — ${label}` at HS.
  Height row and Hand row: `heightRow.hidden = !isHS(); handRow.hidden = !isHS();`. Jersey row: already toggled by `showJersey`, now default true.

- [x] **1.3 — Blocking scale.** `playerFitForRole` (`app.js:805`), inside the skill loop:
  ```js
  let w = weights[skill] || 0;
  if (skill === 'blocking') w *= currentLevel(settings).blockingScale;
  ```
  Cache key must include the level: `${player.id}|${role}|${settings.level}|${settings.showSetterTempo ? 1 : 0}`.

- [x] **1.4 — Intangibles.** Constants after `SKILL_LABELS_SHORT` (`app.js:52`):
  ```js
  // Rated like skills, kept apart from them: they never feed lineup score
  // directly. They order the bench in the sub plan and break ties between
  // near-equal starters. Speed/athleticism is here rather than in skills
  // because it's a trait, not a volleyball skill.
  const INTANGIBLES = ['attitude', 'athleticism'];
  const INTANGIBLE_LABELS = { attitude: 'Attitude', athleticism: 'Speed / Athleticism' };
  const TIEBREAK_WEIGHT = 0.001; // small enough that a 10-vs-1 intangible gap (< 0.01) can't beat a 0.05 skill gap
  function defaultIntangibles() { const o = {}; INTANGIBLES.forEach(k => o[k] = 5); return o; }
  function intangibleScore(p) {
    const it = p.intangibles || {};
    return INTANGIBLES.reduce((a, k) => a + (it[k] || 5), 0) / INTANGIBLES.length;
  }
  function tiebreak(p) { return intangibleScore(p) * TIEBREAK_WEIGHT; }
  ```
  `createPlayer` adds `intangibles: defaultIntangibles()`. `migratePlayer` and `applyLoadedState` (`app.js:370-384`) add `intangibles: { ...defaultIntangibles(), ...(migrated.intangibles || {}) }`.
  **Share tuple** (`app.js:461-475, 499-531`): append index 9:
  ```js
  const PT = { ID:0, NAME:1, POS:2, HAND:3, HEIGHT:4, JERSEY:5, SKILLS:6, TEMPO:7, AVAIL:8, INTANG:9 };
  // compactPlayer: push INTANGIBLES.map(k => (p.intangibles || {})[k] | 0 || 5)
  // decodeShareV2: const itArr = tuple[PT.INTANG] || []; intangibles = INTANGIBLES.reduce(... itArr[i] ?? 5)
  ```
  A v2 link from the college app (no index 9) decodes to all-5s — no version bump needed.
  **Tiebreak in `chooseStarters`** (`app.js:929-936`): `fit: playerFitForRole(p, role, settings) + tiebreak(p)`. That's the only algorithm touch; the maximin score is unaffected beyond the 3rd decimal.
  **Card UI**: after `buildSkillGrid(...)` in `buildPlayerCard` (`app.js:2130`):
  ```js
  skillBox.appendChild(el('h4', { cls: 'card-subhead', text: 'Intangibles' }));
  skillBox.appendChild(buildIntangibleGrid(p));
  ```
  `buildIntangibleGrid` reuses `buildSkillCell` with `INTANGIBLE_LABELS` — refactor `buildSkillCell(skillsObj, skill, onChange, labels = SKILL_LABELS_SHORT)` so it takes a label map. `avgSkillDisplay` unchanged (skills only).

- [x] **1.5 — Kill the Weights tab, add Advanced.** `index.html`: delete the Weights `<button class="tab">` and `#weightsTab` section. `VALID_TABS` → `new Set(['roster','lineup','scrimmage','bench'])` ('bench' arrives in Block 5; a missing panel is harmless). On the Lineup tab, after `#lineupBreakdownPanel`:
  ```html
  <details class="lb-panel" id="advancedPanel">
    <summary>Advanced</summary>
    <div class="lb-panel-body">
      <div class="adv-row"><label>Subs per set <input type="number" id="advSubsPerSet" min="6" max="30" inputmode="numeric"></label></div>
      <div class="adv-row"><label>Sub in when we're up by <input type="number" id="advLeadThreshold" min="0" max="15" inputmode="numeric"></label></div>
      <label class="settings-toggle"><input type="checkbox" id="advLiberoServe"> Libero may serve</label>
      <label class="settings-toggle"><input type="checkbox" id="jerseyToggle"> Show jersey #</label>
      <label class="settings-toggle" data-hs-only><input type="checkbox" id="setterTempoToggle"> Setter tempo</label>
      <div data-hs-only>
        <label class="lc-field"><span>Optimize for</span><select id="optimizationMode">…(existing 4 options)…</select></label>
      </div>
      <h4>Skill weights</h4>
      <div class="weight-list" id="weightList"></div>
      <button class="btn btn-secondary btn-tiny" id="resetWeightsBtn">Reset weights</button>
    </div>
  </details>
  ```
  Move the jersey/tempo toggles out of the topbar; move `#optimizationMode` out of `.lineup-controls`. Pairings panel (`#pairingsPanel`) gets `data-hs-only`. Wire the three new inputs in `init()`:
  ```js
  function bindLevelOverride(id, key, parse) {
    const n = $(id); if (!n) return;
    const paint = () => { const v = currentLevel()[key]; if (n.type === 'checkbox') n.checked = !!v; else n.value = v; };
    paint();
    n.addEventListener('change', e => {
      const v = parse(e.target);
      S.settings.levelOverrides = { ...S.settings.levelOverrides, [key]: v };
      save(); scheduleRegen();
    });
    return paint;
  }
  const repaintOverrides = [
    bindLevelOverride('#advSubsPerSet', 'subsPerSet', t => Math.max(6, Math.min(30, parseInt(t.value, 10) || 18))),
    bindLevelOverride('#advLeadThreshold', 'leadThreshold', t => Math.max(0, Math.min(15, parseInt(t.value, 10) || 0))),
    bindLevelOverride('#advLiberoServe', 'liberoMayServe', t => !!t.checked)
  ];
  ```
  Level change handler (0.3) also calls `repaintOverrides.forEach(f => f && f())`. `renderWeights()` still targets `#weightList` — unchanged.

- [x] **1.6 — Help text rewrite.** Replace the three `HELP` entries (`app.js:594-636`) with MS wording and add three:
  - `skills-key`: same six, one plain sentence each ("Serve Receive — passing the other team's serve up to the setter"). Callout: rate against *our team*.
  - `intangibles`: "These don't change who starts. They decide who comes off the bench first and break ties."
  - `systems`: 4-2 / Simple 6 / 5-1 in one sentence each. HS-only paragraph for 6-2 appended when `isHS()` (build the body array at open time).
  - `sub-plan`: how the everybody-plays plan works (Block 4 fills the wording).
  - `optimization-mode`, `rotation-strength`: keep, shorten by half.
  Help buttons: add `makeHelpButton('intangibles')` beside the Intangibles subhead, `makeHelpButton('systems')` beside the System select.

- [x] **1.7 — Demo roster.** Replace `DEMO_ROSTER` (`app.js:1682-1696`) with 12 MS-shaped players: 2 S, 4 OH, 3 MB, 1 L, 2 OH/L-secondary. Skills 3-8 range, intangibles varied (two players deliberately identical on skills, differing on attitude — reused by the Block 6 tie fixture). Update `#rosterEmpty` hint: "Or load a 12-player demo team".

- [ ] **Verify**
  ```bash
  npm test   # still green; tie fixture arrives in Block 6
  ```
  Preview: card shows Setter/Hitter/Middle/Libero; jersey visible; no height/hand; Intangibles group with 2 cells; Level→HS reveals everything; Advanced panel edits persist and survive reload; share link round-trips intangibles (check `#d=` decodes 10-element tuples).

---

## Block 2 — 4-2 and Simple 6

**Goal**: Two new systems in the optimizer with pure functions the tests can call directly. 4-2 and 6-2 share an arrangement but differ in *who is scored as the setter*.
**Files**: `app.js` (797-1320), `index.html` (system selects) · **Scope**: M · **Depends on**: Block 0

### Tasks

- [x] **2.1 — Register systems.** `app.js:797`:
  ```js
  const SYSTEM_REQUIREMENTS = {
    '4-2':   { S: 2, OPP: 0, OH: 2, MB: 2, L: 1 },  // same six as 6-2; differs in scoring (2.2)
    'simple':{ ANY: 6, L: 1 },                       // handled by chooseSimpleStarters, not the role solver
    '5-1':   { S: 1, OPP: 1, OH: 2, MB: 2, L: 1 },
    '6-2':   { S: 2, OPP: 0, OH: 2, MB: 2, L: 1 }
  };
  const VALID_SYSTEMS = new Set(Object.keys(SYSTEM_REQUIREMENTS));
  ```
  `generateLineup` (`app.js:1251`): `const system = VALID_SYSTEMS.has(settings.system) ? settings.system : '4-2';`. Both `systemSel` handlers in `init()` (`app.js:3292-3300, 3320-3328`) validate with `VALID_SYSTEMS.has(v) ? v : '4-2'`. `arrangeRotation` (`app.js:1113`):
  ```js
  function arrangeRotation(starters, system) {
    if (system === '5-1') return _enumerate51Arrangements(starters);
    if (system === '6-2' || system === '4-2') return _enumerate62Arrangements(starters); // setters opposite each other
    if (system === 'simple') return _enumerateSimpleArrangements(starters);
    return [];
  }
  ```

- [x] **2.2 — Row-aware scoring role.** This is what makes 4-2 ≠ 6-2. Add above `scoreRotation`:
  ```js
  /* roleForScoring: which weight profile a player is scored with, given the
     row she's in and the system. A setter only "is" the setter in the row
     she sets from — 4-2 sets from the front, 6-2 from the back, 5-1 from
     both. The other setter is scored as an ordinary player in that row. */
  function roleForScoring(player, row, system) {
    const primary = (player.positions && player.positions[0]) || (row === 'front' ? 'OH' : 'DS');
    if (primary !== 'S') return primary;
    if (system === '5-1') return 'S';
    if (system === '4-2') return row === 'front' ? 'S' : 'DS';
    if (system === '6-2') return row === 'back' ? 'S' : 'OPP';
    return 'S'; // simple: score her as what she is
  }
  window.roleForScoring = roleForScoring;
  ```
  `scoreRotation(rotation, mode, libero, ruleset, settings, system)` gains a `system` param; the two `const role = ...` lines become `roleForScoring(p, 'front', system)` / `roleForScoring(p, 'back', system)`. `scoreLineup` passes `system` through; `generateLineup` passes it in. The 5-1 / 6-2 fixtures must still pass unchanged — 5-1 scoring is identical; 6-2 back-row setter was already scored as S, front-row setter now scores as OPP (previously S). Re-baseline the 6-2 maximin assertion if it moves; the *composition* assertion cannot move.

- [x] **2.3 — Simple 6.** New functions after `chooseStarters`:
  ```js
  /* Simple 6: no positions, no system. Best six by raw skill (+ tiebreak),
     pins honoured, libero = best libero-fit among the rest when 7+ are here. */
  function chooseSimpleStarters(roster, settings, forced) {
    const forcedIds = new Set((forced || []).map(f => f.player.id));
    const ranked = roster
      .filter(p => !forcedIds.has(p.id))
      .sort((a, b) => (playerSkillRaw(b) + tiebreak(b)) - (playerSkillRaw(a) + tiebreak(a)));
    const six = (forced || []).map(f => f.player).concat(ranked).slice(0, 6);
    if (six.length < 6) return { starters: null, validation: `Need 6 available players (you have ${six.length}).` };
    const rest = roster.filter(p => !six.includes(p));
    const lib = rest.length
      ? rest.slice().sort((a, b) => playerFitForRole(b, 'L', settings) - playerFitForRole(a, 'L', settings))[0]
      : null;
    const starters = { OH: [], MB: [], S: [], OPP: [], L: lib ? [lib] : [], DS: [] };
    six.forEach(p => { const r = (p.positions && p.positions[0]) || 'OH'; (starters[r] || starters.OH).push(p); });
    starters._order = six; // arrangement enumerator reads this
    return { starters, validation: null };
  }
  function _enumerateSimpleArrangements(starters) {
    const six = starters._order || ROLES.flatMap(r => starters[r] || []).slice(0, 6);
    const out = [];
    (function perm(arr, m) {
      if (arr.length === 0) { out.push({ startOrder: m.slice(), rotations: _rotationsFromStartOrder(m) }); return; }
      for (let i = 0; i < arr.length; i++) perm(arr.slice(0, i).concat(arr.slice(i + 1)), m.concat(arr[i]));
    })(six, []);
    return out; // 720 arrangements × 6 rotations — trivially fast
  }
  ```
  In `generateLineup`: `const minRoster = system === 'simple' ? 6 : 7;` for the roster-size check; branch `system === 'simple' ? chooseSimpleStarters(roster, settings, forced) : chooseStarters(...)`. Libero for simple is `starters.L[0] || null` — the existing default path already does this. `renderLineupBreakdown` iterates `ROLES` — works as-is since simple buckets starters by primary.

- [x] **2.4 — Libero may replace a back-row setter (4-2).** `renderLiberoPanel` (`app.js:2509`): the "replaces" checkbox list currently offers `['MB','OPP','OH','DS']` — already includes `'S'`; nothing to do, with hint "In a 4-2 the back-row setter isn't setting — the libero can take her spot."

- [x] **2.5 — Default system + picker.** `index.html` both system selects:
  ```html
  <option value="4-2" data-system="4-2">4-2 — setter sets from the front row</option>
  <option value="simple" data-system="simple">Simple 6 — best six, normal rotation</option>
  <option value="5-1" data-system="5-1">5-1 — one setter</option>
  <option value="6-2" data-system="6-2" data-hs-only>6-2 — setters set from the back row</option>
  ```
  Leave `SUB_PATTERN_TEMPLATES` alone — they're coach-authored HS tools. Gate the template picker `data-hs-only` (the MS coach uses the planner, Block 4).

- [ ] **Verify** — run the four systems on the demo roster in the preview and eyeball: 4-2 shows one setter front, one back in every rotation; Simple 6 with 6 players → no libero, no error. `npm test` green (re-baselined 6-2 maximin if needed, noted in the commit).

---

## Block 3 — iPad court layout + Covenant branding

**Goal**: The Lineup tab is designed for a landscape iPad; everything else gets the brand and a tablet pass.
**Files**: `styles.css`, `index.html`, `app.js` (setTab, topbar), `assets/` · **Scope**: M · **Depends on**: Block 0 (tokens), Block 1 (nav shape). ⚠️ *Needs Derek's logo + colors to finish 3.4; everything else proceeds on placeholders.*

### Tasks

- [x] **3.1 — Body knows the tab.** `setTab` (`app.js:3168`): add `document.body.dataset.tab = name;`. CSS can now widen `main` only where the layout wants it.

- [x] **3.2 — Landscape tablet layout for Lineup.** Append to `styles.css`:
  ```css
  /* ===== Tablet landscape (iPad 10"–13") ===== */
  @media (min-width: 1024px) and (orientation: landscape) {
    body[data-tab="lineup"] main, body[data-tab="bench"] main { max-width: 1240px; }
    #lineupBuilder { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-areas: "controls controls" "status status" "result side"; column-gap: 20px; }
    #lineupBuilder .lineup-controls { grid-area: controls; }
    #lineupBuilder .lineup-status { grid-area: status; }
    #lineupResult { grid-area: result; display: contents; }
    #rotationGrid { grid-area: result; grid-template-columns: repeat(3, 1fr); }
    #lineupSide { grid-area: side; position: sticky; top: 132px; align-self: start; display: flex; flex-direction: column; gap: 12px; max-height: calc(100vh - 150px); overflow-y: auto; }
    .rot-zone { min-height: 84px; }
    .rot-zone .chip-name { font-size: 15px; }
    .lc-field select, .btn { min-height: 48px; }
  }
  ```
  `index.html`: wrap `#benchCard`, `#liberoPanel`, `#subPlanPanel` (Block 4), `#pairingsPanel`, `#advancedPanel` in `<aside id="lineupSide">`; `#lineupBreakdownPanel` stays under the grid. Phone/portrait keeps today's stacked flow (the grid rules only apply inside the media query).

- [x] **3.3 — Tablet pass on Roster and Scrimmage.** Extend `@media (min-width: 768px)` (`styles.css:1475`): `.player-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }` and `.player-card.expanded { grid-column: 1 / -1; }` so an open card spans both columns. Scrimmage `.team-grid` → 2 columns at 768, 3 at 1024 (verify current rules at `styles.css:1863+`). Tabs: at `min-width: 768px` the tab bar hugs left (`.tabs { justify-content: flex-start; } .tab { flex: 0 0 160px; }`).

- [ ] **3.4 — Brand.** ⚠️ *Placeholder mark + icon shipped; the real logo/colors are still blocked on assets.* When they arrive: replace the 4 `--brand*` lines in both token sets; drop `assets/covenant-logo.svg` (≤ 8KB, single color or currentColor so it works on the brand-gradient topbar); export `assets/icon-180.png`. Until then create a placeholder `covenant-logo.svg` (a rounded "C" mark, 32×32, `fill="currentColor"`). Topbar (`index.html:14-16`): replace `<span class="ball">🏐</span>` with `<img class="brand-logo" src="assets/covenant-logo.svg" alt="" width="32" height="32">`; `.brand-logo { width: 32px; height: 32px; }`. Empty state (`styles.css:1450-1473`) swaps `marco-silhouette.svg` for the logo at low opacity; delete `assets/marco-silhouette.svg`. `DEFAULT_TEAM_NAME` stays editable in the topbar as today.

- [x] **3.5 — Rotation card readability.** Chips show `#jersey · Name` when `showJersey` (default on). Server zone gets a filled brand-color badge "SERVE" rather than the ⚡ pseudo-element (`styles.css:1614-1622`). Libero chip gets a distinct soft outline and an "L" tag. All new colors via tokens.

- [ ] **Verify** — iPad Safari (real device, landscape and portrait) and Chrome device toolbar at 1024×768 / 1366×1024: no horizontal scroll, 44px+ targets, sticky side column doesn't overlap the tab bar. Phone (375×812) unchanged from Block 1. Light and dark both.

---

## Block 4 — Everybody-plays sub planner

**Goal**: One tap after Generate produces a legal, explainable plan that gets every bench player onto the floor, ordered by intangibles, within the sub cap.
**Files**: `app.js` (1161-1200 applySubPatterns, new planner, sub panel 2587-2700, runGenerate 3463), `index.html`, `styles.css` · **Scope**: M · **Depends on**: Blocks 1, 2

### Design (read before coding)

A starter who begins at `startOrder[i]` serves in rotation `i` (zone 1) and is back-row in rotations `i, i+1, i+2` (zones 1, 6, 5), then front-row from `i+3`. So the classic MS sub — "she goes in to serve, plays the back row, comes out when she'd rotate to the net" — is: **in at rotation `i`, out at rotation `(i+3) % 6`**. Each such swap costs 2 subs (in + return). At most one starter serves per rotation, so at most one planned sub-in per rotation and at most 6 per plan.

Eligible starters to sub out: everyone on the floor **except** the libero, the setter in 5-1, and the setter in 6-2 (she sets from the back). In 4-2 both setters are eligible (the back-row one isn't setting). Prefer subbing starters the libero *isn't* replacing so the libero keeps her MB.

Bench order: `intangibleScore desc`, then `playerSkillRaw desc`. For each bench player in that order pick the eligible, still-unsubbed starter whose swap costs the least rotation strength across her 3 back-row rotations. Stop when the next swap would exceed `subsPerSet`.

- [x] **4.1 — Span semantics for `applySubPatterns`.** `app.js:1161`: a pattern with `return` now covers rotations from `trigger.rotationIndex` up to but not including `return.rotationIndex` (wrapping mod 6). No `return` = single rotation (unchanged).
  ```js
  function _patternActiveAt(pat, rotationIndex) {
    if (!pat || !pat.trigger || pat.trigger.event !== 'in') return false;
    const start = pat.trigger.rotationIndex;
    if (!pat.return) return start === rotationIndex;
    const end = pat.return.rotationIndex;
    for (let r = start; r !== end; r = (r + 1) % 6) if (r === rotationIndex) return true;
    return false;
  }
  ```
  Replace the two `continue` checks in the loop with `if (!_patternActiveAt(pat, rotationIndex)) continue;`. Note in the commit: coach-authored templates with `return` (all three) now span as their descriptions always said.

- [x] **4.2 — The planner (pure).** After `arrangementSatisfiesOverrides`:
  ```js
  /* planEverybodyPlays: returns { patterns:[], subsUsed, subsCap, benchLeft:[] }.
     patterns are subPattern-shaped with auto:true so the rest of the app
     treats them exactly like coach-authored ones. Never mutates state. */
  function planEverybodyPlays(state, result) {
    state = state || S;
    const settings = state.settings || defaultSettings();
    const level = currentLevel(settings);
    const system = VALID_SYSTEMS.has(settings.system) ? settings.system : '4-2';
    const mode = (state.lineup && state.lineup.optimizationMode) || 'balanced';
    const cap = level.subsPerSet;
    if (!result || !result.arrangement) return { patterns: [], subsUsed: 0, subsCap: cap, benchLeft: [] };

    const startOrder = result.arrangement.startOrder;
    const rotations = result.arrangement.rotations;
    const libero = result.libero;
    const onFloorIds = new Set(startOrder.map(p => p.id));
    if (libero && libero.player) onFloorIds.add(libero.player.id);
    const exclude = (state.lineup && state.lineup.planExclude) || {};
    const bench = state.players
      .filter(p => p.available && (p.name || '').trim() && !onFloorIds.has(p.id))
      .sort((a, b) => (intangibleScore(b) - intangibleScore(a)) || (playerSkillRaw(b) - playerSkillRaw(a)));

    const liberoReplaces = (libero && libero.replaces) || ['MB'];
    const eligible = startOrder.map((p, i) => ({ p, i })).filter(({ p }) => {
      if (exclude[p.id]) return false;
      const primary = (p.positions && p.positions[0]) || 'OH';
      if (primary === 'S' && (system === '5-1' || system === '6-2')) return false;
      return true;
    });
    // Libero keeps her spot: sub the non-replaced starters first.
    eligible.sort((a, b) => {
      const ar = liberoReplaces.includes(a.p.positions?.[0]) ? 1 : 0;
      const br = liberoReplaces.includes(b.p.positions?.[0]) ? 1 : 0;
      return ar - br;
    });

    const base = rotations.map(r => scoreRotation(effectiveRotationWithLibero(r, libero, level), mode, libero, level, settings, system));
    const patterns = [];
    const used = new Set();
    let subsUsed = 0;
    for (const sub of bench) {
      if (subsUsed + 2 > cap) break;
      let best = null;
      for (const { p: starter, i } of eligible) {
        if (used.has(starter.id)) continue;
        const pat = { id: genId(), out: starter.id, in: sub, trigger: { rotationIndex: i, event: 'in' }, return: { rotationIndex: (i + 3) % 6, event: 'in' }, auto: true };
        let cost = 0;
        for (let k = 0; k < 3; k++) {
          const r = (i + k) % 6;
          const eff = effectiveRotationWithLibero(applySubPatterns(rotations[r], [pat], r), libero, level);
          cost += base[r] - scoreRotation(eff, mode, libero, level, settings, system);
        }
        if (!best || cost < best.cost) best = { pat, cost, starterId: starter.id };
      }
      if (!best) break;
      used.add(best.starterId);
      patterns.push(best.pat);
      subsUsed += 2;
    }
    const planned = new Set(patterns.map(p => p.in.id));
    return { patterns, subsUsed, subsCap: cap, benchLeft: bench.filter(p => !planned.has(p.id)) };
  }
  window.planEverybodyPlays = planEverybodyPlays;
  ```
  `effectiveRotationWithLibero` is already pure and hoisted; left in place. **Discovered during build:** the libero picks her replacement by primary position, so an MB-primary *sub* in the back row was being swapped straight back out. `applySubPatterns` now inserts a shallow copy tagged `_sub`, and both libero-swap sites skip tagged players. Auto patterns are never persisted — `save()` and the share link filter them; Generate re-derives them.

- [x] **4.3 — Generate ignores auto patterns; display applies them.** `generateLineup` (`app.js:1295`): `const patterns = (lineupCfg.subPatterns || []).filter(p => !p.auto);`. Add `S.lineup.everybodyPlays` (default `true`; `applyLoadedState` reads it as `!== false`) and `S.lineup.planExclude` (`{ starterId: true }`, default `{}`); both persist and ride the share link (they're team config). `runGenerate` (`app.js:3463`):
  ```js
  const result = generateLineup();
  S.result = result;
  if (!result.error && S.lineup.everybodyPlays) {
    S.lineup.subPatterns = S.lineup.subPatterns.filter(p => !p.auto);
    const plan = planEverybodyPlays(S, result);
    S.lineup.subPatterns.push(...plan.patterns);
    S.plan = plan;            // render-only; not persisted
    save({ silent: true });
  }
  ```
  `renderRotationGrid` already applies all `subPatterns` — the plan shows up in the six cards with no change. Chip for a subbed-in player gets a "SUB" tag (extend `buildPlayerChip`).

- [x] **4.4 — Sub plan panel.** Replace `#subPatternsPanel` in `index.html` with:
  ```html
  <details class="lb-panel" id="subPlanPanel" open>
    <summary>Sub plan <span class="lb-counter" id="subsCounter"></span> <button class="help-btn" data-help="sub-plan" type="button">?</button></summary>
    <div class="lb-panel-body">
      <label class="settings-toggle"><input type="checkbox" id="everybodyPlaysToggle"> Get everyone in when we're ahead</label>
      <ol class="sub-plan-list" id="subPlanList"></ol>
      <p class="hint" id="subPlanLeft"></p>
      <details data-hs-only><summary>Custom sub patterns</summary><div id="subPatternsBody"></div></details>
    </div>
  </details>
  ```
  `renderSubPlanPanel()` (replaces `renderSubPatternsPanel` as the thing `renderLineup` calls; the old function keeps rendering into `#subPatternsBody` for HS): each `auto` pattern → `<li>`: "**#12 Ava** in for **#4 Mia** · rotation 3, when Mia rotates to serve · out at rotation 6" with a ✕ that sets `S.lineup.planExclude[starterId] = true` and re-plans ("Don't sub Mia out"). A "Reset" link clears `planExclude`. `#subsCounter`: "8 of 18 subs". `#subPlanLeft`: "Still on the bench: Zoe, Kate — no subs left" or empty. Toggle unchecked → strip auto patterns, re-render.

- [x] **4.5 — Help copy** for `sub-plan`: three sentences on when a sub goes in (to serve), when she comes out (before she'd rotate to the net), and that the order is Attitude first.

- [ ] **Verify** — demo roster, 4-2: 5 bench players → 5 patterns, 10 subs; set Advanced sub cap to 4 → 2 patterns, hint names the three left out. Simple 6 with 6 players → empty plan, no error. `npm test` (planner tests land in Block 6; run existing now).

---

## Block 5 — Bench screen

**Goal**: The tab the coach holds during a set. Current six on a court, score, sub counter, hasn't-played strip, one-tap planned subs, manual subs with legality checks. Local-only, survives reload.
**Files**: `app.js`, `index.html`, `styles.css` · **Scope**: L → split into 5.1 (state + rules, pure), 5.2 (render), 5.3 (interactions), 5.4 (styles) · **Depends on**: Block 4

### Tasks

- [x] **5.1 — Match state + legality (pure).** `defaultMatch()` next to `defaultScrimmage()`:
  ```js
  function defaultMatch() {
    // Tonight-only. Persisted locally so a reload mid-set doesn't lose the
    // sub count; never in the share link.
    return {
      active: false, set: 1, rotationIndex: 0, us: 0, them: 0,
      onFloor: [],               // 6 player ids by starting zone (startOrder snapshot)
      liberoId: null,
      subsUsed: 0,
      slots: {},                 // slotIdx -> [ids who have occupied it, in order]  (same-slot re-entry)
      log: [],                   // { set, rotationIndex, inId, outId, slot, us, them, t }
      played: {}                 // playerId -> true (whole match)
    };
  }
  ```
  `S.match = defaultMatch()`; `save()` persists it under `match`; `applyLoadedState` restores it; `encodeStateForUrl` **does not** include it (add to the comment block at `app.js:453-456`).
  ```js
  /* canSub: pure legality check. Returns { ok:true } or { ok:false, reason }. */
  function canSub(match, level, inId, outId) {
    if (!match.active) return { ok: false, reason: 'Start the set first.' };
    if (match.subsUsed + 1 > level.subsPerSet) return { ok: false, reason: `Out of subs (${level.subsPerSet} per set).` };
    const slot = match.onFloor.indexOf(outId);
    if (slot < 0) return { ok: false, reason: 'That player is not on the floor.' };
    if (match.onFloor.includes(inId)) return { ok: false, reason: 'She is already on the floor.' };
    if (inId === match.liberoId) return { ok: false, reason: 'The libero swaps on her own — no sub needed.' };
    // Same-slot re-entry: a player who has been in the game may only return to the slot she left.
    for (const s in match.slots) {
      if (Number(s) !== slot && (match.slots[s] || []).includes(inId)) return { ok: false, reason: 'She can only re-enter for the player who replaced her.' };
    }
    return { ok: true };
  }
  function applySub(match, inId, outId) {
    const slot = match.onFloor.indexOf(outId);
    const next = { ...match, onFloor: match.onFloor.slice(), slots: { ...match.slots }, log: match.log.slice(), played: { ...match.played } };
    next.onFloor[slot] = inId;
    next.slots[slot] = (match.slots[slot] || [match.onFloor[slot]]).concat(inId);
    next.subsUsed = match.subsUsed + 1;
    next.played[inId] = true;
    next.log.push({ set: match.set, rotationIndex: match.rotationIndex, inId, outId, slot, us: match.us, them: match.them, t: Date.now() });
    return next;
  }
  function pendingPlannedSub(match, patterns) {
    // The planned pattern whose in-rotation is now and whose 'out' player is on the floor,
    // or whose return-rotation is now and whose 'in' player is on the floor (the return leg).
    return (patterns || []).find(p => p.auto && p.trigger.rotationIndex === match.rotationIndex && match.onFloor.includes(p.out) && !match.onFloor.includes(p.in.id))
        || (patterns || []).find(p => p.auto && p.return && p.return.rotationIndex === match.rotationIndex && match.onFloor.includes(p.in.id));
  }
  window.canSub = canSub; window.applySub = applySub; window.pendingPlannedSub = pendingPlannedSub;
  ```
  **Built as:** the match snapshots `starters`, `liberoId` and `plan` (ids only) at Start set, so a reload mid-set renders with `S.result === null`. `startSet()` reuses the snapshot for set 2+ if no fresh lineup exists.
  Also `startSet(result)`: snapshot `onFloor = result.arrangement.startOrder.map(p => p.id)`, `liberoId`, mark all seven `played`, `slots = {}` with each slot seeded `[id]`, `active = true`, score 0-0, `rotationIndex 0`, `subsUsed 0`. `endSet()`: `active=false`, `set++`, keep `played` and `log`. `newMatch()`: `S.match = defaultMatch()`.

- [x] **5.2 — Markup + render.** Nav: fourth tab `<button class="tab" data-tab="bench"><span class="tab-icon">📋</span><span class="tab-label">Bench</span></button>`. Panel:
  ```html
  <section class="tab-panel" id="benchTab" role="tabpanel">
    <div class="bench-empty" id="benchNoLineup" hidden><p>Generate a lineup first — the bench screen runs off it.</p></div>
    <div id="benchScreen" hidden>
      <div class="bench-top">
        <div class="bench-score">
          <button class="btn btn-score" id="usMinus">−</button><span class="score-us" id="scoreUs">0</span><button class="btn btn-score btn-primary" id="usPlus">+</button>
          <span class="score-sep">·</span>
          <button class="btn btn-score" id="themMinus">−</button><span class="score-them" id="scoreThem">0</span><button class="btn btn-score" id="themPlus">+</button>
        </div>
        <div class="bench-meta"><span id="benchSet">Set 1</span> · <span id="benchRot">Rotation 1</span> · <span id="benchSubs">0 / 18 subs</span></div>
        <div class="bench-actions"><button class="btn btn-primary" id="startSetBtn">Start set</button><button class="btn btn-secondary" id="rotateBtn" hidden>Rotate ➜</button><button class="btn btn-secondary btn-tiny" id="endSetBtn" hidden>End set</button><button class="btn btn-secondary btn-tiny" id="newMatchBtn">New match</button></div>
      </div>
      <div class="bench-nudge" id="benchNudge" hidden></div>
      <div class="bench-main">
        <div class="bench-court" id="benchCourt"></div>
        <aside class="bench-side">
          <h3>Hasn't played yet</h3><div class="chip-row" id="notPlayed"></div>
          <h3>Sub plan</h3><ol class="sub-plan-list compact" id="benchPlan"></ol>
          <h3>Bench</h3><div class="chip-row" id="benchAvail"></div>
        </aside>
      </div>
    </div>
  </section>
  ```
  `renderBenchScreen()` (called from `setTab('bench')` and after every match mutation): court = current rotation's six from `S.match.onFloor` rotated by `rotationIndex` (reuse `_rotationsFromStartOrder` on the id array, map ids → players), libero applied via `effectiveRotationWithLibero` with `liberoConfig.replaces`; each floor chip is a 56px-tall button "Sub…". Nudge: if `S.match.us - S.match.them >= currentLevel().leadThreshold` and `pendingPlannedSub(...)` → banner "Up by 6 — **#12 Ava** in for **#4 Mia**. [Sub in]"; below threshold but a planned sub exists → muted "Planned: Ava for Mia when we're up by 5". Not-played = available players not in `S.match.played`.

- [x] **5.3 — Interactions.** Score ± mutate `S.match.us/them`, `save()`, re-render. `Rotate ➜` → `rotationIndex = (rotationIndex+1)%6`. Floor chip "Sub…" opens the existing confirm-modal pattern repurposed as a picker: list available bench players, each with `canSub()` evaluated — legal ones tappable, illegal ones greyed with the reason as subtext. Confirm → `S.match = applySub(...)`, toast "#12 in for #4 — 3 of 18". Nudge "Sub in" does the same for the planned pair (still runs `canSub`). End set / New match confirm via `confirmDialog`. `setTab('bench')` → if `!S.result || S.result.error` show `#benchNoLineup`.

- [x] **5.4 — Styles.** `bench-main` is a 2-column grid at `min-width: 1024px landscape` (court `minmax(0,1fr)`, side 360px), stacked below. `.btn-score { min-width: 64px; min-height: 64px; font-size: 28px; }`. `.bench-nudge` is a brand-soft banner with a 56px primary button. Court reuses `.rot-court` scaled up: `.bench-court .rot-zone { min-height: 120px; }`.

- [ ] **Verify** — iPad landscape: start set → +5 us → rotation of the first planned sub → nudge appears → Sub in → counter 1/18, "hasn't played" shrinks; reload → state intact; try to sub the same player in a different slot → refused with reason; set Advanced cap to 1 → second sub refused. Share link from this device opened elsewhere: no match state.

---

## Block 6 — Tests + print

**Goal**: Regression net for everything new; paper output reflects the plan and the intangibles.
**Files**: `tests/algorithm.spec.js`, `tests/fixtures/*.json`, `app.js` (print 1714-1840), `styles.css` (print) · **Scope**: M · **Depends on**: Blocks 1, 2, 4, 5

### Tasks

- [x] **6.1 — Fixtures.** `roster-ms-12.json` (2 S, 4 OH, 3 MB, 1 L, 2 OH — includes `intangibles`), `roster-simple-6.json` (6 players, mixed positions), `roster-tie-attitude.json` (7 players; two OH with identical skills, attitude 9 vs 3). `runGenerate` helper in the spec gains `level` (default `'ms'`) and sets `window.S.settings.level`, drops `ruleset`.

- [x] **6.2 — Assertions** (each its own `test`):
  1. 4-2 on ms-12: starters have 2 S, 2 OH, 2 MB; `result.libero.player` set; every rotation has exactly one S in `frontRow` and one in `backRow`.
  2. `roleForScoring(setter, 'back', '4-2') === 'DS'` and `(…, 'front', '4-2') === 'S'`; `(…, 'front', '6-2') === 'OPP'`; `(…, 'back', '5-1') === 'S'`.
  3. Simple 6 on simple-6 fixture: no error, 6 starters, `libero === null`.
  4. Simple 6 on ms-12: libero present, `arrangement.rotations.length === 6`.
  5. Tie fixture, 4-2: the attitude-9 OH is a starter, attitude-3 is not.
  6. Intangible tiebreak never outranks skill: bump attitude-3 OH's hitting by 1 → she starts instead.
  7. Planner on ms-12 (cap 18): `patterns.length === 5`, `subsUsed === 10`, every pattern's `return.rotationIndex === (trigger.rotationIndex + 3) % 6`, no two patterns share an `out`.
  8. Planner cap 4 → `patterns.length === 2`, `benchLeft.length === 3`, and `benchLeft` are the three lowest-intangible bench players.
  9. Planner never subs the setter in 5-1 (`out` ≠ setter id) and does in 4-2 when she's the cheapest.
  10. `applySubPatterns` span: pattern in@1 return@4 is active at 1,2,3 and not 4,5,0.
  11. `canSub` refuses over cap, refuses wrong-slot re-entry, allows same-slot re-entry.
  12. Existing 5-1 / 6-2 assertions unchanged (10 tests).

- [x] **6.3 — Print.** `buildPrintLineupDOM` (`app.js:1761`): after the rotation table add "Sub plan" table (In · For · Goes in at · Comes out at) from auto patterns, then "Subs: N of cap". `buildPrintRosterDOM` (`app.js:1714`): add Attitude and Athl. columns after the six skills; header shows Level. Print CSS: `.print-subplan td { padding: 3pt 6pt; }`, keep to one page for ≤ 14 players (test at 14).

- [ ] **6.4 — Final verification.**
  ```bash
  npm test                      # ~22 tests green
  npm run preview               # smoke every tab, both themes, phone + iPad sizes
  ```
  Console clean on Chrome + iPad Safari. Then Derek reviews the preview and gives the push go-ahead.

---

## Round 2 — coach-side feedback (2026-09-05)

Derek reviewed the preview and asked for four changes. All built and verified:

- [x] **All-around position.** `'ANY'` is a primary-position value meaning "no position yet." First option in the picker, default for new players, never offered as a secondary. Not in `ROLES` — it's never a lineup slot. In strict (HS) mode an all-around is eligible for every role. Scoring now uses the role a starter was *given* in this lineup (`result.roleOf`), not her primary, so an all-around picked as setter scores as a setter; unassigned all-arounds score as a hitter up front / back-row player in back.
- [x] **Dark-mode contrast.** Skill inputs, AVG badge, sort select and every other brand-colored text used `--green-dark` (dark navy) on a dark surface. New `--brand-text` token: navy in light, pale blue in dark.
- [x] **Lineup tab rebuilt around one court.** One rotation at a time, big chips with full names, rotation dots + Rotate, a score card (rotation strength, Overall + six categories averaged over the six on the floor with weakest/strongest flagged, lineup Worst/Average/Best), bench beside it with drag-drop onto any zone → pin → regenerate → scores update. The six-card grid (with planned subs) moved under a collapsed "All six rotations"; the breakdown panel is gone (its content is the score card).
- [x] **Bench tab hidden.** Off the nav by default; "Show Bench tab (live sub tracker)" under Advanced brings it back. Nothing deleted.

## Round 3 — coach-side feedback (2026-09-05)

- [x] **Bench is a real drag source.** Big cards (60px+, grip handle, name, position, AVG pill) in the side column, which now scrolls on its own if the bench runs long.
- [x] **Middle = main hitter, Outside = second hitter.** Picker order at MS is Setter, Middle — main hitter, Outside — second hitter, Libero; chips say Outside / Middle. Optimizer unchanged: at MS the blocking scale already makes hitting the dominant middle skill.
- [x] **Jersey # hidden by default.** `settings.v = 2`; saves without `v` get `showJersey` flipped off once. Advanced toggle still turns it on.
- [x] **AVG on every big-court chip** (bottom-right). Pin marker moved to the top-right so it no longer covers the zone number.

## Round 4 — coach-side feedback (2026-09-05)

- [x] **"Why Darcy over Ellie?"** — she was pinned. Pins are now impossible to miss: the zone label says PINNED in amber, and the status line under Generate counts pins and points at Clear pins. Chips playing out of position say so ("Outside · playing Middle") because 4-2 fills two middle slots even from a roster with no middles.
- [x] **Bench full width** under the court, as a grid of cards; the score card keeps the side column alone.

## Round 5 — pins replaced by the board (2026-09-05)

Derek: "I don't like the pin system." Pins were the college optimizer's memory of drag overrides — every drag became a solver constraint, the rest of the lineup reshuffled, and the rule outlived the moment (and rode the share link). Replaced with **the board**:

- [x] `S.lineup.board = { startOrder: [6 ids], liberoId }` is the lineup. Team-forever state (saved + shared).
- [x] **Suggest lineup** (was Generate) runs the optimizer once and writes the board. After that the court is the coach's: bench → spot replaces that player; court → court swaps; nothing else moves. Court → bench is refused (six on the floor).
- [x] `resultFromBoard()` scores the board into the same result shape, so the court view, grid, score card, sub plan, print sheet and bench tab are untouched. Everyone scores by her own position (no role assignment on a manual board). An unavailable starter leaves a '—' hole and a warning, not an error.
- [x] The board renders on load; the libero chip isn't draggable (change her under Libero).
- [x] Pins: `overrides` stays in state but is always empty; Clear pins button, PINNED labels and the pin status line are gone. 28 tests.

## Round 6 — libero panel (2026-09-05)

- [x] Derek: "What is the libero widget doing? We don't have all those positions." Panel rewritten in coach words: a one-line explanation, the libero picker (libero-position players first), **Comes in for** with only this level's positions (Setter / Middle / Outside at MS), and a line saying whether she may serve (pointing at the Advanced toggle). The "Serves in rotation" dropdown was dead — `servesInRotation` was stored but never read — so it's gone. Data shape unchanged.

## Round 7 — NFHS rules (2026-09-05)

WVSSAC §127-3-30.1 makes NFHS the playing rules; §30.10 applies them to middle school with season-length changes only. So the defaults in `LEVELS` are NFHS defaults.

- [x] **Libero serves from one spot per set.** `resolveLiberoServeRot()` picks the rotation (coach's choice under Libero → "Serves in", else the first candidate); `effectiveRotationWithLibero(…, rotIdx)` keeps her out of the serving spot anywhere else, so the middle serves there. `scoreRotation` now uses the shared swap (no duplicate logic) and takes a rotation index. The libero panel says which rotation she serves in.
- [x] **Setters play the front row only** (`S.lineup.setterFrontOnly`, 4-2 only): the planner gives each setter her own passer first (best DS-fit off the bench, spot-locked re-entry means no sharing), then plans everybody-plays with the rest. Rows are tagged "Setter sub". 31 tests.

Still to verify against the 2025–26 NFHS book (I could not open it): one libero per set; replacement-zone and "one rally between replacements" details. Neither affects the lineup math.

## Round 8 — "How do I save a rotation?" (2026-09-05)

There is no save step: the board is the starting six, rotations 2–6 are derived, and everything is saved on drop. What Derek described ("change rotation 3, keep it, rotate…") is substitutions, so drags now mean the right thing per rotation:

- [x] **Rotation 1** = the starting six (board edits, as before).
- [x] **Rotations 2–6** = a drag onto a spot is a coach sub from that rotation through the end of the trip (`coachSubDrop` → sub pattern with `coach:true`, return at rotation 0). Dragging the starter back onto her sub (or the sub to the bench) sets the return. Same-spot re-entry enforced; a sub can't be replaced by another sub; court↔court swaps refused outside rotation 1.
- [x] The court shows the coach's subs (not the conditional everybody-plays ones); the bench shows whoever is off the floor *in that rotation*; the hint under the court says which mode you're in.
- [x] Coach subs appear in the Sub plan ("Your sub", ✕ to remove), print on the sheet, feed the Bench tab, and the everybody-plays planner works around them (their subs count, their starters are spoken for).
- [x] Sub patterns now persist/share `in` as an id and relink on load (no stale player copies). 34 tests.

## Round 9 — the print must match the court (2026-09-05)

- [x] Derek: the printout showed subs he never made (Ansley, LuLu). Cause: the printed rotations and the six-rotation grid baked in the automatic everybody-plays plan while the big court showed only his subs. Now every rotation diagram (court, grid, print) is starters + coach subs + libero; the automatic plan prints as its own labeled table ("If we're ahead — planned subs") and is headed the same way in the Sub plan list. Optimizer mode dropped from the MS print header.

## Round 10 — "Lyla is missing" (2026-09-05)

- [x] The starter the libero covers was invisible: her chip showed the libero, and she's deliberately not on the bench. The libero chip now reads "Libero · in for Lyla" on the court and in the grid, and the print cell says "L Emilia for Lyla".

## Round 11 — the libero lives on the bench (2026-09-05)

- [x] Derek: "include Libero as an option to drag in — there will always be 6 on the bench." The libero is now always the first bench card ("Libero · covers Lyla, Jesslyn"). Dragging her onto a starter toggles whether she comes in for that starter in the back row; coverage is **by player** (`liberoConfig.covers`), and the position checkboxes are only what she starts out covering after Suggest lineup (old saves with no `covers` still work by position). The Libero panel lists who she covers with ✕ chips.

## Round 12 — "my changes aren't on the print" (2026-09-05)

Could not reproduce: pointer-event drags (rotation-1 swap, rotation-3 sub) then the real Print button gave a sheet matching the court in all six rotations, before and after a reload. Most likely a stale cached `app.js` from before the round-9 print fix. Hardened so it can't be a guess next time:

- [x] `APP_VERSION` stamp in the topbar tooltip and the print footer; `?v=` cache-busters on `app.js` / `styles.css`; `bump-version.py`.
- [x] Load is newest-wins: if localStorage is newer than the address-bar link, local wins and the bar is re-synced (a reload 400ms after a drag, or an old bookmark, can no longer roll a change back). Address-bar sync is flushed on `pagehide`/`beforeunload`.

## Round 13 — "Darcy in twice" (2026-09-05)

- [x] Two coach subs for the same bench player could overlap (one made from a later rotation first, then one from an earlier rotation "through 6"). `coachSubDrop` now checks the whole span — she can't already be on the floor anywhere from this rotation to 6, and the starter can't already have someone coming in — and `applySubPatterns` never seats a player who is already on the floor, which repairs existing saves.

## Rounds 14–15 — refusals you can read (2026-09-05)

- [x] `refuse()`: red toast, 6.5s, plain-English rule text (re-entry, both-on-the-floor, sub-for-a-sub, libero).
- [x] While dragging a subbed-out player in rotations 2–6, the one spot she may re-enter (her replacement's) is outlined green and the rest dim.

## Parallel Execution Map

```
Block 0 ──┬──> Block 1 ──┬──> Block 4 ──> Block 5 ──┐
          │              │                          ├──> Block 6
          └──> Block 2 ──┘         Block 3 ─────────┘
                                   (any time after 0; 3.4 waits on assets)
```

Blocks 1 and 2 touch different regions of `app.js` (roster/render vs algorithm) and can run in parallel worktrees; merge before 4. Block 3 is CSS-heavy and independent of 2; it can trail. Block 6 is last and sequential.

## Open items from the coach (defaults in `LEVELS` until answered)

| Question | Default shipped | Where to change |
|---|---|---|
| Subs per set | 18 | Advanced → Subs per set |
| Libero may serve | yes | Advanced → toggle |
| Libero serves in one rotation only? | **enforced (NFHS)** — auto or chosen under Libero | Libero → Serves in |
| "Winning enough" | +5 | Advanced → Sub in when we're up by |
| Same-slot re-entry | yes | `LEVELS.ms.reentry` |
| Roster size | planner handles 6–20 | — |
