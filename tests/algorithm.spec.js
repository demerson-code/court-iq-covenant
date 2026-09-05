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
    window.S.lineup.liberoConfig = { playerId: null, replaces: ['MB'], servesInRotation: null };
    window.S.lineup.planExclude = {};
    window.S.lineup.everybodyPlays = true;
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
