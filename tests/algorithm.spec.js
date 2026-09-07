// Block 6 — algorithm correctness tests.
// Drive the live app via page.evaluate: each test injects a roster onto
// window.S, sets system / mode, then calls window.generateLineup. Asserts
// structural shape (5-1 vs 6-2 composition, libero presence, error reason
// on bad input) plus a maximin sanity check.
//
// The point of these tests is regression protection — if anyone changes the
// algorithm later (intentionally or otherwise), CI catches the break.

const { test, expect } = require('@playwright/test');
const balanced13 = require('./fixtures/roster-balanced-13.json');
const noSetter = require('./fixtures/roster-no-setter.json');
const ms12 = require('./fixtures/roster-ms-12.json');
const simple6 = require('./fixtures/roster-simple-6.json');
const tieAttitude = require('./fixtures/roster-tie-attitude.json');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Reset state to a deterministic baseline. The app's load() runs on
  // DOMContentLoaded; by the time we call goto and the page resolves, S is
  // wired up. We zero out persisted state so each test starts clean.
  await page.evaluate(() => {
    if (!window.S) throw new Error('window.S not exposed — Block 6 wiring missing');
    window.S.players = [];
    window.S.lineup.overrides = [];
    window.S.lineup.subPatterns = [];
    window.S.lineup.pairings = [];
    window.S.lineup.liberoConfig = { playerId: null, covers: [], replaces: ['MB'], servesInRotation: null };
    window.S.lineup.planExclude = {};
    window.S.lineup.board = null;
    window.S.lineup.setterFrontOnly = false;
    window.S.lineup.everybodyPlays = true;
    window.S.lineup.saved = [];
    window.S.lineup.loadedSavedId = null;
    window.S.settings.levelOverrides = {};
  });
});

function runGenerate(page, { roster, system, mode = 'balanced', level = 'hs' }) {
  return page.evaluate(({ roster, system, mode, level }) => {
    window.S.players = roster;
    window.S.settings.system = system;
    window.S.settings.level = level;
    window.S.lineup.optimizationMode = mode;
    return window.generateLineup(window.S);
  }, { roster, system, mode, level });
}

// Generate, then run the everybody-plays planner. Returns a serializable
// summary of the plan (ids only) alongside the lineup result.
function runPlan(page, { roster, system, level = 'ms', subsPerSet }) {
  return page.evaluate(({ roster, system, level, subsPerSet }) => {
    window.S.players = roster;
    window.S.settings.system = system;
    window.S.settings.level = level;
    window.S.settings.levelOverrides = subsPerSet ? { subsPerSet } : {};
    const result = window.generateLineup(window.S);
    if (result.error) return { error: result.error };
    const plan = window.planEverybodyPlays(window.S, result);
    return {
      error: null,
      setterIds: result.starters.S.map(p => p.id),
      liberoId: result.libero && result.libero.player ? result.libero.player.id : null,
      patterns: plan.patterns.map(p => ({ out: p.out, in: p.in.id, trigger: p.trigger.rotationIndex, ret: p.return.rotationIndex })),
      subsUsed: plan.subsUsed,
      subsCap: plan.subsCap,
      benchLeft: plan.benchLeft.map(p => p.id)
    };
  }, { roster, system, level, subsPerSet });
}

test.describe('5-1 system', () => {
  test('balanced lineup has 1 S, 1 OPP, 2 OH, 2 MB, libero set', async ({ page }) => {
    const result = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs' });
    expect(result.error).toBeFalsy();
    expect(result.starters).toBeTruthy();
    expect(result.starters.S).toHaveLength(1);
    expect(result.starters.OPP).toHaveLength(1);
    expect(result.starters.OH).toHaveLength(2);
    expect(result.starters.MB).toHaveLength(2);
    expect(result.libero).toBeTruthy();
    expect(result.libero.player).toBeTruthy();
    expect(result.libero.player.id).toBeTruthy();
  });

  test('produces 6 distinct rotation arrangements', async ({ page }) => {
    const result = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs' });
    expect(result.arrangement.rotations).toHaveLength(6);
    expect(result.perRotationScores).toHaveLength(6);
    // Every rotation has 6 players on the floor (front row + back row).
    for (const rot of result.arrangement.rotations) {
      expect(rot.frontRow).toHaveLength(3);
      expect(rot.backRow).toHaveLength(3);
    }
  });

  test('every starter is in their primary or secondary role', async ({ page }) => {
    const result = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs' });
    const checkRole = (player, role) => {
      const valid = [player.positions[0], player.positions[1]].filter(Boolean);
      expect(valid).toContain(role);
    };
    result.starters.S.forEach(p => checkRole(p, 'S'));
    result.starters.OPP.forEach(p => checkRole(p, 'OPP'));
    result.starters.OH.forEach(p => checkRole(p, 'OH'));
    result.starters.MB.forEach(p => checkRole(p, 'MB'));
    if (result.libero && result.libero.player) checkRole(result.libero.player, 'L');
  });
});

test.describe('6-2 system', () => {
  test('balanced lineup uses 2 S, 0 OPP, 2 OH, 2 MB', async ({ page }) => {
    const result = await runGenerate(page, { roster: balanced13, system: '6-2', level: 'hs' });
    expect(result.error).toBeFalsy();
    expect(result.starters).toBeTruthy();
    expect(result.starters.S).toHaveLength(2);
    expect(result.starters.OPP).toHaveLength(0);
    expect(result.starters.OH).toHaveLength(2);
    expect(result.starters.MB).toHaveLength(2);
    expect(result.libero).toBeTruthy();
  });

  test('the two setters are different players', async ({ page }) => {
    const result = await runGenerate(page, { roster: balanced13, system: '6-2', level: 'hs' });
    expect(result.starters.S[0].id).not.toBe(result.starters.S[1].id);
  });
});

test.describe('error paths', () => {
  test('5-1 with no setters returns a setter-related error', async ({ page }) => {
    const result = await runGenerate(page, { roster: noSetter, system: '5-1', level: 'hs' });
    expect(result.starters).toBeNull();
    expect(result.validation || result.error).toMatch(/setter/i);
  });

  test('6-2 with only one setter returns an error mentioning 2 setters', async ({ page }) => {
    // balanced13 has 2 setters; remove one to leave a single S.
    const oneSetter = balanced13.filter(p => p.id !== 'p11');
    const result = await runGenerate(page, { roster: oneSetter, system: '6-2', level: 'hs' });
    expect(result.starters).toBeNull();
    expect(result.validation || result.error).toMatch(/setter/i);
  });

  test('roster smaller than 7 players returns roster-size error', async ({ page }) => {
    const six = balanced13.slice(0, 6);
    const result = await runGenerate(page, { roster: six, system: '5-1', level: 'hs' });
    expect(result.starters).toBeNull();
    expect(result.error).toMatch(/7/);
  });
});

test.describe('optimization modes', () => {
  test('balanced mode worst-rotation >= best6 mode worst-rotation', async ({ page }) => {
    // Maximin sanity check: balanced optimizes the worst rotation, best6
    // optimizes only rotation 1. So balanced's minimum-rotation score
    // should be at least as high as best6's minimum.
    const balancedResult = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs', mode: 'balanced' });
    const best6Result = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs', mode: 'best6' });
    const balancedWorst = Math.min(...balancedResult.perRotationScores);
    const best6Worst = Math.min(...best6Result.perRotationScores);
    expect(balancedWorst).toBeGreaterThanOrEqual(best6Worst - 0.001); // float tolerance
  });

  test('all four optimization modes return valid lineups', async ({ page }) => {
    for (const mode of ['balanced', 'best6', 'sr', 'serving']) {
      const result = await runGenerate(page, { roster: balanced13, system: '5-1', level: 'hs', mode });
      expect(result.error, `mode=${mode}`).toBeFalsy();
      expect(result.starters, `mode=${mode}`).toBeTruthy();
    }
  });
});

/* ===== Covenant additions (Blocks 1–5) ===== */

test.describe('4-2 system', () => {
  test('MS 4-2 puts 2 S, 2 OH, 2 MB on the floor with a libero', async ({ page }) => {
    const result = await runGenerate(page, { roster: ms12, system: '4-2', level: 'ms' });
    expect(result.error).toBeFalsy();
    expect(result.starters.S).toHaveLength(2);
    expect(result.starters.OH).toHaveLength(2);
    expect(result.starters.MB).toHaveLength(2);
    expect(result.starters.OPP).toHaveLength(0);
    expect(result.libero && result.libero.player).toBeTruthy();
  });

  test('every rotation has one setter in the front row and one in the back', async ({ page }) => {
    const result = await runGenerate(page, { roster: ms12, system: '4-2', level: 'ms' });
    const isS = p => p && p.positions && p.positions[0] === 'S';
    for (const rot of result.arrangement.rotations) {
      expect(rot.frontRow.filter(isS)).toHaveLength(1);
      expect(rot.backRow.filter(isS)).toHaveLength(1);
    }
  });

  test('roleForScoring: the setter only scores as a setter in the row she sets from', async ({ page }) => {
    const out = await page.evaluate(() => {
      const S = { positions: ['S', null] }, OH = { positions: ['OH', null] };
      return {
        back42: window.roleForScoring(S, 'back', '4-2'),
        front42: window.roleForScoring(S, 'front', '4-2'),
        front62: window.roleForScoring(S, 'front', '6-2'),
        back62: window.roleForScoring(S, 'back', '6-2'),
        back51: window.roleForScoring(S, 'back', '5-1'),
        ohBack: window.roleForScoring(OH, 'back', '4-2')
      };
    });
    expect(out).toEqual({ back42: 'DS', front42: 'S', front62: 'OPP', back62: 'S', back51: 'S', ohBack: 'OH' });
  });
});

test.describe('Simple 6', () => {
  test('runs with exactly six players and no libero', async ({ page }) => {
    const result = await runGenerate(page, { roster: simple6, system: 'simple', level: 'ms' });
    expect(result.error).toBeFalsy();
    const starters = ['OH', 'MB', 'S', 'OPP', 'DS'].flatMap(r => result.starters[r] || []);
    expect(starters).toHaveLength(6);
    expect(result.libero).toBeNull();
    expect(result.arrangement.rotations).toHaveLength(6);
  });

  test('names a libero when seven or more are available', async ({ page }) => {
    const result = await runGenerate(page, { roster: ms12, system: 'simple', level: 'ms' });
    expect(result.error).toBeFalsy();
    expect(result.libero && result.libero.player).toBeTruthy();
    expect(result.arrangement.rotations).toHaveLength(6);
  });
});

test.describe('intangibles', () => {
  test('identical skills: the higher Attitude takes the last hitter slot', async ({ page }) => {
    const result = await runGenerate(page, { roster: tieAttitude, system: '4-2', level: 'ms' });
    expect(result.error).toBeFalsy();
    const ohIds = result.starters.OH.map(p => p.id);
    expect(ohIds).toContain('p03'); // the clearly better hitter
    expect(ohIds).toContain('p04'); // Nice, attitude 9
    expect(ohIds).not.toContain('p05'); // Grump, attitude 3
  });

  test('intangibles never outrank skill: one point of hitting flips it', async ({ page }) => {
    const roster = tieAttitude.map(p => p.id === 'p05' ? { ...p, skills: { ...p.skills, hitting: p.skills.hitting + 1 } } : p);
    const result = await runGenerate(page, { roster, system: '4-2', level: 'ms' });
    const ohIds = result.starters.OH.map(p => p.id);
    expect(ohIds).toContain('p05');
    expect(ohIds).not.toContain('p04');
  });
});

test.describe('everybody-plays planner', () => {
  test('12 players, cap 18: every bench player gets a swap, two subs each', async ({ page }) => {
    const plan = await runPlan(page, { roster: ms12, system: '4-2', subsPerSet: 18 });
    expect(plan.error).toBeNull();
    expect(plan.patterns).toHaveLength(5);
    expect(plan.subsUsed).toBe(10);
    expect(plan.benchLeft).toHaveLength(0);
    for (const p of plan.patterns) expect(p.ret).toBe((p.trigger + 3) % 6);
    expect(new Set(plan.patterns.map(p => p.out)).size).toBe(5);
    expect(new Set(plan.patterns.map(p => p.in)).size).toBe(5);
  });

  test('bench order is Attitude/Speed first', async ({ page }) => {
    const plan = await runPlan(page, { roster: ms12, system: '4-2', subsPerSet: 18 });
    const byId = Object.fromEntries(ms12.map(p => [p.id, p]));
    const score = id => (byId[id].intangibles.attitude + byId[id].intangibles.athleticism) / 2;
    const order = plan.patterns.map(p => score(p.in));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThanOrEqual(order[i - 1]);
  });

  test('cap 4: two swaps, the three lowest-intangible players are left out', async ({ page }) => {
    const plan = await runPlan(page, { roster: ms12, system: '4-2', subsPerSet: 4 });
    expect(plan.patterns).toHaveLength(2);
    expect(plan.subsUsed).toBe(4);
    expect(plan.benchLeft).toHaveLength(3);
    const byId = Object.fromEntries(ms12.map(p => [p.id, p]));
    const score = id => (byId[id].intangibles.attitude + byId[id].intangibles.athleticism) / 2;
    const worstPlanned = Math.min(...plan.patterns.map(p => score(p.in)));
    for (const id of plan.benchLeft) expect(score(id)).toBeLessThanOrEqual(worstPlanned);
  });

  test('never subs out the setter in 5-1 or 6-2', async ({ page }) => {
    for (const system of ['5-1', '6-2']) {
      const plan = await runPlan(page, { roster: ms12, system, level: 'ms', subsPerSet: 18 });
      expect(plan.error, system).toBeNull();
      for (const p of plan.patterns) expect(plan.setterIds, system).not.toContain(p.out);
    }
  });

  test('never subs out the libero', async ({ page }) => {
    const plan = await runPlan(page, { roster: ms12, system: '4-2', subsPerSet: 18 });
    for (const p of plan.patterns) expect(p.out).not.toBe(plan.liberoId);
  });

  test('sub patterns with a return span trigger..return, wrapping past 6', async ({ page }) => {
    const active = await page.evaluate(() =>
      [0, 1, 2, 3, 4, 5].map(r => window._patternActiveAt({ trigger: { rotationIndex: 1, event: 'in' }, return: { rotationIndex: 4 } }, r)));
    expect(active).toEqual([false, true, true, true, false, false]);
    const wrap = await page.evaluate(() =>
      [0, 1, 2, 3, 4, 5].map(r => window._patternActiveAt({ trigger: { rotationIndex: 4, event: 'in' }, return: { rotationIndex: 1 } }, r)));
    expect(wrap).toEqual([true, false, false, false, true, true]);
    const single = await page.evaluate(() =>
      [0, 1, 2].map(r => window._patternActiveAt({ trigger: { rotationIndex: 1, event: 'in' } }, r)));
    expect(single).toEqual([false, true, false]);
  });
});

test.describe('bench rules', () => {
  const match = () => ({
    active: true, set: 1, rotationIndex: 0, us: 0, them: 0,
    starters: ['a', 'b', 'c', 'd', 'e', 'f'], liberoId: 'lib', plan: [],
    onFloor: ['a', 'b', 'c', 'd', 'e', 'f'], subsUsed: 0,
    slots: { 0: ['a'], 1: ['b'], 2: ['c'], 3: ['d'], 4: ['e'], 5: ['f'] }, log: [], played: {}
  });
  const level = { subsPerSet: 18 };

  test('a legal sub goes in, counts one sub, marks her as played', async ({ page }) => {
    const out = await page.evaluate(({ m, level }) => {
      const chk = window.canSub(m, level, 'x', 'a');
      const next = window.applySub(m, 'x', 'a');
      return { chk, onFloor: next.onFloor, subsUsed: next.subsUsed, played: next.played, slot0: next.slots[0] };
    }, { m: match(), level });
    expect(out.chk.ok).toBe(true);
    expect(out.onFloor[0]).toBe('x');
    expect(out.subsUsed).toBe(1);
    expect(out.played.x).toBe(true);
    expect(out.slot0).toEqual(['a', 'x']);
  });

  test('refuses over the cap, the libero, and a wrong-slot re-entry; allows same-slot re-entry', async ({ page }) => {
    const out = await page.evaluate(({ m, level }) => {
      const after = window.applySub(m, 'x', 'a'); // a is out, x in slot 0
      return {
        overCap: window.canSub({ ...m, subsUsed: 18 }, level, 'x', 'a'),
        libero: window.canSub(m, level, 'lib', 'a'),
        wrongSlot: window.canSub(after, level, 'a', 'b'),   // a tries to come back for b (slot 1)
        sameSlot: window.canSub(after, level, 'a', 'x'),    // a returns for x (slot 0)
        alreadyIn: window.canSub(after, level, 'x', 'b'),
        inactive: window.canSub({ ...m, active: false }, level, 'x', 'a')
      };
    }, { m: match(), level });
    expect(out.overCap.ok).toBe(false);
    expect(out.overCap.reason).toMatch(/subs/i);
    expect(out.libero.ok).toBe(false);
    expect(out.wrongSlot.ok).toBe(false);
    expect(out.wrongSlot.reason).toMatch(/replaced her/i);
    expect(out.sameSlot.ok).toBe(true);
    expect(out.alreadyIn.ok).toBe(false);
    expect(out.inactive.ok).toBe(false);
  });

  test('pendingPlannedSub finds the in leg, then the return leg', async ({ page }) => {
    const out = await page.evaluate(({ m }) => {
      const plan = [{ id: 'p', out: 'a', in: 'x', trigger: { rotationIndex: 0, event: 'in' }, return: { rotationIndex: 3, event: 'in' } }];
      const inLeg = window.pendingPlannedSub({ ...m, plan }, plan);
      const after = window.applySub({ ...m, plan }, 'x', 'a');
      const none = window.pendingPlannedSub({ ...after, rotationIndex: 1 });
      const back = window.pendingPlannedSub({ ...after, rotationIndex: 3 });
      return { inLeg, none, back };
    }, { m: match() });
    expect(out.inLeg && out.inLeg.leg).toBe('in');
    expect(out.inLeg.inId).toBe('x');
    expect(out.none).toBeNull();
    expect(out.back && out.back.leg).toBe('return');
    expect(out.back.inId).toBe('a');
    expect(out.back.outId).toBe('x');
  });
});

test.describe('the board', () => {
  test('a suggested lineup becomes a board that scores the same six', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      const r = window.generateLineup(window.S);
      window.S.lineup.board = { startOrder: r.arrangement.startOrder.map(p => p.id), liberoId: r.libero.player.id };
      const b = window.resultFromBoard(window.S);
      return { ids: b.arrangement.startOrder.map(p => p.id), suggested: r.arrangement.startOrder.map(p => p.id), libero: b.libero.player.id, rotations: b.arrangement.rotations.length, holes: b.holes, error: b.error || null };
    }, ms12);
    expect(out.error).toBeNull();
    expect(out.ids).toEqual(out.suggested);
    expect(out.rotations).toBe(6);
    expect(out.holes).toBe(0);
  });

  test('an unavailable starter leaves a hole and a warning, not an error', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      const r = window.generateLineup(window.S);
      window.S.lineup.board = { startOrder: r.arrangement.startOrder.map(p => p.id), liberoId: r.libero.player.id };
      const gone = window.S.players.find(p => p.id === window.S.lineup.board.startOrder[2]);
      gone.available = false;
      const b = window.resultFromBoard(window.S);
      return { error: b.error || null, holes: b.holes, validation: b.validation, name: gone.name, slot2: b.arrangement.startOrder[2] };
    }, ms12);
    expect(out.error).toBeNull();
    expect(out.holes).toBe(1);
    expect(out.slot2).toBeNull();
    expect(out.validation).toContain(out.name);
  });
});

test.describe('NFHS libero serving spot', () => {
  test('the libero serves from exactly one rotation per set', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      window.S.settings.levelOverrides = { liberoMayServe: true };
      const r = window.generateLineup(window.S);
      const level = window.currentLevel();
      const libId = r.libero.player.id;
      const serving = r.arrangement.rotations.map((rot, i) => {
        const eff = window.effectiveRotationWithLibero(rot, r.libero, level, i);
        return eff.backRow[2] && eff.backRow[2].id === libId;
      });
      const candidates = r.arrangement.rotations.map((rot, i) => rot.backRow[2] && r.libero.replaces.includes(rot.backRow[2].positions[0]) ? i : null).filter(x => x !== null);
      return { serveRot: r.libero.serveRot, serving, candidates };
    }, ms12);
    expect(out.candidates.length).toBeGreaterThanOrEqual(2); // two middles opposite each other
    expect(out.serveRot).toBe(out.candidates[0]);
    expect(out.serving.filter(Boolean)).toHaveLength(1);
    expect(out.serving[out.serveRot]).toBe(true);
  });

  test('the coach can pick the other serving spot', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      const r0 = window.generateLineup(window.S);
      const candidates = r0.arrangement.rotations.map((rot, i) => rot.backRow[2] && r0.libero.replaces.includes(rot.backRow[2].positions[0]) ? i : null).filter(x => x !== null);
      window.S.lineup.liberoConfig.servesInRotation = candidates[1];
      const r1 = window.generateLineup(window.S);
      return { picked: candidates[1], serveRot: r1.libero.serveRot };
    }, ms12);
    expect(out.serveRot).toBe(out.picked);
  });
});

test.describe('setters play the front row only', () => {
  test('both setters get a passer first, then everybody-plays continues', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      window.S.lineup.setterFrontOnly = true;
      const r = window.generateLineup(window.S);
      const plan = window.planEverybodyPlays(window.S, r);
      const setterIds = r.starters.S.map(p => p.id);
      return {
        setterIds,
        first2Out: plan.patterns.slice(0, 2).map(p => p.out),
        first2Flag: plan.patterns.slice(0, 2).map(p => !!p.setterSub),
        total: plan.patterns.length,
        subsUsed: plan.subsUsed,
        distinctIn: new Set(plan.patterns.map(p => p.in.id)).size
      };
    }, ms12);
    expect(out.first2Out.sort()).toEqual(out.setterIds.sort());
    expect(out.first2Flag).toEqual([true, true]);
    expect(out.total).toBe(5);            // 5 bench players, all still used
    expect(out.distinctIn).toBe(5);       // each setter has her own passer
    expect(out.subsUsed).toBe(10);
  });
});

test.describe('coach subs by drag', () => {
  test('a drag in rotation 3 is a sub from there through rotation 6; rotation 1 is untouched', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      const setup = (roster) => {
        window.S.players = roster;
        window.S.settings.system = '4-2';
        window.S.settings.level = 'ms';
        window.S.lineup.everybodyPlays = false;
        window.S.lineup.subPatterns = [];
        window.runGenerate({ fresh: true });
        const r = window.S.result;
        const onFloor = new Set(r.arrangement.startOrder.map(p => p.id)); onFloor.add(r.libero.player.id);
        const bench = window.S.players.filter(p => !onFloor.has(p.id));
        return { r, bench };
      };
      const zoneOf = (idx, playerId) => {
        const eff = window.courtEffective(idx);
        for (const z of [1, 2, 3, 4, 5, 6]) { const p = window.playerAtZone(eff, z); if (p && p.id === playerId) return z; }
        return null;
      };
      const floorAt = i => { const e = window.courtEffective(i); return e.frontRow.concat(e.backRow).filter(Boolean).map(p => p.id); };

      const { r, bench } = setup(roster);
      const starter = r.arrangement.startOrder.find(p => p.positions[0] === 'OH'); // an outside: never replaced by the libero
      const ok = window.coachSubDrop(2, zoneOf(2, starter.id), bench[0].id);
      const pat = window.S.lineup.subPatterns.find(p => p.coach);
      return { ok, trigger: pat.trigger.rotationIndex, ret: pat.return.rotationIndex,
        subIn3: floorAt(2).includes(bench[0].id), subIn6: floorAt(5).includes(bench[0].id), subIn1: floorAt(0).includes(bench[0].id),
        starterIn1: floorAt(0).includes(starter.id), starterIn3: floorAt(2).includes(starter.id),
        boardUnchanged: window.S.lineup.board.startOrder.includes(starter.id) && !window.S.lineup.board.startOrder.includes(bench[0].id) };
    }, ms12);
    expect(out.ok).toBe(true);
    expect(out.trigger).toBe(2);
    expect(out.ret).toBe(0);
    expect(out).toMatchObject({ subIn3: true, subIn6: true, subIn1: false, starterIn1: true, starterIn3: false, boardUnchanged: true });
  });

  test('dragging the starter back onto her sub ends the sub there; same-spot rule refuses other spots', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      const setup = (roster) => {
        window.S.players = roster;
        window.S.settings.system = '4-2';
        window.S.settings.level = 'ms';
        window.S.lineup.everybodyPlays = false;
        window.S.lineup.subPatterns = [];
        window.runGenerate({ fresh: true });
        const r = window.S.result;
        const onFloor = new Set(r.arrangement.startOrder.map(p => p.id)); onFloor.add(r.libero.player.id);
        const bench = window.S.players.filter(p => !onFloor.has(p.id));
        return { r, bench };
      };
      const zoneOf = (idx, playerId) => {
        const eff = window.courtEffective(idx);
        for (const z of [1, 2, 3, 4, 5, 6]) { const p = window.playerAtZone(eff, z); if (p && p.id === playerId) return z; }
        return null;
      };
      const floorAt = i => { const e = window.courtEffective(i); return e.frontRow.concat(e.backRow).filter(Boolean).map(p => p.id); };

      const { r, bench } = setup(roster);
      const starter = r.arrangement.startOrder.find(p => p.positions[0] === 'OH'); // an outside: never replaced by the libero
      const other = r.arrangement.startOrder.find(p => p.id !== starter.id && p.positions[0] === 'OH');
      window.coachSubDrop(1, zoneOf(1, starter.id), bench[0].id);
      const before = window.S.lineup.subPatterns.length;
      const wrongSpot = window.coachSubDrop(3, zoneOf(3, other.id), starter.id);
      const back = window.coachSubDrop(4, zoneOf(4, bench[0].id), starter.id);
      const pat = window.S.lineup.subPatterns.find(p => p.coach);
      return { wrongSpot, back, count: window.S.lineup.subPatterns.length, before, ret: pat.return.rotationIndex,
        starterBack5: floorAt(4).includes(starter.id), subGone5: !floorAt(4).includes(bench[0].id), subIn4: floorAt(3).includes(bench[0].id) };
    }, ms12);
    expect(out.wrongSpot).toBe(false);
    expect(out.back).toBe(true);
    expect(out.count).toBe(out.before);
    expect(out.ret).toBe(4);
    expect(out).toMatchObject({ starterBack5: true, subGone5: true, subIn4: true });
  });

  test('the everybody-plays plan works around coach subs', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      const setup = (roster) => {
        window.S.players = roster;
        window.S.settings.system = '4-2';
        window.S.settings.level = 'ms';
        window.S.lineup.everybodyPlays = false;
        window.S.lineup.subPatterns = [];
        window.runGenerate({ fresh: true });
        const r = window.S.result;
        const onFloor = new Set(r.arrangement.startOrder.map(p => p.id)); onFloor.add(r.libero.player.id);
        const bench = window.S.players.filter(p => !onFloor.has(p.id));
        return { r, bench };
      };
      const zoneOf = (idx, playerId) => {
        const eff = window.courtEffective(idx);
        for (const z of [1, 2, 3, 4, 5, 6]) { const p = window.playerAtZone(eff, z); if (p && p.id === playerId) return z; }
        return null;
      };
      const floorAt = i => { const e = window.courtEffective(i); return e.frontRow.concat(e.backRow).filter(Boolean).map(p => p.id); };

      const { r, bench } = setup(roster);
      const starter = r.arrangement.startOrder.find(p => p.positions[0] === 'OH'); // an outside: never replaced by the libero
      window.coachSubDrop(2, zoneOf(2, starter.id), bench[0].id);
      const plan = window.planEverybodyPlays(window.S, window.S.result);
      return { outs: plan.patterns.map(p => p.out), ins: plan.patterns.map(p => p.in.id), starter: starter.id, sub: bench[0].id, subsUsed: plan.subsUsed };
    }, ms12);
    expect(out.outs).not.toContain(out.starter);
    expect(out.ins).not.toContain(out.sub);
    expect(out.subsUsed).toBe(2 + out.outs.length * 2);
  });
});

test.describe('libero covers players', () => {
  test('dragging the libero onto a starter makes her cover that starter only', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster;
      window.S.settings.system = '4-2';
      window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false;
      window.runGenerate({ fresh: true });
      const r0 = window.S.result;
      const seeded = window.S.lineup.liberoConfig.covers.slice();
      const outside = r0.arrangement.startOrder.find(p => p.positions[0] === 'OH');
      // find a rotation + zone where that outside is on the floor
      let zone = null, idx = null;
      for (let i = 0; i < 6 && zone == null; i++) { const e = window.courtEffective(i); for (const z of [1,2,3,4,5,6]) { const p = window.playerAtZone(e, z); if (p && p.id === outside.id) { zone = z; idx = i; break; } } }
      window.liberoCoverDrop(idx, zone);
      const r1 = window.S.result;
      const libId = r1.libero.player.id;
      const where = [0,1,2,3,4,5].map(i => { const e = window.courtEffective(i); const ids = e.backRow.filter(Boolean).map(p => p.id); return ids.includes(libId); });
      const outsideBack = [0,1,2,3,4,5].map(i => r1.arrangement.rotations[i].backRow.some(p => p && p.id === outside.id));
      return { seededCount: seeded.length, covers: window.S.lineup.liberoConfig.covers, outside: outside.id, where, outsideBack, benchHasLibero: [...document.querySelectorAll('#benchList .bench-item-libero')].length };
    }, ms12);
    expect(out.seededCount).toBe(2);                          // both middles after Suggest
    expect(out.covers).toEqual(out.seededCount ? [...out.covers] : []);
    expect(out.covers).toContain(out.outside);
    expect(out.covers).toHaveLength(3);
    expect(out.benchHasLibero).toBe(1);
    // wherever the outside is in the back row, the libero is on the floor (unless the serve rule holds her out)
    const serveHeld = out.where.filter((w, i) => out.outsideBack[i] && !w).length;
    expect(serveHeld).toBeLessThanOrEqual(1);
  });
});

test.describe('coach subs cannot overlap', () => {
  test('a later sub for the same player blocks an earlier overlapping one, and the floor never seats her twice', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster; window.S.settings.system = '4-2'; window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false; window.S.lineup.subPatterns = [];
      window.runGenerate({ fresh: true });
      const r = window.S.result; const onFloor = new Set(r.arrangement.startOrder.map(p => p.id)); onFloor.add(r.libero.player.id);
      const bench = window.S.players.filter(p => !onFloor.has(p.id));
      const zoneOf = (idx, id) => { const e = window.courtEffective(idx); for (const z of [1,2,3,4,5,6]) { const p = window.playerAtZone(e, z); if (p && p.id === id) return z; } return null; };
      const [A, B] = r.arrangement.startOrder.filter(p => p.positions[0] === 'OH');
      const darcy = bench[0];
      const first = window.coachSubDrop(4, zoneOf(4, A.id), darcy.id);      // Darcy in for A from rotation 5
      const second = window.coachSubDrop(1, zoneOf(1, B.id), darcy.id);     // Darcy in for B from rotation 2 -> would overlap at 5-6
      const count = window.S.lineup.subPatterns.filter(p => p.coach).length;
      // force an overlapping pair straight into state to prove the floor guard
      window.S.lineup.subPatterns.push({ id: 'x', out: B.id, in: darcy, trigger: { rotationIndex: 1, event: 'in' }, return: { rotationIndex: 0, event: 'in' }, coach: true });
      window.runGenerate();
      const dup = [0,1,2,3,4,5].map(i => { const e = window.courtEffective(i); return e.frontRow.concat(e.backRow).filter(p => p && p.id === darcy.id).length; });
      return { first, second, count, dup };
    }, ms12);
    expect(out.first).toBe(true);
    expect(out.second).toBe(false);
    expect(out.count).toBe(1);
    for (const n of out.dup) expect(n).toBeLessThanOrEqual(1);
  });
});

test.describe('guided tour', () => {
  test('walks every step on the sample roster without getting stuck', async ({ page }) => {
    const out = await page.evaluate(async () => {
      localStorage.removeItem('court_iq_covenant_tour');
      window.S.players = [];
      window.startTour();
      const visited = [];
      let guard = 0;
      while (guard++ < 60) {
        const st = window.tourState();
        if (!st) break;
        visited.push({ i: st.i, target: st.target, hasTarget: st.hasTarget });
        if (st.last) { window.tourGo(1); break; }
        if (st.doClick) {
          document.querySelector(st.target).click();
          await new Promise(r => setTimeout(r, 700));
        } else {
          window.tourGo(1);
          await new Promise(r => setTimeout(r, 60));
        }
      }
      return { visited, ended: window.tourState() === null, players: window.S.players.length, hasLineup: !!(window.S.result && window.S.result.arrangement), rot: window.S.viewRot, done: localStorage.getItem('court_iq_covenant_tour') };
    });
    expect(out.ended).toBe(true);
    expect(out.players).toBe(12);            // sample roster was loaded for the tour
    expect(out.hasLineup).toBe(true);        // the "tap Suggest" step really generated
    expect(out.rot).toBe(1);                 // the "tap Rotate" step really rotated
    expect(out.done).toBe('done');
    const missing = out.visited.filter(v => v.target && !v.hasTarget);
    expect(missing).toEqual([]);             // every spotlighted control existed
    expect(out.visited.length).toBeGreaterThanOrEqual(19);
  });
});

test.describe('bench shows the starter the libero is in for', () => {
  test('she is listed, highlighted, and not draggable; the count matches the floor', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster; window.S.settings.system = '4-2'; window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false; window.S.lineup.subPatterns = [];
      window.runGenerate({ fresh: true });
      const r = window.S.result;
      const perRot = [0,1,2,3,4,5].map(i => {
        window.S.viewRot = i; window.renderLineup();
        const eff = window.courtEffective(i);
        const floor = new Set(eff.frontRow.concat(eff.backRow).filter(Boolean).map(p => p.id));
        const offFloor = r.arrangement.startOrder.filter(p => p && !floor.has(p.id)).map(p => p.name);
        const cards = [...document.querySelectorAll('#benchList .bench-item-covered')].map(li => ({ name: li.querySelector('.bench-name').textContent, role: li.querySelector('.bench-role').textContent }));
        const plain = [...document.querySelectorAll('#benchList .bench-item:not(.bench-item-covered):not(.bench-item-libero) .bench-name')].map(e => e.textContent);
        return { offFloor, cards, plain };
      });
      return { perRot, libero: r.libero.player.name };
    }, ms12);
    let covered = 0;
    for (const rot of out.perRot) {
      expect(rot.cards.map(c => c.name).sort()).toEqual(rot.offFloor.slice().sort());
      for (const c of rot.cards) { expect(c.role).toContain(out.libero); expect(rot.plain).not.toContain(c.name); }
      covered += rot.cards.length;
    }
    expect(covered).toBeGreaterThan(0);
  });
});

test.describe('saved lineups', () => {
  test('save, edit, load back, update, delete', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster; window.S.settings.system = '4-2'; window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false; window.S.lineup.subPatterns = [];
      window.runGenerate({ fresh: true });
      const zoneOf = (idx, id) => { const e = window.courtEffective(idx); for (const z of [1,2,3,4,5,6]) { const p = window.playerAtZone(e, z); if (p && p.id === id) return z; } return null; };
      const r = window.S.result; const onFloor = new Set(r.arrangement.startOrder.map(p => p.id)); onFloor.add(r.libero.player.id);
      const bench = window.S.players.filter(p => !onFloor.has(p.id));
      const A = r.arrangement.startOrder.find(p => p.positions[0] === 'OH');
      const subOk = window.coachSubDrop(3, zoneOf(3, A.id), bench[0].id);   // a coach sub from rotation 4 on
      const orig = window.S.lineup.board.startOrder.slice();
      const beforeSave = window.hasUnsavedLineup();
      const sv = window.saveLineupAs('Starting six A');
      const afterSave = window.savedLineupStatus(sv);
      const cards = document.querySelectorAll('#savedStrip .saved-card').length;
      // edit the court: swap two starters, switch systems
      window.boardSwap(0, 1, 0, 2); window.runGenerate();
      const afterEdit = window.savedLineupStatus(sv);
      const updateBtn = !!document.querySelector('#savedStrip .saved-card.is-edited .btn-primary');
      window.S.settings.system = 'simple'; window.runGenerate();
      const changed = window.S.lineup.board.startOrder.slice();
      // bring the card back
      window.loadSavedLineup(sv.id);
      const back = { order: window.S.lineup.board.startOrder.slice(), system: window.S.settings.system, subs: window.coachPatterns().length, status: window.savedLineupStatus(sv), unsaved: window.hasUnsavedLineup(), rot: window.S.viewRot };
      // edit again, then overwrite the card
      window.boardSwap(0, 1, 0, 2); window.runGenerate();
      const editedAgain = window.savedLineupStatus(sv).edited;
      window.updateSavedLineup(sv.id);
      const afterUpdate = { status: window.savedLineupStatus(sv), order: window.savedLineupById(sv.id).startOrder.slice() };
      window.renameSavedLineup(sv.id, 'vs. Trinity');
      const renamed = window.savedLineupById(sv.id).name;
      window.deleteSavedLineup(sv.id);
      return { subOk, orig, beforeSave, afterSave, cards, afterEdit, updateBtn, changed, back, editedAgain, afterUpdate, renamed, left: window.S.lineup.saved.length, loadedId: window.S.lineup.loadedSavedId, shelfHidden: document.querySelector('#savedShelf').hidden };
    }, ms12);
    expect(out.subOk).toBe(true);
    expect(out.beforeSave).toBe(true);
    expect(out.afterSave).toMatchObject({ loaded: true, edited: false, gone: 0 });
    expect(out.cards).toBe(1);
    expect(out.afterEdit.edited).toBe(true);
    expect(out.updateBtn).toBe(true);
    expect(out.changed).not.toEqual(out.orig);
    expect(out.back.order).toEqual(out.orig);
    expect(out.back.system).toBe('4-2');
    expect(out.back.subs).toBe(1);
    expect(out.back.status.edited).toBe(false);
    expect(out.back.unsaved).toBe(false);
    expect(out.back.rot).toBe(0);
    expect(out.editedAgain).toBe(true);
    expect(out.afterUpdate.status.edited).toBe(false);
    expect(out.afterUpdate.order).not.toEqual(out.orig);
    expect(out.renamed).toBe('vs. Trinity');
    expect(out.left).toBe(0);
    expect(out.loadedId).toBeNull();
    expect(out.shelfHidden).toBe(true);
  });

  test('a card whose player left the roster still loads, with a hole and a warning', async ({ page }) => {
    const out = await page.evaluate((roster) => {
      window.S.players = roster; window.S.settings.system = '4-2'; window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false; window.S.lineup.subPatterns = [];
      window.runGenerate({ fresh: true });
      const sv = window.saveLineupAs('Old six');
      const goneId = window.S.lineup.board.startOrder[2];
      window.S.players = window.S.players.filter(p => p.id !== goneId);
      window.S.lineup.board = null; window.runGenerate({ fresh: true });   // a different six now
      const status = window.savedLineupStatus(sv);
      window.loadSavedLineup(sv.id);
      const warn = document.querySelector('#savedStrip .saved-card .saved-card-warn');
      return { gone: status.gone, holes: window.S.result.holes, error: window.S.result.error || null, warn: warn ? warn.textContent : null };
    }, ms12);
    expect(out.gone).toBe(1);
    expect(out.error).toBeNull();
    expect(out.holes).toBe(1);
    expect(out.warn).toContain('no longer on the roster');
  });

  test('the shelf travels in the share link', async ({ page }) => {
    const hash = await page.evaluate((roster) => {
      window.S.players = roster; window.S.settings.system = '4-2'; window.S.settings.level = 'ms';
      window.S.lineup.everybodyPlays = false; window.S.lineup.subPatterns = [];
      window.runGenerate({ fresh: true });
      window.saveLineupAs('vs. Trinity');
      window.save();
      return window.encodeStateForUrl();
    }, ms12);
    await page.goto('/README.md');                 // leave the page so the link is a real load
    await page.evaluate(() => localStorage.clear());
    await page.goto('/#d=' + hash);
    const out = await page.evaluate(() => {
      const sv = window.S.lineup.saved[0];
      return { n: window.S.lineup.saved.length, name: sv && sv.name, status: sv && window.savedLineupStatus(sv), cards: document.querySelectorAll('#savedStrip .saved-card').length, onCourt: !!document.querySelector('#savedStrip .saved-card.is-loaded') };
    });
    expect(out.n).toBe(1);
    expect(out.name).toBe('vs. Trinity');
    expect(out.status).toMatchObject({ loaded: true, edited: false, gone: 0 });
    expect(out.cards).toBe(1);
    expect(out.onCourt).toBe(true);
  });
});
