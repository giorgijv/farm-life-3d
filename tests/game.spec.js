const { test, expect } = require('@playwright/test');

const SAVE_KEY = 'farmLife3dSave_v1';
const LEGACY_KEY = 'farmLife3dSave_v0';
/** Pre-unlocking every award keeps reward payouts out of coin arithmetic. */
const ACHIEVEMENT_IDS = [
  'first_harvest', 'green_thumb', 'master_farmer', 'rancher', 'poultry_farmer',
  'shepherd', 'full_barn', 'full_house', 'wealthy_farmer', 'week_one', 'big_business',
];
const DAY_LENGTH_MS = 90_000;
const FARMER_MEAL_MS = 3 * DAY_LENGTH_MS;
const FARMER_COLLAPSE_MS = 4 * DAY_LENGTH_MS;
const PLOT_COUNT = 16;

/** A complete, current-shape save. Muted so tests never open an AudioContext. */
function makeSave(overrides = {}) {
  return {
    coins: 100,
    day: 1,
    dayElapsedMs: 0,
    selectedSeed: null,
    unlockedPlots: 8,
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    cows: [],
    chickens: [],
    sheep: [],
    nextAnimalId: 1,
    inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    stats: { totalHarvested: 0, totalCoinsEarned: 0 },
    unlockedAchievements: [],
    upgrades: { sprinkler: 0, feed: 0, fertiliser: 0, contacts: 0 },
    muted: true,
    musicOn: false,
    volume: 0.7,
    onboarded: true,
    // A farmer must be chosen before anything else is reachable, so every
    // fixture starts with one picked and fed.
    farmer: 'female',
    farmerFedUntil: Date.now() + FARMER_MEAL_MS,
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

/**
 * Puts a save in place *before* any page script runs, then loads the game.
 *
 * Seeding after load and reloading does not work: the outgoing page commits
 * its own state on pagehide, overwriting whatever the test just wrote. The
 * nonce makes seeding happen once per load() call, so a later reload in the
 * same test keeps whatever the game itself saved.
 *
 * Timestamps written by secondsAgo() are resolved here rather than in Node,
 * because "twelve seconds ago" has to mean twelve seconds before the *game*
 * boots. Resolving them when the fixture is authored instead charges the
 * clock for however long the page then took to start — measured at 1.6s to
 * 5.0s on a loaded four-worker run — which silently ages every animal and
 * crop the test seeded. See secondsAgo() below.
 */
let seedCounter = 0;
async function load(page, save, key = SAVE_KEY) {
  if (save !== undefined) {
    const nonce = `__seeded_${(seedCounter += 1)}`;
    await page.addInitScript(([k, v, n]) => {
      if (sessionStorage.getItem(n)) return;
      const now = Date.now() / 1000;
      const resolve = (node) => {
        if (Array.isArray(node)) return node.map(resolve);
        if (node && typeof node === 'object') {
          if (typeof node.__agoSeconds === 'number') return now - node.__agoSeconds;
          return Object.fromEntries(
            Object.entries(node).map(([field, val]) => [field, resolve(val)]),
          );
        }
        return node;
      };
      localStorage.clear();
      // A save passed as a string is raw fixture text — usually deliberate
      // garbage — so it is stored exactly as written.
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(resolve(v)));
      sessionStorage.setItem(n, '1');
    }, [key, save, nonce]);
  }
  await page.goto('/');
  await page.waitForSelector('#plotsGrid .plot');
}

/** Reads the persisted save, yielding null rather than throwing on garbage. */
const readSave = (page) =>
  page.evaluate((k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  }, SAVE_KEY);

const coins = async (page) => (await readSave(page)).coins;
const inventory = async (page) => (await readSave(page)).inventory;

/**
 * A fixture timestamp, as a marker rather than a number: load() turns it into
 * `now - s` in the browser, at the instant the game boots.
 *
 * It reads as a plain value at every call site and survives JSON.stringify as
 * one, so nothing downstream knows the difference. Use it only inside a save
 * handed to load(); anywhere else — setting a field through page.evaluate on
 * an already-loaded page, say — the page's own clock is right there, so write
 * the arithmetic out instead.
 */
const secondsAgo = (s) => ({ __agoSeconds: s });

/**
 * Activates a plot button.
 *
 * Since step 6 the field is driven and acted on through the proximity prompt,
 * so these sixteen buttons no longer take pointer input at all — a press on
 * the canvas belongs to the stick or to an orbit drag. What they still are is
 * the keyboard's way of sending her to a tile, so this exercises them the way
 * a keyboard does: the element's own click handler, rather than a synthesised
 * mouse press that would now land on the scene behind them.
 */
const tapPlot = (locator) => locator.dispatchEvent('click');

/**
 * Waits until the farmer has finished everything she has been asked to do.
 *
 * Tapping a plot no longer works it: it sends her walking, and the rules run
 * when she arrives. Assertions that used to read the save on the line after a
 * click need this in between. It waits on the queue rather than a stopwatch,
 * so it is as fast as the walk and never flaky, and it is a no-op when there
 * is no scene (or the player asked for reduced motion, which skips the walk).
 */
const worked = (page) => page.waitForFunction(
  () => !window.Farm3DScene || window.Farm3DScene.pendingActions() === 0,
);

/* ------------------------------------------------------------------ */
/* Core loop                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* How to play, and readable messages                                  */
/* ------------------------------------------------------------------ */

test.describe('explanations', () => {
  const helpPanel = (page) => page.locator('#helpPanel');

  test('a help panel explains every system in the game', async ({ page }) => {
    await load(page, makeSave());
    await expect(helpPanel(page)).toBeHidden();

    await page.locator('#helpBtn').click();
    await expect(helpPanel(page)).toBeVisible();

    const text = await page.locator('#helpBody').textContent();
    // Every system the player can run into should be covered somewhere.
    for (const topic of [
      'dream home', 'exhausted', 'seed', 'rots', 'produce',
      'starves', 'Wolves', 'upgrades', 'achievements', 'day passes', 'saves',
    ]) {
      expect(text, `help should mention "${topic}"`).toContain(topic);
    }
  });

  test('the help text quotes the same numbers the game enforces', async ({ page }) => {
    await load(page, makeSave());
    await page.locator('#helpBtn').click();
    const text = await page.locator('#helpBody').textContent();

    // Pulled from the live constants, so the two cannot drift apart.
    const facts = await page.evaluate(() => ({
      spoil: `${CROP_SPOIL_DAYS} days`,
      starve: `${ANIMAL_STARVE_DAYS} days`,
      capacity: `covers ${GUARD_CAPACITY}`,
      house: DREAM_HOMES.house.cost.toLocaleString('en-GB'),
      villa: DREAM_HOMES.villa.cost.toLocaleString('en-GB'),
      cowShift: `${DOG_PREY.cow.shiftTime}s`,
    }));
    Object.entries(facts).forEach(([name, value]) => {
      expect(text, `help should quote ${name}`).toContain(value);
    });
  });

  test('the help panel closes again', async ({ page }) => {
    await load(page, makeSave());
    await page.locator('#helpBtn').click();
    await expect(helpPanel(page)).toBeVisible();

    await page.locator('#helpCloseBtn').click();
    await expect(helpPanel(page)).toBeHidden();

    // Escape works too, for anyone on a keyboard.
    await page.locator('#helpBtn').click();
    await expect(helpPanel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(helpPanel(page)).toBeHidden();
  });

  test('messages stay up long enough to read, and longer ones stay longer', async ({ page }) => {
    await load(page, makeSave());

    const [short, long] = await page.evaluate(() => [
      toastDuration('Sold.'),
      toastDuration('x'.repeat(90)),
    ]);
    // The old fixed 1600ms was too brief for anything but a glance.
    expect(short).toBeGreaterThanOrEqual(2000);
    expect(long).toBeGreaterThan(short);
  });

  test('a toast never swallows a tap meant for the field beneath it', async ({ page }) => {
    await load(page, makeSave({ selectedSeed: null }));

    // Messages linger now, so they must stay click-through or they would block
    // the plots they sit over.
    await tapPlot(page.locator('#plotsGrid .plot.empty').first());
    await expect(page.locator('#toast')).toBeVisible();
    expect(await page.evaluate(() =>
      getComputedStyle(document.getElementById('toast')).pointerEvents)).toBe('none');
  });

  test('a lost crop says what would have prevented it', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(3) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.evaluate(() => { state.nextPestRaidAt = Date.now(); updateRaids(); });
    await expect(page.locator('#toast')).toContainText('A fed cat would have kept them off');
  });

  test('a lost animal says what would have prevented it', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));

    await page.evaluate(() => { state.nextWolfRaidAt = Date.now(); updateRaids(); });
    await expect(page.locator('#toast')).toContainText('A fed dog would have chased it off');
  });

  test('a halved harvest says why it was halved', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(60) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      farmerFedUntil: Date.now() - 1,
      unlockedAchievements: [...ACHIEVEMENT_IDS], // else an award toast lands on top
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await expect(page.locator('#toast')).toContainText('the farmer is exhausted');
  });

  test('clearing a rotten plot explains the shelf life that was missed', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(60), spoilsAt: Date.now() - 1, rotten: true },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await expect(page.locator('#toast')).toContainText('ripe crops keep for');
  });
});

/* ------------------------------------------------------------------ */
/* Hurricanes and barns                                                */
/* ------------------------------------------------------------------ */

test.describe('hurricanes', () => {
  const HURRICANE_DAYS = 56;
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });

  const fullFarm = (o = {}) => banked({
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: 'wheat', plantedAt: secondsAgo(3) })),
    cows: [1, 2, 3].map((id) => ({ id, state: 'hungry', feedAt: null })),
    chickens: [4, 5].map((id) => ({ id, state: 'hungry', feedAt: null })),
    sheep: [6].map((id) => ({ id, state: 'hungry', feedAt: null })),
    nextAnimalId: 10,
    ...o,
  });

  /** Runs the storm the way a tick would, without waiting 84 minutes for it. */
  const storm = (page) => page.evaluate((d) => {
    state.day = d + 1;
    /* Jumping the calendar leaves eight weeks of subsidy formally unpaid, so
       the next tick pays them and its toast pushes the storm's own report off
       the screen — which cannot happen in a real run, where a tick settles the
       subsidy before it resolves the storm. Settle the books here rather than
       pay them, so the coin arithmetic these tests do is untouched. */
    state.subsidiesPaid = weeksSurvived();
    updateHurricane();
    render();
  }, HURRICANE_DAYS);

  const counts = async (page) => {
    const s = await readSave(page);
    return {
      planted: s.plots.filter((p) => p.crop).length,
      animals: s.cows.length + s.chickens.length + s.sheep.length + s.dogs.length + s.cats.length,
      coins: s.coins,
      inventory: s.inventory,
      seen: s.hurricanesSeen,
    };
  };

  test('the first storm lands after eight weeks, not before', async ({ page }) => {
    await load(page, fullFarm({ day: HURRICANE_DAYS }));  // day 56: still clear
    await page.waitForTimeout(1200);
    expect((await counts(page)).planted).toBe(PLOT_COUNT);

    await storm(page);
    expect((await counts(page)).planted).toBe(0);
    expect((await counts(page)).seen).toBe(1);
  });

  test('every crop is lost and nothing protects a field', async ({ page }) => {
    await load(page, fullFarm({ barn: 'large' }));   // the biggest barn there is
    await storm(page);

    const c = await counts(page);
    expect(c.planted, 'a barn must not save crops').toBe(0);
    expect(c.animals, 'the large barn should shelter this herd').toBe(6);
  });

  test('without a barn the whole herd is lost', async ({ page }) => {
    await load(page, fullFarm());
    await storm(page);

    const c = await counts(page);
    expect(c.animals).toBe(0);
    await expect(page.locator('#toast')).toContainText('hurricane hit the farm');
  });

  test('a small barn shelters ten, and the rest are lost', async ({ page }) => {
    await load(page, banked({
      barn: 'small',
      cows: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, state: 'hungry', feedAt: null })),
      chickens: Array.from({ length: 6 }, (_, i) => ({ id: i + 20, state: 'hungry', feedAt: null })),
      nextAnimalId: 40,
    }));

    await storm(page);

    const s = await readSave(page);
    expect(s.cows.length + s.chickens.length).toBe(10);
    // Dearest first: all eight cows shelter before any chicken does.
    expect(s.cows).toHaveLength(8);
    expect(s.chickens).toHaveLength(2);
  });

  test('coins are never touched', async ({ page }) => {
    await load(page, fullFarm({ coins: 7500 }));
    await storm(page);
    expect((await counts(page)).coins).toBe(7500);
  });

  test('harvested goods blow away without the large barn', async ({ page }) => {
    const inventory = { wheat: 12, corn: 5, carrot: 3, pumpkin: 7, milk: 4, egg: 9, wool: 2 };

    // No barn at all.
    await load(page, fullFarm({ inventory: { ...inventory } }));
    await storm(page);
    expect(Object.values((await counts(page)).inventory).reduce((a, b) => a + b, 0)).toBe(0);

    // The small barn is stalls, not storage — the herd lives, the stores do not.
    await load(page, fullFarm({ barn: 'small', inventory: { ...inventory } }));
    await storm(page);
    const small = await counts(page);
    expect(Object.values(small.inventory).reduce((a, b) => a + b, 0)).toBe(0);
    expect(small.animals, 'the small barn should still save the herd').toBe(6);
  });

  test('the large barn keeps the stores as well as the herd', async ({ page }) => {
    const inventory = { wheat: 12, corn: 5, carrot: 3, pumpkin: 7, milk: 4, egg: 9, wool: 2 };
    await load(page, fullFarm({ barn: 'large', inventory: { ...inventory } }));

    await storm(page);

    const c = await counts(page);
    expect(c.inventory).toEqual(inventory);
    expect(c.animals).toBe(6);
    expect(c.planted, 'not even the large barn saves a field').toBe(0);
  });

  test('an empty farm weathers it with nothing to lose', async ({ page }) => {
    await load(page, banked({ coins: 300 }));
    await storm(page);

    const c = await counts(page);
    expect(c.coins).toBe(300);
    expect(c.seen).toBe(1);
  });

  test('one storm per cycle, however many ticks pass', async ({ page }) => {
    await load(page, fullFarm());
    await storm(page);
    await page.waitForTimeout(1500);   // several more ticks at the same day

    expect((await counts(page)).seen).toBe(1);
  });

  test('a save from before hurricanes is not hit by every storm it missed', async ({ page }) => {
    const old = fullFarm({ day: 200 });
    delete old.hurricanesSeen;
    await load(page, old);
    await page.waitForTimeout(1200);

    const c = await counts(page);
    expect(c.planted, 'no retroactive storms').toBe(PLOT_COUNT);
    expect(c.seen).toBe(3);   // (200 - 1) / 56
  });

  test('the forecast counts down and warns when the herd is exposed', async ({ page }) => {
    await load(page, fullFarm({ day: HURRICANE_DAYS - 1 }));
    await page.getByRole('button', { name: /Market/ }).click();

    const forecast = page.locator('#barnForecast');
    await expect(forecast).toContainText(`day ${HURRICANE_DAYS + 1}`);
    await expect(forecast).toContainText('No barn');
    await expect(forecast).toContainText('blow away');
    await expect(forecast).toHaveClass(/warning/);
    await expect(page.locator('#toast')).toContainText('Storm warning');
  });
});

test.describe('barns', () => {
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });
  const barnBtn = (page, i) => page.locator('#barnList .barn-card').nth(i).locator('.barn-btn');
  const openMarket = (page) => page.getByRole('button', { name: /Market/ }).click();

  test('both barns are offered at their prices', async ({ page }) => {
    await load(page, banked({ coins: 0 }));
    await openMarket(page);

    await expect(page.locator('#barnList .barn-card')).toHaveCount(2);
    await expect(page.locator('#barnList .barn-card').nth(0)).toContainText('Shelters 10 animals');
    await expect(barnBtn(page, 0)).toContainText('10,000');
    await expect(page.locator('#barnList .barn-card').nth(0)).toContainText('Stalls only');
    await expect(page.locator('#barnList .barn-card').nth(1)).toContainText('Shelters 30 animals');
    await expect(page.locator('#barnList .barn-card').nth(1)).toContainText('harvested');
    await expect(barnBtn(page, 1)).toContainText('30,000');
  });

  test('a barn cannot be built without the coins', async ({ page }) => {
    await load(page, banked({ coins: 9999 }));
    await openMarket(page);

    await expect(barnBtn(page, 0)).toBeDisabled();
    await expect(barnBtn(page, 1)).toBeDisabled();
    expect((await readSave(page)).barn).toBeNull();
  });

  test('building the small barn costs 10,000', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await load(page, banked({ coins: 10500 }));
    await openMarket(page);

    await barnBtn(page, 0).click();

    const s = await readSave(page);
    expect(s.barn).toBe('small');
    expect(s.coins).toBe(500);
    await expect(barnBtn(page, 0)).toContainText('Built');
  });

  test('upgrading to the large barn only costs the difference', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await load(page, banked({ coins: 20000, barn: 'small' }));
    await openMarket(page);

    // 30,000 less the 10,000 already sunk into the small barn.
    await expect(barnBtn(page, 1)).toContainText('20,000');
    await barnBtn(page, 1).click();

    const s = await readSave(page);
    expect(s.barn).toBe('large');
    expect(s.coins).toBe(0);
  });

  test('the small barn cannot be bought back over the large one', async ({ page }) => {
    await load(page, banked({ coins: 99999, barn: 'large' }));
    await openMarket(page);

    await expect(barnBtn(page, 0)).toBeDisabled();
    await expect(barnBtn(page, 0)).toContainText('out-built');
    await page.evaluate(() => buyBarn('small'));
    expect((await readSave(page)).barn).toBe('large');
  });

  test('declining the confirmation builds nothing', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, banked({ coins: 15000 }));
    await openMarket(page);

    await barnBtn(page, 0).click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.barn).toBeNull();
    expect(s.coins).toBe(15000);
  });

  test('barns cost the same on every tier', async ({ page }) => {
    for (const tier of ['relaxed', 'farmer', 'hard']) {
      await load(page, banked({ difficulty: tier }));
      const costs = await page.evaluate(() => BARN_ORDER.map((k) => BARNS[k].cost));
      expect(costs, `${tier} moved the barn prices`).toEqual([10000, 30000]);
    }
  });

  test('the rules explain the storm and its economics', async ({ page }) => {
    await load(page, banked());
    await page.locator('#helpBtn').click();

    const text = await page.locator('#helpBody').textContent();
    expect(text).toContain('Hurricanes');
    expect(text).toContain('Every 8 weeks');
    expect(text).toContain('day 57');
    expect(text).toContain('Nothing protects a field');
    expect(text).toContain('stalls, not storage');   // what the small barn is not
    expect(text).toContain('keeps your stores');     // what the large barn adds
    expect(text).toContain('10,000');
    expect(text).toContain('30,000');
    // The honest economics: what it costs against what it saves.
    expect(text).toContain('pay for itself');
    expect(text).toContain('9,000');
  });
});

/* ------------------------------------------------------------------ */
/* Difficulty tiers                                                    */
/* ------------------------------------------------------------------ */

test.describe('difficulty', () => {
  const tierBtn = (page, i) => page.locator('#difficultyChoice .difficulty-btn').nth(i);
  const openMarket = (page) => page.getByRole('button', { name: /Market/ }).click();

  test('three tiers are offered, with the middle one the default', async ({ page }) => {
    await load(page, makeSave());
    await openMarket(page);

    await expect(page.locator('#difficultyChoice .difficulty-btn')).toHaveCount(3);
    await expect(tierBtn(page, 0)).toContainText('Relaxed');
    await expect(tierBtn(page, 1)).toContainText('Farmer');
    await expect(tierBtn(page, 2)).toContainText('Hard');

    // A save with no tier recorded is the middle one, so nothing rebalances
    // under an existing player.
    const save = makeSave();
    delete save.difficulty;
    await load(page, save);
    expect((await readSave(page)).difficulty).toBe('farmer');
  });

  test('a tier can be picked and it sticks', async ({ page }) => {
    await load(page, makeSave());
    await openMarket(page);

    await tierBtn(page, 2).click();

    expect((await readSave(page)).difficulty).toBe('hard');
    await expect(tierBtn(page, 2)).toHaveAttribute('aria-pressed', 'true');
    await expect(tierBtn(page, 1)).toHaveAttribute('aria-pressed', 'false');
  });

  test('a new game is asked the question before the first seed', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    await expect(page.locator('#farmerPicker')).toBeVisible();
    await expect(page.locator('#pickerDifficulty .difficulty-btn')).toHaveCount(3);

    // Choosing a tier does not dismiss the picker — only a farmer does.
    await page.locator('#pickerDifficulty .difficulty-btn').first().click();
    await expect(page.locator('#farmerPicker')).toBeVisible();
    expect((await readSave(page)).difficulty).toBe('relaxed');

    await page.locator('.farmer-option').first().click();
    await expect(page.locator('#farmerPicker')).toBeHidden();
  });

  test('the tier moves prices', async ({ page }) => {
    const stock = { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 10, egg: 0, wool: 0 };

    await load(page, makeSave({ difficulty: 'farmer', inventory: { ...stock } }));
    expect(await page.evaluate(() => goodPrice('milk'))).toBe(9);

    await load(page, makeSave({ difficulty: 'relaxed', inventory: { ...stock } }));
    expect(await page.evaluate(() => goodPrice('milk'))).toBe(11); // 9 x 1.25

    await load(page, makeSave({ difficulty: 'hard', inventory: { ...stock } }));
    expect(await page.evaluate(() => goodPrice('milk'))).toBe(7);  // 9 x 0.8
  });

  test('the tier stretches every clock the farm punishes you with', async ({ page }) => {
    const windows = () => page.evaluate(() => ({
      spoil: cropSpoilMs(),
      starve: animalStarveMs(),
      meal: farmerMealMs(),
      collapse: farmerCollapseMs(),
    }));

    await load(page, makeSave({ difficulty: 'farmer' }));
    const mid = await windows();

    await load(page, makeSave({ difficulty: 'relaxed' }));
    const easy = await windows();
    await load(page, makeSave({ difficulty: 'hard' }));
    const hard = await windows();

    for (const k of ['spoil', 'starve', 'meal', 'collapse']) {
      expect(easy[k], `${k} should be roomier on relaxed`).toBe(mid[k] * 2);
      expect(hard[k], `${k} should be tighter on hard`).toBe(mid[k] * 0.5);
    }
  });

  test('the tier changes the subsidy and raid frequency', async ({ page }) => {
    await load(page, makeSave({ difficulty: 'relaxed' }));
    expect(await page.evaluate(() => subsidyAmount())).toBe(150);
    expect(await page.evaluate(() => raidGap(100))).toBeGreaterThan(100);

    await load(page, makeSave({ difficulty: 'hard' }));
    expect(await page.evaluate(() => subsidyAmount())).toBe(50);
    expect(await page.evaluate(() => raidGap(100))).toBeLessThan(100);
  });

  test('the dream homes cost the same on every tier', async ({ page }) => {
    for (const tier of ['relaxed', 'farmer', 'hard']) {
      await load(page, makeSave({ difficulty: tier }));
      const costs = await page.evaluate(() =>
        DREAM_ORDER.map((k) => DREAM_HOMES[k].cost));
      expect(costs, `${tier} should not move the finish line`).toEqual([20000, 40000]);
    }
  });

  test('the help panel reports the tier actually in force', async ({ page }) => {
    await load(page, makeSave({ difficulty: 'hard' }));
    await page.locator('#helpBtn').click();

    const text = await page.locator('#helpBody').textContent();
    expect(text).toContain('Difficulty: Hard');
    expect(text).toContain('1 day to harvest it');   // 2 days halved
    expect(text).toContain('for 2 days starves');    // 4 days halved
    expect(text).toContain('of 50');                 // subsidy halved
  });

  test('switching tier keeps every bar reading the same fraction', async ({ page }) => {
    // Found by the play-tester: deadlines are absolute, so without rescaling a
    // half-full crop jumps to a quarter the moment the window changes under it.
    await load(page, makeSave({
      difficulty: 'hard',
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(600) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));

    const before = await page.evaluate(() => {
      updateSpoilage(); updateStarvation();
      return { crop: freshness(state.plots[0]), cow: fedness(state.cows[0]), farmer: farmerEnergy() };
    });
    const after = await page.evaluate(() => {
      setDifficulty('relaxed');
      return { crop: freshness(state.plots[0]), cow: fedness(state.cows[0]), farmer: farmerEnergy() };
    });

    for (const k of ['crop', 'cow', 'farmer']) {
      expect(Math.abs(after[k] - before[k]), `${k} bar jumped on a tier change`).toBeLessThan(0.05);
    }
  });

  test('starting a new farm keeps the tier you were playing', async ({ page }) => {
    // Losing a farm on Hard is a request for another farm, not an easier game.
    page.on('dialog', (d) => d.accept());
    await load(page, makeSave({ difficulty: 'hard', gameOver: true, coins: 900 }));

    await page.locator('#restartBtn').click();

    const s = await readSave(page);
    expect(s.difficulty).toBe('hard');
    expect(s.coins).toBe(50);   // Hard's opening purse, not the default 100
    expect(s.gameOver).toBe(false);
  });

  test('a farm can be given up and started again from the market', async ({ page }) => {
    const messages = [];
    page.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
    await load(page, makeSave({
      difficulty: 'hard',
      coins: 5400,
      day: 31,
      unlockedPlots: 14,
      // All banked, so a wealth award does not pay out and move the total.
      unlockedAchievements: [...ACHIEVEMENT_IDS],
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
      inventory: { wheat: 9, corn: 9, carrot: 9, pumpkin: 9, milk: 9, egg: 9, wool: 9 },
      upgrades: { sprinkler: 3, feed: 2, fertiliser: 1, contacts: 3 },
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    await page.locator('#newFarmBtn').click();

    // The prompt names what is about to be thrown away, not just "are you sure".
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('Day 31');
    expect(messages[0]).toContain('5,400 coins');
    expect(messages[0]).toContain('14 plots');
    expect(messages[0]).toContain(`${ACHIEVEMENT_IDS.length} of ${ACHIEVEMENT_IDS.length} awards`);
    expect(messages[0]).toContain('cannot be undone');

    const s = await readSave(page);
    expect(s.coins).toBe(50);          // Hard's opening purse
    expect(s.day).toBe(1);
    expect(s.unlockedPlots).toBe(8);
    expect(s.cows).toEqual([]);
    expect(s.unlockedAchievements).toEqual([]);
    expect(s.upgrades).toEqual({ sprinkler: 0, feed: 0, fertiliser: 0, contacts: 0 });
    expect(s.inventory.wheat).toBe(0);
    expect(s.difficulty).toBe('hard'); // the tier survives, as after a collapse
    expect(s.farmer).toBeNull();
    await expect(page.locator('#farmerPicker')).toBeVisible();
  });

  test('declining the restart leaves the farm exactly as it was', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, makeSave({
      coins: 4321,
      day: 12,
      unlockedPlots: 11,
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    await page.locator('#newFarmBtn').click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.coins).toBe(4321);
    expect(s.day).toBe(12);
    expect(s.unlockedPlots).toBe(11);
  });

  test('the prompt mentions a dream home if one was bought', async ({ page }) => {
    const messages = [];
    page.on('dialog', (d) => { messages.push(d.message()); d.dismiss(); });
    await load(page, makeSave({ dreamHome: 'villa', coins: 10 }));
    await page.getByRole('button', { name: /Market/ }).click();

    await page.locator('#newFarmBtn').click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('Grand Villa');
  });

  test('an unknown tier in a save falls back rather than breaking the rules', async ({ page }) => {
    await load(page, makeSave({ difficulty: 'impossible' }));

    expect((await readSave(page)).difficulty).toBe('farmer');
    expect(await page.evaluate(() => goodPrice('milk'))).toBe(9);
  });
});

/* ------------------------------------------------------------------ */
/* The farmer                                                          */
/* ------------------------------------------------------------------ */

test.describe('the farmer', () => {
  const ripeWheat = () => [
    { crop: 'wheat', plantedAt: secondsAgo(60) },
    ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
  ];

  test('a new game asks who is running the farm', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    const picker = page.locator('#farmerPicker');
    await expect(picker).toBeVisible();
    await expect(page.locator('.farmer-option')).toHaveCount(2);
    await expect(page.locator('.farmer-option').nth(0)).toHaveAttribute('aria-label', 'Female farmer');
    await expect(page.locator('.farmer-option').nth(1)).toHaveAttribute('aria-label', 'Male farmer');
  });

  test('picking a farmer starts the game with them fed', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    await page.locator('.farmer-option').nth(1).click(); // male

    await expect(page.locator('#farmerPicker')).toBeHidden();
    const s = await readSave(page);
    expect(s.farmer).toBe('male');
    expect(s.farmerFedUntil).toBeGreaterThan(Date.now());
    await expect(page.locator('#farmerAvatar')).toHaveText('👨‍🌾');
  });

  test('the choice is remembered and shown in the top bar', async ({ page }) => {
    await load(page, makeSave({ farmer: 'male' }));

    await expect(page.locator('#farmerPicker')).toBeHidden();
    await expect(page.locator('#dayLabel')).toContainText('👨‍🌾');
    await expect(page.locator('#farmerAvatar')).toHaveText('👨‍🌾');
  });

  test('a save from before the farmer asks on the next load', async ({ page }) => {
    // The field is intact — only the farmer is missing.
    await load(page, makeSave({ farmer: undefined, farmerFedUntil: undefined, coins: 777 }));

    await expect(page.locator('#farmerPicker')).toBeVisible();
    await page.locator('.farmer-option').first().click();
    expect((await readSave(page)).coins).toBe(777);
  });

  test('the farmer can be swapped later from the market', async ({ page }) => {
    await load(page, makeSave({ farmer: 'female' }));
    await page.getByRole('button', { name: /Market/ }).click();

    await expect(page.locator('.farmer-swap').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.farmer-swap').nth(1).click();

    expect((await readSave(page)).farmer).toBe('male');
    await expect(page.locator('.farmer-swap').nth(1)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the farmer eats pumpkins', async ({ page }) => {
    await load(page, makeSave({
      // Nearly out of energy, so the meal is worth taking.
      farmerFedUntil: Date.now() + 1000,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 3, milk: 0, egg: 0, wool: 0 },
    }));

    await expect(page.locator('#farmerFeedBtn')).toHaveText('Eat (2 🎃)');
    await page.locator('#farmerFeedBtn').click();

    const s = await readSave(page);
    expect(s.inventory.pumpkin).toBe(1); // 3 - 2
    expect(s.farmerFedUntil).toBeGreaterThan(Date.now() + FARMER_MEAL_MS - 5000);
    await expect(page.locator('#farmerState')).toContainText('Well fed');
  });

  test('with no pumpkins the farmer cannot eat', async ({ page }) => {
    await load(page, makeSave({
      farmerFedUntil: Date.now() + 1000,
      inventory: { wheat: 9, corn: 9, carrot: 9, pumpkin: 1, milk: 9, egg: 9, wool: 9 },
    }));

    // One pumpkin is not a meal.
    await expect(page.locator('#farmerFeedBtn')).toBeDisabled();
  });

  test('a well-fed farmer has nothing to gain from another meal', async ({ page }) => {
    await load(page, makeSave({
      farmerFedUntil: Date.now() + FARMER_MEAL_MS,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 9, milk: 0, egg: 0, wool: 0 },
    }));

    await expect(page.locator('#farmerFeedBtn')).toHaveText('Well fed');
    await expect(page.locator('#farmerFeedBtn')).toBeDisabled();
  });

  test('an exhausted farmer harvests half as much', async ({ page }) => {
    await load(page, makeSave({
      plots: ripeWheat(),
      farmerFedUntil: Date.now() - 1, // out of energy
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await expect(page.locator('#farmerStrip')).toHaveClass(/tired/);
    await expect(page.locator('#farmerState')).toContainText('Exhausted');

    // Wheat yields 3; exhausted, that halves to 1.
    await tapPlot(page.locator('#plotsGrid > *').first());
    await worked(page);
    expect((await readSave(page)).inventory.wheat).toBe(1);
  });

  test('a rested farmer gets the full harvest', async ({ page }) => {
    await load(page, makeSave({
      plots: ripeWheat(),
      farmerFedUntil: Date.now() + FARMER_MEAL_MS,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await worked(page);
    expect((await readSave(page)).inventory.wheat).toBe(3);
  });

  test('a tired farmer never harvests nothing, so recovery is always possible', async ({ page }) => {
    await load(page, makeSave({
      // A single pumpkin plot, ripe, with an exhausted farmer and no stock.
      plots: [
        { crop: 'pumpkin', plantedAt: secondsAgo(600) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      farmerFedUntil: Date.now() - 1,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await worked(page);
    expect((await readSave(page)).inventory.pumpkin).toBeGreaterThanOrEqual(1);
  });

  test('the meal clock does not run down while the game is closed', async ({ page }) => {
    const away = 30 * 60 * 1000;
    await load(page, makeSave({
      farmerFedUntil: Date.now() - away + 0.5 * FARMER_MEAL_MS,
      lastSeenAt: Date.now() - away,
    }));

    await expect(page.locator('#farmerStrip')).not.toHaveClass(/tired/);
    const { farmerFedUntil } = await readSave(page);
    expect(farmerFedUntil - Date.now()).toBeGreaterThan(0.4 * FARMER_MEAL_MS);
  });

  /* ---------------------------------------------------------------- */
  /* Pronouns follow the farmer that was picked                        */
  /* ---------------------------------------------------------------- */

  test('a female farmer is she/her', async ({ page }) => {
    await load(page, makeSave({ farmer: 'female', farmerFedUntil: Date.now() - 1 }));

    await expect(page.locator('#toast')).toContainText('she will collapse');
    expect(await page.evaluate(() => farmerPronouns()))
      .toMatchObject({ they: 'she', them: 'her', their: 'her' });
  });

  test('a male farmer is he/him', async ({ page }) => {
    await load(page, makeSave({ farmer: 'male', farmerFedUntil: Date.now() - 1 }));

    await expect(page.locator('#toast')).toContainText('he will collapse');
    expect(await page.evaluate(() => farmerPronouns()))
      .toMatchObject({ they: 'he', them: 'him', their: 'his' });
  });

  test('the game-over text uses the right pronoun', async ({ page }) => {
    await load(page, makeSave({ farmer: 'male', gameOver: true }));
    await expect(page.locator('#gameOverText')).toContainText('Nobody fed him');

    await load(page, makeSave({ farmer: 'female', gameOver: true }));
    await expect(page.locator('#gameOverText')).toContainText('Nobody fed her');
  });

  test('feeding messages address the chosen farmer', async ({ page }) => {
    await load(page, makeSave({
      farmer: 'female',
      farmerFedUntil: Date.now() + 1000,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));

    await page.evaluate(() => feedFarmer()); // no pumpkins to hand
    await expect(page.locator('#toast')).toContainText('to keep her going');
  });

  test('before anyone is picked the game says they/them', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    expect(await page.evaluate(() => farmerPronouns()))
      .toMatchObject({ they: 'they', them: 'them', their: 'their' });
  });

  /* ---------------------------------------------------------------- */
  /* Exhaustion first, then collapse                                   */
  /* ---------------------------------------------------------------- */

  /** Puts the farmer's meal a chosen distance in the past and runs the pass. */
  const setFedUntil = (page, at) => page.evaluate((t) => {
    state.farmerFedUntil = t;
    updateFarmerHealth();
    render();
  }, at);

  test('exhaustion is the first step, not the end', async ({ page }) => {
    await load(page, makeSave({ farmerFedUntil: Date.now() - 1 }));

    await expect(page.locator('#farmerStrip')).toHaveClass(/tired/);
    await expect(page.locator('#farmerState')).toContainText('Exhausted');
    await expect(page.locator('#toast')).toContainText('will collapse');
    // Still playable — that is the whole point of the first step.
    expect((await readSave(page)).gameOver).toBe(false);
    await expect(page.locator('#gameOverOverlay')).toBeHidden();
  });

  test('the bar switches to counting down to collapse', async ({ page }) => {
    await load(page, makeSave({ farmerFedUntil: Date.now() - 0.5 * FARMER_COLLAPSE_MS }));

    // Halfway through the grace period, so roughly half the bar is left.
    const bar = page.locator('#farmerEnergy');
    await expect(bar).toHaveAttribute('aria-label', 'Time before the farmer collapses');
    const value = Number(await bar.getAttribute('aria-valuenow'));
    expect(value).toBeGreaterThan(35);
    expect(value).toBeLessThan(65);
  });

  test('the last stretch before collapse is flagged', async ({ page }) => {
    await load(page, makeSave({ farmerFedUntil: Date.now() - 1 }));
    await setFedUntil(page, Date.now() - 0.9 * FARMER_COLLAPSE_MS);

    await expect(page.locator('#farmerStrip')).toHaveClass(/critical/);
    await expect(page.locator('#farmerState')).toContainText('About to collapse');
    await expect(page.locator('#toast')).toContainText('about to collapse');
  });

  test('a farmer who never eats collapses, and that is game over', async ({ page }) => {
    await load(page, makeSave({ farmerFedUntil: Date.now() - 1 }));
    await setFedUntil(page, Date.now() - FARMER_COLLAPSE_MS - 1);

    await expect(page.locator('#gameOverOverlay')).toBeVisible();
    await expect(page.locator('#gameOverTitle')).toContainText('collapsed');
    expect((await readSave(page)).gameOver).toBe(true);
  });

  test('eating in time clears the warnings and the danger', async ({ page }) => {
    await load(page, makeSave({
      farmerFedUntil: Date.now() - 0.9 * FARMER_COLLAPSE_MS,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 4, milk: 0, egg: 0, wool: 0 },
    }));
    await expect(page.locator('#farmerStrip')).toHaveClass(/critical/);

    await page.locator('#farmerFeedBtn').click();

    const s = await readSave(page);
    expect(s.gameOver).toBe(false);
    expect(s.farmerWarned).toBe(false);
    expect(s.farmerCritical).toBe(false);
    await expect(page.locator('#farmerStrip')).not.toHaveClass(/tired/);
  });

  test('game over survives a reload rather than resuming a dead farm', async ({ page }) => {
    await load(page, makeSave({ gameOver: true, farmerFedUntil: Date.now() - FARMER_COLLAPSE_MS }));

    await expect(page.locator('#gameOverOverlay')).toBeVisible();
    // The farmer picker must not fight it for the screen.
    await expect(page.locator('#farmerPicker')).toBeHidden();
  });

  test('starting a new farm clears the loss', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await load(page, makeSave({ gameOver: true, coins: 4321, day: 40 }));

    await page.locator('#restartBtn').click();

    await expect(page.locator('#gameOverOverlay')).toBeHidden();
    const s = await readSave(page);
    expect(s.gameOver).toBe(false);
    expect(s.day).toBe(1);
    expect(s.coins).toBeLessThan(4321);
    expect(s.farmer).toBeNull(); // a new farm asks who is running it
  });

  test('declining the restart keeps the game-over screen up', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, makeSave({
      gameOver: true,
      coins: 4321,
      unlockedAchievements: [...ACHIEVEMENT_IDS], // else wealth awards pay out
    }));

    await page.locator('#restartBtn').click();
    await page.waitForTimeout(300);

    await expect(page.locator('#gameOverOverlay')).toBeVisible();
    expect((await readSave(page)).coins).toBe(4321);
  });

  test('the collapse clock is paused while the game is closed', async ({ page }) => {
    const away = 40 * 60 * 1000;
    await load(page, makeSave({
      // Exhausted with half the grace period left when the tab was closed.
      farmerFedUntil: Date.now() - away - 0.5 * FARMER_COLLAPSE_MS,
      lastSeenAt: Date.now() - away,
    }));

    // Long enough away to have died several times over on a wall clock.
    await expect(page.locator('#gameOverOverlay')).toBeHidden();
    expect((await readSave(page)).gameOver).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Core loop                                                           */
/* ------------------------------------------------------------------ */

test.describe('core loop', () => {
  test('planting a seed costs coins and fills the plot', async ({ page }) => {
    await load(page, makeSave({ coins: 300 }));

    await page.locator('.seed-btn').first().click(); // wheat, 5 coins
    await tapPlot(page.locator('#plotsGrid .plot.empty').first());

    await expect.poll(() => coins(page)).toBe(295);
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('a ripe crop can be harvested and yields produce', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const plot = page.locator('#plotsGrid > *').first();
    await expect(plot).toHaveClass(/ready/);
    await tapPlot(plot);

    await expect.poll(async () => (await inventory(page)).wheat).toBe(3);
  });

  test('harvesting spawns floating feedback', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await expect(page.locator('#fxLayer .float-text')).toHaveText(/^\+3/);
  });

  test('unlocking the next plot charges the escalating price', async ({ page }) => {
    await load(page, makeSave({ coins: 300, unlockedPlots: 8 }));

    await tapPlot(page.locator('#plotsGrid .plot.unlockable'));

    await expect.poll(() => coins(page)).toBe(270); // base cost 30
    await expect.poll(async () => (await readSave(page)).unlockedPlots).toBe(9);
  });

  test('a plot cannot be unlocked without enough coins', async ({ page }) => {
    await load(page, makeSave({ coins: 5, unlockedPlots: 8 }));

    await tapPlot(page.locator('#plotsGrid .plot.unlockable'));

    await expect(page.locator('#toast')).toHaveText(/not enough coins/i);
    await expect.poll(async () => (await readSave(page)).unlockedPlots).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/* The farmer walks to work                                            */
/* ------------------------------------------------------------------ */

/* The one property worth pinning here is the order of events: queue, walk,
   then fire. Everything else in this block is a consequence of it. */
test.describe('walking to work', () => {
  const ripeAt = (...indices) => Array.from({ length: PLOT_COUNT }, (_, i) => (
    indices.includes(i)
      ? { crop: 'wheat', plantedAt: secondsAgo(60) }
      : { crop: null, plantedAt: null }
  ));

  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });

  /** scene.js is a deferred module, so it starts a beat after the grid exists. */
  const sceneReady = (page) => page.waitForFunction(() => !!window.Farm3DScene);
  const pending = (page) => page.evaluate(() => window.Farm3DScene.pendingActions());
  const livePlot = (page, i) => page.evaluate((n) => {
    const s = window.Farm3DBridge.getState();
    return { crop: s.plots[n].crop, rotten: !!s.plots[n].rotten, wheat: s.inventory.wheat };
  }, i);

  test('the crop is picked when she arrives, not when the plot is tapped', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(0) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').first());

    // The tap has been taken on — and nothing whatever has happened yet.
    expect(await pending(page)).toBe(1);
    expect((await inventory(page)).wheat).toBe(0);
    expect((await readSave(page)).plots[0].crop).toBe('wheat');

    await worked(page);
    expect((await inventory(page)).wheat).toBe(3);
  });

  test('a reload mid-walk drops the tap and the crop is still standing', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(3) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').nth(3));
    expect(await pending(page)).toBe(1);

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');

    /* This is why the queue is not in the save: there is no half-finished
       tap to recover, because the farm never knew about it. */
    expect((await readSave(page)).plots[3].crop).toBe('wheat');
    expect((await inventory(page)).wheat).toBe(0);
    await sceneReady(page);
    expect(await pending(page)).toBe(0);
  });

  test('a round of taps is worked through one plot at a time', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(0, 1, 2, 3) }));
    await sceneReady(page);

    for (const i of [0, 1, 2, 3]) await tapPlot(page.locator('#plotsGrid > *').nth(i));

    /* One plot at a time is the point: four taps cannot all have been
       carried out by the time the fourth one is made, however fast they
       arrive. (Asserting the queue is exactly four deep would instead be
       asserting how quickly the test can click, which is not a property of
       the game — and duly failed on a loaded machine.) */
    expect((await inventory(page)).wheat).toBeLessThan(12);

    await worked(page);
    expect((await inventory(page)).wheat).toBe(12);
  });

  test('tapping the same plot twice does not queue it twice', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(3) }));
    await sceneReady(page);

    const plot = page.locator('#plotsGrid > *').nth(3);
    await tapPlot(plot);
    await tapPlot(plot);

    expect(await pending(page)).toBe(1);
  });

  test('a job the world has changed under is dropped, not swapped for another', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(3) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').nth(3));
    // While she is still crossing the yard, the crop she set out to harvest
    // rots. Clearing it is a different job, and not one anybody asked for.
    await page.evaluate(() => {
      const plot = window.Farm3DBridge.getState().plots[3];
      plot.rotten = true;
      plot.spoilsAt = Date.now() - 1;
    });

    await worked(page);
    expect(await livePlot(page, 3)).toEqual({ crop: 'wheat', rotten: true, wheat: 0 });
  });

  test('a farm replaced under her drops the round she was on', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(3) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').nth(3));
    expect(await pending(page)).toBe(1);

    /* What Start Over does, and what picking up a newer save from another tab
       does: replace the farm wholesale. The new one is set up to look exactly
       like the old one at plot 3, so re-checking the intent would happily
       harvest it — only noticing that the world itself changed can tell that
       this is somebody else's plot 3 now. */
    await page.evaluate(() => {
      const fresh = freshState();
      fresh.farmer = 'female';
      fresh.plots[3] = { crop: 'wheat', plantedAt: Date.now() / 1000 - 60, spoilsAt: null, rotten: false };
      state = fresh;
      render();
    });

    await worked(page);
    expect(await livePlot(page, 3)).toEqual({ crop: 'wheat', rotten: false, wheat: 0 });
  });

  test('a job taken on the farm tab still finishes from another tab', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(0) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').first());
    await page.getByRole('button', { name: /Market/ }).click();

    // Walking is not drawn while the field is off screen, but it still
    // happens: a tap must not be swallowed by changing tabs.
    await worked(page);
    expect((await inventory(page)).wheat).toBe(3);
  });

  test('a refusal comes back straight away, without a walk', async ({ page }) => {
    await load(page, makeSave({ coins: 0, selectedSeed: 'wheat' }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid .plot.empty').first());

    await expect(page.locator('#toast')).toHaveText(/not enough coins/i);
    expect(await pending(page)).toBe(0);
  });

  test('reduced motion works the plot on the spot', async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const quiet = await context.newPage();
    await load(quiet, banked({ plots: ripeAt(0) }));
    await sceneReady(quiet);

    await tapPlot(quiet.locator('#plotsGrid > *').first());

    // Nothing to wait for: a player who turned motion off gets the old game.
    expect((await readSave(quiet)).inventory.wheat).toBe(3);
    expect(await pending(quiet)).toBe(0);
    await context.close();
  });

  /* ---------------------------------------------------------------- */
  /* The pen shares the walk queue                                     */
  /* ---------------------------------------------------------------- */

  const readyCow = () => [{ id: 1, state: 'producing', feedAt: secondsAgo(60) }]; // produceTime 25
  const hungryCowFixture = () => [{ id: 1, state: 'hungry', feedAt: null }];
  const hungryDogFixture = () => [{ id: 90, state: 'hungry', feedAt: null }];

  test('milk is only ever collected by a farmer standing next to a cow', async ({ page }) => {
    await load(page, banked({ cows: readyCow() }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#cowList .animal-btn').click();

    // The tap was taken — nothing about the cow or the stores has moved yet.
    expect(await pending(page)).toBe(1);
    expect((await inventory(page)).milk).toBe(0);
    expect((await readSave(page)).cows[0].state).toBe('producing');

    await worked(page);
    expect((await inventory(page)).milk).toBe(2);
    expect((await readSave(page)).cows[0].state).toBe('hungry');
  });

  test('feeding a hungry animal also sends her to the pen', async ({ page }) => {
    await load(page, banked({
      cows: hungryCowFixture(),
      inventory: { wheat: 0, corn: 4, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#cowList .animal-btn').click();
    expect(await pending(page)).toBe(1);
    expect((await readSave(page)).cows[0].state).toBe('hungry');

    await worked(page);
    expect((await readSave(page)).cows[0].state).toBe('producing');
    expect((await inventory(page)).corn).toBe(2);
  });

  test('feeding a dog a chicken walks there too, after the confirmation', async ({ page }) => {
    await load(page, banked({
      dogs: hungryDogFixture(),
      chickens: [{ id: 2, state: 'hungry', feedAt: null }],
    }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#dogList .prey-btn').first().click(); // chicken, no confirmation needed
    expect(await pending(page)).toBe(1);
    expect((await readSave(page)).chickens).toHaveLength(1); // not slaughtered yet — she has not arrived

    await worked(page);
    expect((await readSave(page)).chickens).toHaveLength(0);
    expect((await readSave(page)).dogs[0].state).toBe('producing');
  });

  test('declining to slaughter a cow never sends her anywhere', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, banked({ dogs: hungryDogFixture(), cows: hungryCowFixture() }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#dogList .prey-btn').nth(2).click(); // cow — asks first
    await page.waitForTimeout(300);

    // The confirmation runs before any job is queued, so declining it never
    // sends her walking in the first place.
    expect(await pending(page)).toBe(0);
    expect((await readSave(page)).cows).toHaveLength(1);
  });

  test('an animal refusal comes back straight away, without a walk', async ({ page }) => {
    // The Feed button is disabled whenever this would fail, so a real click
    // can never reach the refusal — the same defence plotIntentBlocker gives
    // plants exists here too, just behind a UI door that never opens on it.
    // Calling the handler directly is the only way to exercise it.
    await load(page, banked({
      cows: hungryCowFixture(),
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();
    await expect(page.locator('#cowList .animal-btn')).toBeDisabled();

    await page.evaluate(() => window.Farm3DBridge.handleAnimalTap('cow', 1, 'feed'));

    await expect(page.locator('#toast')).toContainText('needs 2 Corn');
    expect(await pending(page)).toBe(0);
  });

  test('an animal sold while she is on the way is not there when she arrives', async ({ page }) => {
    await load(page, banked({ cows: readyCow() }));
    await sceneReady(page);
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#cowList .animal-btn').click();
    expect(await pending(page)).toBe(1);

    // Sold out from under the job, the way a starving death or another tab
    // acting on the same save could also remove it mid-walk.
    await page.evaluate(() => {
      state.cows = [];
      saveState();
    });

    await worked(page);
    expect((await inventory(page)).milk).toBe(0);
  });

  test('reduced motion works the pen on the spot too', async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const quiet = await context.newPage();
    await load(quiet, banked({ cows: readyCow() }));
    await sceneReady(quiet);
    await quiet.getByRole('button', { name: /Animals/ }).click();

    await quiet.locator('#cowList .animal-btn').click();

    // Collected immediately: producing -> hungry is what a tap does now.
    expect((await readSave(quiet)).cows[0].state).toBe('hungry');
    expect(await pending(quiet)).toBe(0);
    await context.close();
  });
});

/* ------------------------------------------------------------------ */
/* Animals                                                             */
/* ------------------------------------------------------------------ */

test.describe('animals', () => {
  test('buy, feed, collect and sell a cow', async ({ page }) => {
    await load(page, makeSave({
      coins: 500,
      inventory: { wheat: 0, corn: 20, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#buyCowBtn').click();
    await expect.poll(() => coins(page)).toBe(400); // cow base cost 100
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);

    await page.locator('#cowList .animal-btn').click(); // feed: 2 corn
    await worked(page);
    await expect.poll(async () => (await inventory(page)).corn).toBe(18);
    await expect(page.locator('#cowList .animal-state.producing')).toHaveCount(1);

    // Fast-forward past the production timer. Mutating the live state avoids
    // a reload, during which the outgoing page would save over the edit.
    await page.evaluate(() => { state.cows[0].feedAt = Date.now() / 1000 - 60; });

    await expect(page.locator('#cowList .animal-state.ready')).toHaveCount(1);
    await page.locator('#cowList .animal-btn').click(); // collect
    await worked(page);
    await expect.poll(async () => (await inventory(page)).milk).toBe(2);

    const before = await coins(page);
    page.on('dialog', (d) => d.accept()); // selling asks for confirmation
    await page.locator('#cowList .animal-btn-sell').click();
    await expect.poll(() => coins(page)).toBe(before + 50); // half of base cost
    await expect(page.locator('#cowList p')).toHaveCount(1); // empty-state text
  });

  test('selling an animal asks first, and declining keeps it', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, makeSave({
      coins: 0,
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#cowList .animal-btn-sell').click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.cows).toHaveLength(1);
    expect(s.coins).toBe(0);
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);
  });

  test('the sell prompt names the refund and the cost of buying back', async ({ page }) => {
    const messages = [];
    page.on('dialog', (d) => { messages.push(d.message()); d.dismiss(); });
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#cowList .animal-btn-sell').click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('50 coins');   // half the 100-coin base
    expect(messages[0]).toContain('170 coins');  // buying another, one already owned
  });

  test('accepting the prompt sells the animal', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await load(page, makeSave({
      coins: 0,
      sheep: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#sheepList .animal-btn-sell').click();

    await expect.poll(() => coins(page)).toBe(75); // half the 150-coin base
    expect((await readSave(page)).sheep).toEqual([]);
  });

  test('feeding is blocked without enough crops', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#cowList .animal-btn')).toBeDisabled();
  });

  test('the feed button names the food that animal eats', async ({ page }) => {
    await load(page, makeSave({
      chickens: [{ id: 1, state: 'hungry', feedAt: null }],
      cows: [{ id: 2, state: 'hungry', feedAt: null }],
      sheep: [{ id: 3, state: 'hungry', feedAt: null }],
      nextAnimalId: 4,
      inventory: { wheat: 5, corn: 5, carrot: 5, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#chickenList .animal-btn')).toHaveText('Feed (1 🌾)');
    await expect(page.locator('#cowList .animal-btn')).toHaveText('Feed (2 🌽)');
    await expect(page.locator('#sheepList .animal-btn')).toHaveText('Feed (2 🥕)');
  });

  test('an animal will not eat the wrong food', async ({ page }) => {
    // Plenty of wheat, but a cow eats corn.
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
      inventory: { wheat: 99, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#cowList .animal-btn')).toBeDisabled();
    await expect(page.locator('#cowList .animal-state.hungry')).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ */
/* Feed economics                                                      */
/* ------------------------------------------------------------------ */

test.describe('feed economics', () => {
  test('feeding costs more the more valuable the produce', async ({ page }) => {
    await load(page, makeSave());

    const economics = await page.evaluate(() =>
      ['chicken', 'cow', 'sheep'].map((kind) => {
        const def = ANIMALS[kind];
        return {
          kind,
          feedCost: def.feed.amount * GOODS[def.feed.good].sellPrice,
          produceValue: def.produceYield * GOODS[def.produceKey].sellPrice,
        };
      }));

    // Ordered by produce value, feed cost must rise in step...
    const byValue = [...economics].sort((a, b) => a.produceValue - b.produceValue);
    expect(byValue.map((e) => e.kind)).toEqual(['chicken', 'cow', 'sheep']);
    for (let i = 1; i < byValue.length; i += 1) {
      expect(byValue[i].feedCost,
        `${byValue[i].kind} should cost more to feed than ${byValue[i - 1].kind}`)
        .toBeGreaterThan(byValue[i - 1].feedCost);
    }
    // ...while every animal still turns a profit.
    economics.forEach((e) => {
      expect(e.produceValue, `${e.kind} should be worth keeping`).toBeGreaterThan(e.feedCost);
    });
  });

  test('every animal that eats produce has its own food', async ({ page }) => {
    await load(page, makeSave());

    const foods = await page.evaluate(() => ANIMAL_ORDER
      .filter((kind) => !ANIMALS[kind].eatsLivestock)
      .map((kind) => ANIMALS[kind].feed.good));

    expect(new Set(foods).size, 'each animal should have its own food').toBe(foods.length);
    // The dog is the exception: it is fed livestock, not produce.
    expect(await page.evaluate(() => ANIMALS.dog.feed)).toBeNull();
    expect(await page.evaluate(() => ANIMALS.dog.eatsLivestock)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Guardians: dogs and cats                                            */
/* ------------------------------------------------------------------ */

test.describe('guardians', () => {
  const onDutyDog = (t = 0) => [{ id: 90, state: 'producing', feedAt: secondsAgo(t) }];
  const hungryDog = () => [{ id: 90, state: 'hungry', feedAt: null }];

  const wolfNow = (page) => page.evaluate(() => {
    state.nextWolfRaidAt = Date.now();
    updateRaids();
  });
  const pestNow = (page) => page.evaluate(() => {
    state.nextPestRaidAt = Date.now();
    updateRaids();
  });

  const herdSize = async (page) => {
    const s = await readSave(page);
    return s.cows.length + s.chickens.length + s.sheep.length;
  };

  test('a dog on duty turns a wolf away', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      sheep: [{ id: 2, state: 'hungry', feedAt: null }],
      dogs: onDutyDog(),
      nextAnimalId: 91,
    }));

    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('chased off a wolf');
    expect(await herdSize(page)).toBe(2);
  });

  test('without a dog a wolf takes an animal', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      sheep: [{ id: 2, state: 'hungry', feedAt: null }],
      nextAnimalId: 3,
    }));

    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('A wolf took');
    expect(await herdSize(page)).toBe(1);
  });

  test('a hungry dog is not guarding anything', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      dogs: hungryDog(),
      nextAnimalId: 91,
    }));

    await wolfNow(page);

    expect(await herdSize(page)).toBe(0);
  });

  test('a cat on duty keeps the crows off', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(3) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      cats: [{ id: 92, state: 'producing', feedAt: secondsAgo(0) }],
      nextAnimalId: 93,
    }));

    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('saw off the crows');
    expect((await readSave(page)).plots[0].crop).toBe('wheat');
  });

  test('without a cat the crows eat a crop', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(3) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('Crows ate');
    expect((await readSave(page)).plots[0].crop).toBeNull();
  });

  test('a wolf finds nothing to take on an empty farm', async ({ page }) => {
    await load(page, makeSave());
    await wolfNow(page);
    expect(await herdSize(page)).toBe(0); // no crash, nothing lost
  });

  test('a guardian goes off duty when its meal runs out', async ({ page }) => {
    await load(page, makeSave({
      dogs: [{ id: 90, state: 'producing', feedAt: secondsAgo(1000) }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogList .animal-state.hungry')).toHaveCount(1);
    expect((await readSave(page)).dogs[0].state).toBe('hungry');
  });

  test('a guardian has nothing to collect, only a shift to run down', async ({ page }) => {
    await load(page, makeSave({
      dogs: onDutyDog(),
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
    await expect(page.locator('#dogList .animal-btn')).toBeDisabled();
    await expect(page.locator('#dogList .animal-btn')).toHaveText('On duty');
  });

  test('a cat is fed on produce, a dog on livestock', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      cats: [{ id: 91, state: 'hungry', feedAt: null }],
      chickens: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 92,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 2, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#catList .animal-btn')).toHaveText('Feed (1 🥛)');
    // The dog gets one button per animal it could be given, not a food cost.
    await expect(page.locator('#dogList .prey-btn')).toHaveCount(3);
    await expect(page.locator('#dogList .prey-btn').first()).toHaveText('🐔 90s');

    await page.locator('#catList .animal-btn').click();
    await worked(page);
    await expect.poll(async () => (await inventory(page)).milk).toBe(1);
    await expect(page.locator('#catList .animal-state.onduty')).toHaveCount(1);

    // Eggs are no longer dog food; the chicken itself is.
    await page.locator('#dogList .prey-btn').first().click();
    await worked(page);
    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
    const s = await readSave(page);
    expect(s.chickens).toEqual([]);
    expect(s.inventory.egg).toBe(2);
  });

  test('a raid that fell due while away is skipped, not resolved', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));

    // Overdue by far more than the staleness window: the player was gone.
    await page.evaluate(() => {
      state.nextWolfRaidAt = Date.now() - 10 * 60 * 1000;
      updateRaids();
    });

    expect(await herdSize(page)).toBe(1);
    // ...and the clock is pushed out rather than firing again immediately.
    expect((await readSave(page)).nextWolfRaidAt).toBeGreaterThan(Date.now());
  });

  /* ---------------------------------------------------------------- */
  /* Guard coverage: one guardian only covers so much                  */
  /* ---------------------------------------------------------------- */

  const GUARD_CAPACITY = 4;

  /** Pins the raid roll so partial coverage becomes a deterministic outcome. */
  const pinRandom = (page, value) =>
    page.evaluate((v) => { Math.random = () => v; }, value);

  const onDutyDogs = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 90 + i, state: 'producing', feedAt: secondsAgo(0) }));
  const onDutyCats = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 70 + i, state: 'producing', feedAt: secondsAgo(0) }));
  /** A herd of `n` chickens, which are livestock and so wolf bait. */
  const flock = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, state: 'hungry', feedAt: null }));
  const plantedPlots = (n) => [
    ...Array.from({ length: n }, () => ({ crop: 'wheat', plantedAt: secondsAgo(3) })),
    ...Array.from({ length: PLOT_COUNT - n }, () => ({ crop: null, plantedAt: null })),
  ];
  const plantedCount = async (page) =>
    (await readSave(page)).plots.filter((p) => p.crop).length;

  test('one dog cannot cover a herd of twelve', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(12), dogs: onDutyDogs(1), nextAnimalId: 100 }));
    // Coverage is 4/12, so a roll above that gets through.
    await pinRandom(page, 0.99);
    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('spread too thin');
    expect(await herdSize(page)).toBe(11);
  });

  test('three dogs do cover a herd of twelve', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(12), dogs: onDutyDogs(3), nextAnimalId: 100 }));
    // 3 x 4 = 12: full cover, so even the worst roll is turned away.
    await pinRandom(page, 0.99);
    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('chased off a wolf');
    expect(await herdSize(page)).toBe(12);
  });

  test('a herd that outgrows its dog starts losing animals again', async ({ page }) => {
    // Exactly at capacity: covered.
    await load(page, makeSave({
      chickens: flock(GUARD_CAPACITY),
      dogs: onDutyDogs(1),
      nextAnimalId: 100,
    }));
    await pinRandom(page, 0.99);
    await wolfNow(page);
    expect(await herdSize(page)).toBe(GUARD_CAPACITY);

    // Buy one more than the dog can watch and the cover is no longer total.
    await page.evaluate(() => {
      state.chickens.push({ id: 500, state: 'hungry', feedAt: null, starvesAt: null });
    });
    await wolfNow(page);
    expect(await herdSize(page)).toBe(GUARD_CAPACITY); // 5 - 1 lost
  });

  test('one cat cannot cover a full field', async ({ page }) => {
    await load(page, makeSave({ plots: plantedPlots(12), cats: onDutyCats(1), nextAnimalId: 100 }));
    await pinRandom(page, 0.99);
    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('spread too thin');
    expect(await plantedCount(page)).toBe(11);
  });

  test('three cats do cover twelve planted plots', async ({ page }) => {
    await load(page, makeSave({ plots: plantedPlots(12), cats: onDutyCats(3), nextAnimalId: 100 }));
    await pinRandom(page, 0.99);
    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('saw off the crows');
    expect(await plantedCount(page)).toBe(12);
  });

  test('a hungry guardian contributes no cover', async ({ page }) => {
    await load(page, makeSave({
      chickens: flock(4),
      // Two dogs, but only one has been fed.
      dogs: [
        { id: 90, state: 'producing', feedAt: secondsAgo(0) },
        { id: 91, state: 'hungry', feedAt: null },
      ],
      nextAnimalId: 100,
    }));

    expect(await page.evaluate(() => guardCapacity('dog'))).toBe(GUARD_CAPACITY);
  });

  test('the animals tab reports how much of the farm is covered', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(9), dogs: onDutyDogs(1), nextAnimalId: 100 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    const status = page.locator('#dogGuardStatus');
    await expect(status).toContainText('covering 4 of 9 animals');
    await expect(status).toContainText('buy 2 more');
    await expect(status).toHaveClass(/short/);

    // Feed enough dogs to close the gap and the warning clears.
    await page.evaluate(() => {
      state.dogs.push(
        { id: 91, state: 'producing', feedAt: Date.now() / 1000 },
        { id: 92, state: 'producing', feedAt: Date.now() / 1000 },
      );
      render();
    });
    await expect(status).toContainText('all 9 animals covered');
    await expect(status).not.toHaveClass(/short/);
  });

  test('an unguarded farm says so plainly', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(3), nextAnimalId: 100 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogGuardStatus')).toContainText('all 3 animals unguarded');
    await expect(page.locator('#catGuardStatus')).toContainText('Nothing planted');
  });

  /* ---------------------------------------------------------------- */
  /* You can see the raid happen                                       */
  /* ---------------------------------------------------------------- */

  const actors = (page, sel = '') => page.locator(`#fxLayer .raid-actor${sel}`);
  const openFarm = (page) => page.getByRole('button', { name: /Farm/ }).click();
  const openAnimals = (page) => page.getByRole('button', { name: /Animals/ }).click();

  const oneWheat = () => [
    { crop: 'wheat', plantedAt: secondsAgo(3) },
    ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
  ];

  test('crows are shown arriving when they eat a crop', async ({ page }) => {
    await load(page, makeSave({ plots: oneWheat() }));
    await openFarm(page);

    await pestNow(page);

    await expect(actors(page, '.crow')).toHaveCount(3);
    // Undefended, so no cat turns up and the crows leave with it.
    await expect(actors(page, '.guard')).toHaveCount(0);
    await expect(actors(page, '.crow.steals')).toHaveCount(3);
  });

  test('the plot that was raided is flagged where it stands', async ({ page }) => {
    await load(page, makeSave({ plots: oneWheat() }));
    await openFarm(page);

    /* The flag takes itself off again after 900ms, which is shorter than a
       round trip from Node reliably is, so polling for it afterwards caught
       the pulse only about half the time. Watching for it instead records the
       flag as it goes on and races nothing — and it can say which plot was
       marked, which is the half of this test the name promises and a bare
       count never checked.

       Plots are collected rather than counted because redrawing one rewrites
       its class attribute, so a single pulse can be seen more than once. */
    await page.evaluate(() => {
      const grid = document.querySelector('#plotsGrid');
      const hits = new Set();
      window.__raidHits = () => [...hits].sort();
      new MutationObserver((records) => {
        for (const { target } of records) {
          if (target.classList.contains('raid-hit')) {
            hits.add([...grid.children].indexOf(target));
          }
        }
      }).observe(grid, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });

    await pestNow(page);

    // The wheat sits in the first plot, and is the only crop there is to lose.
    await expect.poll(() => page.evaluate(() => window.__raidHits())).toEqual([0]);
  });

  test('a cat is shown seeing the crows off', async ({ page }) => {
    await load(page, makeSave({
      plots: oneWheat(),
      cats: [{ id: 92, state: 'producing', feedAt: secondsAgo(0) }],
      nextAnimalId: 93,
    }));
    await openFarm(page);

    await pestNow(page);

    await expect(actors(page, '.crow')).toHaveCount(3);
    await expect(actors(page, '.guard.cat')).toHaveCount(1);
    // Driven off rather than carrying anything away.
    await expect(actors(page, '.crow.flees')).toHaveCount(3);
    expect((await readSave(page)).plots[0].crop).toBe('wheat');
  });

  test('a wolf is shown arriving when it takes an animal', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await openAnimals(page);

    await wolfNow(page);

    await expect(actors(page, '.wolf.steals')).toHaveCount(1);
    await expect(actors(page, '.guard')).toHaveCount(0);
  });

  test('a dog is shown chasing the wolf off', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      dogs: onDutyDog(),
      nextAnimalId: 91,
    }));
    await openAnimals(page);

    await wolfNow(page);

    await expect(actors(page, '.wolf.flees')).toHaveCount(1);
    await expect(actors(page, '.guard.dog')).toHaveCount(1);
    expect(await herdSize(page)).toBe(1);
  });

  test('a raid is still visible from another tab', async ({ page }) => {
    await load(page, makeSave({ plots: oneWheat() }));
    await page.getByRole('button', { name: /Market/ }).click();

    await pestNow(page);

    // No plot to aim at from here, but the crows still cross the screen.
    await expect(actors(page, '.crow')).toHaveCount(3);
  });

  test('the actors are cleaned up once the raid is over', async ({ page }) => {
    await load(page, makeSave({ plots: oneWheat() }));
    await openFarm(page);

    await pestNow(page);
    await expect(actors(page)).toHaveCount(3);

    await expect(actors(page)).toHaveCount(0, { timeout: 6000 });
  });

  test('two raids at once do not pile up on screen', async ({ page }) => {
    await load(page, makeSave({
      plots: oneWheat(),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await openFarm(page);

    await pestNow(page);
    await wolfNow(page); // lands while the crows are still in flight

    await expect(actors(page, '.crow')).toHaveCount(3);
    await expect(actors(page, '.wolf')).toHaveCount(0);
  });

  test('nothing is animated when the player asked for less motion', async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const quiet = await context.newPage();
    await load(quiet, makeSave({ plots: oneWheat() }));
    await openFarm(quiet);

    await pestNow(quiet);

    await expect(quiet.locator('#fxLayer .raid-actor')).toHaveCount(0);
    // The raid still happened, and is still reported.
    await expect(quiet.locator('#toast')).toContainText('Crows ate');
    expect((await readSave(quiet)).plots[0].crop).toBeNull();
    await context.close();
  });

  /* ---------------------------------------------------------------- */
  /* Dogs eat livestock                                                */
  /* ---------------------------------------------------------------- */

  const preyBtn = (page, i) => page.locator('#dogList .prey-btn').nth(i);
  const acceptConfirms = (page) => page.on('dialog', (d) => d.accept());

  test('a bigger animal buys a longer watch', async ({ page }) => {
    await load(page, makeSave({ dogs: hungryDog(), nextAnimalId: 91 }));

    const shifts = await page.evaluate(() =>
      DOG_PREY_ORDER.map((k) => DOG_PREY[k].shiftTime));

    // chicken < sheep < cow, strictly increasing with the size of the animal.
    expect(shifts).toEqual([...shifts].sort((a, b) => a - b));
    expect(new Set(shifts).size).toBe(shifts.length);
  });

  test('feeding a dog a chicken costs the chicken', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      chickens: [{ id: 1, state: 'hungry', feedAt: null }, { id: 2, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 0).click(); // chicken, no confirmation
    await worked(page);

    await expect(page.locator('#toast')).toContainText('Slaughtered a Chicken');
    const s = await readSave(page);
    expect(s.chickens).toHaveLength(1);
    expect(s.dogs[0].state).toBe('producing');
    expect(s.dogs[0].shiftTime).toBe(90);
  });

  test('a cow keeps the dog on duty far longer than a chicken', async ({ page }) => {
    acceptConfirms(page);
    await load(page, makeSave({
      dogs: hungryDog(),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 2).click(); // cow
    await worked(page);

    const s = await readSave(page);
    expect(s.cows).toEqual([]);
    expect(s.dogs[0].shiftTime).toBe(320);
    // The shift really is longer: a dog 200s in is still working.
    await page.evaluate(() => { state.dogs[0].feedAt = Date.now() / 1000 - 200; });
    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
  });

  test('giving up a cow asks first', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, makeSave({
      dogs: hungryDog(),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 2).click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.cows).toHaveLength(1); // declined, so nothing was lost
    expect(s.dogs[0].state).toBe('hungry');
  });

  test('with empty pens there is nothing to feed the dog', async ({ page }) => {
    await load(page, makeSave({ dogs: hungryDog(), nextAnimalId: 91 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    for (let i = 0; i < 3; i += 1) await expect(preyBtn(page, i)).toBeDisabled();
    // Buying an animal is what puts a meal back on the table.
    await page.evaluate(() => {
      state.chickens.push({ id: 5, state: 'hungry', feedAt: null, starvesAt: null });
      render();
    });
    await expect(preyBtn(page, 0)).toBeEnabled();
  });

  test('a producing animal is spared while an idle one is available', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      chickens: [
        { id: 1, state: 'producing', feedAt: secondsAgo(2) },
        { id: 2, state: 'hungry', feedAt: null },
      ],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 0).click();
    await worked(page);

    // The one mid-cycle is left alone; the idle one goes.
    const s = await readSave(page);
    expect(s.chickens).toHaveLength(1);
    expect(s.chickens[0].state).toBe('producing');
  });

  test('eggs no longer feed a dog', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      nextAnimalId: 91,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 9, wool: 0 },
    }));

    // A barn full of eggs and no livestock leaves the dog hungry.
    await page.evaluate(() => feedAnimal('dog', 90));
    const s = await readSave(page);
    expect(s.dogs[0].state).toBe('hungry');
    expect(s.inventory.egg).toBe(9);
  });
});

/* ------------------------------------------------------------------ */
/* Spoilage                                                            */
/* ------------------------------------------------------------------ */

test.describe('spoilage', () => {
  const CROP_SPOIL_MS = 2 * DAY_LENGTH_MS;

  /** One ripe wheat plot, the rest empty. */
  const ripeField = (plot = {}) => ([
    { crop: 'wheat', plantedAt: secondsAgo(60), ...plot },
    ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
  ]);

  const firstPlot = (page) => page.locator('#plotsGrid > *').first();

  /** Moves plot 0's deadline to a chosen point and runs the spoilage pass. */
  const setDeadline = (page, at) => page.evaluate((t) => {
    state.plots[0].spoilsAt = t;
    updateSpoilage();
    render();
  }, at);

  test('a ripe crop starts a shelf-life countdown', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));

    // The growth bar becomes a freshness gauge once the crop is ripe.
    await expect(firstPlot(page).locator('.plot-progress-fill.freshness')).toHaveCount(1);

    await expect.poll(async () => (await readSave(page)).plots[0].spoilsAt)
      .toBeGreaterThan(Date.now());
    const { spoilsAt } = (await readSave(page)).plots[0];
    expect(spoilsAt).toBeLessThanOrEqual(Date.now() + CROP_SPOIL_MS);
  });

  test('the last stretch of shelf life is flagged as wilting', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await expect(firstPlot(page)).toHaveClass(/ready/);

    // Comfortably inside the final 30% of the window, but not past it.
    await setDeadline(page, Date.now() + 0.15 * CROP_SPOIL_MS);

    await expect(firstPlot(page)).toHaveClass(/wilting/);
    await expect(firstPlot(page)).toHaveAttribute('aria-label', /going off soon/);
  });

  test('a crop left past its window rots and yields nothing', async ({ page }) => {
    await load(page, makeSave({ inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 }, plots: ripeField() }));
    await expect(firstPlot(page)).toHaveClass(/ready/);

    await setDeadline(page, Date.now() - 1);

    await expect(firstPlot(page)).toHaveClass(/rotten/);
    expect((await readSave(page)).plots[0].rotten).toBe(true);

    // Tapping it clears the plot rather than paying out a harvest.
    await tapPlot(firstPlot(page));
    await worked(page);
    const s = await readSave(page);
    expect(s.inventory.wheat).toBe(0);
    expect(s.stats.totalHarvested).toBe(0);
    expect(s.plots[0]).toEqual({ crop: null, plantedAt: null, spoilsAt: null, rotten: false });
    await expect(firstPlot(page)).toHaveClass(/empty/);
  });

  test('harvesting is refused once a crop has rotted', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await setDeadline(page, Date.now() - 1);

    // Bypass the click handler: even called directly, harvest must not pay out.
    await page.evaluate(() => harvestPlot(0));
    const s = await readSave(page);
    expect(s.inventory.wheat).toBe(0);
    expect(s.plots[0].crop).toBe('wheat');
  });

  test('shelf life does not burn down while the game is closed', async ({ page }) => {
    const away = 20 * 60 * 1000;
    await load(page, makeSave({
      // Left the game with about half the window left; long gone since.
      plots: ripeField({ spoilsAt: Date.now() - away + 0.5 * CROP_SPOIL_MS }),
      lastSeenAt: Date.now() - away,
    }));

    await expect(firstPlot(page)).toHaveClass(/ready/);
    await expect(firstPlot(page)).not.toHaveClass(/rotten/);
    const { spoilsAt } = (await readSave(page)).plots[0];
    // The absence was handed back, so roughly half the window remains.
    expect(spoilsAt - Date.now()).toBeGreaterThan(0.4 * CROP_SPOIL_MS);
  });

  test('a save from before spoilage keeps its ripe crops', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'pumpkin', plantedAt: secondsAgo(600) }, // no spoilsAt field at all
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(firstPlot(page)).toHaveClass(/ready/);
    await expect(firstPlot(page)).not.toHaveClass(/rotten/);
    // A fresh countdown starts from arrival rather than from planting.
    await expect.poll(async () => (await readSave(page)).plots[0].spoilsAt)
      .toBeGreaterThan(Date.now());
  });

  test('crows leave a rotten plot alone', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await setDeadline(page, Date.now() - 1);

    await page.evaluate(() => {
      state.nextPestRaidAt = Date.now();
      updateRaids();
    });

    // Nothing left for them to take, so the plot survives untouched.
    expect((await readSave(page)).plots[0]).toMatchObject({ crop: 'wheat', rotten: true });
  });
});

/* ------------------------------------------------------------------ */
/* Starvation                                                          */
/* ------------------------------------------------------------------ */

test.describe('starvation', () => {
  const ANIMAL_STARVE_MS = 4 * DAY_LENGTH_MS;

  const hungryCow = (extra = {}) => [{ id: 1, state: 'hungry', feedAt: null, ...extra }];

  /** Moves the cow's deadline to a chosen point and runs the starvation pass. */
  const setDeadline = (page, at) => page.evaluate((t) => {
    state.cows[0].starvesAt = t;
    updateStarvation();
    render();
  }, at);

  const openAnimals = (page) => page.getByRole('button', { name: /Animals/ }).click();

  test('a hungry animal starts a starvation countdown', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);

    // The production bar doubles as the hunger gauge while the animal waits.
    await expect(page.locator('#cowList .animal-progress-fill.hunger')).toHaveCount(1);

    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now());
    const { starvesAt } = (await readSave(page)).cows[0];
    expect(starvesAt).toBeLessThanOrEqual(Date.now() + ANIMAL_STARVE_MS);
  });

  test('the last stretch before death is flagged as starving', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);
    await expect(page.locator('#cowList .animal-state.hungry')).toHaveCount(1);

    // Well inside the final quarter of the window, but not past it.
    await setDeadline(page, Date.now() + 0.1 * ANIMAL_STARVE_MS);

    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('is starving');
    expect((await readSave(page)).cows[0].starvingWarned).toBe(true);
  });

  test('an animal left hungry too long dies', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);

    await setDeadline(page, Date.now() - 1);

    await expect(page.locator('#toast')).toContainText('starved to death');
    expect((await readSave(page)).cows).toEqual([]);
    await expect(page.locator('#cowList p')).toHaveCount(1); // empty-state text
  });

  test('feeding resets the clock', async ({ page }) => {
    await load(page, makeSave({
      cows: hungryCow(),
      nextAnimalId: 2,
      inventory: { wheat: 0, corn: 4, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await openAnimals(page);

    // On the brink, then fed with a moment to spare.
    await setDeadline(page, Date.now() + 0.05 * ANIMAL_STARVE_MS);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);
    await page.locator('#cowList .animal-btn').click();
    await worked(page);

    const s = await readSave(page);
    expect(s.cows[0].state).toBe('producing');
    expect(s.cows[0].starvesAt).toBeNull();
    expect(s.cows[0].starvingWarned).toBe(false);

    // ...and once the milk is collected it gets a full window again.
    await page.evaluate(() => { state.cows[0].feedAt = Date.now() / 1000 - 60; });
    await page.locator('#cowList .animal-btn').click(); // collect
    await worked(page);
    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now() + 0.9 * ANIMAL_STARVE_MS);
  });

  test('hunger does not burn down while the game is closed', async ({ page }) => {
    const away = 30 * 60 * 1000;
    await load(page, makeSave({
      // Walked away with about half the window left; long gone since.
      cows: hungryCow({ starvesAt: Date.now() - away + 0.5 * ANIMAL_STARVE_MS }),
      nextAnimalId: 2,
      lastSeenAt: Date.now() - away,
    }));
    await openAnimals(page);

    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(0);
    const { starvesAt } = (await readSave(page)).cows[0];
    expect(starvesAt - Date.now()).toBeGreaterThan(0.4 * ANIMAL_STARVE_MS);
  });

  test('a save from before starvation keeps its animals', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }], // no starvesAt field at all
      nextAnimalId: 2,
    }));
    await openAnimals(page);

    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);
    // A fresh window starts from arrival rather than from whenever it was fed.
    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now());
  });

  test('guardians starve too', async ({ page }) => {
    await load(page, makeSave({
      dogs: [{ id: 90, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await openAnimals(page);

    await expect(page.locator('#dogList .animal-progress-fill.hunger')).toHaveCount(1);
    await page.evaluate(() => {
      state.dogs[0].starvesAt = Date.now() - 1;
      updateStarvation();
      render();
    });

    await expect(page.locator('#toast')).toContainText('starved to death');
    expect((await readSave(page)).dogs).toEqual([]);
  });

  test('a starving animal can still be sold rather than lost', async ({ page }) => {
    await load(page, makeSave({ coins: 0, cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);

    await setDeadline(page, Date.now() + 0.05 * ANIMAL_STARVE_MS);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);

    page.on('dialog', (d) => d.accept());
    await page.locator('#cowList .animal-btn-sell').click();
    await expect.poll(() => coins(page)).toBe(50); // half the 100-coin base cost
  });
});

/* ------------------------------------------------------------------ */
/* Market + achievements                                               */
/* ------------------------------------------------------------------ */

test.describe('market', () => {
  test('selling goods pays out and zeroes the stock', async ({ page }) => {
    await load(page, makeSave({
      coins: 0,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    const milk = page.locator('#sellList .market-item').filter({ hasText: 'Milk' });
    await milk.getByRole('button').click();

    await expect.poll(() => coins(page)).toBe(18); // 2 x 9
    await expect(milk.locator('.market-have')).toHaveText('Have: 0');
    await expect(milk.getByRole('button')).toBeDisabled();
  });
});

test.describe('achievements', () => {
  test('a met condition unlocks and pays its reward once', async ({ page }) => {
    await load(page, makeSave({ coins: 0, stats: { totalHarvested: 1, totalCoinsEarned: 0 } }));
    await page.getByRole('button', { name: /Awards/ }).click();

    // "First Harvest" pays 10.
    await expect.poll(() => coins(page)).toBe(10);
    await expect(page.locator('.achievement-card.unlocked')).toHaveCount(1);
    await expect(page.locator('#achievementsProgress')).toHaveText('1 / 11 unlocked');

    // It must not pay again on subsequent ticks.
    await page.waitForTimeout(2200);
    expect(await coins(page)).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering: elements persist so CSS animations are not restarted     */
/* ------------------------------------------------------------------ */

test.describe('incremental rendering', () => {
  test('a growing plot keeps its element while its progress advances', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'carrot', plantedAt: secondsAgo(1) }, // 50s grow time
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.evaluate(() => { window.__el = document.querySelector('#plotsGrid').children[0]; });
    const widthBefore = await page.locator('#plotsGrid > *').first()
      .locator('.plot-progress-fill').evaluate((el) => el.style.width);

    await page.waitForTimeout(2500);

    expect(await page.evaluate(
      () => window.__el === document.querySelector('#plotsGrid').children[0],
    )).toBe(true);

    const widthAfter = await page.locator('#plotsGrid > *').first()
      .locator('.plot-progress-fill').evaluate((el) => el.style.width);
    expect(parseFloat(widthAfter)).toBeGreaterThan(parseFloat(widthBefore));
  });

  test('a producing animal card keeps its element across ticks', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'producing', feedAt: secondsAgo(1) }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();
    await page.waitForSelector('#cowList .animal-card');

    await page.evaluate(() => { window.__c = document.querySelector('#cowList .animal-card'); });
    await page.waitForTimeout(2500);

    expect(await page.evaluate(
      () => window.__c === document.querySelector('#cowList .animal-card'),
    )).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Day cycle                                                           */
/* ------------------------------------------------------------------ */

test.describe('day cycle', () => {
  test('the calendar does not move while the game is closed', async ({ page }) => {
    // An old save whose wall-clock anchor is an hour in the past: under the
    // previous rules that was forty free days.
    const stale = makeSave({ day: 3 });
    stale.dayStartedAt = Date.now() - 40 * DAY_LENGTH_MS;
    await load(page, stale);
    await page.waitForTimeout(1500);

    const s = await readSave(page);
    expect(s.day).toBe(3);
    expect(s.dayStartedAt).toBeUndefined(); // the wall-clock anchor is gone
  });

  test('a long absence is not banked as play time', async ({ page }) => {
    await load(page, makeSave({ day: 5, dayElapsedMs: 0 }));
    await page.waitForTimeout(1200);

    // Even a huge gap since the last tick only ever credits one step.
    await page.evaluate(() => {
      lastDayTickAt = Date.now() - 60 * 60 * 1000; // an hour of throttled tab
      updateDay();
    });

    const s = await readSave(page);
    expect(s.day).toBe(5);
    expect(s.dayElapsedMs).toBeLessThan(10_000);
  });

  test('playing does move the calendar on', async ({ page }) => {
    // A day's worth of play already banked: the next tick rolls it over.
    await load(page, makeSave({ day: 4, dayElapsedMs: DAY_LENGTH_MS - 200 }));

    await expect.poll(async () => (await readSave(page)).day).toBe(5);
  });

  test('rollover carries the remainder instead of snapping back to dawn', async ({ page }) => {
    await load(page, makeSave({ day: 1 }));

    // Overshoot the boundary on the live clock — a save is clamped to one day,
    // so this is the only way to land mid-rollover.
    const remainder = 30_000;
    const after = await page.evaluate((over) => {
      state.dayElapsedMs = over;
      updateDay();
      return { day: state.day, dayElapsedMs: state.dayElapsedMs };
    }, DAY_LENGTH_MS + remainder);

    expect(after.day).toBe(2);
    expect(after.dayElapsedMs).toBeGreaterThanOrEqual(remainder);
    expect(after.dayElapsedMs).toBeLessThan(DAY_LENGTH_MS);
  });

  test('a saved part-day is never more than one day', async ({ page }) => {
    await load(page, makeSave({ day: 1, dayElapsedMs: 5 * DAY_LENGTH_MS }));

    // A save cannot smuggle in banked days it never played.
    expect((await readSave(page)).day).toBeLessThanOrEqual(2);
  });

  test('the sun and moon stay on screen across the whole cycle', async ({ page }) => {
    await load(page, makeSave());

    for (const fraction of [0, 0.15, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      await page.evaluate((offset) => {
        state.dayElapsedMs = offset;
        updateDayNightVisuals();
      }, fraction * DAY_LENGTH_MS);
      await page.waitForTimeout(150);

      const box = await page.locator('#celestialBody').boundingBox();
      const viewport = page.viewportSize();
      expect(box.x + box.width).toBeGreaterThan(0);
      expect(box.x).toBeLessThan(viewport.width);
      expect(box.y).toBeGreaterThan(-box.height);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Government subsidy                                                  */
/* ------------------------------------------------------------------ */

test.describe('government subsidy', () => {
  const SUBSIDY = 100;
  /** Awards pre-unlocked so their rewards stay out of the arithmetic. */
  const subSave = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });

  test('a new farm starts with 100 coins', async ({ page }) => {
    await load(page, undefined); // no save at all: a genuinely fresh game
    await page.locator('.farmer-option').first().click();

    expect(await coins(page)).toBe(100);
    expect((await readSave(page)).subsidiesPaid).toBe(0);
  });

  test('nothing is paid during the first week', async ({ page }) => {
    await load(page, subSave({ coins: 0, day: 7, subsidiesPaid: 0 }));
    await page.waitForTimeout(1200);

    // Day 7 is still week one — the week has not been survived yet.
    expect(await coins(page)).toBe(0);
    expect((await readSave(page)).subsidiesPaid).toBe(0);
  });

  test('surviving a week pays a subsidy', async ({ page }) => {
    await load(page, subSave({ coins: 0, day: 8, subsidiesPaid: 0 }));

    await expect.poll(() => coins(page)).toBe(SUBSIDY);
    await expect(page.locator('#toast')).toContainText('Government subsidy');
    await expect(page.locator('#toast')).toContainText('surviving week 1');
    const s = await readSave(page);
    expect(s.subsidiesPaid).toBe(1);
    expect(s.stats.totalCoinsEarned).toBe(SUBSIDY);
  });

  test('it is paid once per week, not once per tick', async ({ page }) => {
    await load(page, subSave({ coins: 0, day: 8, subsidiesPaid: 0 }));
    await expect.poll(() => coins(page)).toBe(SUBSIDY);

    await page.waitForTimeout(2500); // several more ticks
    expect(await coins(page)).toBe(SUBSIDY);
  });

  test('a second week pays again', async ({ page }) => {
    await load(page, subSave({ coins: 0, day: 15, subsidiesPaid: 1 }));

    await expect.poll(() => coins(page)).toBe(SUBSIDY);
    await expect(page.locator('#toast')).toContainText('surviving week 2');
    expect((await readSave(page)).subsidiesPaid).toBe(2);
  });

  test('no subsidy accrues for time spent away from the game', async ({ page }) => {
    // The old wall-clock anchor says three weeks; none of it was played.
    const stale = subSave({ coins: 0, day: 1, subsidiesPaid: 0 });
    stale.dayStartedAt = Date.now() - 22 * DAY_LENGTH_MS;
    await load(page, stale);
    await page.waitForTimeout(1500);

    expect(await coins(page)).toBe(0);
    expect((await readSave(page)).subsidiesPaid).toBe(0);
  });

  test('several weeks owed are still settled in one payment', async ({ page }) => {
    // Weeks genuinely played through, e.g. after a burst of catching up.
    await load(page, subSave({ coins: 0, day: 22, subsidiesPaid: 0 }));

    await expect.poll(() => coins(page)).toBe(3 * SUBSIDY);
    await expect(page.locator('#toast')).toContainText('3 weeks of farming');
    expect((await readSave(page)).subsidiesPaid).toBe(3);
  });

  test('an existing farm does not collect backdated weeks on load', async ({ page }) => {
    // A day-40 save from before subsidies existed: no windfall.
    const save = subSave({ coins: 500, day: 40 });
    delete save.subsidiesPaid;
    await load(page, save);
    await page.waitForTimeout(1200);

    expect(await coins(page)).toBe(500);
    expect((await readSave(page)).subsidiesPaid).toBe(5); // (40 - 1) / 7
  });

  test('a collapsed farm collects nothing', async ({ page }) => {
    await load(page, subSave({ coins: 0, day: 30, subsidiesPaid: 0, gameOver: true }));
    await page.waitForTimeout(1200);

    expect(await coins(page)).toBe(0);
    expect((await readSave(page)).subsidiesPaid).toBe(0);
  });

  test('the help panel explains the subsidy', async ({ page }) => {
    await load(page, subSave());
    await page.locator('#helpBtn').click();

    const text = await page.locator('#helpBody').textContent();
    expect(text).toContain('government subsidy');
    expect(text).toContain('Every 7 days');
  });
});

/* ------------------------------------------------------------------ */
/* Save loading and migration                                          */
/* ------------------------------------------------------------------ */

test.describe('save migration', () => {
  test('a pre-expansion v1 save is upgraded rather than discarded', async ({ page }) => {
    // v1: 12 plots, no unlockedPlots, no sheep, no pumpkin/wool, no stats.
    const legacy = {
      coins: 275,
      day: 5,
      plots: Array.from({ length: 12 }, () => ({ crop: null, plantedAt: null })),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      chickens: [],
      nextAnimalId: 2,
      inventory: { wheat: 4, corn: 2, carrot: 1, milk: 3, egg: 6 },
    };
    await load(page, legacy, LEGACY_KEY);

    const s = await readSave(page);
    expect(s.coins).toBe(275);
    expect(s.inventory.wheat).toBe(4);
    // Goods added after v1 must default to 0, never undefined.
    expect(s.inventory.pumpkin).toBe(0);
    expect(s.inventory.wool).toBe(0);
    expect(s.plots).toHaveLength(PLOT_COUNT);
    expect(s.unlockedPlots).toBe(8);
    expect(s.sheep).toEqual([]);
    expect(s.stats).toEqual({ totalHarvested: 0, totalCoinsEarned: 0 });
  });

  test('a migrated save keeps arithmetic numeric', async ({ page }) => {
    await load(page, {
      coins: 50,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(30) },
        ...Array.from({ length: 11 }, () => ({ crop: null, plantedAt: null })),
      ],
      inventory: { wheat: 1 }, // every other good missing
    }, LEGACY_KEY);

    // A save this old predates the farmer, so the picker is in the way.
    await page.locator('.farmer-option').first().click();
    await tapPlot(page.locator('#plotsGrid > *').first()); // harvest
    await worked(page);

    const inv = await inventory(page);
    for (const [good, count] of Object.entries(inv)) {
      expect(Number.isFinite(count), `${good} should be a number, got ${count}`).toBe(true);
    }
    expect(inv.wheat).toBe(4); // 1 carried over + 3 harvested
  });

  test('content that no longer exists is dropped from the save', async ({ page }) => {
    await load(page, makeSave({
      selectedSeed: 'dragonfruit',
      plots: [
        { crop: 'dragonfruit', plantedAt: secondsAgo(5) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      unlockedAchievements: ['first_harvest', 'no_such_achievement'],
    }));

    const s = await readSave(page);
    expect(s.plots[0]).toEqual({ crop: null, plantedAt: null, spoilsAt: null, rotten: false });
    expect(s.selectedSeed).toBeNull();
    expect(s.unlockedAchievements).toEqual(['first_harvest']);
  });

  test('duplicate animal ids are re-issued uniquely', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 5, state: 'hungry', feedAt: null }, { id: 5, state: 'hungry', feedAt: null }],
      chickens: [{ id: 5, state: 'hungry', feedAt: null }],
      nextAnimalId: 6,
    }));

    const s = await readSave(page);
    const ids = [...s.cows, ...s.chickens, ...s.sheep].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.nextAnimalId).toBeGreaterThan(Math.max(...ids));
  });

  test('an animal stuck mid-production without a timer is reset to hungry', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'producing', feedAt: null }],
      nextAnimalId: 2,
    }));

    expect((await readSave(page)).cows[0].state).toBe('hungry');
  });

  test('a corrupt save falls back to a new farm instead of crashing', async ({ page }) => {
    await load(page, 'this is not json {{{');

    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
    await expect.poll(() => coins(page)).toBe(100); // starting purse
  });

  test('a save from before guardians gains empty pens and a fresh raid clock', async ({ page }) => {
    // Exactly what an existing player's save looks like: no dogs, cats or
    // raid timers, and livestock that predate per-animal feed.
    const preGuardians = makeSave({
      coins: 640,
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      chickens: [{ id: 2, state: 'hungry', feedAt: null }],
    });
    delete preGuardians.dogs;
    delete preGuardians.cats;
    delete preGuardians.nextWolfRaidAt;
    delete preGuardians.nextPestRaidAt;

    await load(page, preGuardians);

    const s = await readSave(page);
    expect(s.coins).toBe(640);
    expect(s.cows).toHaveLength(1);
    expect(s.dogs).toEqual([]);
    expect(s.cats).toEqual([]);
    // No ambush the moment they open the game.
    expect(s.nextWolfRaidAt).toBeGreaterThan(Date.now());
    expect(s.nextPestRaidAt).toBeGreaterThan(Date.now());
  });

  test('out-of-range plot counts are clamped', async ({ page }) => {
    await load(page, makeSave({ unlockedPlots: 999 }));
    expect((await readSave(page)).unlockedPlots).toBe(PLOT_COUNT);
  });
});

/* ------------------------------------------------------------------ */
/* Persistence of preferences                                          */
/* ------------------------------------------------------------------ */

test.describe('preferences', () => {
  test('mute survives a reload', async ({ page }) => {
    await load(page, makeSave({ muted: false }));

    await page.locator('#muteBtn').click();
    await expect.poll(async () => (await readSave(page)).muted).toBe(true);

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');
    await expect(page.locator('#muteBtn')).toHaveText('🔇');
  });

  test('dismissing the intro banner sticks', async ({ page }) => {
    await load(page, makeSave({ onboarded: false }));

    await expect(page.locator('#onboardingBanner')).toBeVisible();
    await page.locator('#onboardingDismissBtn').click();
    await expect(page.locator('#onboardingBanner')).toBeHidden();

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');
    await expect(page.locator('#onboardingBanner')).toBeHidden();
  });
});

/* ------------------------------------------------------------------ */
/* Upgrades                                                            */
/* ------------------------------------------------------------------ */

test.describe('upgrades', () => {
  const upgradeCard = (page, name) =>
    page.locator('#upgradeList .upgrade-item').filter({ hasText: name });

  test('buying a level charges the cost and records it', async ({ page }) => {
    await load(page, makeSave({ coins: 500 }));
    await page.getByRole('button', { name: /Market/ }).click();

    const sprinkler = upgradeCard(page, 'Sprinkler');
    await expect(sprinkler.locator('.upgrade-level')).toHaveText('Level 0 / 3');
    await sprinkler.getByRole('button').click();

    await expect.poll(() => coins(page)).toBe(380); // base cost 120
    await expect(sprinkler.locator('.upgrade-level')).toHaveText('Level 1 / 3');
    await expect.poll(async () => (await readSave(page)).upgrades.sprinkler).toBe(1);
  });

  test('each level costs more than the last', async ({ page }) => {
    await load(page, makeSave({ coins: 10_000 }));
    await page.getByRole('button', { name: /Market/ }).click();

    const sprinkler = upgradeCard(page, 'Sprinkler');
    const costs = [];
    for (let i = 0; i < 3; i += 1) {
      const label = await sprinkler.getByRole('button').textContent();
      costs.push(Number(label.match(/(\d+)/)[1]));
      await sprinkler.getByRole('button').click();
      await expect(sprinkler.locator('.upgrade-level')).toHaveText(`Level ${i + 1} / 3`);
    }

    expect(costs).toEqual([120, 240, 480]);
    await expect(sprinkler.getByRole('button')).toBeDisabled();
    await expect(sprinkler.getByRole('button')).toHaveText('Maxed out');
  });

  test('a level cannot be bought without the coins', async ({ page }) => {
    await load(page, makeSave({ coins: 10 }));
    await page.getByRole('button', { name: /Market/ }).click();

    await expect(upgradeCard(page, 'Sprinkler').getByRole('button')).toBeDisabled();
    await expect.poll(async () => (await readSave(page)).upgrades.sprinkler).toBe(0);
  });

  test('the sprinkler actually shortens growing time', async ({ page }) => {
    /* Pumpkins take 70s; at level 3 that drops to 44.8s. One planted 48s ago
       is therefore still growing at level 0 but ripe at level 3.

       A pumpkin rather than the obvious wheat for the same reason the sheep
       is a sheep over in "rich feed shortens animal production": the clock is
       read off a live page, so the wait between booting the game and asserting
       on it is charged to the crop, and only the "not ready yet" half is
       exposed to it, since drift can only ever age things. Wheat's 15s/9.6s
       pair spans 5.4s in total, which is less than a loaded page load; the
       pumpkin's spans 25s, and 48s leaves 22s of room. */
    const plots = () => [
      { crop: 'pumpkin', plantedAt: secondsAgo(48) },
      ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
    ];

    await load(page, makeSave({ plots: plots() }));
    await expect(page.locator('#plotsGrid > *').first()).not.toHaveClass(/ready/);

    await load(page, makeSave({
      plots: plots(),
      upgrades: { sprinkler: 3, feed: 0, fertiliser: 0, contacts: 0 },
    }));
    await expect(page.locator('#plotsGrid > *').first()).toHaveClass(/ready/);
  });

  test('fertiliser adds to every harvest', async ({ page }) => {
    await load(page, makeSave({
      upgrades: { sprinkler: 0, feed: 0, fertiliser: 2, contacts: 0 },
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());
    await expect.poll(async () => (await inventory(page)).wheat).toBe(5); // 3 base + 2
  });

  test('market contacts raise both the quoted and the paid price', async ({ page }) => {
    await load(page, makeSave({
      coins: 0,
      upgrades: { sprinkler: 0, feed: 0, fertiliser: 0, contacts: 3 },
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    // Milk is 9 base; +30% rounds to 12.
    const milk = page.locator('#sellList .market-item').filter({ hasText: 'Milk' });
    await expect(milk.locator('.market-price')).toHaveText('12💰 each');

    await milk.getByRole('button').click();
    await expect.poll(() => coins(page)).toBe(24);
  });

  test('rich feed shortens animal production', async ({ page }) => {
    /* Sheep take 35s; at level 3 that drops to 22.4s. One fed 24s ago is
       therefore still producing at level 0 but finished at level 3 — a 12.6s
       window, the widest any animal offers, and still not wide enough to be
       reached through a page load.

       So the sheep is put in place *after* the page is up, and the upgrade
       switched under it without a second load. Everything before this point
       is what makes a fixture-seeded version of this test flake: booting the
       game takes 9 to 12 seconds when four workers are contending, all of it
       charged to an animal that only has 11 seconds to spare, and the "still
       producing" half is the one exposed, since drift can only ever age the
       sheep. Done this way the only elapsed time that counts is the gap
       between the two assertions below, which is a render tick. */
    await load(page, makeSave({ nextAnimalId: 2 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.evaluate(() => {
      state.upgrades.feed = 0;
      state.sheep = [{ id: 1, state: 'producing', feedAt: Date.now() / 1000 - 24 }];
    });
    await expect(page.locator('#sheepList .animal-state.producing')).toHaveCount(1);

    await page.evaluate(() => { state.upgrades.feed = 3; });
    await expect(page.locator('#sheepList .animal-state.ready')).toHaveCount(1);
  });

  test('upgrade levels survive migration and are clamped', async ({ page }) => {
    await load(page, makeSave({
      upgrades: { sprinkler: 2, feed: 99, fertiliser: -4, nonsense: 7 },
    }));

    const saved = (await readSave(page)).upgrades;
    expect(saved.sprinkler).toBe(2);
    expect(saved.feed).toBe(3);       // clamped to maxLevel
    expect(saved.fertiliser).toBe(0); // clamped up from negative
    expect(saved.contacts).toBe(0);   // defaulted
    expect(saved.nonsense).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Dream homes — the two grand goals                                   */
/* ------------------------------------------------------------------ */

test.describe('dream homes', () => {
  const HOUSE_COST = 20000;
  const VILLA_COST = 40000;

  /** Awards pre-unlocked so their coin rewards stay out of the arithmetic. */
  const dreamSave = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });

  const openDream = (page) => page.getByRole('button', { name: /Dream/ }).click();
  const card = (page, i) => page.locator('#dreamList > *').nth(i);
  const houseBtn = (page) => card(page, 0).locator('.dream-btn');
  const villaBtn = (page) => card(page, 1).locator('.dream-btn');

  /** window.confirm defaults to dismissed under Playwright. */
  const acceptConfirms = (page) => page.on('dialog', (d) => d.accept());

  test('both goals are listed with their prices', async ({ page }) => {
    await load(page, dreamSave({ coins: 0 }));
    await openDream(page);

    await expect(page.locator('#dreamList > *')).toHaveCount(2);
    await expect(card(page, 0)).toContainText('Country House');
    await expect(card(page, 0)).toContainText('20,000💰');
    await expect(card(page, 1)).toContainText('Grand Villa');
    await expect(card(page, 1)).toContainText('40,000💰');
  });

  test('neither can be bought without the coins', async ({ page }) => {
    await load(page, dreamSave({ coins: HOUSE_COST - 1 }));
    await openDream(page);

    await expect(houseBtn(page)).toBeDisabled();
    await expect(villaBtn(page)).toBeDisabled();
    expect((await readSave(page)).dreamHome).toBeNull();
  });

  test('savings progress is shown against each goal', async ({ page }) => {
    await load(page, dreamSave({ coins: 10000 }));
    await openDream(page);

    // Halfway to the house, a quarter of the way to the villa.
    await expect(card(page, 0).locator('.dream-progress')).toHaveAttribute('aria-valuenow', '50');
    await expect(card(page, 1).locator('.dream-progress')).toHaveAttribute('aria-valuenow', '25');
  });

  test('buying the house ends the run and takes the villa off the market', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: HOUSE_COST + 500 }));
    await openDream(page);

    await expect(houseBtn(page)).toBeEnabled();
    await houseBtn(page).click();

    await expect(page.locator('#toast')).toContainText('You bought the Country House');
    const s = await readSave(page);
    expect(s.dreamHome).toBe('house');
    expect(s.coins).toBe(500);

    await expect(card(page, 0)).toHaveClass(/owned/);
    await expect(houseBtn(page)).toHaveText('🎉 Yours — see it again');
    await expect(card(page, 1)).toHaveClass(/forfeited/);
    await expect(villaBtn(page)).toBeDisabled();
    await expect(villaBtn(page)).toHaveText('No longer available');
  });

  test('the villa is the other way to finish', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: VILLA_COST }));
    await openDream(page);

    // With villa money in hand, both are affordable — it is a real choice.
    await expect(houseBtn(page)).toBeEnabled();
    await villaBtn(page).click();

    const s = await readSave(page);
    expect(s.dreamHome).toBe('villa');
    expect(s.coins).toBe(0);
    await expect(card(page, 1)).toHaveClass(/owned/);
    await expect(card(page, 0)).toHaveClass(/forfeited/);
  });

  test('declining the confirmation leaves the coins alone', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, dreamSave({ coins: HOUSE_COST }));
    await openDream(page);

    await houseBtn(page).click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.dreamHome).toBeNull();
    expect(s.coins).toBe(HOUSE_COST);
  });

  test('a second home cannot be bought after the first', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: VILLA_COST + HOUSE_COST, dreamHome: 'house' }));
    await openDream(page);

    // Even called directly, with the coins in hand, the goal stays settled.
    await page.evaluate(() => buyDreamHome('villa'));
    const s = await readSave(page);
    expect(s.dreamHome).toBe('house');
    expect(s.coins).toBe(VILLA_COST + HOUSE_COST);
  });

  test('buying a home celebrates it from the inside, with fireworks', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: HOUSE_COST, day: 12, stats: { totalHarvested: 84, totalCoinsEarned: 30000 } }));
    await openDream(page);
    await expect(page.locator('#endingOverlay')).toBeHidden();

    await houseBtn(page).click();

    const ending = page.locator('#endingOverlay');
    await expect(ending).toBeVisible();
    await expect(page.locator('#endingTitle')).toContainText('Home at last');
    // The room is dressed as the cottage that was actually bought.
    await expect(page.locator('#endingScene')).toHaveClass(/house/);
    await expect(page.locator('#endingFarmer')).toHaveText('👩‍🌾');
    // Fireworks are really there, not just a caption.
    await expect(page.locator('#endingFireworks .firework')).toHaveCount(7);
    expect(await page.locator('#endingFireworks .spark').count()).toBeGreaterThan(50);
    // ...and the run is summed up.
    await expect(page.locator('#endingStats')).toContainText('Days farmed');
    await expect(page.locator('#endingStats')).toContainText('84');
  });

  test('the villa gets its own room', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: VILLA_COST, farmer: 'male' }));
    await openDream(page);

    await villaBtn(page).click();

    await expect(page.locator('#endingScene')).toHaveClass(/villa/);
    await expect(page.locator('#endingScene')).not.toHaveClass(/house/);
    await expect(page.locator('#endingFarmer')).toHaveText('👨‍🌾');
  });

  test('the celebration closes and the farm carries on', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: HOUSE_COST }));
    await openDream(page);
    await houseBtn(page).click();
    await expect(page.locator('#endingOverlay')).toBeVisible();

    await page.locator('#endingCloseBtn').click();

    await expect(page.locator('#endingOverlay')).toBeHidden();
    // The sparks are torn down rather than left animating out of sight.
    await expect(page.locator('#endingFireworks .firework')).toHaveCount(0);
    // The game is still playable — a home is an ending, not a lockout.
    await expect(page.locator('#gameOverOverlay')).toBeHidden();
    expect((await readSave(page)).dreamHome).toBe('house');
  });

  test('the celebration can be replayed from the owned card', async ({ page }) => {
    await load(page, dreamSave({ coins: 10, dreamHome: 'villa' }));
    await openDream(page);
    await expect(page.locator('#endingOverlay')).toBeHidden();

    await villaBtn(page).click();

    await expect(page.locator('#endingOverlay')).toBeVisible();
    await expect(page.locator('#endingScene')).toHaveClass(/villa/);
  });

  test('the choice survives a reload, and a bogus one is discarded', async ({ page }) => {
    await load(page, dreamSave({ coins: 10, dreamHome: 'villa' }));
    await openDream(page);
    await expect(card(page, 1)).toHaveClass(/owned/);
    expect((await readSave(page)).dreamHome).toBe('villa');

    await load(page, dreamSave({ coins: 10, dreamHome: 'mansion' }));
    expect((await readSave(page)).dreamHome).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Sound settings                                                      */
/* ------------------------------------------------------------------ */

test.describe('sound settings', () => {
  test('music can be toggled and the choice persists', async ({ page }) => {
    await load(page, makeSave({ musicOn: true }));
    await page.getByRole('button', { name: /Market/ }).click();

    const music = page.locator('#musicToggleBtn');
    await expect(music).toHaveAttribute('aria-pressed', 'true');

    await music.click();
    await expect(music).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await readSave(page)).musicOn).toBe(false);

    await page.reload();
    await page.getByRole('button', { name: /Market/ }).click();
    await expect(page.locator('#musicToggleBtn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the volume slider stores its value and unmutes', async ({ page }) => {
    await load(page, makeSave({ muted: true, volume: 0.7 }));
    await page.getByRole('button', { name: /Market/ }).click();

    // Muted reads as 0% regardless of the stored level.
    await expect(page.locator('#volumeReadout')).toHaveText('0%');

    await page.locator('#volumeSlider').fill('40');
    await expect(page.locator('#volumeReadout')).toHaveText('40%');

    const saved = await readSave(page);
    expect(saved.volume).toBeCloseTo(0.4, 5);
    expect(saved.muted).toBe(false);
  });

  test('the topbar mute button and the volume readout agree', async ({ page }) => {
    await load(page, makeSave({ muted: false, volume: 1 }));
    await page.getByRole('button', { name: /Market/ }).click();
    await expect(page.locator('#volumeReadout')).toHaveText('100%');

    await page.locator('#muteBtn').click();
    await expect(page.locator('#volumeReadout')).toHaveText('0%');
  });
});

/* ------------------------------------------------------------------ */
/* Welcome back                                                        */
/* ------------------------------------------------------------------ */

test.describe('welcome back', () => {
  const minutesAgo = (m) => Date.now() - m * 60_000;

  test('summarises what finished while the tab was closed', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: minutesAgo(10),
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(300) }, // ripened during the gap
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      cows: [{ id: 1, state: 'producing', feedAt: secondsAgo(300) }],
      nextAnimalId: 2,
    }));

    const banner = page.locator('#welcomeBack');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1 crop ripened');
    await expect(banner).toContainText('1 animal finished producing');

    await page.locator('#welcomeDismissBtn').click();
    await expect(banner).toBeHidden();
  });

  test('stays quiet after a short absence', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: Date.now() - 30_000,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(page.locator('#welcomeBack')).toBeHidden();
  });

  test('stays quiet when nothing actually finished', async ({ page }) => {
    await load(page, makeSave({ lastSeenAt: minutesAgo(30) }));
    await expect(page.locator('#welcomeBack')).toBeHidden();
  });

  test('a crop that was already ripe before leaving is not counted again', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: minutesAgo(10),
      plots: [
        // Ripened an hour ago, well before the player left.
        { crop: 'wheat', plantedAt: secondsAgo(3600) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(page.locator('#welcomeBack')).toBeHidden();
  });
});

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

test.describe('accessibility', () => {
  test('plots are real buttons with descriptive labels', async ({ page }) => {
    await load(page, makeSave({
      unlockedPlots: 8,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) }, // ready
        { crop: 'carrot', plantedAt: secondsAgo(2) }, // growing
        ...Array.from({ length: PLOT_COUNT - 2 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const cells = page.locator('#plotsGrid > *');
    expect(await cells.first().evaluate((el) => el.tagName)).toBe('BUTTON');

    await expect(cells.nth(0)).toHaveAttribute('aria-label', /Wheat ready to harvest/);
    await expect(cells.nth(1)).toHaveAttribute('aria-label', /Carrot growing/);
    await expect(cells.nth(2)).toHaveAttribute('aria-label', /empty/i);
    await expect(cells.nth(8)).toHaveAttribute('aria-label', /locked. Unlock for 30 coins/);
  });

  test('an unreachable locked plot is disabled rather than a dead button', async ({ page }) => {
    await load(page, makeSave({ unlockedPlots: 8 }));

    await expect(page.locator('#plotsGrid > *').nth(8)).toBeEnabled();  // next to unlock
    await expect(page.locator('#plotsGrid > *').nth(9)).toBeDisabled(); // not yet reachable
  });

  test('a crop can be planted using only the keyboard', async ({ page }) => {
    await load(page, makeSave({ coins: 300 }));

    // Focus the last seed, choose it with Enter, tab into the grid, plant.
    await page.locator('.seed-btn').last().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.seed-btn').last()).toHaveClass(/selected/);

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.className)).toContain('plot');

    await page.keyboard.press('Enter');
    await expect.poll(() => coins(page)).toBe(265); // pumpkin seed costs 35
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('growth is exposed as a progress bar', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'carrot', plantedAt: secondsAgo(25) }, // 50s grow time, ~50%
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const bar = page.locator('#plotsGrid > *').first().locator('[role="progressbar"]');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    const now = Number(await bar.getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThan(30);
    expect(now).toBeLessThan(70);
  });

  test('the toast is an announced live region', async ({ page }) => {
    await load(page, makeSave({ coins: 0 }));

    await expect(page.locator('#toast')).toHaveAttribute('role', 'status');
    await expect(page.locator('#toast')).toHaveAttribute('aria-live', 'polite');
  });

  test('the mute control reports its state', async ({ page }) => {
    await load(page, makeSave({ muted: false }));

    const mute = page.locator('#muteBtn');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect(mute).toHaveAttribute('aria-label', 'Mute sound');

    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(mute).toHaveAttribute('aria-label', 'Unmute sound');
  });
});

/* ------------------------------------------------------------------ */
/* Installability and offline play                                     */
/* ------------------------------------------------------------------ */

test.describe('progressive web app', () => {
  test('serves a valid manifest with reachable icons', async ({ page, request }) => {
    await load(page, makeSave());

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('manifest.webmanifest');

    const res = await request.get(`/${href}`);
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe('Farm Life 3D');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const iconRes = await request.get(`/${icon.src}`);
      expect(iconRes.status(), `${icon.src} should be reachable`).toBe(200);
      expect(iconRes.headers()['content-type']).toContain('image/png');
    }
  });

  test('registers a service worker and still plays with the network down', async ({ page, context }) => {
    await load(page, makeSave({ coins: 300 }));

    // The very first page load is never controlled — the worker is still
    // installing while that navigation is in flight. Wait for it to become
    // active, then reload so this page is served through it.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
      if (controlled) break;
      await page.reload();
      await page.waitForSelector('#plotsGrid .plot');
    }
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    await page.reload();

    // The shell came from the cache, and the game is still interactive.
    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
    await page.locator('.seed-btn').first().click();
    await tapPlot(page.locator('#plotsGrid .plot.empty').first());
    await expect.poll(() => coins(page)).toBe(295);

    await context.setOffline(false);
  });
});

/* ------------------------------------------------------------------ */
/* The vendored asset pipeline                                         */
/* ------------------------------------------------------------------ */

/* The models are third-party files fetched by tools/vendor.mjs and committed.
   What these pin down is that they are reachable, that they parse through the
   game's own import map with no build step in the way, that the loader gives
   them a sane world scale, and — the one that matters most — that they are
   precached, because an offline game that renders an empty field is a broken
   promise rather than a degraded one. */
test.describe('asset pipeline', () => {
  /* Runs inside the page so the import map, the vendored GLTFLoader and its
     transitive imports are all exercised exactly as the game will use them. */
  const loadInPage = (page, id) => page.evaluate(async (modelId) => {
    const [{ loadModel }, THREE] = await Promise.all([
      import('./assets.js'),
      import('three'),
    ]);
    const { object, animations } = await loadModel(modelId);
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    let meshes = 0;
    object.traverse((child) => { if (child.isMesh) meshes += 1; });
    return { meshes, height: size.y, clips: animations.map((clip) => clip.name) };
  }, id);

  test('a model parses through the import map, with no build step', async ({ page }) => {
    await load(page, makeSave());

    const tree = await loadInPage(page, 'nature/tree_default');
    expect(tree.meshes).toBeGreaterThan(0);
    // The Nature Kit is the scale reference, so it is placed as authored.
    expect(tree.height).toBeGreaterThan(1.5);
    expect(tree.height).toBeLessThan(2);
  });

  test('models are normalised to a target height, not their authored one', async ({ page }) => {
    await load(page, makeSave());

    /* Authored, these two are nonsense next to each other: the chicken's model
       is larger than the cow's. Normalising is what makes a herd read. */
    const cow = await loadInPage(page, 'cube-pets/animal-cow');
    const chicken = await loadInPage(page, 'cube-pets/animal-chick');

    expect(cow.height).toBeCloseTo(0.9, 2);
    expect(chicken.height).toBeCloseTo(0.4, 2);
    expect(cow.height).toBeGreaterThan(chicken.height);
  });

  test('the farmer arrives with the clips she needs to be animated', async ({ page }) => {
    await load(page, makeSave());

    /* 1.45, not the 1.7 a person stands: these characters are chibi enough
       that a realistic height reads as a giant beside a 1-unit plot. The
       reasoning is with the number, in assets.js. */
    const farmer = await loadInPage(page, 'blocky-characters/character-a');
    expect(farmer.height).toBeCloseTo(1.45, 2);
    // Step 5 drives her from these; step 1 rejected a kit that lacked them.
    expect(farmer.clips).toEqual(expect.arrayContaining(['idle', 'walk', 'pick-up']));
  });

  test('every model in the manifest is served', async ({ request }) => {
    const res = await request.get('/assets/manifest.json');
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.files.length).toBeGreaterThan(20);

    const missing = [];
    for (const file of manifest.files) {
      const fileRes = await request.get(`/${file.replace(/^\.\//, '')}`);
      if (fileRes.status() !== 200) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  test('the vendored three.js modules are listed and served too', async ({ request }) => {
    /* They are in the manifest rather than hand-copied into sw.js because
       following EffectComposer's imports took that set from four files to
       sixteen in a single run of tools/vendor.mjs. A list maintained by hand
       would have been wrong the moment it did, and a module missing from the
       precache is an offline farm that loads to a blank canvas. */
    const manifest = await (await request.get('/assets/manifest.json')).json();
    expect(manifest.vendor.length).toBeGreaterThan(10);
    expect(manifest.vendor).toContain('./vendor/jsm/postprocessing/EffectComposer.js');

    const missing = [];
    for (const file of manifest.vendor) {
      const res = await request.get(`/${file.replace(/^\.\//, '')}`);
      if (res.status() !== 200) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  test('the models are precached, so an offline farm is not an empty one', async ({ page, context }) => {
    await load(page, makeSave());

    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await page.evaluate(() => navigator.serviceWorker.controller !== null)) break;
      await page.reload();
      await page.waitForSelector('#plotsGrid .plot');
    }

    /* The worker precaches from assets/manifest.json, which it fetches during
       install — so this also covers the case where that fetch silently fails
       and the shell installs without any models. Checked across every named
       cache rather than one hardcoded CACHE_VERSION string, so a version
       bump in sw.js does not also require finding and updating this test. */
    await expect.poll(async () => page.evaluate(async () => {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) {
        const keys = await (await caches.open(name)).keys();
        total += keys.filter((req) => req.url.includes('/assets/models/')).length;
      }
      return total;
    }), { timeout: 15_000 }).toBeGreaterThan(20);

    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');

    const tree = await loadInPage(page, 'nature/tree_default');
    expect(tree.meshes, 'a model should still load with the network down').toBeGreaterThan(0);

    await context.setOffline(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sustained-play performance                                          */
/* ------------------------------------------------------------------ */

test.describe('post-processing budget', () => {
  /** The scene reports its own tier; 2 is bloom + AO, 1 bloom, 0 neither. */
  const scene = (page, fn) => page.evaluate(fn);

  test('the scene measures what it costs, and says which tier it settled on', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);

    /* The point of this pair is that the budget is actually running. A tier
       is asserted only to be one of the three, never to be a particular one:
       which tier a machine can afford is the whole question, and a CI worker
       sharing a software rasteriser with three siblings is entitled to a
       different answer than a desktop GPU. Pinning the expectation to 2 here
       would be a test that fails precisely when the feature works. */
    await expect.poll(
      () => scene(page, () => window.Farm3DScene.frameIntervalMs()),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    expect([0, 1, 2]).toContain(await scene(page, () => window.Farm3DScene.quality()));
  });

  test('a tab left open long enough to be judged still draws', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);

    // Past the warm-up and the settle window, which is where a step-down can
    // first happen — the scene has to survive changing its own quality.
    await expect.poll(
      () => scene(page, () => window.Farm3DScene.frameIntervalMs()),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
    const before = await scene(page, () => window.Farm3DScene.quality());

    await page.waitForTimeout(2500);
    const after = await scene(page, () => window.Farm3DScene.quality());

    // Steps down only, never back up, so the tier can fall but not climb.
    expect(after).toBeLessThanOrEqual(before);
    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
  });
});

test.describe('foliage, instanced', () => {
  /* Placement is checked by screenshot during development, the way the
     terrain's slope colouring and the props' camera-blocking were — a canvas
     has no DOM to assert a coordinate against, and re-deriving the farm's
     layout constants here would just be a second copy of scene.js's own
     geometry, free to drift out of sync with it. What a test can honestly
     check is that the scatter actually ran, for every species, and that the
     counts it produced are shaped the way the request was: more grass than
     grass_large, and both far outnumbering the sparse hillside fringe — the
     same 220:70:14:12 ratio scene.js asks for, whatever fraction of it a
     software renderer's budget kept. */
  test('every species is scattered before the scene calls itself ready', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);

    await page.evaluate(() => window.Farm3DScene.foliageReady());
    const counts = await page.evaluate(() => window.Farm3DScene.foliageCounts());

    expect(Object.keys(counts).sort()).toEqual([
      'nature/grass', 'nature/grass_large', 'nature/tree_default', 'nature/tree_pineDefaultA',
    ].sort());
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);

    expect(counts['nature/grass']).toBeGreaterThan(counts['nature/grass_large']);
    expect(counts['nature/grass_large']).toBeGreaterThan(counts['nature/tree_default']);
    expect(counts['nature/grass_large']).toBeGreaterThan(counts['nature/tree_pineDefaultA']);
  });
});

test.describe('the pond', () => {
  /* Whether it looks wet is a screenshot's question and was answered by one
     — the shader was tuned against renders at midday, dusk and midnight, and
     three of its four settled values are there because a render showed the
     first guess was wrong (see the art bible). What a test can hold onto is
     the part that would break silently: that the surface is animating at all,
     and that she cannot walk out onto it. */

  test('the water is moving, not a painted disc', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);

    const first = await page.evaluate(() => window.Farm3DScene.waterPhase());
    await page.waitForFunction(
      (t) => window.Farm3DScene.waterPhase() > t,
      first,
      { timeout: 5_000 },
    );
  });

  test('she walks round the water rather than across it', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);
    const start = await page.evaluate(() => window.Farm3DScene.farmerAt());
    const pond = await page.evaluate(() => window.Farm3DScene.pond());

    /* Sampled every frame from inside the page rather than polled over the
       wire. She only spends about a second beside the water on the way past,
       and a dozen round trips can land either side of that second — an
       earlier version of this test read her position from Playwright and
       failed whenever the walk got ahead of the polling. Every frame is also
       every step keepOutOfPond is applied on, so this is the whole of what
       happened rather than a sample of it. */
    await page.evaluate(() => {
      window.__pondTrack = [];
      const tick = () => {
        if (window.__pondTrack.length >= 3000) return;
        window.__pondTrack.push(window.Farm3DScene.farmerAt());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // Straight at it from the north, the side she starts on. The pond is
      // walk-blocked in steer() only, so this is the path a player with a
      // hand on the stick actually takes.
      window.Farm3DScene.drive(0, 1);
    });

    await page.waitForFunction(
      (z) => window.Farm3DScene.farmerAt().z > z,
      pond.z + pond.rz + 0.4,
      { timeout: 20_000 },
    );
    await page.evaluate(() => window.Farm3DScene.drive(0, 0));

    const track = await page.evaluate(() => window.__pondTrack);
    const wet = await page.evaluate(
      (pts) => pts.filter((p) => window.Farm3DScene.inPond(p.x, p.z)),
      track,
    );
    expect(wet).toEqual([]);

    /* Not a vacuous pass: driving due south holds x fixed, so her
       undeflected course is the line x = start.x, and this asserts that line
       runs through the water at the pond's own latitude. Pure geometry, so it
       says the same thing however the frames happened to fall — an earlier
       version asked instead whether she had visibly been pushed sideways,
       which is true only if some frame actually landed her on the bank, and
       under two workers a slow frame can carry her clean over the pond in one
       step. That step is not a bug — the endpoint is dry and she is never
       drawn in the water — but it does leave the push untested, which is why
       the claim being made here is about her course rather than her path. */
    expect(await page.evaluate(
      (x) => window.Farm3DScene.inPond(x, window.Farm3DScene.pond().z),
      start.x,
    )).toBe(true);
  });
});

test.describe('animals that roam', () => {
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });
  const sceneReady = (page) => page.waitForFunction(() => !!window.Farm3DScene);
  const at = (page, kind, index = 0) => page.evaluate(
    ([k, i]) => window.Farm3DScene.animalAt(k, i),
    [kind, index],
  );
  const moved = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

  test('a producing cow wanders the pen; a hungry one is left exactly where it stands', async ({ page }) => {
    await load(page, banked({
      cows: [
        { id: 1, state: 'producing', feedAt: secondsAgo(0) },
        { id: 2, state: 'hungry', feedAt: null },
      ],
    }));
    await sceneReady(page);

    const before = { fed: await at(page, 'cow', 0), hungry: await at(page, 'cow', 1) };
    /* Polled rather than a single fixed wait: the look-then-eat pause the
       roam FSM opens on (see stepLivestock in scene.js) is itself randomised
       up to 900ms before the walk leg that actually covers ground even
       starts, and under worker contention a real-time wait can land before
       that walk leg is done — a threshold of 0.05 came back 0.0497 once at
       a fixed 3.5s. Waiting for a clearly-moved distance, with room to keep
       trying, is what a person watching the pen would actually do rather
       than glance at one instant and call it. */
    await expect.poll(async () => moved(before.fed, await at(page, 'cow', 0)), {
      timeout: 10_000,
    }).toBeGreaterThan(0.2);

    /* Not "moved less" — moved not at all. A hungry animal has nothing to
       graze, so stepLivestock freezes it exactly where the pen's grid put
       it rather than letting it wander off looking for grass that is not
       there, which is also the only place a player can see who needs
       feeding without opening the Animals tab. */
    expect(await at(page, 'cow', 1)).toEqual(before.hungry);
  });

  test('a guardian on duty patrols the lane; hungry, it rests', async ({ page }) => {
    await load(page, banked({
      dogs: [{ id: 90, state: 'producing', feedAt: secondsAgo(0) }],
      cats: [{ id: 91, state: 'hungry', feedAt: null }],
    }));
    await sceneReady(page);

    const before = { dog: await at(page, 'dog', 0), cat: await at(page, 'cat', 0) };
    // Polled, not a fixed wait — see the equivalent cow test above for why.
    await expect.poll(async () => moved(before.dog, await at(page, 'dog', 0)), {
      timeout: 10_000,
    }).toBeGreaterThan(0.2);

    expect(await at(page, 'cat', 0)).toEqual(before.cat);
  });

  test('walking up to a roaming, ready cow offers to collect it', async ({ page }) => {
    /* Regression test for a real bug this step's own screenshots did not
       catch and its own test-writing did: animalIntent (script.js) checked
       animal.state === 'ready', a value nothing ever assigns — animal.state
       is only ever 'producing' or 'hungry', and "ready" is always the
       derived animalProgress(...) >= 1 check the Animals tab already used.
       The 3D prompt could not offer "Collect" to a ready animal from the day
       step 6 shipped it; only "Feed", once the animal later went hungry, and
       only null for as long as it sat there full. Fixed alongside this
       step because it is the walk-up-to-a-live-animal path this step is
       what finally exercises. */
    await load(page, makeSave({ cows: [{ id: 1, state: 'producing', feedAt: secondsAgo(60) }] }));
    // produceTime is 25s; 60 is comfortably past ready with room for the
    // page's own boot time (see secondsAgo's own doc comment above).
    await page.waitForFunction(() => !!window.Farm3DScene);

    /* Steered at the cow's own live position rather than in a fixed
       direction, and re-aimed every tick: the pen is well off the straight
       line from her start to any point due east of it (the cow's lane sits
       north of where she spawns), and the cow is, by design, not staying
       still while she crosses the yard. A player working the stick would
       correct the same way.

       The stick is pushed at less than full deflection once she is close —
       drive()'s magnitude scales her speed (see steer() in scene.js), and a
       full-speed straight line at a slow-moving target massively overshoots
       at WALK_SPEED's 4.2 units/second in a pen barely two wide, so the
       first version of this loop mostly saw her fly through REACH and out
       the other side rather than land in it.

       And it all runs as one page.evaluate rather than a Node-side loop of
       many small ones. That was tried first and it was doubly wrong: every
       tick's round trip left a gap between "yes, in reach" and "so what does
       the button say now" for the still-roaming cow to wander back out of in
       — an intermittent real failure, not a flaky assertion — and the sheer
       number of round trips (driving alone was one per tick) was slow enough
       to starve this page's own rAF under the two workers CI runs this
       suite at, which is exactly the contention this project's render loop
       has needed defending against before (see the walk-timing bug in the
       art bible). Every read and every drive call below happens in the same
       browser-side tick they are decided from, and only the final, settled
       outcome ever crosses back to Node. */
    const landedOn = await page.evaluate(() => new Promise((resolve) => {
      const scene = window.Farm3DScene;
      let tick = 0;
      function step() {
        const cow = scene.animalAt('cow', 0);
        const here = scene.farmerAt();
        const dx = cow.x - here.x;
        const dz = cow.z - here.z;
        const dist = Math.hypot(dx, dz) || 1;
        const mag = dist < 0.6 ? 0.15 : 1;
        scene.drive((dx / dist) * mag, (dz / dist) * mag);

        const reach = scene.reachable();
        if (reach?.type === 'animal' && reach.distance < 0.5) {
          scene.drive(0, 0);
          resolve({
            reach,
            promptText: document.getElementById('actionPrompt')?.textContent ?? '',
          });
          return;
        }
        tick += 1;
        if (tick >= 1200) { scene.drive(0, 0); resolve(null); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }));

    expect(landedOn).not.toBeNull();
    expect(landedOn.reach.kind).toBe('cow');
    expect(landedOn.reach.intent).toBe('collect');
    expect(landedOn.promptText).toMatch(/Collect/);

    await expect(page.locator('#actionPrompt')).toBeVisible();

    await page.keyboard.press('Space');
    await expect.poll(async () => (await readSave(page)).inventory.milk).toBeGreaterThan(0);
  });
});

test.describe('the keyboard plays the same game', () => {
  const sceneReady = (page) => page.waitForFunction(() => !!window.Farm3DScene);
  const at = (page) => page.evaluate(() => window.Farm3DScene.farmerAt());
  const focused = (page) => page.evaluate(() => document.activeElement.getAttribute('aria-label'));

  test('the sixteen plots are one tab stop, not sixteen', async ({ page }) => {
    /* Every tile used to be its own stop: sixteen of the Farm tab's
       twenty-one, all sitting between the seed bar and anything past it. */
    await load(page, makeSave({ unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);

    await page.locator('.seed-btn').last().focus();
    await page.keyboard.press('Tab');
    expect(await focused(page)).toMatch(/^Plot 1,/);

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.id)).toBe('actionPrompt');
  });

  test('arrows move between tiles while the grid has them, and drive her when it does not', async ({ page }) => {
    await load(page, makeSave({ unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);

    await page.locator('#plotsGrid > *').first().focus();
    const parked = await at(page);

    await page.keyboard.press('ArrowRight');
    expect(await focused(page)).toMatch(/^Plot 2,/);
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toMatch(/^Plot 6,/);
    // Four columns, so Down is four along — and Up comes back to the same tile.
    await page.keyboard.press('ArrowUp');
    expect(await focused(page)).toMatch(/^Plot 2,/);

    /* And she has not taken a step for any of it. Before step 12 the drive
       keys were bound at the window with only text fields excluded, so the
       same press both moved between tiles and walked her — measured at 2.87
       units of walking during a single held arrow. */
    const after = await at(page);
    expect(Math.hypot(after.x - parked.x, after.z - parked.z)).toBeLessThan(0.01);

    /* Out of the grid, the arrows are hers again. This is the half that has
       to keep working: it is the whole keyboard path through free movement. */
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(
      (z) => window.Farm3DScene.farmerAt().z < z - 0.4,
      parked.z,
      { timeout: 10_000 },
    );
    await page.keyboard.up('ArrowUp');
  });

  test('the tile the keyboard is on is published to the scene, and let go of', async ({ page }) => {
    /* The scene draws the marker over that tile where it really stands. The
       DOM used to draw it instead, at the CSS grid's own position — which
       since step 6 lines up with nothing, and was putting plot 1's face in
       the sky above the farmhouse roof. */
    await load(page, makeSave({ unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);
    expect(await page.evaluate(() => window.Farm3DBridge.selectedPlot())).toBeNull();

    await page.locator('#plotsGrid > *').nth(6).focus();
    expect(await page.evaluate(() => window.Farm3DBridge.selectedPlot())).toBe(6);

    await page.evaluate(() => document.activeElement.blur());
    expect(await page.evaluate(() => window.Farm3DBridge.selectedPlot())).toBeNull();
  });

  test('what comes into reach is announced, not only drawn', async ({ page }) => {
    await load(page, makeSave({ coins: 500, selectedSeed: 'wheat', unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);

    const live = page.locator('#reachStatus');
    await expect(live).toHaveAttribute('aria-live', 'polite');

    /* She spawns at the gate already within reach of a tile, so this starts
       with something in it rather than empty — which is itself the point:
       the region says what is in reach, not what has changed. What this test
       is after is that it keeps saying so as she moves. */
    await expect.poll(async () => (await live.textContent()).trim(), { timeout: 10_000 })
      .toMatch(/plot \d+$/);
    const first = (await live.textContent()).trim();

    // Walk her up the field the way a keyboard player would, and it follows.
    await page.keyboard.down('ArrowUp');
    await expect.poll(async () => (await live.textContent()).trim(), { timeout: 15_000 })
      .not.toBe(first);
    await page.keyboard.up('ArrowUp');
    expect((await live.textContent()).trim()).toMatch(/plot \d+$/);
  });

  test('a keyboard-only player can plant and harvest without touching the plot grid', async ({ page }) => {
    /* This step's whole point, and the plan's own acceptance test for it:
       the same loop a player with a mouse gets — walk up, act on what is in
       reach — done entirely from the keyboard, with the grid untouched.
       Planting through the grid was already possible before step 12; playing
       the actual game from the keyboard was not. */
    await load(page, makeSave({ coins: 500, selectedSeed: 'wheat', unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);

    const walkUntilReachable = async () => {
      await page.keyboard.down('ArrowUp');
      await page.waitForFunction(
        () => window.Farm3DScene.reachable()?.type === 'plot',
        null,
        { timeout: 15_000 },
      );
      await page.keyboard.up('ArrowUp');
    };

    await walkUntilReachable();
    const target = await page.evaluate(() => window.Farm3DScene.reachable());
    expect(target.intent).toBe('plant');

    await page.keyboard.press('Space');
    await expect.poll(async () => (await readSave(page)).plots[target.plot].crop).toBe('wheat');

    /* And back again once it is ripe — the same tile, the same key, no grid
       and no mouse anywhere in it. */
    await page.evaluate((idx) => {
      state.plots[idx].plantedAt = Date.now() / 1000 - 60; // wheat grows in 15s
    }, target.plot);
    await expect.poll(
      () => page.evaluate(() => window.Farm3DScene.reachable()?.intent),
      { timeout: 10_000 },
    ).toBe('harvest');

    await page.keyboard.press('Space');
    await expect.poll(async () => (await readSave(page)).inventory.wheat).toBeGreaterThan(0);
  });
});

test.describe('crops, modelled', () => {
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });
  const sceneReady = async (page) => {
    await page.waitForFunction(() => !!window.Farm3DScene);
    await page.evaluate(() => window.Farm3DScene.cropModelsReady());
  };
  const stageAt = (page, i) => page.evaluate((idx) => window.Farm3DScene.cropStageAt(idx), i);

  // Growth times, in seconds — see CROPS in script.js. A fraction of one
  // lands a plot at a chosen point in plotGrowthStage's own boundaries
  // (script.js: <0.4 sprout, <0.75 seedling, <1 growing, >=1 ripe).
  const GROW_TIME = { wheat: 15, corn: 30, carrot: 50, pumpkin: 70 };

  test('every crop shows the model its growth stage actually calls for', async ({ page }) => {
    /* One plot per crop per stage that has a model of its own — sixteen
       plots, four crops, four stages apiece, wheat and corn using the extra
       growing/ripe split the kit happens to give them (see CROP_STAGE_MODEL
       in scene.js), carrot and pumpkin repeating their one stage-2 model for
       both. Sprout and seedling are shared across every crop, so this also
       covers SPROUT_MODEL without a fixture of its own.

       Set live, in the page's own clock, immediately before each check —
       not via secondsAgo at boot. Wheat's growTime is 15s, so its seedling
       window (40%-75% of that) is only 5.25 seconds wide; the page's own
       startup plus loading the eight crop models both eat into a boot-timed
       margin before the first check ever runs, and the first version of
       this test did exactly that and lost a wheat plot to the next stage
       over. Poking state.plots directly and checking a moment later has
       nothing but one short wait to drift across. */
    await load(page, makeSave({ unlockedPlots: 16 }));
    await sceneReady(page);

    const cases = [];
    for (const crop of ['wheat', 'corn', 'carrot', 'pumpkin']) {
      cases.push(
        [crop, 0.1, 'nature/crops_leafsStageA'],
        [crop, 0.5, 'nature/crops_leafsStageB'],
        [crop, 0.85, crop === 'wheat' ? 'nature/crops_wheatStageA'
          : crop === 'corn' ? 'nature/crops_cornStageB'
            : `nature/crop_${crop}`],
        [crop, 1.3, crop === 'wheat' ? 'nature/crops_wheatStageB'
          : crop === 'corn' ? 'nature/crops_cornStageD'
            : `nature/crop_${crop}`],
      );
    }

    for (let i = 0; i < cases.length; i += 1) {
      const [crop, frac, expectedId] = cases[i];
      const elapsed = frac * GROW_TIME[crop];
      await page.evaluate(([idx, c, ago]) => {
        state.plots[idx] = { crop: c, plantedAt: Date.now() / 1000 - ago, spoilsAt: null, rotten: false };
      }, [i, crop, elapsed]);
      await page.waitForTimeout(120); // one drawn frame's worth of margin, and then some
      expect(await stageAt(page, i), `plot ${i}: ${crop} at ${frac} of its grow time`).toBe(expectedId);
    }
  });

  test('a rotten plot shows the abstract rotten shape, not a crop model', async ({ page }) => {
    await load(page, banked({
      plots: Array.from({ length: PLOT_COUNT }, (_, i) => (
        i === 0
          ? { crop: 'wheat', plantedAt: secondsAgo(60), spoilsAt: Date.now() - 1, rotten: true }
          : { crop: null, plantedAt: null }
      )),
    }));
    await sceneReady(page);

    // None of the eight real models — the rotten stand-in isn't one of them,
    // by construction, so this is really asking "is nothing here confused
    // about whose turn it is" rather than naming what should show instead.
    expect(await stageAt(page, 0)).toBeNull();
  });

  test('harvesting and replanting never leaves the old crop\'s model standing', async ({ page }) => {
    /* The regression this step's own bookkeeping could actually cause:
       hideCropStage clears every stage's instance at a plot before
       showCropStage turns exactly one back on, but only syncPlots' own
       per-frame call is what enforces that — nothing stops a stale instance
       from a crop that used to grow here from simply never being told to
       hide if that call were ever skipped for a plot. Harvest a ripe wheat,
       plant a corn in the same plot, and check the wheat is gone rather
       than merely trusting that it must be. */
    await load(page, banked({
      coins: 500, selectedSeed: 'corn',
      plots: Array.from({ length: PLOT_COUNT }, (_, i) => (
        i === 0
          ? { crop: 'wheat', plantedAt: secondsAgo(60), spoilsAt: Date.now() + 999999 }
          : { crop: null, plantedAt: null }
      )),
    }));
    await sceneReady(page);
    expect(await stageAt(page, 0)).toBe('nature/crops_wheatStageB');

    /* Straight to runPlotIntent, bypassing the walk-to-work queue entirely
       — this is a rendering-bookkeeping question, not a walking one, and
       that path is already covered in "walking to work" above. */
    await page.evaluate(() => window.Farm3DBridge.runPlotIntent(0, 'harvest'));
    await expect.poll(async () => (await readSave(page)).plots[0].crop).toBeNull();
    expect(await stageAt(page, 0)).toBeNull();

    await page.evaluate(() => window.Farm3DBridge.runPlotIntent(0, 'plant'));
    await expect.poll(async () => (await readSave(page)).plots[0].crop).toBe('corn');
    expect(await stageAt(page, 0)).toBe('nature/crops_leafsStageA');
  });
});

test.describe('driving her yourself', () => {
  const ripeAt = (...indices) => Array.from({ length: PLOT_COUNT }, (_, i) => (
    indices.includes(i) ? { crop: 'wheat', plantedAt: secondsAgo(40) } : { crop: null, plantedAt: null }
  ));
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });
  const sceneReady = (page) => page.waitForFunction(() => !!window.Farm3DScene);
  const pending = (page) => page.evaluate(() => window.Farm3DScene.pendingActions());
  const at = (page) => page.evaluate(() => window.Farm3DScene.farmerAt());
  const reach = (page) => page.evaluate(() => window.Farm3DScene.reachable());
  const drive = (page, x, z) => page.evaluate(([a, b]) => window.Farm3DScene.drive(a, b), [x, z]);

  /** Drives in a direction until something comes into reach, then lets go. */
  async function driveUntilReachable(page, x, z) {
    await drive(page, x, z);
    await page.waitForFunction(() => window.Farm3DScene.reachable() !== null, null, { timeout: 15_000 });
    await drive(page, 0, 0);
  }

  test('the stick moves her, and she stops where she is let go of', async ({ page }) => {
    await load(page, makeSave());
    await sceneReady(page);
    const start = await at(page);

    await drive(page, 0, -1);
    await page.waitForFunction(
      (z) => window.Farm3DScene.farmerAt().z < z - 0.5,
      start.z,
      { timeout: 10_000 },
    );
    await drive(page, 0, 0);

    /* Stopped means stopped: no coasting, and no trudging back to the gate,
       which is what she used to do the moment the queue ran dry. */
    const stopped = await at(page);
    await page.waitForTimeout(700);
    const later = await at(page);
    expect(Math.hypot(later.x - stopped.x, later.z - stopped.z)).toBeLessThan(0.05);
  });

  test('she stays inside the yard however long you hold it', async ({ page }) => {
    await load(page, makeSave());
    await sceneReady(page);

    await drive(page, -1, -1);
    await page.waitForTimeout(3500);
    await drive(page, 0, 0);

    /* The flat ground the farm sits on, which step 7 widened to take in the
       orchard and the dooryard. Past it are hills with nothing on them, and
       she has no business up there. */
    const corner = await at(page);
    expect(corner.x).toBeGreaterThan(-7.5);
    expect(corner.z).toBeGreaterThan(-8.7);
  });

  test('the farm she can walk is bigger than the field she works', async ({ page }) => {
    await load(page, makeSave());
    await sceneReady(page);

    /* Step 7 put an orchard north and a dooryard south, and they are only
       rooms if she can get to them: before it the roam bounds stopped at the
       field's own fence, about 2.5 units either way.

       This waits for her to pass each mark rather than for her to settle
       against the far wall. Waiting for her to stop is the same assertion but
       it costs the walk back from the edge every time — as written that way
       first, it was the slowest test in the suite at 25s, and 21 tests behind
       it did not get to run before CI's ten-minute budget ran out. */
    const drivePast = async (x, z, mark, what) => {
      await drive(page, x, z);
      await page.waitForFunction(mark, null, { timeout: 20_000 }).catch(() => {
        throw new Error(`she never reached ${what}`);
      });
      await drive(page, 0, 0);
    };

    await drivePast(0, -1, () => window.Farm3DScene.farmerAt().z < -6, 'the orchard');
    await drivePast(0, 1, () => window.Farm3DScene.farmerAt().z > 5, 'the dooryard');
    await drivePast(-1, 0, () => window.Farm3DScene.farmerAt().x < -5, 'the farmhouse');
  });

  test('taking the stick drops the round she was walking', async ({ page }) => {
    await load(page, banked({ plots: ripeAt(0) }));
    await sceneReady(page);

    await tapPlot(page.locator('#plotsGrid > *').first());
    expect(await pending(page)).toBe(1);

    /* A player who grabs the stick has changed their mind. Picking the old
       errand back up the moment they let go would feel haunted. */
    await drive(page, 1, 0);
    await expect.poll(() => pending(page)).toBe(0);
    await drive(page, 0, 0);
  });

  test('standing next to a plot offers what it needs, and space does it', async ({ page }) => {
    /* Every plot unlocked, so the first tile she reaches offers to be sown
       rather than bought — makeSave stops at eight, and plot 9 is the one
       straight ahead of where she starts. */
    await load(page, makeSave({ coins: 500, selectedSeed: 'wheat', unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);
    await driveUntilReachable(page, 0, -1);

    const target = await reach(page);
    expect(target.type).toBe('plot');
    expect(target.intent).toBe('plant');

    const prompt = page.locator('#actionPrompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveText(/Plant .*Wheat/);
    // Named for a screen reader, since "Plant" alone never says which tile.
    await expect(prompt).toHaveAttribute('aria-label', new RegExp(`plot ${target.plot + 1}$`));

    await page.keyboard.press('Space');
    await expect.poll(async () => (await readSave(page)).plots[target.plot].crop).toBe('wheat');
  });

  test('the offer follows her, and goes away when nothing is in reach', async ({ page }) => {
    await load(page, makeSave({ coins: 500, selectedSeed: 'wheat', unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);
    await driveUntilReachable(page, 0, -1);
    await expect(page.locator('#actionPrompt')).toBeVisible();

    /* East, out of the field and across to the empty pen — not south, which
       is where she already starts: the yard ends a few centimetres behind
       her, so backing up does not put any distance between her and row 4. */
    await drive(page, 1, 0);
    await page.waitForFunction(() => window.Farm3DScene.reachable() === null, null, { timeout: 15_000 });
    await drive(page, 0, 0);
    await expect(page.locator('#actionPrompt')).toBeHidden();
  });

  test('the offer keeps up with a change of seed', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedPlots: PLOT_COUNT }));
    await sceneReady(page);
    await driveUntilReachable(page, 0, -1);

    /* The intent is "plant" either way, so anything watching only the intent
       would leave this button offering a seed nobody had picked. */
    await expect(page.locator('#actionPrompt')).toHaveText(/Pick a seed/);
    await page.locator('.seed-btn').first().click();
    await expect(page.locator('#actionPrompt')).toHaveText(/Plant .*Wheat/);
  });

  test('the arrow keys drive her too, and releasing one stops her', async ({ page }) => {
    await load(page, makeSave());
    await sceneReady(page);
    const start = await at(page);

    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(
      (z) => window.Farm3DScene.farmerAt().z < z - 0.4,
      start.z,
      { timeout: 10_000 },
    );
    await page.keyboard.up('ArrowUp');

    // A key left stuck down would walk her into the fence and hold her there.
    const released = await at(page);
    await page.waitForTimeout(600);
    expect((await at(page)).z).toBeCloseTo(released.z, 1);
  });
});

test.describe('the farmer is a real model', () => {
  const clip = (page) => page.evaluate(() => window.Farm3DScene.farmerClip());

  test('she arrives as a rigged model, idling on an authored clip', async ({ page }) => {
    await load(page, makeSave());
    await page.waitForFunction(() => !!window.Farm3DScene);

    /* Her body is fetched rather than built, so this waits for it. Null here
       for good would mean the model never arrived and the farm is being
       worked by an invisible farmer — which stays playable on purpose, but is
       not what should happen when the models are being served. */
    await expect.poll(() => clip(page), { timeout: 15_000 }).toBe('idle');
  });

  test('walking to work plays the walk cycle, and she settles back to idle', async ({ page }) => {
    await load(page, makeSave({ selectedSeed: 'wheat' }));
    await page.waitForFunction(() => !!window.Farm3DScene);
    await expect.poll(() => clip(page), { timeout: 15_000 }).toBe('idle');

    // The far corner, so she is walking for long enough to be caught at it.
    await tapPlot(page.locator('#plotsGrid > *').nth(7));
    await expect.poll(() => clip(page), { timeout: 10_000 }).toBe('walk');

    /* Back to idle only once the queue is empty and she has walked home
       again, which is the whole round trip the walk queue promises. */
    await worked(page);
    await expect.poll(() => clip(page), { timeout: 15_000 }).toBe('idle');
  });
});

test.describe('animation cost', () => {
  test('nothing that loops forever animates a property that repaints', async ({ page }) => {
    await load(page, makeSave());

    // A full field of ripe crops means a dozen-plus of these run at once, so
    // an expensive property here is what turns a long session into a stutter.
    const offenders = await page.evaluate(async () => {
      const css = await fetch('styles.css').then((r) => r.text());
      const composited = new Set(['transform', 'opacity']);
      const found = [];
      const blocks = css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g);
      const declarations = css.match(/animation:[^;]*;/g) || [];
      for (const [, name, body] of blocks) {
        const loopsForever = declarations.some(
          (d) => new RegExp(`\\b${name}\\b`).test(d) && d.includes('infinite'),
        );
        if (!loopsForever) continue;
        const props = [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))];
        const expensive = props.filter((p) => !composited.has(p));
        if (expensive.length) found.push(`${name} animates ${expensive.join(', ')}`);
      }
      return found;
    });

    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Progress durability                                                 */
/* ------------------------------------------------------------------ */

test.describe('progress is never lost', () => {
  test('coins and stock survive a reload', async ({ page }) => {
    await load(page, makeSave({
      coins: 500,
      unlockedAchievements: ACHIEVEMENT_IDS,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await tapPlot(page.locator('#plotsGrid > *').first());          // +3 wheat
    await worked(page); // the plot is only free to plant once she has picked it
    await page.locator('.seed-btn').first().click();
    await tapPlot(page.locator('#plotsGrid .plot.empty').first());  // -5 coins
    await expect.poll(() => coins(page)).toBe(495);

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');

    expect(await coins(page)).toBe(495);
    expect((await inventory(page)).wheat).toBe(3);
    // The planted crop is still growing after the reload, not reset.
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('progress is committed as soon as the page is backgrounded', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate(() => {
      // Bank coins without going through an action that saves, then background
      // the page — the handler must flush it.
      state.coins = 4242;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await coins(page)).toBe(4242);
  });

  test('a backgrounded page stops writing over a newer save', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Stand in for a second tab, or the installed app, saving newer progress.
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.coins = 9999;
      s.lastSeenAt = Date.now() + 5000;
      localStorage.setItem(k, JSON.stringify(s));
    }, SAVE_KEY);

    // Several ticks pass while hidden; none of them may clobber that.
    await page.waitForTimeout(2500);
    expect(await coins(page)).toBe(9999);
  });

  test('returning to the page picks up the newer save', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate((k) => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const s = JSON.parse(localStorage.getItem(k));
      s.coins = 8888;
      s.lastSeenAt = Date.now() + 5000;
      localStorage.setItem(k, JSON.stringify(s));
    }, SAVE_KEY);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(page.locator('#coinsLabel')).toContainText('8888');
    await expect.poll(() => coins(page)).toBe(8888);
  });

  test('an unreadable save is kept as a backup rather than thrown away', async ({ page }) => {
    await load(page, 'not valid json at all {{{');

    const backup = await page.evaluate(
      (k) => localStorage.getItem(`${k}_backup`), SAVE_KEY,
    );
    expect(backup).toBe('not valid json at all {{{');
    // The player still gets a working farm.
    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
  });
});

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

test.describe('footer', () => {
  test('credits the author and points at the other playable games', async ({ page }) => {
    await load(page, makeSave());

    const footer = page.locator('.site-footer');
    await expect(footer).toContainText('made by Giorgi Jvarsheishvili');
    await expect(footer).toContainText('Other games by Giorgi Jvarsheishvili');

    const links = footer.getByRole('link');
    await expect(links).toHaveCount(3);

    // Each must be the hosted game, not the source repository: a github.com
    // link drops the player on a code page rather than into the game. The 2D
    // original leads, since this fork is the reason a player is here at all.
    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toEqual([
      'https://giorgijv.github.io/farm-game/',
      'https://giorgijv.github.io/juice-sort/',
      'https://giorgijv.github.io/soviet-racer-giorgi/',
    ]);
    hrefs.forEach((href) => expect(href).not.toContain('github.com'));
  });
});

test.describe('seasons and weather', () => {
  const banked = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });
  const sceneReady = async (page) => {
    await page.waitForFunction(() => !!window.Farm3DScene);
    await page.evaluate(() => window.Farm3DScene.foliageReady());
  };
  /* Jumps the calendar without going through updateHurricane — plain state,
     read back by season() and rainActive() alike. Every day used here stays
     below 57, the day a hurricane against a fresh save first comes due (see
     the 'hurricanes' describe block above): past that, the game's own tick
     resolves the storm on its next real interval and proximity drops back
     to zero out from under the assertion, which is a fact about hurricanes
     rather than a bug in either system. */
  const setDay = (page, day) => page.evaluate((d) => { state.day = d; }, day);

  test('the calendar turns the season, and the season turns the orchard', async ({ page }) => {
    await load(page, banked());
    await sceneReady(page);
    await page.waitForFunction(() => window.Farm3DScene.orchardReady());

    // One day into each of the four weeks a fresh save's day 1 already
    // sits in the first of — spring, summer, autumn, winter — plus day 29,
    // the first day of the cycle's second lap, to check it wraps rather
    // than counting stormward forever.
    const cases = [
      [1, 'spring'], [8, 'summer'], [15, 'autumn'], [22, 'winter'], [29, 'spring'],
    ];
    for (const [day, season] of cases) {
      await setDay(page, day);
      // The calendar itself turns the instant state.day does — no polling
      // needed for a plain read of script.js's own state.
      expect(await page.evaluate(() => window.Farm3DBridge.currentSeason())).toBe(season);
      /* The orchard only catches up once syncSeason has run a frame since —
         polled, not read once, so a slow tick under load is a wait rather
         than a flake. This is also the honest reason season() above is
         read on the far side of it: were it read first, it would report
         the same live, un-lagged calendar currentSeason() already checked,
         proving nothing about whether the 3D yard had caught up yet. */
      await expect.poll(() => page.evaluate(() => window.Farm3DScene.orchardAutumn())).toBe(season === 'autumn');
      expect(await page.evaluate(() => window.Farm3DScene.season())).toBe(season);
    }
  });

  test('winter undresses the grass, not the trees', async ({ page }) => {
    await load(page, banked());
    await sceneReady(page);

    await setDay(page, 1); // spring
    expect(await page.evaluate(() => window.Farm3DBridge.currentSeason())).toBe('spring');
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.grassShowing())).toBe(true);

    await setDay(page, 22); // winter
    expect(await page.evaluate(() => window.Farm3DBridge.currentSeason())).toBe('winter');
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.grassShowing())).toBe(false);
    // The hillside fringe scattered in step 8 has no snow variant either
    // (checked against the Kenney mirror, not assumed — see
    // docs/ART_BIBLE.md) and is deliberately out of scope for this step,
    // so foliageCounts — unaffected by the visibility toggle above — should
    // still report the trees it always did.
    const counts = await page.evaluate(() => window.Farm3DScene.foliageCounts());
    expect(counts['nature/tree_default']).toBeGreaterThan(0);
    expect(counts['nature/tree_pineDefaultA']).toBeGreaterThan(0);

    await setDay(page, 29); // back to spring
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.grassShowing())).toBe(true);
  });

  test('rain builds in across the hurricane forecast, and only then', async ({ page }) => {
    await load(page, banked());
    await sceneReady(page);

    await setDay(page, 50); // well outside the 3-day warning window
    expect(await page.evaluate(() => window.Farm3DBridge.stormProximity())).toBe(0);
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.rainVisible())).toBe(false);

    await setDay(page, 55); // two days out
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.rainVisible())).toBe(true);
    const early = await page.evaluate(() => window.Farm3DScene.rainActive());
    expect(early).toBeGreaterThan(0);

    await setDay(page, 56); // one day out — closer, so more of it falling
    await expect.poll(() => page.evaluate(() => window.Farm3DScene.rainActive())).toBeGreaterThan(early);

    /* And it is actually falling, not a field of frozen streaks: the same
       "moving, not painted" question the pond's own test asks of its water.
       Drop 0 is guaranteed to be among the active ones whenever any are —
       syncWeather always fills the active count from the front of the
       seeded array — so its y is a fair sample of the whole field. */
    const before = await page.evaluate(() => window.Farm3DScene.rainDropY(0));
    await page.waitForFunction(
      (y) => window.Farm3DScene.rainDropY(0) !== y,
      before,
      { timeout: 5_000 },
    );
  });

  test('the day label carries the season, and a storm warning when one is due', async ({ page }) => {
    await load(page, banked());
    await page.waitForFunction(() => !!window.Farm3DScene);

    await setDay(page, 15); // autumn, no storm due
    await expect.poll(() => page.locator('#dayLabel').textContent()).toContain('🍂');
    expect(await page.locator('#dayLabel').textContent()).not.toContain('🌪️');

    await setDay(page, 56); // storm two-to-one day out
    await expect.poll(() => page.locator('#dayLabel').textContent()).toContain('🌪️');
  });
});

/* ------------------------------------------------------------------ */
/* Smoke                                                               */
/* ------------------------------------------------------------------ */

test('the page loads with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await load(page, makeSave());
  for (const tab of [/Animals/, /Market/, /Awards/, /Farm/]) {
    await page.getByRole('button', { name: tab }).click();
  }
  await page.waitForTimeout(1200);

  expect(errors).toEqual([]);
});
