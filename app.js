/* =============================================================
   Court IQ College — Volleyball Lineup Tool
   Single-file app logic: state, persistence, UI, algorithm

   ⚠️  This is a fresh fork of the youth-rec Court IQ tool
   (https://github.com/demerson-code/court-iq). The college version
   needs significant rework before this is suitable for a college
   team. Major TODOs:
     - Rotation systems: support 5-1 (one fixed setter) and 6-2
       (two setters from back row). Add a setter-system selector.
     - Specialized positions: tag each player with primary position
       (OH1 / OH2 / MB1 / MB2 / S / OPP / L / DS) and respect those
       constraints in the optimizer.
     - Libero rules: back-row only, doesn't count in rotation, may
       or may not serve depending on league.
     - NCAA substitution model: 15 subs/set cap, re-entry rules.
     - Algorithm: position-locked assignment problem (Hungarian /
       constraint solver), not "best 6 + balance variance."
     - Skills: split passing into serve-receive vs free-ball pass,
       add blocking, add hitting efficiency, add tempo for setters.
     - Match-day mode: situational lineups, opponent scouting,
       live sub tracking.
   ============================================================= */

/* ===== Constants ===== */
const ROLES = ['OH', 'MB', 'S', 'OPP', 'L', 'DS'];
// MS shows the plain names; HS shows the fuller ones. Keys never change.
const ROLE_LABELS = { ANY: 'All-around', OH: 'Outside', MB: 'Middle', S: 'Setter', OPP: 'Right Side', L: 'Libero', DS: 'Defensive Specialist' };
const ROLE_LABELS_HS = { ...ROLE_LABELS, OH: 'Outside Hitter', MB: 'Middle Blocker' };
// In Covenant's 4-2 the middle is the main hitter and the outside the second
// hitter — the picker says so in words, and lists them in that order.
const ROLE_PICKER_LABELS_MS = { MB: 'Middle — main hitter', OH: 'Outside — second hitter' };
function roleLabel(r) { return (isHS() ? ROLE_LABELS_HS : ROLE_LABELS)[r] || r; }
// 'ANY' = no position yet (coaches are still working it out). Not in ROLES:
// it's never a lineup slot, and the optimizer treats her as eligible for
// every role and scores her by whichever role she was actually given.
const ROLE_CODES = { ANY: 'ALL' };
function roleCode(r) { return ROLE_CODES[r] || r || ''; }
const SYSTEM_LABELS = {
  '4-2':    '4-2 — setter sets from the front row',
  'simple': 'Simple 6 — best six, normal rotation',
  '5-1':    '5-1 — one setter, all six rotations',
  '6-2':    '6-2 — setters set from the back row'
};

const SKILLS = ['serving', 'serveReceive', 'defense', 'hitting', 'blocking', 'setting'];
const SKILL_LABELS = {
  serving: 'Serving',
  serveReceive: 'Serve Receive',
  defense: 'Defense',
  hitting: 'Hitting',
  blocking: 'Blocking',
  setting: 'Setting'
};
const SKILL_LABELS_SHORT = {
  serving: 'Serve',
  serveReceive: 'Recv',
  defense: 'Def',
  hitting: 'Hit',
  blocking: 'Block',
  setting: 'Set'
};
const SETTER_TEMPO_KEY = 'setterTempo'; // toggleable 7th skill, S-only

// Rated like skills, kept apart from them: they never feed lineup score
// directly. They order the bench in the sub plan and break ties between
// near-equal starters. Speed/athleticism lives here rather than in skills
// because it's a trait, not a volleyball skill.
const INTANGIBLES = ['attitude', 'athleticism'];
const INTANGIBLE_LABELS = { attitude: 'Attitude', athleticism: 'Speed / Athleticism' };
const INTANGIBLE_LABELS_SHORT = { attitude: 'Attitude', athleticism: 'Speed' };
const TIEBREAK_WEIGHT = 0.001; // a 10-vs-1 intangible gap (< 0.01) can never beat a 0.05 skill gap
function defaultIntangibles() { const o = {}; INTANGIBLES.forEach(k => o[k] = 5); return o; }
function intangibleScore(p) {
  const it = (p && p.intangibles) || {};
  return INTANGIBLES.reduce((a, k) => a + (it[k] || 5), 0) / INTANGIBLES.length;
}
function tiebreak(p) { return intangibleScore(p) * TIEBREAK_WEIGHT; }

// One dial, four effects: which positions the coach sees, which systems
// the picker offers, which controls are visible, and the rule preset.
// Every value here is a DEFAULT — the coach can override subsPerSet,
// leadThreshold and liberoMayServe under Advanced (settings.levelOverrides).
const LEVELS = {
  ms: {
    label: 'Middle School',
    subsPerSet: 18,          // NFHS default; Covenant's league TBD — coach confirms
    liberoMayServe: true,    // confirmed 2026-09-04
    reentry: 'sameSlot',
    timeoutsPerSet: 2,
    roleStrict: false,       // never reject a roster for lacking a role
    blockingScale: 0.35,     // blocking rarely decides MS points; tall girls still get credit
    leadThreshold: 5,        // "winning enough" to start subbing — coach adjusts
    roles: ['S', 'MB', 'OH', 'L'],
    systems: ['4-2', 'simple', '5-1']
  },
  hs: {
    label: 'High School',
    subsPerSet: 18,
    liberoMayServe: true,
    reentry: 'sameSlot',
    timeoutsPerSet: 2,
    roleStrict: true,        // HS coaches assign positions; validation messages are useful here
    blockingScale: 1,
    leadThreshold: 5,
    roles: ['S', 'MB', 'OH', 'OPP', 'L', 'DS'],
    systems: ['4-2', 'simple', '5-1', '6-2']
  }
};
// roleStrict: when false (MS), any player can fill any role/zone — the
// optimizer still scores per-role fit, but won't reject a roster that
// lacks a designated setter or libero, and won't reject pins that violate
// role caps.
function currentLevel(settings) {
  const s = settings || (typeof S !== 'undefined' ? S.settings : null) || {};
  const base = LEVELS[s.level] || LEVELS.ms;
  // Coach overrides (Advanced panel) layer over the level defaults.
  return { ...base, ...(s.levelOverrides || {}) };
}
function isHS(settings) { return ((settings || S.settings || {}).level) === 'hs'; }

// Per-role skill weights (higher = more important for that role).
// Used by Block 2's algorithm; declared here so the data model and
// algorithm share a single source of truth.
const ROLE_SKILL_WEIGHTS = {
  OH:  { serving: 1.5, serveReceive: 2.5, defense: 1.5, hitting: 3.0, blocking: 1.0, setting: 0.5 },
  MB:  { serving: 1.0, serveReceive: 0.5, defense: 1.0, hitting: 2.5, blocking: 4.0, setting: 0.5, bonusBackRow: 'serveReceive' },
  S:   { serving: 1.5, serveReceive: 0.5, defense: 2.0, hitting: 0.5, blocking: 0.5, setting: 5.0 },
  OPP: { serving: 2.0, serveReceive: 0.5, defense: 1.5, hitting: 3.5, blocking: 2.0, setting: 0.5 },
  L:   { serving: 1.0, serveReceive: 5.0, defense: 4.0, hitting: 0.0, blocking: 0.0, setting: 0.0 },
  DS:  { serving: 1.5, serveReceive: 4.5, defense: 4.0, hitting: 0.0, blocking: 0.0, setting: 0.0 }
};
// Setter tempo is added at full weight (5.0) for S-role lineup scoring when settings.showSetterTempo is on.

const POSITION_NAMES = {
  1: 'Right Back (serves)',
  2: 'Right Front',
  3: 'Middle Front',
  4: 'Left Front',
  5: 'Left Back',
  6: 'Middle Back'
};

// safeStorage: localStorage with try/catch + in-memory fallback for mobile Safari private mode.
const safeStorage = (() => {
  let inMemory = {};
  const test = () => { try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch { return false; } };
  const ok = test();
  return {
    get: (k) => ok ? localStorage.getItem(k) : (inMemory[k] ?? null),
    set: (k, v) => { if (ok) try { localStorage.setItem(k, v); } catch { inMemory[k] = v; } else inMemory[k] = v; },
    remove: (k) => { if (ok) try { localStorage.removeItem(k); } catch {} delete inMemory[k]; }
  };
})();

const STORAGE_KEY = 'court_iq_covenant_v1';
const LEGACY_KEY = null; // no prior tool on a Covenant coach's device — nothing to migrate
const THEME_KEY = 'court_iq_covenant_theme'; // 'light' | 'dark' | null (= follow device)

/* ===== State ===== */
const DEFAULT_TEAM_NAME = 'Covenant Middle School';

function defaultSettings() {
  return {
    level: 'ms',
    levelOverrides: {},          // { subsPerSet?, leadThreshold?, liberoMayServe? }
    system: '4-2',
    showJersey: false,           // confusing at this stage — coach can turn it on under Advanced
    showSetterTempo: false,
    showBench: false,            // live sub tracker tab; off until a coach asks for it
    v: 2                         // settings shape version; bump when a default flips
  };
}

function defaultWeights() {
  // Equal-weight default; coach can tune in the Weights tab.
  // Block 2's optimizer multiplies these by ROLE_SKILL_WEIGHTS — coach weights
  // act as a global "this skill matters more on our team" knob.
  const w = {};
  SKILLS.forEach(s => w[s] = 5);
  return w;
}

function defaultLineup() {
  // optimizationMode: 'balanced' | 'best6' | 'sr' | 'serving'
  // overrides:        { rotationIndex, zone, playerId } — coach-pinned slots
  // liberoConfig:     { playerId|null, replaces:['MB'|'OPP'|...], servesInRotation: 0..5|null }
  // subPatterns:      [{ id, out, in, trigger:{rotationIndex,event}, return?: {...}, auto? }]
  //                   auto:true = written by planEverybodyPlays; never persisted
  // pairings:         [{ a: playerId, b: playerId }] — both must be starters together
  // everybodyPlays:   run the sub planner after every Generate
  // planExclude:      { starterId: true } — starters the coach won't sub out
  // board:            { startOrder: [6 playerIds by starting zone], liberoId } — THE lineup.
  //                   "Suggest lineup" fills it from the optimizer; drags edit it directly.
  //                   Everything on screen, in print and in the sub plan derives from it.
  return {
    optimizationMode: 'balanced',
    overrides: [],           // legacy pin system — always empty now
    liberoConfig: { playerId: null, replaces: ['MB'], servesInRotation: null },
    subPatterns: [],
    pairings: [],
    everybodyPlays: true,
    planExclude: {},
    setterFrontOnly: false,  // 4-2 only: a passer subs in for each setter's back-row trip
    board: null
  };
}

function defaultScrimmage() {
  // teamCount:    2 | 3 | 4
  // attendance:   { playerId: bool } — Tuesday-night attendance checklist;
  //               defaults to whatever's marked p.available on the roster.
  // teams:        [[playerId, ...], [playerId, ...], ...] — last-generated split.
  // lastSpread:   number | null — gap between strongest and weakest team total.
  // subOverrides: [playerId] — players the coach has manually designated as
  //               subs (overriding the lowest-skill auto-pick). Reset on each
  //               Pick teams so a fresh team gets fresh sub designations.
  return {
    teamCount: 2,
    attendance: {},
    teams: [],
    lastSpread: null,
    subOverrides: []
  };
}

/* Match / bench state. Tonight-only: persisted locally so a reload mid-set
   keeps the sub count, never in the share link. It snapshots its own
   starters, libero and sub plan (as ids) at Start set, so the bench screen
   never depends on a lineup still being in memory. */
function defaultMatch() {
  return {
    active: false,
    set: 1,
    rotationIndex: 0,
    us: 0, them: 0,
    starters: [],      // 6 player ids by starting zone, captured at the first Start set
    liberoId: null,
    plan: [],          // [{ id, out, in, trigger, return }] — ids only
    onFloor: [],       // 6 ids by starting slot; changes as subs happen
    subsUsed: 0,
    slots: {},         // slotIdx -> [ids who have occupied it, in order] (same-slot re-entry)
    log: [],           // { set, rotationIndex, inId, outId, slot, us, them, t }
    played: {}         // playerId -> true, for the whole match
  };
}
function normalizeMatch(m) {
  const d = defaultMatch();
  if (!m || typeof m !== 'object') return d;
  const ids = a => Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
  const int = (v, dflt) => Number.isInteger(v) ? v : dflt;
  return {
    active: !!m.active,
    set: int(m.set, 1) > 0 ? int(m.set, 1) : 1,
    rotationIndex: ((int(m.rotationIndex, 0) % 6) + 6) % 6,
    us: Math.max(0, int(m.us, 0)),
    them: Math.max(0, int(m.them, 0)),
    starters: ids(m.starters),
    liberoId: typeof m.liberoId === 'string' ? m.liberoId : null,
    plan: Array.isArray(m.plan) ? m.plan.filter(x => x && x.out && x.in && x.trigger) : [],
    onFloor: ids(m.onFloor),
    subsUsed: Math.max(0, int(m.subsUsed, 0)),
    slots: (m.slots && typeof m.slots === 'object') ? m.slots : {},
    log: Array.isArray(m.log) ? m.log : [],
    played: (m.played && typeof m.played === 'object') ? m.played : {}
  };
}

let S = {
  teamName: DEFAULT_TEAM_NAME,
  players: [],
  weights: defaultWeights(),
  settings: defaultSettings(),
  lineup: defaultLineup(),
  scrimmage: defaultScrimmage(),
  match: defaultMatch(),
  result: null,
  lastEdited: null,
  rosterSort: 'avg-desc',   // 'avg-desc' | 'avg-asc' | 'name-asc' | 'name-desc'
  benchSort: 'avg-desc',
  currentTab: 'roster'      // last-active tab; restored on reload
};

const VALID_TABS = new Set(['roster', 'lineup', 'scrimmage', 'bench']); // 'bench' arrives in Block 5
const VALID_SYSTEMS = new Set(['4-2', 'simple', '5-1', '6-2']); // keep in step with SYSTEM_REQUIREMENTS

const SORT_MODES = new Set(['avg-desc', 'avg-asc', 'name-asc', 'name-desc']);

/* ===== Helpers ===== */
function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultSkills() {
  const o = {};
  SKILLS.forEach(s => o[s] = 5);
  return o;
}

function createPlayer(name = '', positions = ['ANY', null]) {
  return {
    id: genId(),
    name,
    jersey: '',                 // string; blank when toggle is off
    height: '',                 // freeform e.g. "6-1" or "185cm"
    hand: 'R',                  // 'R' | 'L'
    positions,                  // [primary, secondary|null], values from ROLES
    skills: defaultSkills(),
    intangibles: defaultIntangibles(),
    setterTempo: 5,             // only surfaced when settings.showSetterTempo and primary === 'S'
    available: true
  };
}

// One-time migration of pre-college (youth-rec) player records.
// Old shape: skills.passing, skills.spiking, skills.attitude, skills.communication; no positions.
// New shape: skills.serveReceive + skills.defense + skills.hitting + skills.blocking; positions[].
function migratePlayer(p) {
  if (!p || typeof p !== 'object') return p;
  const isLegacy = p.skills && (
    'passing' in p.skills || 'spiking' in p.skills ||
    'attitude' in p.skills || 'communication' in p.skills
  ) && !Array.isArray(p.positions);
  if (!isLegacy) return p;

  const old = p.skills || {};
  const passing = (old.passing | 0) || 5;
  const newSkills = {
    serving:      (old.serving | 0) || 5,
    serveReceive: passing,                     // best-guess split: passing -> both
    defense:      (old.defense | 0) || passing,
    hitting:      (old.spiking | 0) || 5,
    blocking:     5,                           // no analog in old data
    setting:      (old.setting | 0) || 5
  };
  // attitude carries over as an intangible; communication has no analog.
  return {
    ...p,
    skills: newSkills,
    intangibles: { ...defaultIntangibles(), attitude: (old.attitude | 0) || 5 },
    jersey: p.jersey || '',
    height: p.height || '',
    hand: p.hand || 'R',
    positions: Array.isArray(p.positions) ? p.positions : ['OH', null],
    setterTempo: typeof p.setterTempo === 'number' ? p.setterTempo : 5
  };
}

function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.attrs) {
    for (const k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
  }
  if (opts.dataset) {
    for (const k in opts.dataset) e.dataset[k] = opts.dataset[k];
  }
  if (opts.on) {
    for (const k in opts.on) e.addEventListener(k, opts.on[k]);
  }
  if (opts.title) e.title = opts.title;
  children.forEach(c => {
    if (c == null) return;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  });
  return e;
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

/* ===== Persistence ===== */
let urlUpdateTimer = null;
let lastEditedDisplayTimer = null;

function save(opts = {}) {
  // Bump timestamp for real edits (not for hash-load mirroring)
  if (!opts.silent) S.lastEdited = Date.now();

  const payload = {
    teamName: S.teamName,
    players: S.players.map(p => ({
      id: p.id,
      name: p.name,
      jersey: p.jersey || '',
      height: p.height || '',
      hand: p.hand || 'R',
      positions: p.positions || ['OH', null],
      skills: p.skills,
      intangibles: p.intangibles || defaultIntangibles(),
      setterTempo: typeof p.setterTempo === 'number' ? p.setterTempo : 5,
      available: p.available
    })),
    weights: S.weights,
    settings: S.settings,
    currentTab: S.currentTab,
    lineup: {
      optimizationMode: S.lineup.optimizationMode,
      overrides: S.lineup.overrides,
      liberoConfig: S.lineup.liberoConfig,
      subPatterns: S.lineup.subPatterns.filter(p => !p.auto).map(p => ({ ...p, in: p.in ? { id: p.in.id } : null })), // planned subs are re-derived on Generate; `in` relinks by id on load
      pairings: S.lineup.pairings,
      everybodyPlays: S.lineup.everybodyPlays !== false,
      planExclude: S.lineup.planExclude || {},
      setterFrontOnly: !!S.lineup.setterFrontOnly,
      board: S.lineup.board || null
    },
    scrimmage: {
      teamCount: S.scrimmage.teamCount,
      attendance: S.scrimmage.attendance
      // teams + lastSpread are intentionally NOT persisted; the user picks
      // teams fresh each session. (Save-to-favorites is future scope.)
    },
    match: S.match,
    lastEdited: S.lastEdited,
    rosterSort: S.rosterSort,
    benchSort: S.benchSort
  };
  safeStorage.set(STORAGE_KEY, JSON.stringify(payload));

  // Auto-sync the URL hash so the address bar always reflects current state.
  // Debounced so rapid edits don't thrash history.replaceState.
  clearTimeout(urlUpdateTimer);
  urlUpdateTimer = setTimeout(() => {
    if (!hasMeaningfulState()) return;
    history.replaceState(null, '', '#d=' + encodeStateForUrl());
    updateLastEditedDisplay();
  }, 400);

  // Update display sooner so the user sees feedback
  updateLastEditedDisplay();
}

function hasMeaningfulState() {
  return S.players.length > 0 || (S.teamName && S.teamName.trim().length);
}

function load() {
  // Read local-only preferences (currentTab, attendance, etc.) from
  // localStorage even when we end up loading from URL — those aren't part
  // of the team data and shouldn't be reset by a fresh hash.
  let localOnly = null;
  try {
    const raw = safeStorage.get(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        localOnly = {
          currentTab: VALID_TABS.has(data.currentTab) ? data.currentTab : null,
          scrimmage: (data.scrimmage && typeof data.scrimmage === 'object') ? data.scrimmage : null,
          match: (data.match && typeof data.match === 'object') ? data.match : null
        };
      }
    }
  } catch (e) { /* ignore */ }

  const urlState = readStateFromUrl();
  if (urlState) {
    applyLoadedState(urlState);
    // Restore local-only prefs that the URL hash doesn't carry.
    if (localOnly) {
      if (localOnly.currentTab) S.currentTab = localOnly.currentTab;
      if (localOnly.match) S.match = normalizeMatch(localOnly.match);
      if (localOnly.scrimmage) {
        S.scrimmage = {
          ...S.scrimmage,
          attendance: (localOnly.scrimmage.attendance && typeof localOnly.scrimmage.attendance === 'object')
            ? localOnly.scrimmage.attendance : S.scrimmage.attendance,
          teamCount: (localOnly.scrimmage.teamCount === 2 || localOnly.scrimmage.teamCount === 3 || localOnly.scrimmage.teamCount === 4)
            ? localOnly.scrimmage.teamCount : S.scrimmage.teamCount
        };
      }
    }
    // Mirror back to localStorage so future saves don't drop the local-only prefs.
    save({ silent: true });
    return { fromUrl: true };
  }
  try {
    let raw = safeStorage.get(STORAGE_KEY);
    if (!raw && LEGACY_KEY) {
      const legacy = safeStorage.get(LEGACY_KEY);
      // Silent migration: copy youth-rec record into the college-scoped key.
      // Don't delete the legacy key — youth tool still owns it.
      if (legacy) { safeStorage.set(STORAGE_KEY, legacy); raw = legacy; }
    }
    if (raw) applyLoadedState(JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return { fromUrl: false };
}

function applyLoadedState(data) {
  if (!data) return;
  if (typeof data.teamName === 'string' && data.teamName.trim()) {
    S.teamName = data.teamName.trim();
  }
  if (Array.isArray(data.players)) {
    S.players = data.players.map(raw => {
      // First migrate any youth-rec / v1 records to the college shape, then
      // normalize against the new shape's defaults.
      const migrated = migratePlayer(raw);
      return {
        id: migrated.id || genId(),
        name: migrated.name || '',
        jersey: migrated.jersey || '',
        height: migrated.height || '',
        hand: migrated.hand === 'L' ? 'L' : 'R',
        positions: Array.isArray(migrated.positions) && migrated.positions.length
          ? [migrated.positions[0] || 'OH', migrated.positions[1] || null]
          : ['OH', null],
        skills: { ...defaultSkills(), ...(migrated.skills || {}) },
        intangibles: { ...defaultIntangibles(), ...(migrated.intangibles || {}) },
        setterTempo: typeof migrated.setterTempo === 'number' ? migrated.setterTempo : 5,
        available: migrated.available !== false
      };
    });
  }
  if (data.weights) {
    // Discard stale skill keys (passing/spiking/attitude/communication) — keep only current SKILLS.
    const w = defaultWeights();
    SKILLS.forEach(k => { if (typeof data.weights[k] === 'number') w[k] = data.weights[k]; });
    S.weights = w;
  }
  if (data.settings && typeof data.settings === 'object') {
    const { ruleset: _legacyRuleset, ...incoming } = data.settings;
    if (!incoming.v) incoming.showJersey = false; // pre-v2 saves defaulted jersey ON; flip once
    S.settings = {
      ...defaultSettings(),
      ...incoming,
      level: LEVELS[data.settings.level] ? data.settings.level : 'ms',
      levelOverrides: (data.settings.levelOverrides && typeof data.settings.levelOverrides === 'object')
        ? data.settings.levelOverrides : {},
      system: VALID_SYSTEMS.has(data.settings.system) ? data.settings.system : '4-2'
    };
  }
  if (data.lineup && typeof data.lineup === 'object') {
    const VALID_MODES = new Set(['balanced', 'best6', 'sr', 'serving']);
    S.lineup = {
      ...defaultLineup(),
      optimizationMode: VALID_MODES.has(data.lineup.optimizationMode) ? data.lineup.optimizationMode : 'balanced',
      overrides: Array.isArray(data.lineup.overrides) ? data.lineup.overrides : [],
      liberoConfig: data.lineup.liberoConfig && typeof data.lineup.liberoConfig === 'object'
        ? { ...defaultLineup().liberoConfig, ...data.lineup.liberoConfig }
        : defaultLineup().liberoConfig,
      subPatterns: Array.isArray(data.lineup.subPatterns)
        ? data.lineup.subPatterns.filter(p => p && !p.auto).map(p => ({ ...p, in: (p.in && p.in.id) ? (S.players.find(x => x.id === p.in.id) || null) : null }))
        : [],
      pairings: Array.isArray(data.lineup.pairings) ? data.lineup.pairings : [],
      everybodyPlays: data.lineup.everybodyPlays !== false,
      planExclude: (data.lineup.planExclude && typeof data.lineup.planExclude === 'object') ? data.lineup.planExclude : {},
      setterFrontOnly: !!data.lineup.setterFrontOnly,
      board: (data.lineup.board && Array.isArray(data.lineup.board.startOrder) && data.lineup.board.startOrder.length === 6)
        ? { startOrder: data.lineup.board.startOrder.map(String), liberoId: typeof data.lineup.board.liberoId === 'string' ? data.lineup.board.liberoId : null }
        : null
    };
  }
  if (data.scrimmage && typeof data.scrimmage === 'object') {
    const tc = data.scrimmage.teamCount;
    S.scrimmage = {
      ...defaultScrimmage(),
      teamCount: (tc === 2 || tc === 3 || tc === 4) ? tc : 2,
      attendance: (data.scrimmage.attendance && typeof data.scrimmage.attendance === 'object')
        ? data.scrimmage.attendance : {},
      // Teams are intentionally NOT restored — user wants a fresh "Pick teams"
      // each session. A future "save to favorites" will live in its own slot.
      teams: [],
      lastSpread: null
    };
  }
  if (data.match && typeof data.match === 'object') S.match = normalizeMatch(data.match);
  if (typeof data.lastEdited === 'number') S.lastEdited = data.lastEdited;
  if (SORT_MODES.has(data.rosterSort)) S.rosterSort = data.rosterSort;
  if (SORT_MODES.has(data.benchSort)) S.benchSort = data.benchSort;
  if (VALID_TABS.has(data.currentTab)) S.currentTab = data.currentTab;
}

/* ===== Sorting ===== */
function sortByMode(items, mode, getName, getAvg) {
  const arr = items.slice();
  switch (mode) {
    case 'avg-asc':
      return arr.sort((a, b) => getAvg(a) - getAvg(b));
    case 'name-asc':
      return arr.sort((a, b) => (getName(a) || '').toLocaleLowerCase().localeCompare((getName(b) || '').toLocaleLowerCase()));
    case 'name-desc':
      return arr.sort((a, b) => (getName(b) || '').toLocaleLowerCase().localeCompare((getName(a) || '').toLocaleLowerCase()));
    case 'avg-desc':
    default:
      return arr.sort((a, b) => getAvg(b) - getAvg(a));
  }
}

/* ===== URL encoding (compact base64url JSON) =====
   v2 envelope: { v:2, t, p[], w[], cfg, ln, e }.
     - Players are encoded as compact tuples (positional, no key names) and
       carry their `id` so lineup overrides / pairings / libero / sub-patterns
       (which reference player IDs) survive a round-trip.
     - Scrimmage state, match/bench state, currentTab, and sort prefs are deliberately NOT
       included — those are local "tonight" preferences that shouldn't follow
       a coach's link to another coach's device.
   Legacy decoder accepts the Block 1 ad-hoc shape (object-form players with
   n/s/a/pos/h/ht/j/st keys) so any link generated before v2 still loads. */
const SHARE_VERSION = 2;
// Player tuple indices: [id, name, positions, hand, height, jersey, skillsArr, setterTempo, available, intangiblesArr]
// Index 9 was added for Covenant; a college-era link without it decodes to all-5s.
const PT = { ID:0, NAME:1, POS:2, HAND:3, HEIGHT:4, JERSEY:5, SKILLS:6, TEMPO:7, AVAIL:8, INTANG:9 };

function compactPlayer(p) {
  return [
    p.id || genId(),
    p.name || '',
    p.positions || ['OH', null],
    p.hand === 'L' ? 'L' : 'R',
    p.height || '',
    p.jersey || '',
    SKILLS.map(k => p.skills[k] | 0),
    typeof p.setterTempo === 'number' ? p.setterTempo : 5,
    p.available ? 1 : 0,
    INTANGIBLES.map(k => ((p.intangibles || {})[k] | 0) || 5)
  ];
}

function encodeStateForUrl() {
  const compact = {
    v: SHARE_VERSION,
    t: S.teamName || undefined,
    p: S.players.map(compactPlayer),
    w: SKILLS.map(k => S.weights[k] | 0),
    cfg: S.settings,
    ln: { ...S.lineup, subPatterns: S.lineup.subPatterns.filter(p => !p.auto).map(p => ({ ...p, in: p.in ? { id: p.in.id } : null })) },
    e: S.lastEdited || undefined
  };
  return b64urlEncode(JSON.stringify(compact));
}

function readStateFromUrl() {
  const m = window.location.hash.match(/^#d=(.+)$/);
  if (!m) return null;
  let c;
  try { c = JSON.parse(b64urlDecode(m[1])); } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  return c.v === 2 ? decodeShareV2(c) : decodeShareLegacy(c);
}

function decodeShareV2(c) {
  return {
    teamName: typeof c.t === 'string' ? c.t : '',
    players: Array.isArray(c.p) ? c.p.map(tuple => {
      if (!Array.isArray(tuple)) return null;
      const skillsArr = tuple[PT.SKILLS] || [];
      const skills = {};
      SKILLS.forEach((k, i) => skills[k] = (typeof skillsArr[i] === 'number') ? skillsArr[i] : 5);
      const itArr = Array.isArray(tuple[PT.INTANG]) ? tuple[PT.INTANG] : [];
      const intangibles = {};
      INTANGIBLES.forEach((k, i) => intangibles[k] = (typeof itArr[i] === 'number') ? itArr[i] : 5);
      const pos = tuple[PT.POS];
      return {
        id: typeof tuple[PT.ID] === 'string' && tuple[PT.ID] ? tuple[PT.ID] : genId(),
        name: tuple[PT.NAME] || '',
        jersey: tuple[PT.JERSEY] || '',
        height: tuple[PT.HEIGHT] || '',
        hand: tuple[PT.HAND] === 'L' ? 'L' : 'R',
        positions: Array.isArray(pos) && pos.length
          ? [pos[0] || 'OH', pos[1] || null]
          : ['OH', null],
        skills,
        intangibles,
        setterTempo: typeof tuple[PT.TEMPO] === 'number' ? tuple[PT.TEMPO] : 5,
        available: tuple[PT.AVAIL] !== 0
      };
    }).filter(Boolean) : [],
    weights: decodeWeightsArray(c.w),
    settings: (c.cfg && typeof c.cfg === 'object') ? c.cfg : null,
    lineup: (c.ln && typeof c.ln === 'object') ? c.ln : null,
    lastEdited: typeof c.e === 'number' ? c.e : null
  };
}

// Block 1 ad-hoc / pre-v2 shape: players are objects with n/s/a/pos/h/ht/j/st.
// No player IDs — pairings/overrides/libero/subPatterns can't bind to players
// in this format, so they're effectively reset (matches the pre-v2 behavior).
// migratePlayer in applyLoadedState upgrades any older youth-rec records.
function decodeShareLegacy(c) {
  return {
    teamName: c.t || '',
    players: (c.p || []).map(p => {
      const skills = {};
      SKILLS.forEach((k, i) => skills[k] = (p.s && p.s[i]) || 5);
      return {
        id: genId(),
        name: p.n || '',
        jersey: p.j || '',
        height: p.ht || '',
        hand: p.h === 'L' ? 'L' : 'R',
        positions: Array.isArray(p.pos) && p.pos.length
          ? [p.pos[0] || 'OH', p.pos[1] || null]
          : ['OH', null],
        skills,
        intangibles: defaultIntangibles(),
        setterTempo: typeof p.st === 'number' ? p.st : 5,
        available: p.a !== 0
      };
    }),
    weights: decodeWeightsArray(c.w),
    settings: (c.cfg && typeof c.cfg === 'object') ? c.cfg : null,
    lineup: (c.ln && typeof c.ln === 'object') ? c.ln : null,
    lastEdited: typeof c.e === 'number' ? c.e : null
  };
}

function decodeWeightsArray(arr) {
  const w = defaultWeights();
  if (Array.isArray(arr)) {
    SKILLS.forEach((k, i) => { if (typeof arr[i] === 'number') w[k] = arr[i]; });
  }
  return w;
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.hash = 'd=' + encodeStateForUrl();
  return url.toString();
}

/* ===== Help system =====
   Help content stored as structured data. Each entry defines title +
   an array of body items rendered as DOM (no innerHTML on dynamic
   strings). Items: {p}=paragraph, {h}=subheading, {dl}=def list,
   {callout}=highlighted note. */
const HELP = {
  'skills-key': {
    title: 'The six skills',
    body: [
      { p: 'Rate each player 1–10. Keep the definitions the same for everyone so the ratings mean something:' },
      { dl: [
        ['Serving', 'Gets it over and in, with some pace and placement.'],
        ['Serve Receive', 'Passes the other team\'s serve up to the setter.'],
        ['Defense', 'Digs hard-hit balls and reads where the attack is going.'],
        ['Hitting', 'Puts the ball down from the net — power, placement, and smart shots.'],
        ['Blocking', 'Gets hands over the net at the right time. Counts less at middle school, but your tall girls still get credit.'],
        ['Setting', 'Runs the offense — a clean, hittable second ball.']
      ] },
      { callout: 'Rate against our team, not the league. A 7 means "one of our better ones," not "one of the best around."' }
    ]
  },
  'intangibles': {
    title: 'Intangibles',
    body: [
      { p: 'Two extra ratings that don\'t change who starts:' },
      { dl: [
        ['Attitude', 'Coachable, positive, good teammate.'],
        ['Speed / Athleticism', 'Covers ground, quick to the ball, moves well.']
      ] },
      { callout: 'They decide who comes off the bench first in the sub plan, and break ties between two players who are otherwise equal. A better passer still starts over a nicer kid.' }
    ]
  },
  'systems': {
    title: 'Which system?',
    body: () => {
      const items = [
        { dl: [
          ['4-2', 'Two setters across from each other. Whichever one is in the front row sets; the other plays the back row. The classic middle-school system.'],
          ['Simple 6', 'No positions, no system — your best six on the floor, rotating normally. Good for a scrimmage or a young team.'],
          ['5-1', 'One setter who sets from everywhere. Only worth it when you have one girl who can run the whole rotation.']
        ] }
      ];
      if (isHS()) items.push({ callout: '6-2 (high school): two setters, but the one in the BACK row sets, so you always have three hitters up front. Needs two setters who can also hit.' });
      items.push({ callout: 'Suggest lineup gives you a starting six. After that the court is yours: drag a bench player onto a spot to put her in, or drag two players on the court to swap them. Nothing else moves.' });
      return items;
    }
  },
  'sub-plan': {
    title: 'The sub plan',
    body: [
      { p: 'Once you generate a lineup, the plan lists how every girl on the bench gets in:' },
      { dl: [
        ['When she goes in', 'When the starter she replaces rotates back to serve. She serves, then plays two more rotations in the back row.'],
        ['When she comes out', 'Right before she\'d rotate up to the net — the starter comes back in for her.'],
        ['Order', 'Highest Attitude first, then Speed, then skill.'],
        ['Setters front row only', 'In a 4-2, turn this on and a passer goes in for each setter when she rotates to the back row, and the setter comes back at the net. Each setter needs her own passer (re-entry is spot-locked), and it uses 4 subs per trip around.']
      ] },
      { callout: 'Each swap uses two of your subs (in and back out). The plan stops when the next swap would go over your sub limit — change the limit under Advanced.' }
    ]
  },
  'optimization-mode': {
    title: 'What "best" means',
    body: [
      { dl: [
        ['Balanced', 'No weak rotation. The usual choice.'],
        ['Best 6 on floor', 'Strongest opening rotation; the rest can be uneven.'],
        ['Best serve-receive', 'Favors passers. Use against a tough server.'],
        ['Best serving', 'Favors servers. Use when you need to score from the line.']
      ] }
    ]
  },
  'rotation-strength': {
    title: 'Rotation strength',
    body: [
      { p: 'Each bar is the total skill on the floor for that rotation. Balanced mode makes the shortest bar as tall as it can.' },
      { dl: [
        ['Worst', 'Your most vulnerable rotation.'],
        ['Best', 'Your strongest.'],
        ['Average', 'All six together.']
      ] }
    ]
  }
};

function openHelp(key) {
  const entry = HELP[key];
  if (!entry) return;
  $('#helpTitle').textContent = entry.title;
  const bodyEl = $('#helpBody');
  bodyEl.replaceChildren();
  const body = typeof entry.body === 'function' ? entry.body() : entry.body;
  for (const item of body) {
    if (item.p) bodyEl.appendChild(el('p', { text: item.p }));
    else if (item.h) bodyEl.appendChild(el('h4', { text: item.h, attrs: { style: 'font-size:14px;margin:14px 0 6px;color:var(--green-dark);' } }));
    else if (item.dl) {
      const dl = document.createElement('dl');
      for (const [t, d] of item.dl) {
        dl.appendChild(el('dt', { text: t }));
        dl.appendChild(el('dd', { text: d }));
      }
      bodyEl.appendChild(dl);
    } else if (item.callout) {
      bodyEl.appendChild(el('div', { cls: 'help-callout', text: item.callout }));
    }
  }
  $('#helpModal').hidden = false;
}

function closeHelp() {
  $('#helpModal').hidden = true;
}

function makeHelpButton(key, label = 'What is this?') {
  return el('button', {
    cls: 'help-btn',
    text: '?',
    attrs: { 'aria-label': label, type: 'button' },
    on: {
      click: e => {
        e.preventDefault();
        e.stopPropagation();
        openHelp(key);
      }
    }
  });
}

/* ===== Last-edited display ===== */
function formatRelativeTime(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 0 || sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    return `${m} min${m === 1 ? '' : 's'} ago`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    return `${h} hr${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(sec / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function updateLastEditedDisplay() {
  const bar = document.getElementById('statusBar');
  const text = document.getElementById('lastEditedText');
  if (!bar || !text) return;
  if (S.lastEdited) {
    bar.hidden = false;
    text.textContent = `${S.teamName ? S.teamName + ' • ' : ''}edited ${formatRelativeTime(S.lastEdited)}`;
  } else {
    bar.hidden = true;
  }
  // Re-tick every minute so the relative time stays accurate
  clearTimeout(lastEditedDisplayTimer);
  lastEditedDisplayTimer = setTimeout(updateLastEditedDisplay, 60_000);
}

function renderTeamName() {
  const el = document.getElementById('teamNameDisplay');
  if (!el) return;
  const target = S.teamName || DEFAULT_TEAM_NAME;
  if ((el.textContent || '') !== target) el.textContent = target;
}

/* ===== Share modal ===== */
async function openShareModal() {
  const url = buildShareUrl();
  const teamName = S.teamName?.trim() || 'Untitled team';
  const playerCount = S.players.filter(p => (p.name || '').trim()).length;
  const editedTxt = S.lastEdited ? `edited ${formatRelativeTime(S.lastEdited)}` : 'never edited';

  document.getElementById('shareModalInfo').textContent =
    `${teamName} · ${playerCount} player${playerCount === 1 ? '' : 's'} · ${editedTxt}`;

  const input = document.getElementById('shareUrlInput');
  input.value = url;

  const nativeBtn = document.getElementById('shareNativeBtn');
  // Show native share if supported on this device
  const shareData = { title: `${teamName} — Court IQ`, text: `Court IQ team: ${teamName}`, url };
  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    nativeBtn.hidden = false;
  } else {
    nativeBtn.hidden = true;
  }

  document.getElementById('shareModal').hidden = false;
  // Make sure the URL hash is up to date right now (don't wait for debounce)
  history.replaceState(null, '', '#d=' + encodeStateForUrl());
}

function closeShareModal() {
  document.getElementById('shareModal').hidden = true;
}

async function shareNativeOrCopy() {
  const url = buildShareUrl();
  const teamName = S.teamName?.trim() || 'Court IQ team';
  const shareData = {
    title: `${teamName} — Court IQ`,
    text: `${teamName} on Court IQ:`,
    url
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      closeShareModal();
      return;
    } catch (e) {
      if (e?.name !== 'AbortError') {
        // Fall through to clipboard
      } else {
        return;
      }
    }
  }
  await copyShareUrl();
}

async function copyShareUrl() {
  const url = buildShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — paste it in iMessage or email.');
  } catch (e) {
    // Last resort
    const input = document.getElementById('shareUrlInput');
    input.select();
    document.execCommand?.('copy');
    toast('Link copied.');
  }
}

/* ===== Algorithm (pure functions) =====
   Role-locked, rotation-aware optimizer for 5-1 and 6-2 systems.
   Modes: balanced (maximin), best6, sr, serving.
   Public entry: generateLineup(state). Returns the new shape AND a
   back-compat layer (mode/starting6/rotations/rotationScores/bench/...)
   so the existing UI keeps working until Block 3 rebuilds the lineup tab.
*/

const SYSTEM_REQUIREMENTS = {
  '4-2':    { S: 2, OPP: 0, OH: 2, MB: 2, L: 1 },  // same six as 6-2; differs in who is scored as the setter
  'simple': { ANY: 6, L: 1 },                       // handled by chooseSimpleStarters, not the role solver
  '5-1':    { S: 1, OPP: 1, OH: 2, MB: 2, L: 1 },
  '6-2':    { S: 2, OPP: 0, OH: 2, MB: 2, L: 1 }
};

// Per-call memo cleared at the top of generateLineup.
let _fitCache = null;

function playerFitForRole(player, role, settings) {
  if (!player || !role) return 0;
  const weights = ROLE_SKILL_WEIGHTS[role];
  if (!weights) return 0;
  const cacheKey = _fitCache && `${player.id}|${role}|${(settings && settings.level) || 'ms'}|${settings && settings.showSetterTempo ? 1 : 0}`;
  if (_fitCache && _fitCache.has(cacheKey)) return _fitCache.get(cacheKey);
  let total = 0, weightSum = 0;
  for (const skill of SKILLS) {
    let w = weights[skill] || 0;
    // Blocking rarely decides a middle-school point; scale it by level.
    if (skill === 'blocking') w *= currentLevel(settings).blockingScale;
    if (w === 0) continue;
    total += (player.skills[skill] || 0) * w;
    weightSum += w;
  }
  if (role === 'S' && settings && settings.showSetterTempo) {
    const tempoWeight = 5;
    total += (player.setterTempo || 5) * tempoWeight;
    weightSum += tempoWeight;
  }
  const fit = weightSum > 0 ? total / weightSum : 0;
  if (_fitCache) _fitCache.set(cacheKey, fit);
  return fit;
}

function validRolesForPlayer(player, ruleset) {
  // Rec League: any player can fill any role. The role still affects
  // scoring (via ROLE_SKILL_WEIGHTS) but doesn't gate eligibility.
  if (ruleset && ruleset.roleStrict === false) return ROLES.slice();
  const out = [];
  const pri = player.positions && player.positions[0];
  const sec = player.positions && player.positions[1];
  if (pri === 'ANY') return ROLES.slice();
  if (pri) out.push(pri);
  if (sec && sec !== pri) out.push(sec);
  return out;
}

// Used by sort and other UI bits — average of the 6 college skills.
function playerSkillRaw(player) {
  let s = 0;
  for (const k of SKILLS) s += (player.skills[k] || 0);
  return s / SKILLS.length;
}

/* chooseStarters: backtracking with primary-preference + best-case pruning.
   Returns { starters: { OH:[..], MB:[..], S:[..], OPP:[..], L:[..], DS:[] },
             validation: null | reason-string }.
   forced: optional [{ player, role }] of players that MUST be starters. The
   role must be a valid role for the player (else returned as a validation
   failure). */
function chooseStarters(roster, system, mode, settings, forced, ruleset, pairings) {
  const reqs = SYSTEM_REQUIREMENTS[system];
  if (!reqs) return { starters: null, validation: `Unknown system: ${system}` };
  const relaxed = !!(ruleset && ruleset.roleStrict === false);

  // Coverage check — strict only. Rec accepts any roster shape and lets
  // role-based scoring decide who fills each slot.
  const counts = { OH: 0, MB: 0, S: 0, OPP: 0, L: 0, DS: 0 };
  for (const p of roster) {
    for (const r of validRolesForPlayer(p, ruleset)) counts[r] = (counts[r] || 0) + 1;
  }
  if (!relaxed) {
    for (const role of Object.keys(reqs)) {
      const need = reqs[role];
      if (need > 0 && (counts[role] || 0) < need) {
        const label = roleLabel(role).toLowerCase();
        return { starters: null, validation: `Need ${need} ${label}${need > 1 ? 's' : ''} for ${system} system, found ${counts[role] || 0}.` };
      }
    }
  }

  // Validate forced starters. In strict mode, reject pins that violate role
  // caps; in Rec, reassign each forced player to whichever system-required
  // role they fit best (so pinning a DS in a 5-1 doesn't blow up).
  const forcedByRole = {};
  const forcedIds = new Set();
  if (forced && forced.length) {
    for (const f of forced) {
      if (!f || !f.player || !f.role) continue;
      if (forcedIds.has(f.player.id)) continue;

      let assignedRole = f.role;
      if (relaxed) {
        // Pick the still-needed COURT role this player fits best. Libero is
        // excluded — pins live on numbered zones (1-6) and the libero swap
        // is handled separately, so a pinned player has to fill a 6-on-floor
        // slot or the arrangement constraint can't be satisfied.
        const openRoles = Object.keys(reqs)
          .filter(r => r !== 'L' && reqs[r] > 0 && ((forcedByRole[r] || []).length < reqs[r]))
          .map(r => ({ role: r, fit: playerFitForRole(f.player, r, settings) }))
          .sort((a, b) => b.fit - a.fit);
        if (openRoles.length === 0) continue; // every court slot already pinned
        assignedRole = openRoles[0].role;
      } else {
        if (!validRolesForPlayer(f.player, ruleset).includes(f.role)) {
          return { starters: null, validation: `${f.player.name || 'Player'} can't play ${f.role}; pin not satisfiable.` };
        }
        const cap = reqs[f.role] || 0;
        const already = (forcedByRole[f.role] || []).length;
        if (already >= cap) {
          return { starters: null, validation: `Too many pinned ${f.role}s for ${system}; system only needs ${cap}.` };
        }
      }

      (forcedByRole[assignedRole] = forcedByRole[assignedRole] || []).push(f.player);
      forcedIds.add(f.player.id);
    }
  }

  // Slots remaining after forced placements.
  const rolesToFill = [];
  for (const role of Object.keys(reqs)) {
    const remaining = reqs[role] - ((forcedByRole[role] || []).length);
    for (let i = 0; i < remaining; i++) rolesToFill.push(role);
  }
  rolesToFill.sort((a, b) => (counts[a] || 0) - (counts[b] || 0));

  const candidatesByRole = {};
  for (const role of new Set(rolesToFill)) {
    candidatesByRole[role] = roster
      .filter(p => !forcedIds.has(p.id) && validRolesForPlayer(p, ruleset).includes(role))
      .map(p => ({
        p,
        fit: playerFitForRole(p, role, settings) + tiebreak(p),
        primary: (p.positions && p.positions[0]) === role
      }))
      .sort((a, b) => (b.primary - a.primary) || (b.fit - a.fit));
  }

  let best = null;
  const usedIds = new Set(forcedIds);
  const assignments = [];

  // Seed assignments with forced starters so they appear in the result.
  Object.keys(forcedByRole).forEach(role => {
    forcedByRole[role].forEach(player => assignments.push({ role, player, forced: true }));
  });
  const forcedScore = assignments.reduce((s, a) => s + playerFitForRole(a.player, a.role, settings), 0);

  // Filter pairings to ones whose players exist in the roster (defensive).
  // 'together' (default) means both-or-neither in starters; 'apart' means
  // never both. Apart-pairs only matter when both would be in starters
  // (single-team scope), so they reduce to: not both in starters.
  const rosterIds = new Set(roster.map(p => p.id));
  const activePairings = (pairings || []).filter(pr =>
    pr && pr.a && pr.b && pr.a !== pr.b && rosterIds.has(pr.a) && rosterIds.has(pr.b)
  );

  function pairingsSatisfied(currentIds) {
    for (const pr of activePairings) {
      const aIn = currentIds.has(pr.a);
      const bIn = currentIds.has(pr.b);
      if ((pr.kind || 'together') === 'apart') {
        if (aIn && bIn) return false;
      } else {
        if (aIn !== bIn) return false;
      }
    }
    return true;
  }

  function recurse(idx, runningScore) {
    if (idx === rolesToFill.length) {
      if (activePairings.length > 0) {
        const ids = new Set(assignments.map(a => a.player.id));
        if (!pairingsSatisfied(ids)) return;
      }
      if (!best || runningScore > best.score) {
        best = { score: runningScore, assignments: assignments.map(a => ({ ...a })) };
      }
      return;
    }
    if (best) {
      let upper = runningScore;
      for (let j = idx; j < rolesToFill.length; j++) {
        const cands = candidatesByRole[rolesToFill[j]];
        const top = cands.find(c => !usedIds.has(c.p.id));
        if (top) upper += top.fit; else return;
      }
      if (upper <= best.score) return;
    }
    const role = rolesToFill[idx];
    const cands = candidatesByRole[role];
    for (const c of cands) {
      if (usedIds.has(c.p.id)) continue;
      usedIds.add(c.p.id);
      assignments.push({ role, player: c.p });
      recurse(idx + 1, runningScore + c.fit);
      assignments.pop();
      usedIds.delete(c.p.id);
    }
  }
  recurse(0, forcedScore);

  // Pairings might have over-constrained the search. Retry once without
  // pairings and surface the gap in validation rather than failing hard.
  let pairingsSkipped = false;
  if (!best && activePairings.length > 0) {
    pairingsSkipped = true;
    const reset = assignments.length - Object.keys(forcedByRole).reduce((n, k) => n + (forcedByRole[k] || []).length, 0);
    // Drop any non-forced assignments left over from the failed run.
    while (assignments.length > Object.keys(forcedByRole).reduce((n, k) => n + (forcedByRole[k] || []).length, 0)) {
      assignments.pop();
    }
    activePairings.length = 0; // disable for the fallback
    recurse(0, forcedScore);
  }

  if (!best) {
    if (rolesToFill.length === 0) {
      // All slots forced; just return the forced starters.
      const starters = { OH: [], MB: [], S: [], OPP: [], L: [], DS: [] };
      assignments.forEach(a => starters[a.role].push(a.player));
      return { starters, validation: null };
    }
    return { starters: null, validation: 'Could not find a valid starter set.' };
  }

  const starters = { OH: [], MB: [], S: [], OPP: [], L: [], DS: [] };
  for (const a of best.assignments) starters[a.role].push(a.player);
  return {
    starters,
    validation: pairingsSkipped ? "Couldn't keep all pairings together; constraint was relaxed." : null
  };
}

/* Simple 6: no positions, no system. Best six by raw skill (+ tiebreak),
   pins honoured, libero = best libero-fit among the rest when 7+ are here.
   Starters are bucketed by primary role so every renderer that walks ROLES
   keeps working; `_order` carries the six for the arrangement enumerator. */
function chooseSimpleStarters(roster, settings, forced) {
  const forcedPlayers = (forced || []).map(f => f.player).filter(Boolean);
  const forcedIds = new Set(forcedPlayers.map(p => p.id));
  const ranked = roster
    .filter(p => !forcedIds.has(p.id))
    .sort((a, b) => (playerSkillRaw(b) + tiebreak(b)) - (playerSkillRaw(a) + tiebreak(a)));
  const six = forcedPlayers.concat(ranked).slice(0, 6);
  if (six.length < 6) return { starters: null, validation: `Need 6 available players (you have ${six.length}).` };
  const rest = roster.filter(p => !six.includes(p));
  const lib = rest.length
    ? rest.slice().sort((a, b) => playerFitForRole(b, 'L', settings) - playerFitForRole(a, 'L', settings))[0]
    : null;
  const starters = { OH: [], MB: [], S: [], OPP: [], L: lib ? [lib] : [], DS: [] };
  six.forEach(p => { const r = (p.positions && p.positions[0]) || 'OH'; (starters[r] || starters.OH).push(p); });
  starters._order = six;
  return { starters, validation: null };
}

function _enumerateSimpleArrangements(starters) {
  const six = starters._order || ROLES.flatMap(r => starters[r] || []).slice(0, 6);
  const out = [];
  (function perm(arr, m) {
    if (arr.length === 0) { out.push({ startOrder: m.slice(), rotations: _rotationsFromStartOrder(m) }); return; }
    for (let i = 0; i < arr.length; i++) perm(arr.slice(0, i).concat(arr.slice(i + 1)), m.concat(arr[i]));
  })(six, []);
  return out; // 720 arrangements x 6 rotations — trivially fast
}

/* Compute 6 rotations from a starting zone-1..6 order.
   Volleyball rotation moves clockwise: zone 2 -> 1, 1 -> 6, ..., 3 -> 2.
   So zone z in rotation r is occupied by the player who started at zone
   ((z - 1 + r) mod 6) + 1. */
function _rotationsFromStartOrder(startOrder) {
  const rotations = [];
  for (let r = 0; r < 6; r++) {
    const at = z => startOrder[((z - 1 + r) % 6 + 6) % 6];
    rotations.push({
      // front row left-to-right is zones 4, 3, 2; back row left-to-right is 5, 6, 1.
      frontRow: [at(4), at(3), at(2)],
      backRow:  [at(5), at(6), at(1)],
      server:   at(1)
    });
  }
  return rotations;
}

function _enumerate51Arrangements(starters) {
  const arrangements = [];
  const setter = starters.S[0], opp = starters.OPP[0];
  const [OH1, OH2] = starters.OH;
  const [MB1, MB2] = starters.MB;
  for (let setterZone = 1; setterZone <= 6; setterZone++) {
    const oppZone = ((setterZone - 1 + 3) % 6) + 1; // opposite (3 zones away)
    const remaining = [1, 2, 3, 4, 5, 6].filter(z => z !== setterZone && z !== oppZone);
    const pairs = [];
    for (const z of remaining) {
      const opp = ((z - 1 + 3) % 6) + 1;
      if (!pairs.find(pr => pr.includes(z))) pairs.push([z, opp]);
    }
    for (const ohPairIdx of [0, 1]) {
      const ohPair = pairs[ohPairIdx];
      const mbPair = pairs[1 - ohPairIdx];
      for (const ohOrder of [[OH1, OH2], [OH2, OH1]]) {
        for (const mbOrder of [[MB1, MB2], [MB2, MB1]]) {
          const startOrder = new Array(6);
          startOrder[setterZone - 1] = setter;
          startOrder[oppZone - 1] = opp;
          startOrder[ohPair[0] - 1] = ohOrder[0];
          startOrder[ohPair[1] - 1] = ohOrder[1];
          startOrder[mbPair[0] - 1] = mbOrder[0];
          startOrder[mbPair[1] - 1] = mbOrder[1];
          arrangements.push({ startOrder, rotations: _rotationsFromStartOrder(startOrder) });
        }
      }
    }
  }
  return arrangements;
}

function _enumerate62Arrangements(starters) {
  const arrangements = [];
  const [S0, S1] = starters.S;
  const [OH1, OH2] = starters.OH;
  const [MB1, MB2] = starters.MB;
  for (let s0Zone = 1; s0Zone <= 6; s0Zone++) {
    const s1Zone = ((s0Zone - 1 + 3) % 6) + 1;
    const remaining = [1, 2, 3, 4, 5, 6].filter(z => z !== s0Zone && z !== s1Zone);
    const pairs = [];
    for (const z of remaining) {
      const opp = ((z - 1 + 3) % 6) + 1;
      if (!pairs.find(pr => pr.includes(z))) pairs.push([z, opp]);
    }
    for (const ohPairIdx of [0, 1]) {
      const ohPair = pairs[ohPairIdx];
      const mbPair = pairs[1 - ohPairIdx];
      for (const ohOrder of [[OH1, OH2], [OH2, OH1]]) {
        for (const mbOrder of [[MB1, MB2], [MB2, MB1]]) {
          const startOrder = new Array(6);
          startOrder[s0Zone - 1] = S0;
          startOrder[s1Zone - 1] = S1;
          startOrder[ohPair[0] - 1] = ohOrder[0];
          startOrder[ohPair[1] - 1] = ohOrder[1];
          startOrder[mbPair[0] - 1] = mbOrder[0];
          startOrder[mbPair[1] - 1] = mbOrder[1];
          arrangements.push({ startOrder, rotations: _rotationsFromStartOrder(startOrder) });
        }
      }
    }
  }
  return arrangements;
}

function arrangeRotation(starters, system) {
  if (system === '5-1') return _enumerate51Arrangements(starters);
  if (system === '6-2' || system === '4-2') return _enumerate62Arrangements(starters); // setters opposite each other
  if (system === 'simple') return _enumerateSimpleArrangements(starters);
  return [];
}

/* roleForScoring: which weight profile a player is scored with, given the
   row she's in and the system. A setter only "is" the setter in the row she
   sets from — 4-2 sets from the front, 6-2 from the back, 5-1 from both. The
   other setter is scored as an ordinary player in that row. This is the whole
   difference between 4-2 and 6-2; their arrangements are identical. */
function roleForScoring(player, row, system, roleOf) {
  // Score by the role she was actually given in this lineup when we know it;
  // otherwise by her primary. An all-around with no assignment scores as a
  // hitter up front and a back-row player in the back.
  let primary = (roleOf && roleOf[player.id]) || (player.positions && player.positions[0]) || 'ANY';
  if (primary === 'ANY') primary = row === 'front' ? 'OH' : 'DS';
  if (primary !== 'S') return primary;
  if (system === '5-1') return 'S';
  if (system === '4-2') return row === 'front' ? 'S' : 'DS';
  if (system === '6-2') return row === 'back' ? 'S' : 'OPP';
  return 'S'; // simple: score her as what she is
}

/* scoreRotation: applies libero swap (per level rules) then sums per-player
   fits. Mode-specific accents added to back-row contributions. */
function scoreRotation(rotation, mode, libero, ruleset, settings, system, roleOf, rotIdx) {
  const eff = effectiveRotationWithLibero(rotation, libero, ruleset, rotIdx);
  const frontRow = eff.frontRow;
  const backRow = eff.backRow;

  let sum = 0;
  for (const p of frontRow) {
    if (!p) continue;
    sum += playerFitForRole(p, roleForScoring(p, 'front', system, roleOf), settings);
  }
  for (const p of backRow) {
    if (!p) continue;
    let s = playerFitForRole(p, roleForScoring(p, 'back', system, roleOf), settings);
    // Mode accents on back-row contribution.
    if (mode === 'sr') s += (p.skills.serveReceive || 0) * 0.5;
    else if (mode === 'serving') s += (p.skills.serving || 0) * 0.5;
    sum += s;
  }
  return sum;
}

/* A pattern with a `return` covers every rotation from trigger up to (not
   including) return, wrapping past 6. Without `return` it fires in exactly
   one rotation. */
function _patternActiveAt(pat, rotationIndex) {
  if (!pat || !pat.trigger || pat.trigger.event !== 'in') return false;
  const start = pat.trigger.rotationIndex;
  if (!pat.return || typeof pat.return.rotationIndex !== 'number') return start === rotationIndex;
  const end = pat.return.rotationIndex;
  for (let r = start, n = 0; r !== end && n < 6; r = (r + 1) % 6, n++) if (r === rotationIndex) return true;
  return false;
}

/* applySubPatterns: pure transform — given a rotation and the patterns array
   plus this rotation's index (0..5), returns a new rotation reflecting any
   pattern active at this index. */
function applySubPatterns(rotation, patterns, rotationIndex) {
  if (!patterns || patterns.length === 0) return rotation;
  const out = {
    frontRow: rotation.frontRow.slice(),
    backRow: rotation.backRow.slice(),
    server: rotation.server
  };
  for (const pat of patterns) {
    if (!_patternActiveAt(pat, rotationIndex)) continue;
    const outId = pat.out;
    if (!outId || !pat.in) continue;
    // Shallow copy tagged _sub so the libero never displaces a player who
    // was just subbed in (she'd never actually play). Comparisons are by id.
    const inPlayer = { ...pat.in, _sub: true };
    const fIdx = out.frontRow.findIndex(p => p && p.id === outId);
    if (fIdx >= 0) { out.frontRow[fIdx] = inPlayer; continue; }
    const bIdx = out.backRow.findIndex(p => p && p.id === outId);
    if (bIdx >= 0) {
      out.backRow[bIdx] = inPlayer;
      if (bIdx === 2) out.server = inPlayer;
    }
  }
  return out;
}

/* scoreLineup: top-level scoring used by the optimizer.
   Returns { score, perRotationScores }. */
function scoreLineup(arrangement, mode, libero, patterns, ruleset, settings, system, roleOf) {
  const rotations = arrangement.rotations || arrangement;
  // The libero's one serving spot depends on the arrangement, so resolve it here.
  const lib = libero ? { ...libero, serveRot: resolveLiberoServeRot(rotations, libero, ruleset) } : null;
  const scores = rotations.map((rot, i) => {
    const effective = applySubPatterns(rot, patterns, i);
    return scoreRotation(effective, mode, lib, ruleset, settings, system, roleOf, i);
  });
  if (mode === 'best6') {
    return { score: scores[0], perRotationScores: scores, libero: lib };
  }
  // 'balanced', 'sr', 'serving' all use maximin with avg tiebreaker for now.
  // Block 5's match-day flow can refine sr/serving to score the 3 specific rotations
  // where the team is receiving / serving rather than all 6.
  const min = Math.min.apply(null, scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { score: min * 1000 + avg, perRotationScores: scores, libero: lib };
}

/* SUB_PATTERN_TEMPLATES: seed templates for Block 3's sub-pattern editor. */
const SUB_PATTERN_TEMPLATES = {
  'setter-sub-5-1': {
    label: 'Setter sub (5-1)',
    description: 'Sub a back-row OPP/DS for the setter when she rotates to back row, then sub her back when the setter rotates to front.',
    out: null, in: null,
    trigger: { rotationIndex: 3, event: 'in' },
    return:  { rotationIndex: 0, event: 'in' }
  },
  'mb-ds-sub': {
    label: 'MB → DS',
    description: 'Sub a defensive specialist for a middle blocker when she rotates to the back row.',
    out: null, in: null,
    trigger: { rotationIndex: 3, event: 'in' },
    return:  { rotationIndex: 0, event: 'in' }
  },
  'power-6-sub': {
    label: 'Power-6',
    description: 'Subs to keep your strongest 6 on the floor as much as possible.',
    out: null, in: null,
    trigger: { rotationIndex: 3, event: 'in' },
    return:  { rotationIndex: 0, event: 'in' }
  }
};

/* arrangementSatisfiesOverrides: in rotation r, zone z is occupied by the
   player at startOrder[(z-1+r) mod 6]. An override pinning a player at
   (rotIdx, zone) maps to the constraint startOrder[startIdx] === pinnedId
   where startIdx = (zone-1+rotIdx) mod 6. */
function arrangementSatisfiesOverrides(arrangement, overrides) {
  if (!overrides || overrides.length === 0) return true;
  for (const ov of overrides) {
    const startIdx = ((ov.zone - 1 + ov.rotationIndex) % 6 + 6) % 6;
    const placed = arrangement.startOrder[startIdx];
    if (!placed || placed.id !== ov.playerId) return false;
  }
  return true;
}

/* ===== Everybody-plays planner =====
   A starter who begins at startOrder[i] serves in rotation i (zone 1) and
   is back-row in rotations i, i+1, i+2, then front-row from i+3. The classic
   middle-school sub — "she goes in to serve, plays the back row, comes out
   before she'd rotate to the net" — is therefore: in at rotation i, out at
   (i+3) % 6. Each swap costs 2 subs. One starter serves per rotation, so at
   most one planned sub-in per rotation and at most 6 per plan.

   Eligible starters: everyone on the floor except the libero, the setter
   in 5-1, and the setter in 6-2 (she sets from the back). In 4-2 both
   setters are eligible — the back-row one isn't setting.

   Bench order: intangibles first, then skill. Each bench player takes the
   still-unsubbed starter whose swap costs the least rotation strength over
   her three back-row rotations. Stops at the sub cap.

   Returns { patterns:[], subsUsed, subsCap, benchLeft:[] }. Patterns are
   subPattern-shaped with auto:true; the rest of the app treats them like
   coach-authored ones. Pure — never mutates state. */
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
  const onFloorIds = new Set(startOrder.filter(Boolean).map(p => p.id));
  if (libero && libero.player) onFloorIds.add(libero.player.id);
  const exclude = (state.lineup && state.lineup.planExclude) || {};
  const bench = state.players
    .filter(p => p.available && (p.name || '').trim() && !onFloorIds.has(p.id))
    .sort((a, b) => (intangibleScore(b) - intangibleScore(a)) || (playerSkillRaw(b) - playerSkillRaw(a)));

  const liberoReplaces = (libero && libero.replaces) || ['MB'];
  const eligible = startOrder.map((p, i) => ({ p, i })).filter(({ p }) => {
    if (!p || exclude[p.id]) return false;
    const primary = (p.positions && p.positions[0]) || 'OH';
    if (primary === 'S' && (system === '5-1' || system === '6-2')) return false;
    return true;
  });
  // Libero keeps her spot: on a tie, sub the starters she isn't replacing.
  eligible.sort((a, b) => {
    const ar = liberoReplaces.includes(a.p.positions?.[0]) ? 1 : 0;
    const br = liberoReplaces.includes(b.p.positions?.[0]) ? 1 : 0;
    return ar - br;
  });

  const roleOf = result.roleOf || {};
  const base = rotations.map((r, i) => scoreRotation(r, mode, libero, level, settings, system, roleOf, i));
  const patterns = [];
  const used = new Set();
  const planned = new Set();
  // The coach's own subs come first: they use subs, their starters are
  // spoken for, and their subs are on the floor.
  const coach = coachPatterns(state);
  let subsUsed = coach.reduce((n, pt) => n + (pt.return ? 2 : 1), 0);
  coach.forEach(pt => { used.add(pt.out); planned.add(pt.in.id); });

  // Setters play the front row only (4-2): a passer goes in for each setter
  // when she rotates to the back row, before anyone else is planned. NFHS
  // re-entry is spot-locked, so each setter needs her own passer.
  const setterFirst = !!(state.lineup && state.lineup.setterFrontOnly) && system === '4-2';
  if (setterFirst) {
    const backRowFit = p => playerFitForRole(p, 'DS', settings) + tiebreak(p);
    const setters = startOrder.map((p, i) => ({ p, i }))
      .filter(({ p }) => p && !exclude[p.id] && ((roleOf[p.id] || (p.positions && p.positions[0])) === 'S'));
    for (const { p: setter, i } of setters) {
      if (subsUsed + 2 > cap) break;
      const pick = bench.filter(b => !planned.has(b.id)).sort((a, b) => backRowFit(b) - backRowFit(a))[0];
      if (!pick) break;
      patterns.push({
        id: 'auto_' + setter.id + '_' + pick.id,
        out: setter.id, in: pick,
        trigger: { rotationIndex: i, event: 'in' },
        return:  { rotationIndex: (i + 3) % 6, event: 'in' },
        auto: true, setterSub: true
      });
      used.add(setter.id); planned.add(pick.id); subsUsed += 2;
    }
  }

  for (const sub of bench) {
    if (planned.has(sub.id)) continue;
    if (subsUsed + 2 > cap) break;
    let best = null;
    for (const { p: starter, i } of eligible) {
      if (used.has(starter.id)) continue;
      const pat = {
        id: 'auto_' + starter.id + '_' + sub.id,
        out: starter.id, in: sub,
        trigger: { rotationIndex: i, event: 'in' },
        return:  { rotationIndex: (i + 3) % 6, event: 'in' },
        auto: true
      };
      let cost = 0;
      for (let k = 0; k < 3; k++) {
        const r = (i + k) % 6;
        cost += base[r] - scoreRotation(applySubPatterns(rotations[r], [pat], r), mode, libero, level, settings, system, roleOf, r);
      }
      if (!best || cost < best.cost) best = { pat, cost, starterId: starter.id };
    }
    if (!best) break;
    used.add(best.starterId);
    planned.add(sub.id);
    patterns.push(best.pat);
    subsUsed += 2;
  }
  return { patterns, subsUsed, subsCap: cap, benchLeft: bench.filter(p => !planned.has(p.id)) };
}

/* ===== The board =====
   resultFromBoard: score a coach-owned lineup. Same result shape as
   generateLineup so every renderer, the sub plan, print and the bench tab
   work unchanged. Everyone is scored by her own position (roleOf is empty —
   on a manual board nobody "assigns" roles). A player who has gone missing
   or unavailable leaves a hole ('—') and a warning rather than an error, so
   the coach can drag someone into it. */
function resultFromBoard(state) {
  state = state || S;
  const board = state.lineup && state.lineup.board;
  const settings = state.settings || defaultSettings();
  const level = currentLevel(settings);
  const system = VALID_SYSTEMS.has(settings.system) ? settings.system : '4-2';
  const mode = (state.lineup && state.lineup.optimizationMode) || 'balanced';
  if (!board || !Array.isArray(board.startOrder) || board.startOrder.length !== 6) {
    return { error: 'No lineup yet — tap Suggest lineup to start.', starters: null, validation: 'no-board' };
  }
  const byId = new Map(state.players.map(p => [p.id, p]));
  const ok = p => p && p.available && (p.name || '').trim();
  const six = board.startOrder.map(id => { const p = byId.get(id); return ok(p) ? p : null; });
  const holes = six.filter(p => !p).length;
  const missingNames = board.startOrder.map((id, i) => six[i] ? null : (byId.get(id) ? byId.get(id).name : null)).filter(Boolean);
  const cfg = state.lineup.liberoConfig || {};
  const libCandidate = (cfg.playerId && byId.get(cfg.playerId)) || (board.liberoId && byId.get(board.liberoId)) || null;
  const libero = (libCandidate && ok(libCandidate) && !six.includes(libCandidate))
    ? { player: libCandidate, replaces: cfg.replaces || ['MB'], servesInRotation: cfg.servesInRotation == null ? null : cfg.servesInRotation }
    : null;
  const arrangement = { startOrder: six, rotations: _rotationsFromStartOrder(six) };
  const starters = { OH: [], MB: [], S: [], OPP: [], L: libero ? [libero.player] : [], DS: [] };
  six.forEach(p => { if (!p) return; const r = p.positions && p.positions[0]; (starters[r] || starters.OH).push(p); });
  const roleOf = {};
  _fitCache = new Map();
  const patterns = (state.lineup.subPatterns || []).filter(p => !p.auto);
  const { score, perRotationScores, libero: libResolved } = scoreLineup(arrangement, mode, libero, patterns, level, settings, system, roleOf);
  const validation = holes
    ? `${missingNames.length ? missingNames.join(', ') : 'Someone'} ${holes === 1 ? 'is' : 'are'} no longer available — drag a bench player onto the empty spot.`
    : null;
  return { starters, roleOf, arrangement, libero: libResolved, score, perRotationScores, validation, board, holes };
}

/* Coach subs: sub patterns the coach made by dragging in rotations 2-6.
   Shape is the ordinary subPattern shape plus coach:true. `return` of
   rotation 0 means "through the end of the trip around". */
function coachPatterns(state) {
  state = state || S;
  return ((state.lineup && state.lineup.subPatterns) || []).filter(p => p && p.coach && p.in && p.out);
}

/* courtEffective: the six on the floor in rotation idx as the COACH set it —
   starting six, her own subs, the libero. The automatic everybody-plays
   subs are deliberately left out: they're conditional ("if we're ahead")
   and live in the Sub plan and the six-rotation grid. */
function courtEffective(idx, state) {
  state = state || S;
  const r = state.result;
  if (!r || !r.arrangement) return null;
  const level = currentLevel(state.settings);
  return effectiveRotationWithLibero(applySubPatterns(r.arrangement.rotations[idx], coachPatterns(state), idx), r.libero, level, idx);
}

/* coachSubDrop: a drag onto a spot in rotation idx >= 1. Returns true if
   something changed. Rules follow NFHS re-entry: a starter who was subbed
   out can only come back in for the player who replaced her. */
function coachSubDrop(idx, zone, inId) {
  if (!(zone >= 1 && zone <= 6) || !Number.isInteger(idx)) return false;
  const eff = courtEffective(idx);
  if (!eff) return false;
  const byId = new Map(S.players.map(p => [p.id, p]));
  const inP = byId.get(inId);
  if (!inP) return false;
  const target = playerAtZone(eff, zone);
  const libId = S.result.libero && S.result.libero.player ? S.result.libero.player.id : null;
  if (!target) {
    // An empty spot means a starter went unavailable — fill the starting six instead.
    return boardPutPlayer(idx, zone, inId);
  }
  if (target.id === libId) { toast('The libero swaps on her own — change her under Libero.', 3000); return false; }
  if (inId === libId) { toast('She\u2019s the libero — change that under Libero first.', 3000); return false; }
  const coach = coachPatterns();
  // Return leg: the starter comes back in for the girl who replaced her.
  const back = coach.find(pt => pt.in.id === target.id && pt.out === inId && _patternActiveAt(pt, idx));
  if (back) {
    if (back.trigger.rotationIndex === idx) {
      S.lineup.subPatterns = S.lineup.subPatterns.filter(x => x !== back);
    } else {
      back.return = { rotationIndex: idx, event: 'in' };
    }
    save();
    runGenerate();
    toast(`${inP.name} back in for ${target.name} at rotation ${idx + 1}.`, 2600);
    return true;
  }
  if (coach.some(pt => pt.in.id === target.id && _patternActiveAt(pt, idx))) {
    toast(`${target.name} is a sub — bring the starter back first.`, 3200);
    return false;
  }
  const outPat = coach.find(pt => pt.out === inId && _patternActiveAt(pt, idx));
  if (outPat) {
    toast(`${inP.name} can only come back in for ${outPat.in.name} (same spot rule).`, 3200);
    return false;
  }
  if (eff.frontRow.concat(eff.backRow).some(pl => pl && pl.id === inId)) {
    toast('She\u2019s already on the floor.', 2400);
    return false;
  }
  S.lineup.subPatterns.push({
    id: 'coach_' + genId(),
    out: target.id, in: inP,
    trigger: { rotationIndex: idx, event: 'in' },
    return: { rotationIndex: 0, event: 'in' },
    coach: true
  });
  save();
  runGenerate();
  toast(`${inP.name} in for ${target.name} from rotation ${idx + 1}.`, 2600);
  return true;
}

/* coachSubOut: a court chip dragged to the bench in rotation idx >= 1. If
   she's a coach sub, the starter comes back here. */
function coachSubOut(idx, playerId) {
  const pat = coachPatterns().find(pt => pt.in.id === playerId && _patternActiveAt(pt, idx));
  if (!pat) { toast('Drag a bench player onto her spot to sub her out.', 3000); return false; }
  const byId = new Map(S.players.map(p => [p.id, p]));
  if (pat.trigger.rotationIndex === idx) S.lineup.subPatterns = S.lineup.subPatterns.filter(x => x !== pat);
  else pat.return = { rotationIndex: idx, event: 'in' };
  save();
  runGenerate();
  const starter = byId.get(pat.out);
  toast(`${starter ? starter.name : 'Starter'} back in at rotation ${idx + 1}.`, 2600);
  return true;
}

/* Board edits. Slot = position in startOrder; zone z in rotation r is slot (z-1+r) mod 6. */
function boardSlot(rotIdx, zone) { return ((zone - 1 + rotIdx) % 6 + 6) % 6; }
function boardPutPlayer(rotIdx, zone, playerId) {
  const board = S.lineup.board;
  if (!board || !(zone >= 1 && zone <= 6) || !Number.isInteger(rotIdx)) return false;
  const slot = boardSlot(rotIdx, zone);
  if (board.startOrder[slot] === playerId) return false;
  if (playerId === board.liberoId || playerId === (S.lineup.liberoConfig && S.lineup.liberoConfig.playerId)) {
    toast('She\u2019s the libero — change that under Libero first.', 3000);
    return false;
  }
  const already = board.startOrder.indexOf(playerId);
  if (already >= 0) {
    // She's on the court elsewhere: swap the two spots.
    const tmp = board.startOrder[slot];
    board.startOrder[slot] = playerId;
    board.startOrder[already] = tmp;
  } else {
    board.startOrder[slot] = playerId;
  }
  save();
  runGenerate();
  return true;
}
function boardSwap(rotA, zoneA, rotB, zoneB) {
  const board = S.lineup.board;
  if (!board || !(zoneA >= 1 && zoneA <= 6) || !(zoneB >= 1 && zoneB <= 6)) return false;
  const a = boardSlot(rotA, zoneA), b = boardSlot(rotB, zoneB);
  if (a === b) return false;
  const tmp = board.startOrder[a];
  board.startOrder[a] = board.startOrder[b];
  board.startOrder[b] = tmp;
  save();
  runGenerate();
  return true;
}

/* ===== Bench rules (pure) ===== */

/* canSub: legality of `inId` replacing `outId` right now. */
function canSub(match, level, inId, outId) {
  if (!match.active) return { ok: false, reason: 'Start the set first.' };
  if (match.subsUsed + 1 > level.subsPerSet) return { ok: false, reason: `Out of subs (${level.subsPerSet} per set).` };
  const slot = match.onFloor.indexOf(outId);
  if (slot < 0) return { ok: false, reason: 'That player is not on the floor.' };
  if (match.onFloor.includes(inId)) return { ok: false, reason: 'She is already on the floor.' };
  if (inId === match.liberoId) return { ok: false, reason: 'The libero swaps on her own — no sub needed.' };
  if (outId === match.liberoId) return { ok: false, reason: 'The libero swaps on her own.' };
  // Same-slot re-entry: a player who has been in the game may only return to the slot she left.
  for (const sKey of Object.keys(match.slots)) {
    if (Number(sKey) !== slot && (match.slots[sKey] || []).includes(inId)) {
      return { ok: false, reason: 'She can only re-enter for the player who replaced her.' };
    }
  }
  return { ok: true };
}

/* applySub: returns a new match with the sub applied (no legality check). */
function applySub(match, inId, outId) {
  const slot = match.onFloor.indexOf(outId);
  const next = { ...match, onFloor: match.onFloor.slice(), slots: { ...match.slots }, log: match.log.slice(), played: { ...match.played } };
  next.onFloor[slot] = inId;
  next.slots[slot] = (match.slots[slot] || [outId]).concat(inId);
  next.subsUsed = match.subsUsed + 1;
  next.played[inId] = true;
  next.log.push({ set: match.set, rotationIndex: match.rotationIndex, inId, outId, slot, us: match.us, them: match.them, t: Date.now() });
  return next;
}

/* pendingPlannedSub: the planned swap that belongs to this rotation, if any.
   'in' leg: the sub's rotation is now and the starter is on the floor.
   'return' leg: the return rotation is now and the sub is on the floor. */
function pendingPlannedSub(match, plan) {
  const list = plan || match.plan || [];
  const r = match.rotationIndex;
  const inLeg = list.find(x => x.trigger && x.trigger.rotationIndex === r && match.onFloor.includes(x.out) && !match.onFloor.includes(x.in));
  if (inLeg) return { pattern: inLeg, leg: 'in', inId: inLeg.in, outId: inLeg.out };
  const back = list.find(x => x.return && x.return.rotationIndex === r && match.onFloor.includes(x.in) && !match.onFloor.includes(x.out));
  if (back) return { pattern: back, leg: 'return', inId: back.out, outId: back.in };
  return null;
}

/* The six on the floor for the current rotation, as player objects with the
   libero applied. Works from ids so it survives a reload. */
function matchFloor(match, players, liberoReplaces, level) {
  const byId = new Map(players.map(p => [p.id, p]));
  const order = match.onFloor.map(id => byId.get(id) || null);
  if (order.length !== 6) return null;
  const rots = _rotationsFromStartOrder(order);
  const lib = match.liberoId && byId.get(match.liberoId);
  const cfg = (S.lineup && S.lineup.liberoConfig) || {};
  const libero = lib ? { player: lib, replaces: liberoReplaces || ['MB'], servesInRotation: cfg.servesInRotation } : null;
  if (libero) libero.serveRot = resolveLiberoServeRot(rots, libero, level);
  return effectiveRotationWithLibero(rots[match.rotationIndex], libero, level, match.rotationIndex);
}

/* generateLineup: public entry. Returns the new-shape result that the lineup
   builder UI consumes directly (starters, arrangement, libero, score,
   perRotationScores, validation). Block 2's back-compat layer is gone. */
function generateLineup(state) {
  state = state || S;
  _fitCache = new Map();

  const settings = state.settings || defaultSettings();
  const lineupCfg = state.lineup || defaultLineup();
  const system = VALID_SYSTEMS.has(settings.system) ? settings.system : '4-2';
  const mode = lineupCfg.optimizationMode || 'balanced';
  const ruleset = currentLevel(settings);

  const roster = state.players.filter(p => p.available && (p.name || '').trim());
  const minRoster = system === 'simple' ? 6 : 7; // Simple 6 can run without a libero
  if (roster.length < minRoster) {
    return { error: `Need at least ${minRoster} available players (you have ${roster.length}).`, starters: null, validation: 'roster-size' };
  }

  // Derive forced starters from overrides: each unique pinned player must be
  // a starter in their primary role.
  const overrides = lineupCfg.overrides || [];
  const forcedMap = new Map();
  for (const ov of overrides) {
    if (forcedMap.has(ov.playerId)) continue;
    const player = state.players.find(p => p.id === ov.playerId);
    if (!player) continue;
    forcedMap.set(ov.playerId, { player, role: (player.positions && player.positions[0]) || 'OH' });
  }
  const forced = Array.from(forcedMap.values());

  const pairings = lineupCfg.pairings || [];
  const { starters, validation: starterValidation } = system === 'simple'
    ? chooseSimpleStarters(roster, settings, forced)
    : chooseStarters(roster, system, mode, settings, forced, ruleset, pairings);
  if (!starters) {
    return { error: starterValidation, starters: null, validation: starterValidation };
  }
  // Who plays which role in this lineup — scoring uses this, not primaries.
  const roleOf = {};
  ROLES.forEach(role => (starters[role] || []).forEach(p => { if (p) roleOf[p.id] = role; }));

  // Libero defaults to the first L starter; coach can override the player + replaces in the panel.
  const liberoPlayer = lineupCfg.liberoConfig && lineupCfg.liberoConfig.playerId
    ? state.players.find(p => p.id === lineupCfg.liberoConfig.playerId) || starters.L[0] || null
    : starters.L[0] || null;
  const libero = liberoPlayer ? {
    player: liberoPlayer,
    replaces: (lineupCfg.liberoConfig && lineupCfg.liberoConfig.replaces) || ['MB'],
    servesInRotation: lineupCfg.liberoConfig ? lineupCfg.liberoConfig.servesInRotation : null
  } : null;

  const arrangements = arrangeRotation(starters, system);
  if (arrangements.length === 0) {
    return { error: `No legal arrangement for ${system}`, starters: null, validation: 'arrangement-empty' };
  }

  // Planned (auto) subs are derived from the lineup, so they can't steer it.
  const patterns = (lineupCfg.subPatterns || []).filter(p => !p.auto);
  const valid = arrangements.filter(a => arrangementSatisfiesOverrides(a, overrides));
  const pool = valid.length > 0 ? valid : arrangements;
  const overridesIgnored = valid.length === 0 && overrides.length > 0;

  let best = null;
  for (const arr of pool) {
    const { score, perRotationScores, libero: libResolved } = scoreLineup(arr, mode, libero, patterns, ruleset, settings, system, roleOf);
    if (!best || score > best.score) {
      best = { arrangement: arr, score, perRotationScores, libero: libResolved };
    }
  }

  return {
    starters,
    roleOf,
    arrangement: best.arrangement,
    libero: best.libero,
    score: best.score,
    perRotationScores: best.perRotationScores,
    validation: overridesIgnored
      ? "Couldn't satisfy all pins; pins were ignored."
      : (starterValidation || null)
  };
}

/* ===== Scrimmage team picker =====
   Splits tonight's available players into N evenly-matched teams.
   Honours pairings (must-play-together) by treating linked players as a
   single bucket during assignment.

   Algorithm: greedy seeding (largest-bucket-first to weakest team) followed
   by hill-climbing 1-for-1 swaps between the strongest and weakest teams to
   shrink the total-skill spread. Pure-function: takes a state object,
   returns { teams: [[playerId,...],...], totals, spread, error }. */
function isHereTonight(state, player) {
  // Attendance is a per-session override of roster availability:
  //   - if the user has explicitly toggled attendance for this player, that wins
  //   - otherwise mirror the roster's available flag
  if (!player) return false;
  if (!(player.name || '').trim()) return false;
  const a = state.scrimmage && state.scrimmage.attendance;
  if (a && (player.id in a)) return !!a[player.id];
  return !!player.available;
}

// Cost weights used by the scrimmage local-search. Total-skill spread
// dominates; setting / hitting / blocking spreads and missing-role penalties
// are secondary nudges so we don't ship a team with no setter, no middle, etc.
const TEAM_COST = {
  totalWeight: 1.0,
  settingWeight: 0.3,
  hittingWeight: 0.3,
  blockingWeight: 0.3,
  noSetterPenalty: 5.0,
  noMBPenalty: 3.0
};

// Team scoring counts only the on-floor 6 — the weakest player on a 7-player
// team is the rotating sub and shouldn't pad the team total.
const ROUND_SIZE = 6;

function _onFloor(team, subOverrides) {
  if (!Array.isArray(team) || team.length === 0) return [];
  // If the coach has manually designated subs, exclude them first; then take
  // top-ROUND_SIZE of what remains (still skill-sorted in case the coach
  // forced too few subs). When no overrides are set, fall back to the
  // skill-only auto-pick.
  if (subOverrides && subOverrides.length) {
    const overrideSet = new Set(subOverrides);
    const undesignated = team.filter(p => !overrideSet.has(p.id));
    if (undesignated.length <= ROUND_SIZE) return undesignated;
    return undesignated.slice().sort((a, b) => playerSkillRaw(b) - playerSkillRaw(a)).slice(0, ROUND_SIZE);
  }
  if (team.length <= ROUND_SIZE) return team;
  return team.slice().sort((a, b) => playerSkillRaw(b) - playerSkillRaw(a)).slice(0, ROUND_SIZE);
}

function effectiveTeamTotal(team, subOverrides) {
  return _onFloor(team, subOverrides).reduce((s, p) => s + playerSkillRaw(p), 0);
}

function teamSubIds(team, subOverrides) {
  if (!Array.isArray(team) || team.length === 0) return new Set();
  const onFloor = new Set(_onFloor(team, subOverrides).map(p => p.id));
  const subs = new Set();
  for (const p of team) if (!onFloor.has(p.id)) subs.add(p.id);
  return subs;
}

function _teamMetrics(team) {
  // Skill spreads use the on-floor 6 only; role coverage uses the full team
  // (subs can rotate in to cover a missing setter/middle, so the team isn't
  // really "missing a setter" if a sub-setter is on the bench).
  const onFloor = _onFloor(team);
  let total = 0, setting = 0, hitting = 0, blocking = 0;
  for (const p of onFloor) {
    total += playerSkillRaw(p);
    setting += (p.skills.setting || 0);
    hitting += (p.skills.hitting || 0);
    blocking += (p.skills.blocking || 0);
  }
  let hasSetter = false, hasMB = false;
  for (const p of team) {
    if (!p) continue;
    const pri = p.positions && p.positions[0];
    const sec = p.positions && p.positions[1];
    if (pri === 'S' || sec === 'S') hasSetter = true;
    if (pri === 'MB' || sec === 'MB') hasMB = true;
  }
  return { total, setting, hitting, blocking, hasSetter, hasMB };
}

function _scrimmageCost(teams) {
  const m = teams.map(_teamMetrics);
  const spread = (key) => {
    let mn = Infinity, mx = -Infinity;
    for (const x of m) { if (x[key] < mn) mn = x[key]; if (x[key] > mx) mx = x[key]; }
    return mx - mn;
  };
  let cost =
    spread('total') * TEAM_COST.totalWeight
    + spread('setting') * TEAM_COST.settingWeight
    + spread('hitting') * TEAM_COST.hittingWeight
    + spread('blocking') * TEAM_COST.blockingWeight;
  for (const x of m) {
    if (!x.hasSetter) cost += TEAM_COST.noSetterPenalty;
    if (!x.hasMB) cost += TEAM_COST.noMBPenalty;
  }
  return cost;
}

function pickScrimmageTeams(state, opts) {
  opts = opts || {};
  state = state || S;
  const sc = state.scrimmage || defaultScrimmage();
  const tc = (sc.teamCount === 3 || sc.teamCount === 4) ? sc.teamCount : 2;
  const here = state.players.filter(p => isHereTonight(state, p));
  if (here.length < tc * 4) {
    return { error: `Need at least ${tc * 4} players for ${tc} teams (you have ${here.length} tonight).`, teams: null };
  }

  // Build buckets of players that must end up together. Pairings list now
  // distinguishes 'together' (default) and 'apart' kinds.
  const allPairings = ((state.lineup && state.lineup.pairings) || []).filter(pr =>
    pr && pr.a && pr.b && pr.a !== pr.b
  );
  const togetherPairs = allPairings.filter(pr => (pr.kind || 'together') === 'together');
  const apartPairs = allPairings.filter(pr => pr.kind === 'apart');

  const inHere = new Set(here.map(p => p.id));
  const parent = new Map(here.map(p => [p.id, p.id]));
  function find(x) {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const pr of togetherPairs) {
    if (inHere.has(pr.a) && inHere.has(pr.b)) union(pr.a, pr.b);
  }
  const bucketMap = new Map();
  for (const p of here) {
    const root = find(p.id);
    if (!bucketMap.has(root)) bucketMap.set(root, []);
    bucketMap.get(root).push(p);
  }
  const buckets = Array.from(bucketMap.values());

  // Build apart-constraint adjacency on bucket level: bucket i and bucket j
  // can't share a team if any (apart) pairing crosses them.
  const playerToBucket = new Map();
  buckets.forEach((b, i) => b.forEach(p => playerToBucket.set(p.id, i)));
  const apartByBucket = new Map(); // bucketIdx -> Set of bucketIdx
  for (const pr of apartPairs) {
    if (!inHere.has(pr.a) || !inHere.has(pr.b)) continue;
    const ba = playerToBucket.get(pr.a);
    const bb = playerToBucket.get(pr.b);
    if (ba == null || bb == null || ba === bb) continue; // same bucket = pairing overrides
    if (!apartByBucket.has(ba)) apartByBucket.set(ba, new Set());
    if (!apartByBucket.has(bb)) apartByBucket.set(bb, new Set());
    apartByBucket.get(ba).add(bb);
    apartByBucket.get(bb).add(ba);
  }

  function bucketsApartConflict(bucketIdx, teamBucketIdxs) {
    const apart = apartByBucket.get(bucketIdx);
    if (!apart) return false;
    for (const other of teamBucketIdxs) if (apart.has(other)) return true;
    return false;
  }

  const bucketStrength = b => b.reduce((s, p) => s + playerSkillRaw(p), 0);
  const hasRoleAnchor = (b, role) => b.some(p => {
    const pri = p.positions && p.positions[0];
    const sec = p.positions && p.positions[1];
    return pri === role || sec === role;
  });

  // Seed order: SETTERS first (so each team has a setter if at all possible),
  // then MBs, then everything else by descending strength. Within each group,
  // sort by descending strength.
  const setterBuckets = buckets.filter(b => hasRoleAnchor(b, 'S'));
  const mbBuckets = buckets.filter(b => hasRoleAnchor(b, 'MB') && !hasRoleAnchor(b, 'S'));
  const restBuckets = buckets.filter(b => !setterBuckets.includes(b) && !mbBuckets.includes(b));
  [setterBuckets, mbBuckets, restBuckets].forEach(g => g.sort((a, b) => bucketStrength(b) - bucketStrength(a)));

  if (opts.shuffle) {
    // Shuffle within each group so the role-anchored seed still distributes
    // anchors across teams but the choice of which one goes where changes.
    const shuffleInPlace = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
    };
    shuffleInPlace(setterBuckets);
    shuffleInPlace(mbBuckets);
    shuffleInPlace(restBuckets);
  }

  const orderedBuckets = setterBuckets.concat(mbBuckets, restBuckets);
  const orderToBucketIdx = orderedBuckets.map(b => playerToBucket.get(b[0].id));

  // Team caps.
  const total = here.length;
  const baseSize = Math.floor(total / tc);
  const remainder = total % tc;
  const teamCaps = new Array(tc).fill(0).map((_, i) => i < remainder ? baseSize + 1 : baseSize);

  // Seed: setter buckets round-robin (then MB, then rest), each going to the
  // currently-weakest team that has capacity AND no apart-conflict.
  const teams = Array.from({ length: tc }, () => []);
  const teamBucketIdxs = Array.from({ length: tc }, () => new Set());
  const totals = new Array(tc).fill(0);

  for (let i = 0; i < orderedBuckets.length; i++) {
    const bucket = orderedBuckets[i];
    const myBucketIdx = orderToBucketIdx[i];
    const isSetter = setterBuckets.includes(bucket);
    const isMB = mbBuckets.includes(bucket);

    let bestT = -1, bestVal = Infinity;
    for (let t = 0; t < tc; t++) {
      if (teams[t].length + bucket.length > teamCaps[t]) continue;
      if (bucketsApartConflict(myBucketIdx, teamBucketIdxs[t])) continue;
      // Strong preference: a team without a setter gets the next setter bucket;
      // a team without an MB gets the next MB bucket.
      if (isSetter && _teamMetrics(teams[t]).hasSetter) continue;
      if (isMB && _teamMetrics(teams[t]).hasMB) continue;
      if (totals[t] < bestVal) { bestVal = totals[t]; bestT = t; }
    }
    if (bestT < 0) {
      // Pass 2 — drop the role-coverage filter, keep cap + apart.
      for (let t = 0; t < tc; t++) {
        if (teams[t].length + bucket.length > teamCaps[t]) continue;
        if (bucketsApartConflict(myBucketIdx, teamBucketIdxs[t])) continue;
        if (totals[t] < bestVal) { bestVal = totals[t]; bestT = t; }
      }
    }
    if (bestT < 0) {
      // Pass 3 — overflow the cap rather than violate apart. Pick the team
      // with the smallest overflow (and weakest total) that still respects
      // apart. Sub-counting handles teams >ROUND_SIZE gracefully.
      for (let t = 0; t < tc; t++) {
        if (bucketsApartConflict(myBucketIdx, teamBucketIdxs[t])) continue;
        if (totals[t] < bestVal) { bestVal = totals[t]; bestT = t; }
      }
    }
    if (bestT < 0) {
      // Pass 4 — apart constraints are infeasible (every team has a conflict).
      // Place on the weakest team and surface a warning later.
      let weakest = 0;
      for (let t = 1; t < tc; t++) if (totals[t] < totals[weakest]) weakest = t;
      bestT = weakest;
    }
    teams[bestT].push(...bucket);
    teamBucketIdxs[bestT].add(myBucketIdx);
    totals[bestT] += bucketStrength(bucket);
  }

  // Local search: 1-for-1 swaps between any pair of teams. Restricted to
  // single-player buckets so we don't break a pairing. Reject swaps that
  // create apart-pair conflicts. Accept if cost decreases.
  const bucketSize = id => buckets[playerToBucket.get(id)].length;
  let improved = true, iters = 0;
  let curCost = _scrimmageCost(teams);
  while (improved && iters < 200) {
    improved = false;
    iters++;
    let bestSwap = null;
    for (let ti = 0; ti < tc; ti++) {
      for (let tj = ti + 1; tj < tc; tj++) {
        for (const a of teams[ti]) {
          if (bucketSize(a.id) !== 1) continue;
          const aBucket = playerToBucket.get(a.id);
          for (const b of teams[tj]) {
            if (bucketSize(b.id) !== 1) continue;
            const bBucket = playerToBucket.get(b.id);
            // Apart check after the proposed swap.
            const tiBuckets = new Set(teamBucketIdxs[ti]); tiBuckets.delete(aBucket); tiBuckets.add(bBucket);
            const tjBuckets = new Set(teamBucketIdxs[tj]); tjBuckets.delete(bBucket); tjBuckets.add(aBucket);
            if (bucketsApartConflict(bBucket, tiBuckets) && tiBuckets.has(bBucket) === false) {
              // shouldn't happen but defensive
            }
            // Direct check: would aBucket conflict with anyone left in tj? would bBucket conflict with anyone left in ti?
            const apartA = apartByBucket.get(aBucket);
            const apartB = apartByBucket.get(bBucket);
            let wouldConflict = false;
            if (apartA) for (const x of tjBuckets) if (apartA.has(x) && x !== aBucket) { wouldConflict = true; break; }
            if (!wouldConflict && apartB) for (const x of tiBuckets) if (apartB.has(x) && x !== bBucket) { wouldConflict = true; break; }
            if (wouldConflict) continue;

            // Try the swap on a temporary copy to score it.
            const trialTeams = teams.map(t => t.slice());
            trialTeams[ti] = trialTeams[ti].filter(p => p.id !== a.id);
            trialTeams[ti].push(b);
            trialTeams[tj] = trialTeams[tj].filter(p => p.id !== b.id);
            trialTeams[tj].push(a);
            const trialCost = _scrimmageCost(trialTeams);
            if (trialCost < curCost - 1e-6 && (!bestSwap || trialCost < bestSwap.cost)) {
              bestSwap = { ti, tj, a, b, cost: trialCost, aBucket, bBucket };
            }
          }
        }
      }
    }
    if (bestSwap) {
      const { ti, tj, a, b, aBucket, bBucket } = bestSwap;
      teams[ti] = teams[ti].filter(p => p.id !== a.id); teams[ti].push(b);
      teams[tj] = teams[tj].filter(p => p.id !== b.id); teams[tj].push(a);
      teamBucketIdxs[ti].delete(aBucket); teamBucketIdxs[ti].add(bBucket);
      teamBucketIdxs[tj].delete(bBucket); teamBucketIdxs[tj].add(aBucket);
      totals[ti] = totals[ti] - playerSkillRaw(a) + playerSkillRaw(b);
      totals[tj] = totals[tj] - playerSkillRaw(b) + playerSkillRaw(a);
      curCost = bestSwap.cost;
      improved = true;
    }
  }

  // Surface warnings about role coverage (after best-effort).
  const finalMetrics = teams.map(_teamMetrics);
  const warnings = [];
  finalMetrics.forEach((m, i) => {
    const issues = [];
    if (!m.hasSetter) issues.push('no setter');
    if (!m.hasMB) issues.push('no middle');
    if (teams[i].length < 6) issues.push(`${teams[i].length} players (needs subs for 6v6)`);
    if (issues.length) warnings.push(`Team ${i + 1}: ${issues.join(', ')}`);
  });

  // Effective totals (on-floor 6 only) — matches what the UI will display.
  const effTotals = teams.map(t => effectiveTeamTotal(t));
  return {
    teams: teams.map(t => t.map(p => p.id)),
    totals: effTotals,
    spread: Math.max.apply(null, effTotals) - Math.min.apply(null, effTotals),
    warnings: warnings.length ? warnings : null
  };
}

// Expose pure functions + state object for Block 6 page.evaluate tests.
// Tests inject roster/settings via window.S then call window.generateLineup(window.S).
if (typeof window !== 'undefined') {
  window.generateLineup = generateLineup;
  window.applyLevelGates = applyLevelGates;
  window.currentLevel = currentLevel;
  window.LEVELS = LEVELS;
  window.chooseStarters = chooseStarters;
  window.arrangeRotation = arrangeRotation;
  window.roleForScoring = roleForScoring;
  window.floorSkillAverages = floorSkillAverages;
  window.chooseSimpleStarters = chooseSimpleStarters;
  window.scoreRotation = scoreRotation;
  window.scoreLineup = scoreLineup;
  window.applySubPatterns = applySubPatterns;
  window.planEverybodyPlays = planEverybodyPlays;
  window.resultFromBoard = resultFromBoard;
  window.coachSubDrop = coachSubDrop;
  window.coachSubOut = coachSubOut;
  window.courtEffective = courtEffective;
  window.playerAtZone = playerAtZone;
  window.runGenerate = runGenerate;
  window.resolveLiberoServeRot = resolveLiberoServeRot;
  window.effectiveRotationWithLibero = effectiveRotationWithLibero;
  window.canSub = canSub;
  window.applySub = applySub;
  window.pendingPlannedSub = pendingPlannedSub;
  window.defaultMatch = defaultMatch;
  window._patternActiveAt = _patternActiveAt;
  window.playerFitForRole = playerFitForRole;
  window.validRolesForPlayer = validRolesForPlayer;
  window.pickScrimmageTeams = pickScrimmageTeams;
  window.isHereTonight = isHereTonight;
  window.SUB_PATTERN_TEMPLATES = SUB_PATTERN_TEMPLATES;
  window.SYSTEM_REQUIREMENTS = SYSTEM_REQUIREMENTS;
  Object.defineProperty(window, 'S', { get: () => S, configurable: true });
  // Print helpers — direct reference avoids the shadowing footgun where
  // window.fn = () => fn() recurses (the arrow's lexical lookup finds the
  // window property assigned just above, not the function declaration).
  window.buildPrintRosterDOM = buildPrintRosterDOM;
  window.buildPrintLineupDOM = buildPrintLineupDOM;
}

/* ===== Demo roster =====
   13 generic players covering all 6 roles with enough depth for both 5-1 and
   6-2 systems. Wired to the "Load Demo Roster" button in the empty roster
   state — gives a coach trying the tool an instant, fully-functional team. */
const DEMO_ROSTER = [
  // 12 middle-school-shaped players: 2 setters, 4 hitters, 3 middles, 1 libero, 2 hitter/libero.
  // Skills 3-8; intangibles varied so the sub plan has an order to it.
  { name: 'Player 1',  positions: ['S',  null], skills: { serving: 7, serveReceive: 5, defense: 6, hitting: 4, blocking: 3, setting: 8 }, intangibles: { attitude: 8, athleticism: 6 } },
  { name: 'Player 2',  positions: ['S',  'OH'], skills: { serving: 6, serveReceive: 5, defense: 5, hitting: 5, blocking: 3, setting: 7 }, intangibles: { attitude: 7, athleticism: 5 } },
  { name: 'Player 3',  positions: ['OH', null], skills: { serving: 7, serveReceive: 7, defense: 6, hitting: 7, blocking: 4, setting: 3 }, intangibles: { attitude: 6, athleticism: 8 } },
  { name: 'Player 4',  positions: ['OH', null], skills: { serving: 6, serveReceive: 7, defense: 6, hitting: 6, blocking: 4, setting: 3 }, intangibles: { attitude: 9, athleticism: 6 } },
  { name: 'Player 5',  positions: ['OH', 'L'],  skills: { serving: 6, serveReceive: 6, defense: 6, hitting: 5, blocking: 3, setting: 3 }, intangibles: { attitude: 9, athleticism: 7 } },
  { name: 'Player 6',  positions: ['OH', 'L'],  skills: { serving: 5, serveReceive: 6, defense: 5, hitting: 4, blocking: 3, setting: 3 }, intangibles: { attitude: 5, athleticism: 5 } },
  { name: 'Player 7',  positions: ['MB', null], skills: { serving: 5, serveReceive: 3, defense: 4, hitting: 7, blocking: 7, setting: 2 }, intangibles: { attitude: 6, athleticism: 6 } },
  { name: 'Player 8',  positions: ['MB', null], skills: { serving: 5, serveReceive: 4, defense: 4, hitting: 6, blocking: 8, setting: 2 }, intangibles: { attitude: 7, athleticism: 4 } },
  { name: 'Player 9',  positions: ['MB', 'OH'], skills: { serving: 4, serveReceive: 4, defense: 4, hitting: 5, blocking: 6, setting: 2 }, intangibles: { attitude: 8, athleticism: 5 } },
  { name: 'Player 10', positions: ['L',  null], skills: { serving: 5, serveReceive: 8, defense: 8, hitting: 2, blocking: 1, setting: 3 }, intangibles: { attitude: 8, athleticism: 8 } },
  { name: 'Player 11', positions: ['OH', null], skills: { serving: 4, serveReceive: 5, defense: 5, hitting: 4, blocking: 3, setting: 3 }, intangibles: { attitude: 10, athleticism: 4 } },
  { name: 'Player 12', positions: ['OH', null], skills: { serving: 3, serveReceive: 4, defense: 4, hitting: 3, blocking: 2, setting: 2 }, intangibles: { attitude: 6, athleticism: 3 } }
];

function loadDemoRoster() {
  S.players = DEMO_ROSTER.map(d => ({
    ...createPlayer(d.name, d.positions),
    skills: { ...d.skills },
    intangibles: { ...defaultIntangibles(), ...(d.intangibles || {}) },
    setterTempo: typeof d.setterTempo === 'number' ? d.setterTempo : 5
  }));
  save();
  renderRoster();
}

/* ===== Print =====
   Renders a clean white-paper version of the roster or current lineup into
   a hidden #printSheet using DOM methods (no innerHTML — keeps user-supplied
   names safe by construction). The sheet is display:none on screen and only
   revealed inside @media print when body.printing is active. */

function buildPrintRosterDOM() {
  const teamName = S.teamName || DEFAULT_TEAM_NAME;
  const date = new Date().toLocaleDateString();
  const avail = S.players.filter(p => p.available).length;
  const sorted = S.players.slice().sort((a, b) => playerSkillRaw(b) - playerSkillRaw(a));

  const page = el('div', { cls: 'print-page' });
  const header = el('header', { cls: 'print-header' }, [
    el('h1', { text: 'Court IQ — ' + teamName }),
    el('div', { cls: 'print-meta', text:
      'Roster · ' + currentLevel().label + ' · ' + date + ' · ' + avail + ' of ' + S.players.length + ' available' })
  ]);
  page.appendChild(header);

  const hs = isHS();
  const table = el('table', { cls: 'print-roster' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { text: '#' }),
      el('th', { text: 'Name' }),
      el('th', { text: 'Position' }),
      hs ? el('th', { text: 'Hand' }) : null,
      hs ? el('th', { text: 'Height' }) : null,
      ...SKILLS.map(k => el('th', { cls: 'num', text: SKILL_LABELS_SHORT[k] })),
      el('th', { cls: 'num', text: 'AVG' }),
      ...INTANGIBLES.map(k => el('th', { cls: 'num', text: INTANGIBLE_LABELS_SHORT[k] })),
      el('th', { text: '' })
    ])
  ]);
  const tbody = el('tbody');
  sorted.forEach(p => {
    const pos = [p.positions[0], p.positions[1]].filter(Boolean).map(roleLabel).join(' / ');
    const avg = playerSkillRaw(p).toFixed(1);
    const status = p.available ? '' : 'OUT';
    const it = p.intangibles || defaultIntangibles();
    tbody.appendChild(el('tr', {}, [
      el('td', { cls: 'num', text: p.jersey || '' }),
      el('td', { text: p.name || '—' }),
      el('td', { text: pos }),
      hs ? el('td', { cls: 'center', text: p.hand || '' }) : null,
      hs ? el('td', { text: p.height || '' }) : null,
      ...SKILLS.map(k => el('td', { cls: 'num', text: String(p.skills[k] || 5) })),
      el('td', { cls: 'num', text: avg }),
      ...INTANGIBLES.map(k => el('td', { cls: 'num', text: String(it[k] || 5) })),
      el('td', { cls: 'status', text: status })
    ]));
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  page.appendChild(table);
  return page;
}

function buildPrintLineupDOM() {
  const teamName = S.teamName || DEFAULT_TEAM_NAME;
  const date = new Date().toLocaleDateString();
  const r = S.result;
  const sys = S.settings.system;
  const mode = S.lineup.optimizationMode;
  const modeLabel = ({ balanced: 'Balanced', best6: 'Best 6 on floor', sr: 'Best serve receive', serving: 'Best serving' })[mode] || mode;
  const lib = r.libero && r.libero.player;
  const liberoNote = lib ? ' · Libero: ' + (lib.name || '—') : '';

  const page = el('div', { cls: 'print-page' });
  page.appendChild(el('header', { cls: 'print-header' }, [
    el('h1', { text: 'Court IQ — ' + teamName }),
    el('div', { cls: 'print-meta', text:
      'Lineup · ' + date + ' · System ' + sys + ' · ' + modeLabel + liberoNote })
  ]));

  const level = currentLevel();
  const patterns = S.lineup.subPatterns || [];
  const tagOf = (p) => (S.settings?.showJersey && p.jersey) ? '#' + p.jersey + ' ' : '';
  const cell = (p) => {
    if (!p) return el('td');
    const td = el('td');
    const role = (p.positions && p.positions[0]) || '';
    const isLib = lib && p.id === lib.id;
    td.appendChild(el('span', { cls: 'rl' + (p._sub ? ' rl-sub' : ''), text: isLib ? 'L' : (p._sub ? 'SUB' : roleCode(role)) }));
    td.appendChild(document.createTextNode(' ' + tagOf(p) + (p.name || '—')));
    return td;
  };

  const rots = el('div', { cls: 'print-rotations' });
  (r.arrangement.rotations || []).forEach((raw, i) => {
    // Same pipeline as the screen: planned subs, then the libero swap.
    const rot = effectiveRotationWithLibero(applySubPatterns(raw, patterns, i), r.libero, level, i);
    const sc = (r.perRotationScores[i] || 0).toFixed(1);
    const fr = rot.frontRow || [];
    const br = rot.backRow || [];
    const rotEl = el('div', { cls: 'print-rot' }, [
      el('div', { cls: 'print-rot-head' }, [
        el('span', { text: 'Rotation ' + (i + 1) }),
        el('span', { cls: 'print-rot-score', text: sc })
      ]),
      el('table', { cls: 'print-court' }, [
        el('tbody', {}, [
          el('tr', {}, [el('th', { text: '4' }), el('th', { text: '3' }), el('th', { text: '2' })]),
          el('tr', {}, [cell(fr[0]), cell(fr[1]), cell(fr[2])]),
          el('tr', {}, [el('th', { text: '5' }), el('th', { text: '6' }), el('th', { text: '1' })]),
          el('tr', {}, [cell(br[0]), cell(br[1]), cell(br[2])])
        ])
      ])
    ]);
    rots.appendChild(rotEl);
  });
  page.appendChild(rots);

  // Sub plan
  const auto = patterns.filter(p => (p.auto || p.coach) && p.in && p.out);
  const byId = new Map(S.players.map(p => [p.id, p]));
  if (auto.length) {
    const subsUsed = patterns.reduce((n, p) => n + (p.return ? 2 : 1), 0);
    page.appendChild(el('h2', { cls: 'print-h2', text: 'Sub plan — ' + subsUsed + ' of ' + level.subsPerSet + ' subs' }));
    const tbl = el('table', { cls: 'print-subplan' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: '' }), el('th', { text: 'In' }), el('th', { text: 'For' }),
        el('th', { text: 'Goes in' }), el('th', { text: 'Comes out' })
      ])]),
      el('tbody', {}, auto.map((pat, i) => {
        const starter = byId.get(pat.out);
        return el('tr', {}, [
          el('td', { cls: 'num', text: String(i + 1) }),
          el('td', { text: tagOf(pat.in) + (pat.in.name || '—') }),
          el('td', { text: starter ? tagOf(starter) + (starter.name || '—') : '—' }),
          el('td', { text: 'Rotation ' + (pat.trigger.rotationIndex + 1) + (pat.coach ? ' (your sub)' : (starter ? ' — when ' + starter.name.split(' ')[0] + ' rotates to serve' : '')) }),
          el('td', { text: pat.return ? (pat.coach && pat.return.rotationIndex === 0 ? 'End of trip' : 'Rotation ' + (pat.return.rotationIndex + 1)) : '—' })
        ]);
      }))
    ]);
    page.appendChild(tbl);
    if (S.plan && S.plan.benchLeft && S.plan.benchLeft.length) {
      page.appendChild(el('p', { cls: 'print-note', text: 'Still on the bench: ' + S.plan.benchLeft.map(p => p.name).join(', ') + ' (no subs left).' }));
    }
  }
  return page;
}

function triggerPrint(node) {
  const sheet = document.getElementById('printSheet');
  if (!sheet) return;
  sheet.replaceChildren(node);
  document.body.classList.add('printing');
  requestAnimationFrame(() => {
    window.print();
    const cleanup = () => {
      document.body.classList.remove('printing');
      sheet.replaceChildren();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Safety fallback if afterprint never fires (older Safari, etc.)
    setTimeout(cleanup, 4000);
  });
}

function printRoster() {
  if (!S.players.length) { toast('No players to print.'); return; }
  triggerPrint(buildPrintRosterDOM());
}

function printLineup() {
  if (!S.result || S.result.error || !S.result.arrangement) {
    toast('Generate a lineup first.');
    return;
  }
  triggerPrint(buildPrintLineupDOM());
}

/* ===== Drag & Drop ===== */
let dragState = null;

function onDragStart(opts, e) {
  // opts: { kind: 'court'|'bench', playerId, rotIdx?, zone? }
  if (e.button != null && e.button !== 0) return;  // left click only

  // Don't start a drag if user pressed on a button inside the source
  if (e.target.closest('button')) return;

  dragState = {
    ...opts,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    didMove: false,
    ghost: null,
    sourceEl: e.currentTarget
  };
  // Capture so move/up arrive even if pointer leaves the source
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
}

function onDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (!dragState.didMove && dist > 8) {
    dragState.didMove = true;
    document.body.classList.add('dragging');
    if (dragState.kind === 'court') document.body.classList.add('dragging-court');
    dragState.sourceEl?.classList.add('drag-source');
    dragState.ghost = makeGhost(dragState);
    document.body.appendChild(dragState.ghost);
  }
  if (dragState.didMove) {
    moveGhost(dragState.ghost, e.clientX, e.clientY);
    updateDropHighlight(e.clientX, e.clientY, dragState);
    e.preventDefault?.();
  }
}

function onDragEnd(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  const ds = dragState;
  dragState = null;
  if (ds.didMove) {
    // Find target BEFORE removing dragging classes — otherwise the bench
    // drop zone (display:none unless body.dragging-court) would vanish first.
    let target = null;
    if (e.type !== 'pointercancel') {
      target = findDropTarget(e.clientX, e.clientY);
    }
    document.body.classList.remove('dragging');
    document.body.classList.remove('dragging-court');
    ds.sourceEl?.classList.remove('drag-source');
    if (ds.ghost) ds.ghost.remove();
    clearDropHighlight();
    if (target) performDrop(ds, target);
  }
}

function makeGhost(state) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const player = S.players.find(p => p.id === state.playerId);
  if (!player) return ghost;
  const firstName = (player.name || '?').split(' ')[0];
  const role = (player.positions && player.positions[0]) || '';
  ghost.classList.add(`rot-chip-${role || 'OH'}`);
  ghost.appendChild(el('span', { cls: 'rot-chip-name', text: firstName }));
  ghost.appendChild(el('span', { cls: 'rot-chip-role', text: role }));
  return ghost;
}

function moveGhost(ghost, x, y) {
  if (!ghost) return;
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
}

function findDropTarget(x, y) {
  // Returns one of:
  //   { kind: 'zone',   rotIdx, zone, el }
  //   { kind: 'bench',  el }
  //   { kind: 'team',   teamIdx, targetPlayerId?, el }
  //   null
  const els = document.elementsFromPoint(x, y);
  for (const e of els) {
    const zoneEl = e.classList?.contains('rot-zone') ? e : e.closest && e.closest('.rot-zone');
    if (zoneEl) {
      const rotIdx = Number(zoneEl.dataset.rotIdx);
      const zone = Number(zoneEl.dataset.zone);
      if (!Number.isNaN(rotIdx) && !Number.isNaN(zone)) {
        return { kind: 'zone', rotIdx, zone, el: zoneEl };
      }
    }
    if (e.id === 'benchCard' || e.id === 'benchList' || e.classList?.contains('bench-list')) {
      return { kind: 'bench', el: document.getElementById('benchCard') };
    }
    if (e.tagName === 'LI' && e.parentElement?.id === 'benchList') {
      return { kind: 'bench', el: document.getElementById('benchCard') };
    }
    // Team cards (Scrimmage tab). A drop on a specific team-player is a swap;
    // a drop on the card body is a move.
    const playerLi = e.classList?.contains('team-player') ? e : (e.closest && e.closest('.team-player'));
    if (playerLi) {
      const teamIdx = Number(playerLi.dataset.teamIdx);
      if (!Number.isNaN(teamIdx)) {
        return { kind: 'team', teamIdx, targetPlayerId: playerLi.dataset.playerId, el: playerLi };
      }
    }
    const teamCard = e.classList?.contains('team-card') ? e : (e.closest && e.closest('.team-card'));
    if (teamCard) {
      const teamIdx = Number(teamCard.dataset.teamIdx);
      if (!Number.isNaN(teamIdx)) {
        return { kind: 'team', teamIdx, el: teamCard };
      }
    }
  }
  return null;
}

let lastHighlight = null;
function updateDropHighlight(x, y, ds) {
  const target = findDropTarget(x, y);
  if (lastHighlight && lastHighlight !== target?.el) {
    lastHighlight.classList.remove('drop-target-active');
  }
  if (target?.el) {
    // Don't highlight no-ops.
    if (ds.kind === 'court' && target.kind === 'zone'
        && ds.rotIdx === target.rotIdx && ds.zone === target.zone) {
      lastHighlight = null;
      return;
    }
    if (ds.kind === 'bench' && target.kind === 'bench') {
      lastHighlight = null;
      return;
    }
    if (ds.kind === 'team' && target.kind === 'team') {
      // Same team: drop is a sub/active swap when the target is a different
      // player, no-op when dropped on the team card body or self.
      const sameTeam = ds.teamIdx === target.teamIdx;
      const onSelf = sameTeam && (target.targetPlayerId === ds.playerId || !target.targetPlayerId);
      if (onSelf) { lastHighlight = null; return; }
    }
    target.el.classList.add('drop-target-active');
    lastHighlight = target.el;
  } else {
    lastHighlight = null;
  }
}
function clearDropHighlight() {
  document.querySelectorAll('.drop-target-active').forEach(e => e.classList.remove('drop-target-active'));
  lastHighlight = null;
}

function performDrop(source, target) {
  // Scrimmage tab: team-to-team drops don't need S.result. Same-team drops
  // onto a different player trigger a sub/active role swap; same-team drops
  // onto the team card body or the same player are handled (as no-ops) inside
  // applyTeamSwap.
  if (source.kind === 'team' && target.kind === 'team') {
    applyTeamSwap(source.teamIdx, target.teamIdx, source.playerId, target.targetPlayerId || null);
    return;
  }

  if (!S.result || !S.lineup.board) return;

  // Rotation 1 is the starting six. Any later rotation: a drag is a substitution.
  const startingSix = target.kind === 'zone' ? target.rotIdx === 0 : source.rotIdx === 0;

  // bench → zone
  if (source.kind === 'bench' && target.kind === 'zone') {
    if (startingSix) { if (boardPutPlayer(target.rotIdx, target.zone, source.playerId)) toast('Swapped in.'); }
    else coachSubDrop(target.rotIdx, target.zone, source.playerId);
    return;
  }
  // court → zone
  if (source.kind === 'court' && target.kind === 'zone') {
    if (source.rotIdx === target.rotIdx && source.zone === target.zone) return;
    if (source.rotIdx === 0 && target.rotIdx === 0) { if (boardSwap(0, source.zone, 0, target.zone)) toast('Swapped.'); }
    else toast('Positions come from the starting order — swap players in rotation 1. In later rotations, drag from the bench to sub.', 3600);
    return;
  }
  // court → bench
  if (source.kind === 'court' && target.kind === 'bench') {
    if (startingSix) toast('Drag a bench player onto her spot instead — you need six on the floor.', 3200);
    else coachSubOut(source.rotIdx, source.playerId);
    return;
  }
}

/* applyManualOverride: pin a player at a specific rotation+zone. The next
   regenerate will respect the pin (so long as it's still legal). */
function applyManualOverride(rotIdx, zone, playerId) {
  const ovs = S.lineup.overrides;
  // Replace any existing override at the same slot.
  for (let i = ovs.length - 1; i >= 0; i--) {
    if (ovs[i].rotationIndex === rotIdx && ovs[i].zone === zone) ovs.splice(i, 1);
  }
  ovs.push({ rotationIndex: rotIdx, zone, playerId });
  save();
  scheduleRegen();
  toast('Pinned. Regenerating…');
}

function removeOverrideAt(rotIdx, zone) {
  const ovs = S.lineup.overrides;
  let removed = false;
  for (let i = ovs.length - 1; i >= 0; i--) {
    if (ovs[i].rotationIndex === rotIdx && ovs[i].zone === zone) {
      ovs.splice(i, 1);
      removed = true;
    }
  }
  if (removed) {
    save();
    scheduleRegen();
    toast('Pin removed.');
  }
}

/* ===== Roster Render ===== */
function renderRoster() {
  const list = $('#playerList');
  list.replaceChildren();
  // Split named from unnamed: unnamed players keep insertion order at the
  // bottom of the list so a freshly-tapped "+ Add Player" stays adjacent
  // to its target — the new card sits right above the Add button instead
  // of jumping to the AVG-sorted top.
  const named = S.players.filter(p => (p.name || '').trim());
  const unnamed = S.players.filter(p => !(p.name || '').trim());
  const sorted = sortByMode(named, S.rosterSort, p => p.name, p => playerSkillRaw(p));
  sorted.forEach(p => list.appendChild(buildPlayerCard(p)));
  unnamed.forEach(p => list.appendChild(buildPlayerCard(p)));
  $('#rosterEmpty').hidden = S.players.length > 0;
  const printBtn = $('#printRosterBtn');
  if (printBtn) printBtn.hidden = S.players.length === 0;
  updateCounts();
  // If there's an active lineup, refresh the bench so newly-added /
  // newly-available players appear without waiting for a regenerate.
  if (S.result && !S.result.error) renderBench();
}

function buildPlayerCard(p) {
  const card = el('div', {
    cls: 'player-card' +
      (p.available ? '' : ' unavailable') +
      (p._expanded ? ' expanded' : ''),
    dataset: { id: p.id }
  });

  // Avail toggle
  const togInput = el('input', { attrs: { type: 'checkbox' } });
  togInput.checked = !!p.available;
  togInput.addEventListener('change', e => {
    e.stopPropagation();
    p.available = e.target.checked;
    card.classList.toggle('unavailable', !p.available);
    updateCounts();
    save();
  });
  const togSpan = el('span', { cls: 'avail-slider' });
  const tog = el('label', { cls: 'avail-toggle', title: 'Available for game' }, [togInput, togSpan]);
  tog.addEventListener('click', e => e.stopPropagation());

  // Name input
  const nameInput = el('input', {
    cls: 'player-name-input',
    attrs: { type: 'text', placeholder: 'Player name', maxlength: '20', autocomplete: 'off' }
  });
  nameInput.value = p.name || '';
  nameInput.addEventListener('input', e => {
    p.name = e.target.value;
    save();
  });
  nameInput.addEventListener('click', e => e.stopPropagation());

  // Overall AVG
  const overallNum = el('span', { cls: 'num', text: avgSkillDisplay(p) });
  const overallLbl = el('span', { cls: 'lbl', text: 'AVG' });
  const overall = el('div', { cls: 'player-overall' }, [overallNum, overallLbl]);

  const arrow = el('span', { cls: 'player-expand-arrow', text: '›' });

  const head = el('div', { cls: 'player-card-head' }, [tog, nameInput, overall, arrow]);
  head.addEventListener('click', () => {
    p._expanded = !p._expanded;
    card.classList.toggle('expanded', p._expanded);
  });

  // Roster fields (jersey, height, positions, hand) + skills + actions
  const skillBox = el('div', { cls: 'player-skills' });
  skillBox.appendChild(buildRosterFields(p));
  skillBox.appendChild(buildSkillGrid(p.skills, () => {
    overallNum.textContent = avgSkillDisplay(p);
    save();
  }));
  skillBox.appendChild(el('h4', { cls: 'card-subhead label-with-help' }, [
    'Intangibles ', makeHelpButton('intangibles', 'What are intangibles?')
  ]));
  skillBox.appendChild(buildIntangibleGrid(p));
  // Setter tempo: only when settings.showSetterTempo and primary === 'S'
  const tempoRow = buildSetterTempoRow(p);
  if (tempoRow) skillBox.appendChild(tempoRow);
  const delBtn = el('button', {
    cls: 'btn-delete-player',
    text: '🗑 Delete player',
    on: { click: () => confirmDelete(p) }
  });
  skillBox.appendChild(el('div', { cls: 'player-actions' }, [delBtn]));

  card.appendChild(head);
  card.appendChild(skillBox);
  return card;
}

function buildRosterFields(p) {
  const wrap = el('div', { cls: 'roster-fields' });

  // Jersey #
  const jerseyRow = el('div', { cls: 'roster-field roster-field-jersey' });
  jerseyRow.appendChild(el('label', { text: 'Jersey #' }));
  const jerseyInput = el('input', {
    attrs: { type: 'text', maxlength: '3', inputmode: 'numeric', pattern: '[0-9]*', placeholder: '#' }
  });
  jerseyInput.value = p.jersey || '';
  jerseyInput.addEventListener('input', e => { p.jersey = e.target.value.replace(/[^0-9]/g, '').slice(0, 3); e.target.value = p.jersey; save(); });
  jerseyInput.addEventListener('click', e => e.stopPropagation());
  jerseyRow.appendChild(jerseyInput);
  if (!S.settings?.showJersey) jerseyRow.hidden = true;
  wrap.appendChild(jerseyRow);

  // Height
  const heightRow = el('div', { cls: 'roster-field' });
  heightRow.appendChild(el('label', { text: 'Height' }));
  const heightInput = el('input', {
    attrs: { type: 'text', maxlength: '8', placeholder: 'e.g. 6-1' }
  });
  heightInput.value = p.height || '';
  heightInput.addEventListener('input', e => { p.height = e.target.value; save(); });
  heightInput.addEventListener('click', e => e.stopPropagation());
  heightRow.appendChild(heightInput);
  heightRow.hidden = !isHS();
  wrap.appendChild(heightRow);

  // Primary position
  const priRow = el('div', { cls: 'roster-field' });
  priRow.appendChild(el('label', { text: 'Primary' }));
  const priSel = el('select');
  positionChoices(p).forEach(r => {
    const o = document.createElement('option');
    o.value = r; o.textContent = positionOptionText(r);
    priSel.appendChild(o);
  });
  priSel.value = p.positions?.[0] || 'ANY';
  priSel.addEventListener('change', e => {
    p.positions = [e.target.value, p.positions?.[1] || null];
    save();
    // In-place: toggle the setter-tempo row on THIS card only so the
    // user's edit position isn't lost to a full re-sort. The list will
    // resort on the next coarse refresh (tab switch, generate, etc.).
    refreshSetterTempoRow(p);
  });
  priSel.addEventListener('click', e => e.stopPropagation());
  priRow.appendChild(priSel);
  wrap.appendChild(priRow);

  // Secondary position
  const secRow = el('div', { cls: 'roster-field' });
  secRow.appendChild(el('label', { text: 'Secondary' }));
  const secSel = el('select');
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— none —';
  secSel.appendChild(noneOpt);
  positionChoices(p).filter(r => r !== 'ANY').forEach(r => {
    const o = document.createElement('option');
    o.value = r; o.textContent = positionOptionText(r);
    secSel.appendChild(o);
  });
  secSel.value = p.positions?.[1] || '';
  secSel.addEventListener('change', e => {
    p.positions = [p.positions?.[0] || 'ANY', e.target.value || null];
    save();
  });
  secSel.addEventListener('click', e => e.stopPropagation());
  secRow.appendChild(secSel);
  wrap.appendChild(secRow);

  // Dominant hand
  const handRow = el('div', { cls: 'roster-field' });
  handRow.appendChild(el('label', { text: 'Hand' }));
  const handSel = el('select');
  [['R', 'Right'], ['L', 'Left']].forEach(([v, label]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    handSel.appendChild(o);
  });
  handSel.value = p.hand === 'L' ? 'L' : 'R';
  handSel.addEventListener('change', e => { p.hand = e.target.value === 'L' ? 'L' : 'R'; save(); });
  handSel.addEventListener('click', e => e.stopPropagation());
  handRow.appendChild(handSel);
  handRow.hidden = !isHS();
  wrap.appendChild(handRow);

  return wrap;
}

/* Which positions the picker offers: the level's list, plus any position
   this player already has (so switching HS -> MS never silently drops one). */
function positionChoices(p) {
  const visible = ['ANY'].concat(currentLevel().roles);
  [p.positions?.[0], p.positions?.[1]].forEach(r => { if (r && !visible.includes(r)) visible.push(r); });
  return visible;
}
function positionOptionText(r) {
  if (r === 'ANY') return 'All-around — no position yet';
  // The role code (OH, MB) is jargon at MS; HS coaches use it.
  return isHS() ? `${r} — ${roleLabel(r)}` : (ROLE_PICKER_LABELS_MS[r] || roleLabel(r));
}

function refreshSetterTempoRow(p) {
  const card = document.querySelector(`.player-card[data-id="${p.id}"]`);
  if (!card) return;
  const skillBox = card.querySelector('.player-skills');
  if (!skillBox) return;
  const existing = skillBox.querySelector('.roster-field-tempo');
  if (existing) existing.remove();
  const fresh = buildSetterTempoRow(p);
  if (fresh) {
    // Insert before .player-actions (the delete-button row) so order matches initial render.
    const actions = skillBox.querySelector('.player-actions');
    skillBox.insertBefore(fresh, actions);
  }
}

function buildSetterTempoRow(p) {
  if (!S.settings?.showSetterTempo) return null;
  if ((p.positions?.[0] || 'OH') !== 'S') return null;
  const row = el('div', { cls: 'roster-field roster-field-tempo' });
  row.appendChild(el('label', {
    text: 'Setter tempo (1 = high-set only · 10 = runs quick / slide / back)',
    title: 'How many tempos this setter can confidently run. Higher = wider playbook.'
  }));
  const input = el('input', {
    attrs: { type: 'number', min: '1', max: '10', step: '1', inputmode: 'numeric' }
  });
  input.value = String(p.setterTempo ?? 5);
  input.addEventListener('input', e => {
    let v = parseInt(e.target.value, 10);
    if (!isNaN(v)) { v = Math.max(1, Math.min(10, v)); p.setterTempo = v; save(); }
  });
  input.addEventListener('blur', e => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v)) v = p.setterTempo ?? 5;
    v = Math.max(1, Math.min(10, v));
    p.setterTempo = v;
    e.target.value = String(v);
    save();
  });
  input.addEventListener('focus', e => e.target.select());
  input.addEventListener('click', e => e.stopPropagation());
  row.appendChild(input);
  return row;
}

function avgSkillDisplay(p) {
  const sum = SKILLS.reduce((a, k) => a + (p.skills[k] || 0), 0);
  return (sum / SKILLS.length).toFixed(1);
}

function buildSkillGrid(skillsObj, onChange) {
  const grid = el('div', { cls: 'skill-grid' });
  SKILLS.forEach(skill => {
    grid.appendChild(buildSkillCell(skillsObj, skill, onChange));
  });
  return grid;
}

function buildIntangibleGrid(p) {
  if (!p.intangibles) p.intangibles = defaultIntangibles();
  const grid = el('div', { cls: 'skill-grid intangible-grid' });
  INTANGIBLES.forEach(k => grid.appendChild(buildSkillCell(p.intangibles, k, () => save(), INTANGIBLE_LABELS_SHORT)));
  return grid;
}

function buildSkillCell(skillsObj, skill, onChange, labels = SKILL_LABELS_SHORT) {
  const label = el('span', { cls: 'skill-cell-label', text: labels[skill] });
  const input = el('input', {
    cls: 'skill-cell-input',
    attrs: {
      type: 'number',
      min: '1',
      max: '10',
      step: '1',
      inputmode: 'numeric',
      pattern: '[0-9]*'
    }
  });
  input.value = String(skillsObj[skill] || 5);

  function commit(rawValue, finalize) {
    let v = parseInt(rawValue, 10);
    if (isNaN(v)) {
      // While typing, allow empty input briefly. Only clamp on blur.
      if (finalize) {
        v = skillsObj[skill] || 5;
        input.value = String(v);
      }
      return;
    }
    v = Math.max(1, Math.min(10, v));
    if (finalize) input.value = String(v);
    skillsObj[skill] = v;
    if (onChange) onChange(v);
  }
  input.addEventListener('input', e => commit(e.target.value, false));
  input.addEventListener('blur', e => commit(e.target.value, true));
  // Select-all on focus so coaches can quickly retype
  input.addEventListener('focus', e => e.target.select());
  // Up/down arrow keys nudge by 1, clamped
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.target.blur(); }
  });
  // Stop card click handler from collapsing when tapping the input
  input.addEventListener('click', e => e.stopPropagation());

  return el('div', { cls: 'skill-cell' }, [label, input]);
}

/* ===== Weights ===== */
function renderWeights() {
  const list = $('#weightList');
  list.replaceChildren();
  list.appendChild(buildSkillGrid(S.weights, () => save()));
}

function updateCounts() {
  const total = S.players.length;
  const avail = S.players.filter(p => p.available && (p.name || '').trim()).length;
  $('#availCount').textContent = avail;
  $('#totalCount').textContent = total;

  const genBtn = $('#generateBtn');
  if (genBtn) genBtn.disabled = avail < (S.settings.system === 'simple' ? 6 : 7);
}

/* ===== Lineup Render ===== */

const ZONE_LABELS = { 1: 'BR', 2: 'FR', 3: 'FM', 4: 'FL', 5: 'BL', 6: 'BM' };

function renderLineup() {
  const r = S.result;
  const wrap = $('#lineupResult');
  const status = $('#lineupStatus');
  if (!r) {
    wrap.hidden = true;
    if (status) status.textContent = '';
    updateClearOverridesBtn();
    return;
  }
  if (r.error) {
    wrap.hidden = true;
    if (status) {
      status.textContent = r.error;
      status.className = 'lineup-status lineup-status-error';
    }
    updateClearOverridesBtn();
    return;
  }
  wrap.hidden = false;
  if (status) {
    status.textContent = (r.holes && r.validation) ? r.validation : '';
    status.className = 'lineup-status' + (r.holes ? ' lineup-status-warn' : '');
  }
  renderCourtView();
  renderRotationGrid();
  renderLiberoPanel();
  renderSubPlanPanel();
  renderPairingsPanel();
  renderBench();
  updateClearOverridesBtn();
}

/* ===== Court view =====
   One rotation at a time, big enough to read from the bench, with the
   floor's strength by category beside it. Shows starters + libero only —
   the sub plan lives in its own panel and in "All six rotations". Drops on
   the zones pin players exactly like the grid does. */
function floorSkillAverages(rotation) {
  const six = rotation.frontRow.concat(rotation.backRow).filter(Boolean);
  const n = Math.max(six.length, 1);
  const out = {};
  SKILLS.forEach(k => { out[k] = six.reduce((a, p) => a + (p.skills[k] || 0), 0) / n; });
  out.overall = SKILLS.reduce((a, k) => a + out[k], 0) / SKILLS.length;
  return out;
}

const COURT_CATEGORIES = [
  ['overall', 'Overall'], ['hitting', 'Hitting'], ['serveReceive', 'Passing'], ['setting', 'Setting'],
  ['serving', 'Serving'], ['defense', 'Defense'], ['blocking', 'Blocking']
];

function renderCourtView() {
  const court = $('#bigCourt'), dots = $('#rotDots'), card = $('#scoreCard');
  if (!court || !dots || !card) return;
  court.replaceChildren(); dots.replaceChildren(); card.replaceChildren();
  const r = S.result;
  if (!r || !r.arrangement) return;
  const idx = (((S.viewRot || 0) % 6) + 6) % 6;
  S.viewRot = idx;
  const level = currentLevel();
  const scores = r.perRotationScores;
  const min = Math.min.apply(null, scores), max = Math.max.apply(null, scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  for (let i = 0; i < 6; i++) {
    dots.appendChild(el('button', {
      cls: 'rot-dot' + (i === idx ? ' active' : '') + (scores[i] === min ? ' is-weak' : ''),
      attrs: { type: 'button', 'aria-label': `Rotation ${i + 1}` },
      title: `Rotation ${i + 1}: ${scores[i].toFixed(1)}`,
      text: String(i + 1),
      on: { click: () => { S.viewRot = i; renderCourtView(); } }
    }));
  }

  const eff = courtEffective(idx);
  const coachIn = new Set(coachPatterns().filter(pt => _patternActiveAt(pt, idx)).map(pt => pt.in.id));
  const grid = el('div', { cls: 'rot-court big-rot-court' });
  for (const z of [4, 3, 2, 5, 6, 1]) {
    const player = playerAtZone(eff, z);
    const isLibero = r.libero && r.libero.player && player && player.id === r.libero.player.id;
    const cellCls = ['rot-zone'];
    if (z === 1) cellCls.push('rot-zone-server');
    if (isLibero) cellCls.push('rot-zone-libero');
    const zoneLabel = el('span', { cls: 'rot-zone-num', text: `${z} · ${POSITION_NAMES[z]}` });
    const chip = buildPlayerChip(player, idx, z, !!(player && coachIn.has(player.id)), true);
    grid.appendChild(el('div', { cls: cellCls.join(' '), dataset: { rotIdx: String(idx), zone: String(z) } }, [zoneLabel, chip]));
  }
  court.appendChild(grid);

  // Score card
  card.appendChild(el('div', { cls: 'score-head' }, [
    el('div', {}, [
      el('div', { cls: 'score-title', text: `Rotation ${idx + 1}` }),
      el('div', { cls: 'score-sub', text: scores[idx] === min ? 'Your weakest rotation' : (scores[idx] === max ? 'Your strongest rotation' : 'Strength on the floor') })
    ]),
    el('div', { cls: 'score-big' + (scores[idx] === min ? ' is-weak' : '') + (scores[idx] === max ? ' is-strong' : ''), text: scores[idx].toFixed(1) })
  ]));
  const avgs = floorSkillAverages(eff);
  const skillVals = SKILLS.map(k => avgs[k]);
  const weakest = Math.min.apply(null, skillVals), strongest = Math.max.apply(null, skillVals);
  const tiles = el('div', { cls: 'score-cats' });
  COURT_CATEGORIES.forEach(([key, label]) => {
    const v = avgs[key];
    const cls = ['score-cat'];
    if (key === 'overall') cls.push('score-cat-overall');
    else if (v === weakest) cls.push('is-weak');
    else if (v === strongest) cls.push('is-strong');
    tiles.appendChild(el('div', { cls: cls.join(' '), title: key === 'serveReceive' ? 'Serve receive' : '' }, [
      el('span', { cls: 'score-cat-label', text: label }),
      el('span', { cls: 'score-cat-val', text: v.toFixed(1) })
    ]));
  });
  card.appendChild(tiles);
  card.appendChild(el('div', { cls: 'score-lineup' }, [
    el('div', { cls: 'lb-bd-stat' }, [el('span', { cls: 'lb-bd-stat-label', text: 'Worst' }), el('span', { cls: 'lb-bd-stat-val lb-bd-stat-min', text: `${min.toFixed(1)} · R${scores.indexOf(min) + 1}` })]),
    el('div', { cls: 'lb-bd-stat' }, [el('span', { cls: 'lb-bd-stat-label', text: 'Average' }), el('span', { cls: 'lb-bd-stat-val', text: avg.toFixed(1) })]),
    el('div', { cls: 'lb-bd-stat' }, [el('span', { cls: 'lb-bd-stat-label', text: 'Best' }), el('span', { cls: 'lb-bd-stat-val', text: `${max.toFixed(1)} · R${scores.indexOf(max) + 1}` })])
  ]));
  card.appendChild(el('p', { cls: 'hint score-hint', text: 'Numbers are the six on the floor, averaged (1–10).' }));

  const hint = $('#courtHint');
  if (hint) {
    hint.replaceChildren();
    if (idx === 0) {
      hint.appendChild(el('strong', { text: 'Rotation 1 is your starting six. ' }));
      hint.appendChild(document.createTextNode('Drag a bench player onto a spot to put her in, or drag two players on the court to swap them. Tap Rotate to walk through the set.'));
    } else {
      hint.appendChild(el('strong', { text: `Rotation ${idx + 1} — drags here are substitutions. ` }));
      hint.appendChild(document.createTextNode('Drag a bench player onto a spot and she comes in for that player from this rotation on. Drag the starter back onto her (or drag the sub to the bench) to bring the starter back. Each one counts against your subs.'));
    }
  }
  renderBench();
}

function updateClearOverridesBtn() {
  const btn = $('#clearOverridesBtn');
  if (!btn) return;
  btn.hidden = !(S.lineup.overrides && S.lineup.overrides.length > 0);
}

/* Rotation grid: 6 cards, each rendering the on-floor 6 in a mini-court layout
   (front row 4-3-2 across the top, back row 5-6-1 across the bottom). The
   server (zone 1) gets a star; libero replacement is shown as a chip swap. */
function renderRotationGrid() {
  const grid = $('#rotationGrid');
  grid.replaceChildren();
  const r = S.result;
  if (!r || !r.arrangement) return;

  const settings = S.settings || defaultSettings();
  const ruleset = currentLevel(settings);
  const patterns = S.lineup.subPatterns || [];

  r.arrangement.rotations.forEach((rot, idx) => {
    const score = r.perRotationScores[idx];
    const card = el('div', { cls: 'rot-card', dataset: { rotIdx: String(idx) } });
    const head = el('div', { cls: 'rot-card-head' }, [
      el('span', { cls: 'rot-num', text: `Rotation ${idx + 1}` }),
      el('span', { cls: 'rot-score', text: score.toFixed(1) })
    ]);
    card.appendChild(head);

    // Apply libero swap and any sub patterns to compute the on-floor 6.
    const afterSubs = applySubPatterns(rot, patterns, idx);
    const effective = effectiveRotationWithLibero(afterSubs, r.libero, ruleset, idx);
    const subbedIn = new Set(patterns.filter(p => p.in && _patternActiveAt(p, idx)).map(p => p.in.id));

    const court = el('div', { cls: 'rot-court' });
    // Zones drawn left-to-right, top row 4-3-2, bottom row 5-6-1.
    const zoneOrder = [4, 3, 2, 5, 6, 1];
    for (const z of zoneOrder) {
      const player = playerAtZone(effective, z);
      const overridden = isZoneOverridden(idx, z);
      const isServer = z === 1;
      const isLibero = r.libero && r.libero.player && player && player.id === r.libero.player.id;
      const cellCls = ['rot-zone'];
      if (isServer) cellCls.push('rot-zone-server');
      if (overridden) cellCls.push('rot-zone-override');
      if (isLibero) cellCls.push('rot-zone-libero');

      const zoneLabel = el('span', { cls: 'rot-zone-num', text: `${z} · ${ZONE_LABELS[z]}` });
      const chip = buildPlayerChip(player, idx, z, player && subbedIn.has(player.id));
      const cell = el('div', {
        cls: cellCls.join(' '),
        dataset: { rotIdx: String(idx), zone: String(z) }
      }, [zoneLabel, chip]);
      court.appendChild(cell);
    }
    card.appendChild(court);
    grid.appendChild(card);
  });
}

/* effectiveRotationWithLibero: the six actually on the floor once the libero
   swaps in. rotIdx (0-5) enables the NFHS one-serving-spot rule: if her swap
   lands on the serving spot in a rotation other than libero.serveRot, the
   player she'd replace serves instead and the libero sits that rotation. */
function effectiveRotationWithLibero(rotation, libero, ruleset, rotIdx) {
  if (!libero || !libero.player) return rotation;
  const replaces = libero.replaces || ['MB'];
  const backRow = rotation.backRow.slice();
  if (backRow.some(p => p && p.id === libero.player.id)) return rotation; // already applied
  const idx = backRow.findIndex(p => p && !p._sub && replaces.includes(p.positions && p.positions[0]));
  if (idx < 0) return rotation;
  const isServerSlot = idx === 2;
  if (isServerSlot) {
    if (!(ruleset && ruleset.liberoMayServe)) return rotation;
    if (rotIdx != null && libero.serveRot != null && rotIdx !== libero.serveRot) return rotation;
  }
  backRow[idx] = libero.player;
  return { frontRow: rotation.frontRow.slice(), backRow, server: isServerSlot ? libero.player : rotation.server };
}

/* resolveLiberoServeRot: which rotation (0-5) the libero serves in for this
   arrangement. Candidates are the rotations where her swap would land on the
   serving spot; the coach's choice (liberoConfig.servesInRotation) wins if
   it's a candidate, otherwise the first one. null = she never serves. */
function resolveLiberoServeRot(rotations, libero, ruleset) {
  if (!libero || !libero.player || !(ruleset && ruleset.liberoMayServe)) return null;
  const replaces = libero.replaces || ['MB'];
  const candidates = [];
  rotations.forEach((rot, i) => {
    const server = rot.backRow[2];
    if (server && !server._sub && replaces.includes(server.positions && server.positions[0])) candidates.push(i);
  });
  if (!candidates.length) return null;
  const wanted = libero.servesInRotation;
  return (typeof wanted === 'number' && candidates.includes(wanted)) ? wanted : candidates[0];
}

function playerAtZone(rotation, zone) {
  // Front row indices: 4 -> [0], 3 -> [1], 2 -> [2]
  // Back row indices: 5 -> [0], 6 -> [1], 1 -> [2]
  if (zone === 4) return rotation.frontRow[0];
  if (zone === 3) return rotation.frontRow[1];
  if (zone === 2) return rotation.frontRow[2];
  if (zone === 5) return rotation.backRow[0];
  if (zone === 6) return rotation.backRow[1];
  if (zone === 1) return rotation.backRow[2];
  return null;
}

function isZoneOverridden(rotIdx, zone) {
  return (S.lineup.overrides || []).some(o => o.rotationIndex === rotIdx && o.zone === zone);
}

function buildPlayerChip(player, rotIdx, zone, isSub = false, fullName = false) {
  if (!player) {
    return el('div', { cls: 'rot-chip rot-chip-empty', text: '—' });
  }
  const firstName = fullName ? (player.name || '?') : (player.name || '?').split(' ')[0];
  const role = (player.positions && player.positions[0]) || '';
  const cls = ['rot-chip', `rot-chip-${role || 'OH'}`];
  if (isSub) cls.push('rot-chip-sub');
  // Jersey first: at the bench a coach knows girls by number.
  const chipName = (S.settings?.showJersey && player.jersey) ? `#${player.jersey} ${firstName}` : firstName;
  // "Outside · playing Middle" — 4-2 needs two middles even when the roster
  // has none, and the coach should see who's filling in where.
  const assigned = S.result && S.result.roleOf && S.result.roleOf[player.id];
  const roleText = isSub ? 'SUB'
    : (assigned && assigned !== role && assigned !== 'L') ? `${roleLabel(role)} · playing ${roleLabel(assigned)}`
    : roleLabel(assigned || role);
  const isLiberoChip = !!(S.result && S.result.libero && S.result.libero.player && S.result.libero.player.id === player.id);
  const chip = el('div', {
    cls: cls.join(' ') + (isLiberoChip ? ' rot-chip-libero' : ''),
    dataset: { playerId: player.id, rotIdx: String(rotIdx), zone: String(zone) },
    title: isLiberoChip ? `${player.name} — libero (change under Libero)` : `${player.name} (${roleLabel(role)})`,
    on: {
      pointerdown: e => {
        if (isLiberoChip) return; // the libero isn't a spot on the board
        onDragStart({ kind: 'court', playerId: player.id, rotIdx, zone }, e);
      }
    }
  }, [
    el('span', { cls: 'rot-chip-name', text: chipName }),
    el('span', { cls: 'rot-chip-role', text: roleText }),
    fullName ? el('span', { cls: 'rot-chip-avg', text: avgSkillDisplay(player), title: 'Average of the six skills' }) : null
  ]);
  return chip;
}

/* Libero panel: pick player, choose roles to replace, optional serving rotation.
   Auto-regenerate when changed. */
function renderLiberoPanel() {
  const body = $('#liberoPanelBody');
  if (!body) return;
  body.replaceChildren();
  const cfg = S.lineup.liberoConfig;
  const settings = S.settings || defaultSettings();
  const level = currentLevel(settings);

  body.appendChild(el('p', { cls: 'hint lb-hint', text:
    'The libero plays the back row only. She comes in for one of the players below when that player rotates to the back row, and swaps out when that player rotates back up to the net. No sub is used.' }));

  // Player picker — libero-position players first, then everyone else.
  const liberoFirst = S.players.slice().sort((a, b) => {
    const al = (a.positions || []).includes('L') ? 0 : 1;
    const bl = (b.positions || []).includes('L') ? 0 : 1;
    return al - bl || (a.name || '').localeCompare(b.name || '');
  });
  const picker = el('select', {
    on: {
      change: e => {
        cfg.playerId = e.target.value || null;
        save();
        scheduleRegen();
      }
    }
  });
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— whoever is marked Libero —';
  picker.appendChild(noneOpt);
  liberoFirst.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = (p.name || '(unnamed)') + ((p.positions || []).includes('L') ? ' · libero' : '');
    picker.appendChild(o);
  });
  picker.value = cfg.playerId || '';
  body.appendChild(el('div', { cls: 'lb-row' }, [el('label', { text: 'Libero' }), picker]));

  // Comes in for — only this level's positions, in coach words. Roles the
  // coach checked at another level stay checked (and visible) so nothing is lost.
  const choices = level.roles.filter(r => r !== 'L');
  (cfg.replaces || []).forEach(r => { if (r !== 'L' && !choices.includes(r)) choices.push(r); });
  const replacesWrap = el('div', { cls: 'lb-replaces-wrap' });
  choices.forEach(role => {
    const cb = el('input', { attrs: { type: 'checkbox', value: role } });
    cb.checked = (cfg.replaces || ['MB']).includes(role);
    cb.addEventListener('change', () => {
      const set = new Set(cfg.replaces || []);
      if (cb.checked) set.add(role); else set.delete(role);
      cfg.replaces = Array.from(set);
      save();
      scheduleRegen();
    });
    replacesWrap.appendChild(el('label', { cls: 'lb-replaces-chip' }, [cb, roleLabel(role)]));
  });
  body.appendChild(el('div', { cls: 'lb-row' }, [el('label', { text: 'Comes in for' }), replacesWrap]));

  if (level.liberoMayServe) {
    // NFHS: one serving spot per set. Auto = the first rotation where her swap
    // lands on the serving spot; the coach can pick the other one instead.
    const serveSel = el('select', {
      on: { change: e => {
        cfg.servesInRotation = e.target.value === '' ? null : Number(e.target.value);
        save();
        scheduleRegen();
      } }
    });
    const autoOpt = document.createElement('option');
    autoOpt.value = ''; autoOpt.textContent = 'First spot she reaches (auto)';
    serveSel.appendChild(autoOpt);
    const resolved = (S.result && S.result.libero) ? S.result.libero.serveRot : null;
    for (let i = 0; i < 6; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `Rotation ${i + 1}`;
      serveSel.appendChild(o);
    }
    serveSel.value = cfg.servesInRotation == null ? '' : String(cfg.servesInRotation);
    body.appendChild(el('div', { cls: 'lb-row' }, [el('label', { text: 'Serves in' }), serveSel]));
    body.appendChild(el('p', { cls: 'hint lb-hint', text:
      resolved == null
        ? 'Under NFHS she serves from one spot per set. With this lineup her swap never lands on the serving spot, so she won\u2019t serve.'
        : `Under NFHS she serves from one spot per set. With this lineup she serves in rotation ${resolved + 1}; anywhere else her swap would land on the serving spot, the player she replaces serves and she sits that rotation.` }));
  } else {
    body.appendChild(el('p', { cls: 'hint lb-hint', text:
      'She may not serve (Advanced → Libero may serve), so she sits out any rotation where her swap would land on the serving spot.' }));
  }
}

/* Sub patterns: list current patterns + a template picker. Each pattern has
   out-player select, in-player select, trigger rotation, optional return rotation. */
function renderSubPatternsPanel() {
  const body = $('#subPatternsBody');
  if (!body) return;
  body.replaceChildren();
  const settings = S.settings || defaultSettings();
  const ruleset = currentLevel(settings);
  const patterns = S.lineup.subPatterns.filter(p => !p.auto);
  patterns.forEach((pat, i) => body.appendChild(buildSubPatternCard(pat, i)));

  // Add pattern row
  const addRow = el('div', { cls: 'lb-row' });
  const tplSel = el('select', { attrs: { id: 'subTemplatePicker' } });
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '— pick template —';
  tplSel.appendChild(noneOpt);
  Object.entries(SUB_PATTERN_TEMPLATES).forEach(([key, tpl]) => {
    const o = document.createElement('option');
    o.value = key; o.textContent = tpl.label;
    tplSel.appendChild(o);
  });
  const addBtn = el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: '+ Add',
    on: {
      click: () => {
        const key = tplSel.value;
        if (!key) { toast('Pick a template first.'); return; }
        const tpl = SUB_PATTERN_TEMPLATES[key];
        S.lineup.subPatterns.push({
          id: 'sp_' + Math.random().toString(36).slice(2, 8),
          template: key,
          out: null, in: null,
          trigger: { ...tpl.trigger },
          return: tpl.return ? { ...tpl.return } : null
        });
        save();
        renderSubPatternsPanel();
        scheduleRegen();
      }
    }
  });
  addRow.appendChild(tplSel);
  addRow.appendChild(addBtn);
  body.appendChild(addRow);
}

function buildSubPatternCard(pat, idx) {
  const card = el('div', { cls: 'lb-sub-card' });
  const tpl = SUB_PATTERN_TEMPLATES[pat.template] || { label: 'Custom', description: '' };
  card.appendChild(el('div', { cls: 'lb-sub-title', text: tpl.label }));
  if (tpl.description) card.appendChild(el('div', { cls: 'lb-sub-desc', text: tpl.description }));

  const playerOpts = [{ value: '', label: '— pick player —' }]
    .concat(S.players.map(p => ({ value: p.id, label: p.name || '(unnamed)' })));

  const outSel = playerSelect(playerOpts, pat.out, v => { pat.out = v || null; save(); scheduleRegen(); });
  const inSel = playerSelect(playerOpts, pat.in && pat.in.id, v => {
    pat.in = v ? S.players.find(p => p.id === v) || null : null;
    save();
    scheduleRegen();
  });
  const rotSel = el('select', {
    on: {
      change: e => {
        pat.trigger.rotationIndex = Number(e.target.value);
        save();
        scheduleRegen();
      }
    }
  });
  for (let i = 0; i < 6; i++) {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `Trigger at rot ${i + 1}`;
    rotSel.appendChild(o);
  }
  rotSel.value = String(pat.trigger?.rotationIndex || 0);

  const delBtn = el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: '✕',
    on: {
      click: () => {
        S.lineup.subPatterns = S.lineup.subPatterns.filter(x => x !== pat);
        save();
        renderSubPatternsPanel();
        scheduleRegen();
      }
    }
  });

  card.appendChild(el('div', { cls: 'lb-sub-fields' }, [
    el('label', {}, ['Out: ', outSel]),
    el('label', {}, ['In: ', inSel]),
    el('label', {}, [rotSel]),
    delBtn
  ]));
  return card;
}

/* Sub plan panel: the everybody-plays list, the subs counter (auto + custom),
   and — at HS — the custom sub-pattern editor underneath. */
function renderSubPlanPanel() {
  const list = $('#subPlanList');
  if (!list) return;
  list.replaceChildren();
  const level = currentLevel();
  const all = S.lineup.subPatterns || [];
  const subsUsed = all.reduce((n, p) => n + (p.return ? 2 : 1), 0);
  const counter = $('#subsCounter');
  if (counter) {
    counter.textContent = `${subsUsed} of ${level.subsPerSet} subs`;
    counter.classList.toggle('over', subsUsed > level.subsPerSet);
  }
  const toggle = $('#everybodyPlaysToggle');
  if (toggle) toggle.checked = S.lineup.everybodyPlays !== false;
  const setterTog = $('#setterFrontOnlyToggle');
  const setterRow = $('#setterFrontOnlyRow');
  if (setterTog) setterTog.checked = !!S.lineup.setterFrontOnly;
  if (setterRow) setterRow.hidden = (S.settings.system !== '4-2');

  const byId = new Map(S.players.map(p => [p.id, p]));
  const tag = p => (S.settings?.showJersey && p.jersey) ? `#${p.jersey} ${p.name}` : (p.name || '(unnamed)');
  const auto = all.filter(p => p.auto);
  const coach = all.filter(p => p.coach && p.in && p.out);
  const left = $('#subPlanLeft');

  coach.forEach(pat => {
    const starter = byId.get(pat.out);
    if (!starter) return;
    const row = el('li', { cls: 'sub-plan-row is-coach' });
    row.appendChild(el('div', { cls: 'sub-plan-who' }, [
      el('strong', { text: tag(pat.in) }), ' in for ', el('strong', { text: tag(starter) })
    ]));
    const ret = pat.return ? pat.return.rotationIndex : null;
    row.appendChild(el('div', { cls: 'sub-plan-when', text:
      `Your sub · from rotation ${pat.trigger.rotationIndex + 1}` + (ret === 0 || ret == null ? ' through rotation 6' : ` · ${starter.name.split(' ')[0]} back at rotation ${ret + 1}`) }));
    row.appendChild(el('button', {
      cls: 'btn btn-secondary btn-tiny sub-plan-x', text: '✕', attrs: { 'aria-label': 'Remove this sub' }, title: 'Remove this sub',
      on: { click: () => { S.lineup.subPatterns = S.lineup.subPatterns.filter(x => x !== pat); save(); runGenerate(); } }
    }));
    list.appendChild(row);
  });

  if (S.lineup.everybodyPlays === false) {
    list.appendChild(el('li', { cls: 'sub-plan-empty', text: 'Turn this on and the plan fills in after Generate.' }));
    if (left) left.textContent = '';
    return;
  }
  if (auto.length === 0 && coach.length === 0) {
    list.appendChild(el('li', { cls: 'sub-plan-empty', text: 'Everyone available is already on the floor.' }));
  }
  auto.forEach(pat => {
    const starter = byId.get(pat.out);
    const inP = pat.in;
    if (!starter || !inP) return;
    const row = el('li', { cls: 'sub-plan-row' });
    row.appendChild(el('div', { cls: 'sub-plan-who' }, [
      el('strong', { text: tag(inP) }),
      ' in for ',
      el('strong', { text: tag(starter) })
    ]));
    row.appendChild(el('div', { cls: 'sub-plan-when', text:
      (pat.setterSub ? 'Setter sub · ' : '') + `In at rotation ${pat.trigger.rotationIndex + 1} — when ${starter.name.split(' ')[0]} rotates ${pat.setterSub ? 'to the back row' : 'back to serve'} · out at rotation ${pat.return.rotationIndex + 1}` }));
    row.appendChild(el('button', {
      cls: 'btn btn-secondary btn-tiny sub-plan-x',
      text: '✕',
      title: `Keep ${starter.name} in — don't sub her out`,
      attrs: { 'aria-label': `Keep ${starter.name} in` },
      on: { click: () => {
        S.lineup.planExclude = { ...(S.lineup.planExclude || {}), [starter.id]: true };
        save();
        runGenerate();
      } }
    }));
    list.appendChild(row);
  });

  if (left) {
    left.replaceChildren();
    const plan = S.plan;
    const excluded = Object.keys(S.lineup.planExclude || {}).map(id => byId.get(id)).filter(Boolean);
    if (plan && plan.benchLeft.length) {
      left.appendChild(document.createTextNode(
        `Still on the bench: ${plan.benchLeft.map(p => p.name).join(', ')} — no subs left under the ${level.subsPerSet}-sub limit (change it under Advanced).`));
    }
    if (excluded.length) {
      if (left.childNodes.length) left.appendChild(el('br'));
      left.appendChild(document.createTextNode(`Kept in: ${excluded.map(p => p.name).join(', ')}. `));
      left.appendChild(el('button', {
        cls: 'link-btn', text: 'Reset',
        on: { click: () => { S.lineup.planExclude = {}; save(); runGenerate(); } }
      }));
    }
  }

  renderSubPatternsPanel();
}

/* Pairings panel: each entry forces both named players to start together
   (kind:'together') OR forces them onto different teams (kind:'apart').
   Rendered into both the Lineup tab and the Scrimmage tab — they share the
   same S.lineup.pairings state so edits in either place sync. */
function renderPairingsPanel() {
  const bodies = [$('#pairingsBody'), $('#scrimmagePairingsBody')].filter(Boolean);
  if (bodies.length === 0) return;
  const pairings = S.lineup.pairings;
  const counter1 = $('#pairingsCounter');
  const counter2 = $('#scrimmagePairingsCounter');
  const counterText = pairings.length ? String(pairings.length) : '';
  if (counter1) counter1.textContent = counterText;
  if (counter2) counter2.textContent = counterText;
  bodies.forEach(body => _renderPairingsBody(body, pairings));
}

function _renderPairingsBody(body, pairings) {
  body.replaceChildren();

  const playerOpts = [{ value: '', label: '— pick player —' }]
    .concat(S.players
      .filter(p => (p.name || '').trim())
      .map(p => ({ value: p.id, label: p.name })));

  pairings.forEach((pair, i) => {
    const card = el('div', { cls: 'lb-sub-card' });
    if (!pair.kind) pair.kind = 'together';
    const aSel = playerSelect(playerOpts, pair.a, v => { pair.a = v || null; save(); scheduleRegen(); });
    const bSel = playerSelect(playerOpts, pair.b, v => { pair.b = v || null; save(); scheduleRegen(); });
    const kindSel = el('select', {
      cls: 'lb-pair-kind',
      on: {
        change: e => {
          pair.kind = e.target.value === 'apart' ? 'apart' : 'together';
          save();
          renderPairingsPanel();
          scheduleRegen();
        }
      }
    });
    [['together', 'must play together'], ['apart', 'must be on different teams']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      kindSel.appendChild(o);
    });
    kindSel.value = pair.kind;
    const delBtn = el('button', {
      cls: 'btn btn-secondary btn-tiny',
      text: '✕',
      on: {
        click: () => {
          S.lineup.pairings.splice(i, 1);
          save();
          renderPairingsPanel();
          scheduleRegen();
        }
      }
    });
    card.appendChild(el('div', { cls: 'lb-sub-fields' }, [
      el('label', {}, ['Player A: ', aSel]),
      el('span', { cls: 'lb-pair-and', text: pair.kind === 'apart' ? '⇄' : '+' }),
      el('label', {}, ['Player B: ', bSel]),
      delBtn
    ]));
    card.appendChild(el('div', { cls: 'lb-row' }, [
      el('label', { text: 'Constraint' }), kindSel
    ]));
    const desc = pair.kind === 'apart'
      ? 'Never on the same lineup or scrimmage team.'
      : 'Both must start together — neither plays without the other.';
    card.appendChild(el('div', { cls: 'lb-sub-desc', text: desc }));
    body.appendChild(card);
  });

  const addRow = el('div', { cls: 'lb-row' });
  const addBtn = el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: '+ Add pairing',
    on: {
      click: () => {
        S.lineup.pairings.push({ a: null, b: null, kind: 'together' });
        save();
        renderPairingsPanel();
      }
    }
  });
  addRow.appendChild(addBtn);
  body.appendChild(addRow);
}

function playerSelect(options, current, onChange) {
  const sel = el('select', { on: { change: e => onChange(e.target.value) } });
  options.forEach(({ value, label }) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  });
  sel.value = current || '';
  return sel;
}

/* Lineup breakdown: per-rotation scores, maximin, average, and a short
   "why this lineup" string explaining the constraints that drove starter
   selection. */
function renderLineupBreakdown() {
  const wrap = $('#lineupBreakdown');
  if (!wrap) return;
  wrap.replaceChildren();
  const r = S.result;
  if (!r || r.error) return;

  const scores = r.perRotationScores;
  const min = Math.min.apply(null, scores);
  const max = Math.max.apply(null, scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const summary = el('div', { cls: 'lb-bd-summary' });
  summary.appendChild(el('div', { cls: 'lb-bd-stat' }, [
    el('span', { cls: 'lb-bd-stat-label', text: 'Worst' }),
    el('span', { cls: 'lb-bd-stat-val lb-bd-stat-min', text: min.toFixed(1) })
  ]));
  summary.appendChild(el('div', { cls: 'lb-bd-stat' }, [
    el('span', { cls: 'lb-bd-stat-label', text: 'Average' }),
    el('span', { cls: 'lb-bd-stat-val', text: avg.toFixed(1) })
  ]));
  summary.appendChild(el('div', { cls: 'lb-bd-stat' }, [
    el('span', { cls: 'lb-bd-stat-label', text: 'Best' }),
    el('span', { cls: 'lb-bd-stat-val', text: max.toFixed(1) })
  ]));
  wrap.appendChild(summary);

  // Per-rotation bars
  const bars = el('div', { cls: 'lb-bd-bars' });
  const range = Math.max(max - min, 1);
  scores.forEach((s, i) => {
    const pct = ((s - min) / range) * 80 + 20;
    const cls = ['lb-bd-bar'];
    if (s === min) cls.push('is-weak');
    if (s === max) cls.push('is-strong');
    const bar = el('div', { cls: cls.join(' '), title: `Rotation ${i + 1}: ${s.toFixed(2)}` });
    bar.style.height = pct + '%';
    bar.appendChild(el('span', { cls: 'lb-bd-bar-label', text: String(i + 1) }));
    bars.appendChild(bar);
  });
  wrap.appendChild(bars);

  // Why this lineup — list role assignments
  const why = el('div', { cls: 'lb-bd-why' });
  why.appendChild(el('h4', { text: 'Starting roles' }));
  const dl = document.createElement('dl');
  ROLES.forEach(role => {
    const players = (r.starters[role] || []).filter(Boolean);
    if (players.length === 0) return;
    const dt = el('dt', { text: `${role} — ${roleLabel(role)}` });
    const dd = el('dd', { text: players.map(p => p.name || '(unnamed)').join(', ') });
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  why.appendChild(dl);
  wrap.appendChild(why);
}

function renderBench() {
  const ul = $('#benchList');
  if (!ul) return;
  ul.replaceChildren();
  const r = S.result;
  if (!r || r.error) return;
  // The bench is "who is not on the floor in the rotation you're looking at",
  // so a starter you subbed out shows up here and can be dragged back.
  // A starter the libero is covering is not "on the bench" — she's part of the
  // libero swap — so start from the six on the board, then apply coach subs.
  const idx = (((S.viewRot || 0) % 6) + 6) % 6;
  const onFloor = new Set((r.arrangement ? r.arrangement.startOrder : []).filter(Boolean).map(p => p.id));
  coachPatterns().filter(pt => _patternActiveAt(pt, idx)).forEach(pt => { onFloor.delete(pt.out); onFloor.add(pt.in.id); });
  if (r.libero && r.libero.player) onFloor.add(r.libero.player.id);
  const benchPlayers = S.players
    .filter(p => p.available && (p.name || '').trim() && !onFloor.has(p.id))
    .map(p => {
      const role = (p.positions && p.positions[0]) || 'OH';
      return { player: p, value: playerFitForRole(p, role, S.settings || defaultSettings()), skill: playerSkillRaw(p) };
    });

  if (benchPlayers.length === 0) {
    ul.appendChild(el('li', { cls: 'bench-empty', text: 'No bench — every available player is starting.' }));
    return;
  }
  const sorted = sortByMode(benchPlayers, S.benchSort, item => item.player.name, item => item.skill);
  sorted.forEach(({ player, skill }) => {
    const role = (player.positions && player.positions[0]) || '';
    const li = el('li', {
      cls: `bench-item rot-chip-${role || 'ANY'}`,
      attrs: { title: 'Drag onto a court spot to put her there' },
      on: {
        pointerdown: e => onDragStart({ kind: 'bench', playerId: player.id }, e)
      }
    }, [
      el('span', { cls: 'bench-grip', text: '⋮⋮', attrs: { 'aria-hidden': 'true' } }),
      el('span', { cls: 'bench-main' }, [
        el('span', { cls: 'bench-name', text: player.name || '?' }),
        el('span', { cls: 'bench-role', text: roleLabel(role) })
      ]),
      el('span', { cls: 'bench-stat-pill', text: skill.toFixed(1), title: 'Average of the six skills' })
    ]);
    ul.appendChild(li);
  });
}

/* ===== Scrimmage Render ===== */

function renderScrimmage() {
  renderAttendancePanel();
  renderTeamGrid();
  renderPairingsPanel(); // mirror into the Scrimmage-tab pairings panel
}

function renderAttendancePanel() {
  const body = $('#attendanceBody');
  if (!body) return;
  body.replaceChildren();
  const named = S.players.filter(p => (p.name || '').trim());
  const counter = $('#attendanceCounter');

  if (named.length === 0) {
    body.appendChild(el('p', { cls: 'hint', text: 'Add players on the Roster tab first.' }));
    if (counter) counter.textContent = '';
    return;
  }

  // Quick toggle row
  const allRow = el('div', { cls: 'attendance-quick' });
  allRow.appendChild(el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: 'All here',
    on: { click: () => { named.forEach(p => S.scrimmage.attendance[p.id] = true); save(); renderScrimmage(); } }
  }));
  allRow.appendChild(el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: 'None',
    on: { click: () => { named.forEach(p => S.scrimmage.attendance[p.id] = false); save(); renderScrimmage(); } }
  }));
  allRow.appendChild(el('button', {
    cls: 'btn btn-secondary btn-tiny',
    text: 'Match roster availability',
    on: {
      click: () => {
        named.forEach(p => S.scrimmage.attendance[p.id] = !!p.available);
        save();
        renderScrimmage();
      }
    }
  }));
  body.appendChild(allRow);

  // Player checklist
  const list = el('div', { cls: 'attendance-list' });
  const sorted = sortByMode(named, 'name-asc', p => p.name, p => playerSkillRaw(p));
  let hereCount = 0;
  for (const p of sorted) {
    const here = isHereTonight(S, p);
    if (here) hereCount++;
    const cb = el('input', { attrs: { type: 'checkbox' } });
    cb.checked = here;
    cb.addEventListener('change', e => {
      S.scrimmage.attendance[p.id] = !!e.target.checked;
      save();
      renderAttendancePanel();
    });
    const role = (p.positions && p.positions[0]) || '';
    const tag = el('span', { cls: 'bench-role-tag', text: roleCode(role) });
    const skill = el('span', { cls: 'bench-stat-pill', text: playerSkillRaw(p).toFixed(1) });
    const label = el('label', { cls: 'attendance-row' + (p.available ? '' : ' is-unavailable') }, [
      cb,
      el('span', { cls: 'attendance-name', text: p.name }),
      tag,
      skill
    ]);
    list.appendChild(label);
  }
  body.appendChild(list);

  if (counter) counter.textContent = `${hereCount} / ${named.length}`;
}

function renderTeamGrid() {
  const grid = $('#teamGrid');
  const wrap = $('#scrimmageResult');
  const status = $('#scrimmageStatus');
  const shuffleBtn = $('#shuffleTeamsBtn');
  if (!grid || !wrap) return;

  const teams = S.scrimmage.teams || [];
  if (!teams.length) {
    wrap.hidden = true;
    if (shuffleBtn) shuffleBtn.hidden = true;
    if (status && !status.classList.contains('lineup-status-error')) status.textContent = '';
    return;
  }

  // Validate that every player ID still exists in the roster (handles roster
  // deletes). Filter dead IDs and re-pick if any team is now empty.
  const idSet = new Set(S.players.map(p => p.id));
  const cleaned = teams.map(t => t.filter(id => idSet.has(id)));
  if (cleaned.some(t => t.length === 0)) {
    wrap.hidden = true;
    if (status) {
      status.textContent = 'Roster changed since last pick. Tap "Pick teams" to refresh.';
      status.className = 'lineup-status lineup-status-error';
    }
    return;
  }

  wrap.hidden = false;
  if (shuffleBtn) shuffleBtn.hidden = false;
  grid.replaceChildren();

  const playerById = new Map(S.players.map(p => [p.id, p]));
  // Resolve each team to player objects so we can compute sub sets and totals.
  const resolved = cleaned.map(ids => ids.map(id => playerById.get(id)).filter(Boolean));
  const subOverrides = S.scrimmage.subOverrides || [];
  const totals = resolved.map(t => effectiveTeamTotal(t, subOverrides));
  const subSets = resolved.map(t => teamSubIds(t, subOverrides));
  const minTotal = Math.min.apply(null, totals);
  const maxTotal = Math.max.apply(null, totals);
  const spread = maxTotal - minTotal;
  const totalCount = cleaned.reduce((n, t) => n + t.length, 0);

  resolved.forEach((teamPlayers, idx) => {
    const card = el('div', { cls: 'team-card', dataset: { teamIdx: String(idx) } });
    const isStrong = totals[idx] === maxTotal && spread > 0.001;
    const isWeak = totals[idx] === minTotal && spread > 0.001;
    if (isStrong) card.classList.add('is-strong');
    if (isWeak) card.classList.add('is-weak');

    const head = el('div', { cls: 'team-card-head' }, [
      el('span', { cls: 'team-name', text: `Team ${idx + 1}` }),
      el('span', { cls: 'team-total', text: totals[idx].toFixed(1) })
    ]);
    card.appendChild(head);

    const list = el('ul', { cls: 'team-list' });
    const subIds = subSets[idx];
    // Sort by skill desc, then push any subs to the bottom so the on-floor 6
    // sit together at the top regardless of skill — keeps a manually-promoted
    // weak player sitting with the actives, and any high-skill manual sub
    // sitting at the bottom where the user expects to see it.
    const sorted = teamPlayers.slice()
      .sort((a, b) => playerSkillRaw(b) - playerSkillRaw(a))
      .sort((a, b) => (subIds.has(a.id) ? 1 : 0) - (subIds.has(b.id) ? 1 : 0));
    sorted.forEach(player => {
      const role = (player.positions && player.positions[0]) || '';
      const isSub = subIds.has(player.id);
      const cls = ['team-player'];
      if (role) cls.push(`team-player-${role}`);
      if (isSub) cls.push('is-sub');
      const children = [
        el('span', { cls: 'team-player-name', text: player.name || '?' })
      ];
      if (isSub) children.push(el('span', { cls: 'team-sub-tag', text: 'SUB', title: 'Rotates in — not counted in team total' }));
      children.push(el('span', { cls: `bench-role-tag bench-role-tag-${role || 'NONE'}`, text: role }));
      children.push(el('span', { cls: 'bench-stat-pill', text: playerSkillRaw(player).toFixed(1) }));
      const li = el('li', {
        cls: cls.join(' '),
        dataset: { playerId: player.id, teamIdx: String(idx) },
        attrs: { title: isSub ? 'Substitute — drag onto another team to move' : 'Drag onto another team to swap' },
        on: {
          pointerdown: e => onDragStart({ kind: 'team', playerId: player.id, teamIdx: idx }, e)
        }
      }, children);
      list.appendChild(li);
    });
    card.appendChild(list);
    grid.appendChild(card);
  });

  $('#teamSpread').textContent = spread.toFixed(1);
  $('#teamPlayerCount').textContent = String(totalCount);
  if (status) {
    const warnings = S.scrimmage.lastWarnings;
    if (warnings && warnings.length) {
      status.textContent = warnings.join(' · ');
      status.className = 'lineup-status lineup-status-warn';
    } else {
      status.textContent = '';
      status.className = 'lineup-status';
    }
  }
}

function runPickTeams(opts) {
  opts = opts || {};
  const result = pickScrimmageTeams(S, { shuffle: !!opts.shuffle });
  const status = $('#scrimmageStatus');
  if (result.error) {
    S.scrimmage.teams = [];
    S.scrimmage.lastSpread = null;
    save();
    if (status) {
      status.textContent = result.error;
      status.className = 'lineup-status lineup-status-error';
    }
    renderTeamGrid();
    return;
  }
  S.scrimmage.teams = result.teams;
  S.scrimmage.lastSpread = result.spread;
  S.scrimmage.lastWarnings = result.warnings || null;
  // A fresh pick wipes any manual sub designations from the previous split.
  S.scrimmage.subOverrides = [];
  save();
  renderTeamGrid();
}

/* applyTeamSwap: drop a player onto another player or team card.
   - Cross-team drop: move (or swap) players between teams.
   - Intra-team drop (same team, target player named): swap sub status.
     The on-floor player becomes the sub; the sub becomes on-floor. The team
     total recomputes. */
function applyTeamSwap(srcTeamIdx, targetTeamIdx, playerId, targetPlayerId) {
  const teams = S.scrimmage.teams.map(t => t.slice());
  if (!teams[srcTeamIdx] || !teams[targetTeamIdx]) return;

  if (srcTeamIdx === targetTeamIdx) {
    // INTRA-TEAM: swap sub status of two players on the same team.
    if (!targetPlayerId || playerId === targetPlayerId) return;
    const team = teams[srcTeamIdx];
    if (!team.includes(playerId) || !team.includes(targetPlayerId)) return;

    const playerById = new Map(S.players.map(p => [p.id, p]));
    const teamPlayers = team.map(id => playerById.get(id)).filter(Boolean);
    const overrides = (S.scrimmage.subOverrides || []).slice();
    const onFloorIds = new Set(_onFloor(teamPlayers, overrides).map(p => p.id));
    const aIsSub = !onFloorIds.has(playerId);
    const bIsSub = !onFloorIds.has(targetPlayerId);
    if (aIsSub === bIsSub) return; // both same status -> no swap to do

    // Whichever player is currently on-floor becomes the new sub.
    const newOverrides = overrides.filter(id => id !== playerId && id !== targetPlayerId);
    const newSubId = aIsSub ? targetPlayerId : playerId;
    newOverrides.push(newSubId);
    S.scrimmage.subOverrides = newOverrides;

    // Recompute spread.
    const subOv = S.scrimmage.subOverrides;
    const resolved = teams.map(t => t.map(id => playerById.get(id)).filter(Boolean));
    const totals = resolved.map(t => effectiveTeamTotal(t, subOv));
    S.scrimmage.lastSpread = Math.max.apply(null, totals) - Math.min.apply(null, totals);
    save();
    renderTeamGrid();
    return;
  }

  // CROSS-TEAM: move (or swap) between teams.
  const srcIdx = teams[srcTeamIdx].indexOf(playerId);
  if (srcIdx < 0) return;
  teams[srcTeamIdx].splice(srcIdx, 1);

  if (targetPlayerId) {
    const tIdx = teams[targetTeamIdx].indexOf(targetPlayerId);
    if (tIdx >= 0) {
      teams[targetTeamIdx].splice(tIdx, 1);
      teams[srcTeamIdx].push(targetPlayerId);
    }
  }
  teams[targetTeamIdx].push(playerId);
  S.scrimmage.teams = teams;

  // Cross-team moves invalidate per-team sub designations: clear overrides for
  // any player whose team is no longer the same, since the override was tied
  // to the prior team composition.
  const stillOnSameTeam = new Set(teams.flat());
  S.scrimmage.subOverrides = (S.scrimmage.subOverrides || []).filter(id => stillOnSameTeam.has(id));

  const playerById = new Map(S.players.map(p => [p.id, p]));
  const subOv = S.scrimmage.subOverrides;
  const resolved = teams.map(t => t.map(id => playerById.get(id)).filter(Boolean));
  const totals = resolved.map(t => effectiveTeamTotal(t, subOv));
  S.scrimmage.lastSpread = Math.max.apply(null, totals) - Math.min.apply(null, totals);
  save();
  renderTeamGrid();
}

/* ===== Bench screen ===== */

function startSet() {
  const m = S.match;
  let starters = m.starters, liberoId = m.liberoId, plan = m.plan;
  if (S.result && S.result.arrangement && S.result.arrangement.startOrder.every(Boolean)) {
    starters = S.result.arrangement.startOrder.map(p => p.id);
    liberoId = (S.result.libero && S.result.libero.player) ? S.result.libero.player.id : null;
    plan = (S.lineup.subPatterns || [])
      .filter(p => (p.auto || p.coach) && p.in && p.out)
      .map(p => ({ id: p.id, out: p.out, in: p.in.id, trigger: { ...p.trigger }, return: p.return ? { ...p.return } : null }));
  }
  if (starters.length !== 6) return false;
  const slots = {};
  starters.forEach((id, i) => { slots[i] = [id]; });
  const played = { ...m.played };
  starters.forEach(id => { played[id] = true; });
  if (liberoId) played[liberoId] = true;
  S.match = { ...m, active: true, rotationIndex: 0, us: 0, them: 0, starters, liberoId, plan, onFloor: starters.slice(), subsUsed: 0, slots, played };
  save();
  return true;
}
function endSet() {
  S.match = { ...S.match, active: false, set: S.match.set + 1 };
  save();
}
function newMatch() {
  S.match = defaultMatch();
  save();
}
function doSub(inId, outId) {
  const chk = canSub(S.match, currentLevel(), inId, outId);
  if (!chk.ok) { toast(chk.reason, 3000); return false; }
  S.match = applySub(S.match, inId, outId);
  save();
  const byId = new Map(S.players.map(p => [p.id, p]));
  toast(`${playerTag(byId.get(inId))} in for ${playerTag(byId.get(outId))} — ${S.match.subsUsed} of ${currentLevel().subsPerSet} subs`, 2600);
  closeSubPicker();
  renderBenchScreen();
  return true;
}

function playerTag(p) {
  if (!p) return '?';
  return (S.settings?.showJersey && p.jersey) ? `#${p.jersey} ${p.name}` : (p.name || '(unnamed)');
}

function renderBenchScreen() {
  const noLineup = $('#benchNoLineup'), screen = $('#benchScreen');
  if (!noLineup || !screen) return;
  const m = S.match;
  const level = currentLevel();
  const byId = new Map(S.players.map(p => [p.id, p]));
  const canStart = !!(S.result && S.result.arrangement) || m.starters.length === 6;
  const show = canStart || m.active;
  noLineup.hidden = show;
  screen.hidden = !show;
  if (!show) return;

  $('#scoreUs').textContent = String(m.us);
  $('#scoreThem').textContent = String(m.them);
  $('#benchSet').textContent = `Set ${m.set}`;
  $('#benchRot').textContent = `Rotation ${m.rotationIndex + 1}`;
  $('#benchSubs').textContent = `${m.subsUsed} of ${level.subsPerSet} subs`;
  $('#startSetBtn').hidden = m.active;
  $('#startSetBtn').textContent = m.set > 1 ? `Start set ${m.set}` : 'Start set';
  $('#rotateBtn').hidden = !m.active;
  $('#endSetBtn').hidden = !m.active;
  $$('.btn-score').forEach(b => { b.disabled = !m.active; });

  // Court
  const court = $('#benchCourt');
  court.replaceChildren();
  const floor = m.active ? matchFloor(m, S.players, S.lineup.liberoConfig?.replaces, level) : null;
  if (floor) {
    const grid = el('div', { cls: 'rot-court bench-rot-court' });
    const subbedIn = new Set(m.onFloor.filter(id => !m.starters.includes(id)));
    for (const z of [4, 3, 2, 5, 6, 1]) {
      const player = playerAtZone(floor, z);
      const isLibero = player && player.id === m.liberoId;
      const isSub = player && subbedIn.has(player.id);
      const cellCls = ['rot-zone'];
      if (z === 1) cellCls.push('rot-zone-server');
      if (isLibero) cellCls.push('rot-zone-libero');
      const zoneLabel = el('span', { cls: 'rot-zone-num', text: `${z} · ${ZONE_LABELS[z]}` });
      const role = (player && player.positions && player.positions[0]) || '';
      const chipCls = ['rot-chip', 'bench-chip', `rot-chip-${role || 'OH'}`];
      if (isSub) chipCls.push('rot-chip-sub');
      const chip = el('button', {
        cls: chipCls.join(' '),
        attrs: { type: 'button' },
        title: isLibero ? 'The libero swaps on her own' : 'Tap to sub her out',
        on: { click: () => {
          if (!player) return;
          if (isLibero) { toast('The libero swaps on her own — no sub needed.'); return; }
          openSubPicker({ outId: player.id });
        } }
      }, [
        el('span', { cls: 'rot-chip-name', text: player ? playerTag(player) : '—' }),
        el('span', { cls: 'rot-chip-role', text: isLibero ? 'Libero' : (isSub ? 'SUB' : roleLabel(role)) }),
        isLibero ? null : el('span', { cls: 'bench-chip-action', text: 'Sub…' })
      ]);
      grid.appendChild(el('div', { cls: cellCls.join(' ') }, [zoneLabel, chip]));
    }
    court.appendChild(grid);
    court.appendChild(el('p', { cls: 'hint bench-court-hint', text: 'Tap Rotate when we win the serve back. Tap a player to sub her out.' }));
  } else {
    court.appendChild(el('div', { cls: 'bench-idle' }, [
      el('p', { cls: 'bench-idle-title', text: m.set > 1 ? `Set ${m.set - 1} is done.` : 'Ready when you are.' }),
      el('p', { cls: 'hint', text: m.set > 1
        ? 'Tap Start set when the next one begins. Playing time carries over; subs reset.'
        : 'Tap Start set at the first whistle. The starting six come from your lineup.' })
    ]));
  }

  // Nudge
  const nudge = $('#benchNudge');
  nudge.replaceChildren();
  const pending = m.active ? pendingPlannedSub(m) : null;
  const lead = m.us - m.them;
  if (pending) {
    const inP = byId.get(pending.inId), outP = byId.get(pending.outId);
    const ready = lead >= level.leadThreshold;
    nudge.hidden = false;
    nudge.classList.toggle('is-ready', ready);
    const verb = pending.leg === 'return' ? 'back in for' : 'in for';
    nudge.appendChild(el('div', { cls: 'bench-nudge-text' }, [
      el('strong', { text: ready ? `Up by ${lead} — ` : `Planned for this rotation: ` }),
      el('span', { text: `${playerTag(inP)} ${verb} ${playerTag(outP)}` }),
      ready ? null : el('span', { cls: 'bench-nudge-sub', text: ` (once we're up by ${level.leadThreshold}${lead > 0 ? `, now +${lead}` : ''})` })
    ]));
    nudge.appendChild(el('button', {
      cls: `btn ${ready ? 'btn-primary' : 'btn-secondary'} bench-nudge-btn`,
      attrs: { type: 'button' },
      text: pending.leg === 'return' ? 'Bring her back' : 'Sub in',
      on: { click: () => doSub(pending.inId, pending.outId) }
    }));
  } else {
    nudge.hidden = true;
  }

  // Hasn't played yet
  const notPlayed = $('#notPlayed');
  notPlayed.replaceChildren();
  const avail = S.players.filter(p => p.available && (p.name || '').trim());
  const waiting = avail.filter(p => !m.played[p.id]);
  if (waiting.length === 0) {
    notPlayed.appendChild(el('span', { cls: 'hint', text: m.starters.length ? 'Everyone has played. 🎉' : '—' }));
  }
  waiting.forEach(p => notPlayed.appendChild(el('button', {
    cls: 'chip chip-waiting', attrs: { type: 'button' }, text: playerTag(p),
    title: 'Tap to pick who she goes in for',
    on: { click: () => { if (m.active) openSubPicker({ inId: p.id }); else toast('Start the set first.'); } }
  })));

  // Plan (compact)
  const planList = $('#benchPlan');
  planList.replaceChildren();
  if (!m.plan.length) planList.appendChild(el('li', { cls: 'sub-plan-empty', text: m.active ? 'No planned subs for this set.' : 'The plan fills in at Start set.' }));
  m.plan.forEach(x => {
    const inP = byId.get(x.in), outP = byId.get(x.out);
    if (!inP || !outP) return;
    const done = !!m.played[inP.id];
    const li = el('li', { cls: 'sub-plan-row compact' + (done ? ' is-done' : '') });
    li.appendChild(el('div', { cls: 'sub-plan-who' }, [el('strong', { text: playerTag(inP) }), ' for ', el('strong', { text: playerTag(outP) })]));
    li.appendChild(el('div', { cls: 'sub-plan-when', text: `Rotation ${x.trigger.rotationIndex + 1}${x.return ? ` → out at ${x.return.rotationIndex + 1}` : ''}${done ? ' · ✓ played' : ''}` }));
    planList.appendChild(li);
  });

  // Bench
  const benchWrap = $('#benchAvail');
  benchWrap.replaceChildren();
  const onBench = avail.filter(p => !m.onFloor.includes(p.id) && p.id !== m.liberoId);
  if (onBench.length === 0) benchWrap.appendChild(el('span', { cls: 'hint', text: '—' }));
  onBench.forEach(p => benchWrap.appendChild(el('button', {
    cls: 'chip' + (m.played[p.id] ? ' chip-played' : ''), attrs: { type: 'button' }, text: playerTag(p),
    title: 'Tap to pick who she goes in for',
    on: { click: () => { if (m.active) openSubPicker({ inId: p.id }); else toast('Start the set first.'); } }
  })));
}

/* Sub picker: one side fixed, pick the other. Illegal choices stay visible
   with the reason, so the coach learns the rule instead of hitting a wall. */
function openSubPicker({ inId, outId }) {
  const modal = $('#subPickerModal');
  const list = $('#subPickerList');
  const m = S.match;
  const level = currentLevel();
  const byId = new Map(S.players.map(p => [p.id, p]));
  list.replaceChildren();
  let cands;
  if (outId) {
    $('#subPickerTitle').textContent = `Who goes in for ${playerTag(byId.get(outId))}?`;
    cands = S.players.filter(p => p.available && (p.name || '').trim() && !m.onFloor.includes(p.id) && p.id !== m.liberoId)
      .map(p => ({ p, chk: canSub(m, level, p.id, outId), go: () => doSub(p.id, outId) }));
  } else {
    $('#subPickerTitle').textContent = `Who does ${playerTag(byId.get(inId))} go in for?`;
    cands = m.onFloor.map(id => byId.get(id)).filter(Boolean)
      .map(p => ({ p, chk: canSub(m, level, inId, p.id), go: () => doSub(inId, p.id) }));
  }
  $('#subPickerHint').textContent = `${m.subsUsed} of ${level.subsPerSet} subs used`;
  cands.forEach(({ p, chk, go }) => {
    const row = el('button', {
      cls: 'sub-pick-row' + (chk.ok ? '' : ' is-illegal'),
      attrs: { type: 'button' },
      on: { click: () => { if (chk.ok) go(); else toast(chk.reason, 3000); } }
    }, [
      el('span', { cls: 'sub-pick-name', text: playerTag(p) }),
      el('span', { cls: 'sub-pick-meta', text: chk.ok ? (m.played[p.id] ? 'has played' : 'hasn\u2019t played yet') : chk.reason })
    ]);
    list.appendChild(row);
  });
  if (cands.length === 0) list.appendChild(el('p', { cls: 'hint', text: 'Nobody available.' }));
  modal.hidden = false;
}
function closeSubPicker() { const m = $('#subPickerModal'); if (m) m.hidden = true; }

/* ===== Level gating =====
   HS-only controls are marked data-hs-only in the HTML. System <option>s are
   marked data-system and hidden when the current level doesn't offer that
   system. Called on init and on level change. */
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
  const benchTab = document.querySelector('.tab[data-tab="bench"]');
  if (benchTab) benchTab.hidden = !S.settings.showBench;
  if (!S.settings.showBench && S.currentTab === 'bench') setTab('lineup');
  _levelOverridePainters.forEach(f => f());
}

/* Advanced-panel inputs that edit settings.levelOverrides. Each one repaints
   from currentLevel() so a level change shows the new defaults. */
const _levelOverridePainters = [];
function bindLevelOverride(id, key, parse) {
  const n = $(id); if (!n) return;
  const paint = () => {
    const v = currentLevel()[key];
    if (n.type === 'checkbox') n.checked = !!v; else n.value = v;
  };
  paint();
  _levelOverridePainters.push(paint);
  n.addEventListener('change', e => {
    S.settings.levelOverrides = { ...S.settings.levelOverrides, [key]: parse(e.target) };
    save();
    paint();
    scheduleRegen();
  });
}

/* ===== Theme =====
   A per-device preference (never in the share link). null = follow the
   device. Stored under its own key so it survives a team reset. */
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

/* ===== Tabs / Toast / Modal ===== */
function setTab(name) {
  if (!VALID_TABS.has(name)) name = 'roster';
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === name + 'Tab'));
  document.body.dataset.tab = name; // lets CSS widen main only where the layout wants it
  if (name === 'scrimmage') renderScrimmage();
  if (name === 'bench') renderBenchScreen();
  if (S.currentTab !== name) {
    S.currentTab = name;
    save();
  }
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.hidden = true, ms);
}

function confirmDialog(title, msg) {
  return new Promise(resolve => {
    const m = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg;
    m.hidden = false;
    const ok = $('#confirmOk');
    const cancel = $('#confirmCancel');
    function cleanup(v) {
      m.hidden = true;
      ok.removeEventListener('click', okH);
      cancel.removeEventListener('click', cancelH);
      resolve(v);
    }
    function okH() { cleanup(true); }
    function cancelH() { cleanup(false); }
    ok.addEventListener('click', okH);
    cancel.addEventListener('click', cancelH);
  });
}

async function confirmDelete(player) {
  const ok = await confirmDialog(
    'Delete player?',
    `Remove ${player.name || 'this player'} from the roster? This can't be undone.`
  );
  if (!ok) return;
  S.players = S.players.filter(p => p.id !== player.id);
  save();
  renderRoster();
}

/* ===== Init / wiring ===== */
function init() {
  initTheme();
  const loadResult = load();

  // Editable team name in the topbar brand. The "Court IQ — " prefix is
  // fixed; only the team-name span is contenteditable. Commit on blur or
  // Enter; Escape reverts. Empty string falls back to the default.
  const teamNameEl = $('#teamNameDisplay');
  if (teamNameEl) {
    renderTeamName();
    const commit = () => {
      const newName = (teamNameEl.textContent || '').trim() || DEFAULT_TEAM_NAME;
      if (newName !== S.teamName) {
        S.teamName = newName;
        save();
        updateLastEditedDisplay();
      }
      // Always re-sync DOM to canonical value (collapses whitespace, etc.)
      teamNameEl.textContent = S.teamName;
    };
    teamNameEl.addEventListener('blur', commit);
    teamNameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        teamNameEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        teamNameEl.textContent = S.teamName;
        teamNameEl.blur();
      }
    });
  }

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  $('#addPlayerBtn').addEventListener('click', () => {
    const np = createPlayer('');
    S.players.push(np);
    save();
    renderRoster();
    requestAnimationFrame(() => {
      const card = document.querySelector(`.player-card[data-id="${np.id}"]`);
      if (!card) return;
      const input = card.querySelector('.player-name-input');
      // Scroll the NEW card into view (not the Add button) so the user
      // can see what they're typing.
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) input.focus();
    });
  });

  $('#loadDemoBtn')?.addEventListener('click', () => {
    loadDemoRoster();
    toast('Demo roster loaded — switch to the Lineup tab and tap Generate.');
  });

  $('#printRosterBtn')?.addEventListener('click', printRoster);
  $('#printLineupBtn')?.addEventListener('click', printLineup);

  // Topbar settings: ruleset / system / jersey toggle / setter-tempo toggle
  const levelSel = $('#levelSelect');
  const systemSel = $('#systemSelect');
  const jerseyTog = $('#jerseyToggle');
  const tempoTog = $('#setterTempoToggle');
  if (levelSel) {
    levelSel.value = S.settings.level;
    levelSel.addEventListener('change', e => {
      S.settings.level = LEVELS[e.target.value] ? e.target.value : 'ms';
      if (!currentLevel().systems.includes(S.settings.system)) {
        // Fall back to the first system this level offers that actually exists yet.
        S.settings.system = currentLevel().systems.find(x => VALID_SYSTEMS.has(x)) || '4-2';
      }
      save();
      applyLevelGates();
      renderRoster();
      scheduleRegen();
    });
  }
  if (systemSel) {
    systemSel.value = S.settings.system;
    systemSel.addEventListener('change', e => {
      S.settings.system = VALID_SYSTEMS.has(e.target.value) ? e.target.value : '4-2';
      const mirror = $('#systemSelectLineup');
      if (mirror) mirror.value = S.settings.system;
      save();
      scheduleRegen();
    });
  }
  const benchTog = $('#showBenchToggle');
  if (benchTog) {
    benchTog.checked = !!S.settings.showBench;
    benchTog.addEventListener('change', e => {
      S.settings.showBench = !!e.target.checked;
      save();
      applyLevelGates();
    });
  }
  if (jerseyTog) {
    jerseyTog.checked = !!S.settings.showJersey;
    jerseyTog.addEventListener('change', e => {
      S.settings.showJersey = !!e.target.checked;
      save();
      renderRoster();
    });
  }
  if (tempoTog) {
    tempoTog.checked = !!S.settings.showSetterTempo;
    tempoTog.addEventListener('change', e => {
      S.settings.showSetterTempo = !!e.target.checked;
      save();
      renderRoster();
      scheduleRegen();
    });
  }

  // Bench screen
  const bump = (key, delta) => () => {
    if (!S.match.active) return;
    S.match = { ...S.match, [key]: Math.max(0, S.match[key] + delta) };
    save();
    renderBenchScreen();
  };
  $('#usPlus')?.addEventListener('click', bump('us', 1));
  $('#usMinus')?.addEventListener('click', bump('us', -1));
  $('#themPlus')?.addEventListener('click', bump('them', 1));
  $('#themMinus')?.addEventListener('click', bump('them', -1));
  $('#rotateBtn')?.addEventListener('click', () => {
    if (!S.match.active) return;
    S.match = { ...S.match, rotationIndex: (S.match.rotationIndex + 1) % 6 };
    save();
    renderBenchScreen();
  });
  $('#startSetBtn')?.addEventListener('click', () => {
    if (!startSet()) { toast('Generate a lineup first.'); return; }
    renderBenchScreen();
  });
  $('#endSetBtn')?.addEventListener('click', async () => {
    const ok = await confirmDialog('End this set?', 'Subs reset for the next set. Who has played carries over.');
    if (!ok) return;
    endSet();
    renderBenchScreen();
  });
  $('#newMatchBtn')?.addEventListener('click', async () => {
    if (S.match.active || Object.keys(S.match.played).length) {
      const ok = await confirmDialog('Start a new match?', 'Clears the score, subs, and who has played.');
      if (!ok) return;
    }
    newMatch();
    renderBenchScreen();
  });
  $('#benchGoLineup')?.addEventListener('click', () => setTab('lineup'));
  $('#subPickerClose')?.addEventListener('click', closeSubPicker);
  $('#subPickerCancel')?.addEventListener('click', closeSubPicker);
  $('#subPickerModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeSubPicker(); });

  $('#setterFrontOnlyToggle')?.addEventListener('change', e => {
    S.lineup.setterFrontOnly = !!e.target.checked;
    save();
    if (S.result) runGenerate();
  });
  $('#everybodyPlaysToggle')?.addEventListener('change', e => {
    S.lineup.everybodyPlays = !!e.target.checked;
    save();
    if (S.result) runGenerate();
  });
  bindLevelOverride('#advSubsPerSet', 'subsPerSet', t => Math.max(6, Math.min(30, parseInt(t.value, 10) || 18)));
  bindLevelOverride('#advLeadThreshold', 'leadThreshold', t => Math.max(0, Math.min(15, parseInt(t.value, 10) || 0)));
  bindLevelOverride('#advLiberoServe', 'liberoMayServe', t => !!t.checked);

  $('#resetWeightsBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('Reset weights?', 'Restore all skill weights to defaults?');
    if (!ok) return;
    S.weights = defaultWeights();
    save();
    renderWeights();
    toast('Weights reset.');
  });

  // Lineup builder controls
  const systemSelLineup = $('#systemSelectLineup');
  if (systemSelLineup) {
    systemSelLineup.value = S.settings.system;
    systemSelLineup.addEventListener('change', e => {
      S.settings.system = VALID_SYSTEMS.has(e.target.value) ? e.target.value : '4-2';
      if (systemSel) systemSel.value = S.settings.system;
      save();
      scheduleRegen();
    });
  }
  const optModeSel = $('#optimizationMode');
  if (optModeSel) {
    optModeSel.value = S.lineup.optimizationMode;
    optModeSel.addEventListener('change', e => {
      const v = e.target.value;
      if (['balanced', 'best6', 'sr', 'serving'].includes(v)) {
        S.lineup.optimizationMode = v;
        save();
        scheduleRegen();
      }
    });
  }
  $('#rotNext')?.addEventListener('click', () => { S.viewRot = ((S.viewRot || 0) + 1) % 6; renderCourtView(); });
  $('#rotPrev')?.addEventListener('click', () => { S.viewRot = ((S.viewRot || 0) + 5) % 6; renderCourtView(); });
  $('#generateBtn').addEventListener('click', () => {
    runGenerate({ fresh: true, toastOnSuccess: true });
  });
  $('#clearOverridesBtn')?.addEventListener('click', () => {
    if (!S.lineup.overrides.length) return;
    S.lineup.overrides = [];
    save();
    runGenerate({ toastOnSuccess: false });
    toast('Pins cleared.');
  });

  // Scrimmage controls
  const teamCountSel = $('#teamCount');
  if (teamCountSel) {
    teamCountSel.value = String(S.scrimmage.teamCount);
    teamCountSel.addEventListener('change', e => {
      const v = Number(e.target.value);
      if (v === 2 || v === 3 || v === 4) {
        S.scrimmage.teamCount = v;
        S.scrimmage.teams = []; // invalidate previous split
        S.scrimmage.lastSpread = null;
        save();
        renderTeamGrid();
      }
    });
  }
  $('#genTeamsBtn')?.addEventListener('click', () => runPickTeams());
  $('#shuffleTeamsBtn')?.addEventListener('click', () => {
    runPickTeams({ shuffle: true });
    toast('Reshuffled.');
  });

  $('#shareBtn').addEventListener('click', openShareModal);

  // Help button delegation: any element with [data-help="key"] opens that help entry
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-help]');
    if (btn && document.body.contains(btn)) {
      e.preventDefault();
      e.stopPropagation();
      openHelp(btn.getAttribute('data-help'));
    }
  });
  $('#helpClose').addEventListener('click', closeHelp);
  $('#helpDoneBtn').addEventListener('click', closeHelp);
  $('#helpModal').addEventListener('click', e => {
    if (e.target.id === 'helpModal') closeHelp();
  });

  // Share modal wiring
  $('#shareModalClose').addEventListener('click', closeShareModal);
  $('#shareCloseBtn').addEventListener('click', closeShareModal);
  $('#shareCopyBtn').addEventListener('click', copyShareUrl);
  $('#shareNativeBtn').addEventListener('click', shareNativeOrCopy);
  $('#shareModal').addEventListener('click', e => {
    if (e.target.id === 'shareModal') closeShareModal();
  });
  // Tap-and-select the URL input contents for easy manual copy
  $('#shareUrlInput').addEventListener('focus', e => e.target.select());

  // ESC closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#shareModal').hidden) closeShareModal();
      if (!$('#helpModal').hidden) closeHelp();
    }
  });

  // Drag & drop window-level handlers
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);

  // Sort dropdowns
  const rosterSortEl = $('#rosterSort');
  rosterSortEl.value = S.rosterSort;
  rosterSortEl.addEventListener('change', e => {
    if (SORT_MODES.has(e.target.value)) {
      S.rosterSort = e.target.value;
      save();
      renderRoster();
    }
  });
  const benchSortEl = $('#benchSort');
  benchSortEl.value = S.benchSort;
  benchSortEl.addEventListener('change', e => {
    if (SORT_MODES.has(e.target.value)) {
      S.benchSort = e.target.value;
      save();
      if (S.result) renderBench();
    }
  });

  renderRoster();
  renderWeights();
  applyLevelGates();
  if (S.lineup.board) runGenerate(); // the coach's lineup is there when she opens the app
  updateCounts();
  updateLastEditedDisplay();
  // Restore the last-active tab (persisted in S.currentTab); falls back to
  // roster if absent or invalid.
  setTab(S.currentTab || 'roster');

  // First-time welcome when opening someone else's shared link
  if (loadResult?.fromUrl) {
    setTimeout(() => {
      toast('Loaded shared team. Your edits sync to the URL — tap 🔗 to share back.', 4500);
    }, 300);
  }
}

/* runGenerate: invoke generateLineup with current state and re-render. */
function runGenerate(opts = {}) {
  // Suggest (fresh) fills the board from the optimizer; otherwise the board
  // is the lineup and we just score it.
  if (opts.fresh || !S.lineup.board) {
    const suggested = generateLineup();
    if (suggested.error) {
      S.result = suggested;
      const printBtn0 = $('#printLineupBtn');
      if (printBtn0) printBtn0.hidden = true;
      renderLineup();
      return;
    }
    S.lineup.board = {
      startOrder: suggested.arrangement.startOrder.map(p => p.id),
      liberoId: (suggested.libero && suggested.libero.player) ? suggested.libero.player.id : null
    };
    save();
  }
  const result = resultFromBoard(S);
  S.result = result;
  // Everybody-plays: derive the sub plan from the fresh lineup. Auto patterns
  // are replaced wholesale; coach-authored ones are untouched.
  S.lineup.subPatterns = S.lineup.subPatterns.filter(p => !p.auto);
  S.plan = null;
  if (!result.error && S.lineup.everybodyPlays !== false) {
    S.plan = planEverybodyPlays(S, result);
    S.lineup.subPatterns.push(...S.plan.patterns);
  }
  const printBtn = $('#printLineupBtn');
  if (printBtn) printBtn.hidden = !!(result.error || !result.arrangement);
  if (result.error) {
    renderLineup();
    return;
  }
  if (result.validation) toast(result.validation, 3000);
  renderLineup();
  if (opts.toastOnSuccess) toast('Here\u2019s a suggested six — drag to change it.', 2600);
}

/* scheduleRegen: debounced auto-regenerate when settings/lineup config change.
   200ms is fast enough to feel responsive but coalesces rapid taps (e.g. cycling
   through ruleset options). */
let _regenTimer = null;
function scheduleRegen() {
  if (!S.lineup.board) return; // nothing to re-score until the coach has a lineup
  clearTimeout(_regenTimer);
  _regenTimer = setTimeout(() => runGenerate(), 200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
