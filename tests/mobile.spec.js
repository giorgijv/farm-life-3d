const { test, expect, devices } = require('@playwright/test');

const SAVE_KEY = 'farmLife3dSave_v1';
const PLOT_COUNT = 16;
const FARMER_MEAL_MS = 3 * 90_000;

/** Android-ish profiles: a small phone, a common phone, and landscape. */
const PHONE = { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const LANDSCAPE = { viewport: { width: 851, height: 393 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };

function makeSave(overrides = {}) {
  return {
    coins: 900,
    day: 3,
    dayElapsedMs: 0,
    selectedSeed: null,
    unlockedPlots: 9,
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    cows: [{ id: 1, state: 'hungry', feedAt: null }],
    chickens: [],
    sheep: [],
    nextAnimalId: 2,
    inventory: { wheat: 9, corn: 2, carrot: 1, pumpkin: 0, milk: 2, egg: 3, wool: 0 },
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

let seedCounter = 0;
async function load(page, save = makeSave()) {
  // Seed before page scripts run; see the note in game.spec.js.
  const nonce = `__seeded_${(seedCounter += 1)}`;
  await page.addInitScript(([k, v, n]) => {
    if (sessionStorage.getItem(n)) return;
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem(n, '1');
  }, [SAVE_KEY, save, nonce]);
  await page.goto('/');
  await page.waitForSelector('#plotsGrid .plot');
}

const readSave = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);

const TABS = ['farm', 'animals', 'market', 'achievements', 'dream'];

/** Every visible, enabled control smaller than the 44px accessibility floor. */
async function undersizedControls(page) {
  const found = [];
  for (const tab of TABS) {
    await page.locator(`button[data-tab="${tab}"]`).tap();
    await page.waitForTimeout(200);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button:not([disabled]), input[type="range"], a').forEach((el) => {
        if (el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 44 || r.width < 44) {
          out.push({
            label: (el.textContent || el.id || el.className).toString().trim().slice(0, 30),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      });
      return out;
    });
    small.forEach((s) => found.push({ tab, ...s }));
  }
  return found;
}

const horizontalOverflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

/* ------------------------------------------------------------------ */

test.describe('phone portrait', () => {
  test.use(PHONE);

  test('the page never scrolls sideways', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows horizontally`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('every control meets the 44px touch target floor', async ({ page }) => {
    await load(page);
    expect(await undersizedControls(page)).toEqual([]);
  });

  /* Row 2 of the field, straight up from where she starts, so driving her
     there is a push on the stick rather than a manoeuvre. */
  const RIPE_PLOT = 8;

  test('the whole loop is playable by tapping', async ({ page }) => {
    await load(page, makeSave({
      coins: 900,
      plots: Array.from({ length: PLOT_COUNT }, (_, i) => (
        i === RIPE_PLOT
          ? { crop: 'wheat', plantedAt: Date.now() / 1000 - 20 } // ripe
          : { crop: null, plantedAt: null })),
      inventory: { wheat: 5, corn: 4, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: ['first_harvest'], // keep the coin maths clean
    }));

    /* Since step 6 a phone plays the field by walking her onto a tile and
       pressing the one prompt, not by tapping sixteen invisible buttons over
       the canvas. So this holds the stick the way a thumb would — the stick
       listens for pointer events precisely so it can be driven without
       synthesising a touch stream — and waits for the tile to come into
       reach rather than for a stopwatch. */
    await page.waitForFunction(() => !!window.Farm3DScene);
    const box = await page.locator('#driveStick').boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x, centre.y - 40); // push north, up the field
    await page.waitForFunction(
      (p) => window.Farm3DScene.reachable()?.plot === p,
      RIPE_PLOT,
      { timeout: 15_000 },
    ).finally(() => page.mouse.up());

    // Harvest by tap: 5 + 3 = 8 wheat.
    await page.locator('#actionPrompt').tap();
    await expect.poll(async () => (await readSave(page)).inventory.wheat).toBe(8);

    // Pick a seed and plant by tap, without moving: wheat seed costs 5. The
    // tile she is standing on is empty now, so the prompt offers to sow it.
    await page.locator('.seed-btn').first().tap();
    await expect(page.locator('#actionPrompt')).toHaveText(/Plant/);
    await page.locator('#actionPrompt').tap();
    await expect.poll(async () => (await readSave(page)).coins).toBe(895);

    // Feed the cow by tap: eats 2 corn, leaving 2.
    await page.locator('button[data-tab="animals"]').tap();
    await page.locator('#cowList .animal-btn').tap();
    await expect(page.locator('#cowList .animal-state.producing')).toHaveCount(1);
    await expect.poll(async () => (await readSave(page)).inventory.corn).toBe(2);

    // Sell the wheat by tap: 8 x 3 coins.
    await page.locator('button[data-tab="market"]').tap();
    const wheat = page.locator('#sellList .market-item').filter({ hasText: 'Wheat' });
    await wheat.getByRole('button').tap();
    await expect(wheat.locator('.market-have')).toHaveText('Have: 0');
    await expect.poll(async () => (await readSave(page)).coins).toBe(919);
  });

  test('all four seeds fit on one row', async ({ page }) => {
    await load(page);
    const tops = await page.locator('.seed-btn').evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'seed bar should not wrap').toBe(1);
  });

  test('hover lift is not applied on a touch screen', async ({ page }) => {
    await load(page);
    // (hover: hover) must not match, so the lift rule is inert here.
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  });
});

test.describe('small phone', () => {
  test.use(SMALL);

  test('no sideways scroll at 360px', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows at 360px`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('touch targets hold up at 360px', async ({ page }) => {
    await load(page);
    expect(await undersizedControls(page)).toEqual([]);
  });
});

test.describe('landscape', () => {
  test.use(LANDSCAPE);

  test('no sideways scroll when the phone is rotated', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows in landscape`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('the farm scene shrinks instead of pushing the tab off-screen', async ({ page }) => {
    await load(page);
    // The 3D yard is a fixed 4x4 layout — it doesn't reflow columns the way
    // a card grid did, so on its side the scene box itself is what has to
    // give: the short-viewport rule below caps it well under the 393px
    // viewport height this profile uses.
    const height = await page.locator('#farmScene').evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(393 * 0.5);
  });

  /* This used to check that all sixteen plot buttons kept a 44px footprint in
     landscape. Since step 6 they take no pointer input at all, so their size
     is no longer what a thumb depends on — the two controls below are, and
     they are what has to survive the short viewport instead. */
  test('the stick and the prompt stay reachable in landscape', async ({ page }) => {
    await load(page, makeSave({ selectedSeed: 'wheat' }));
    await page.waitForFunction(() => !!window.Farm3DScene);

    const stick = await page.locator('#driveStick').boundingBox();
    expect(stick.width).toBeGreaterThanOrEqual(44);
    expect(stick.height).toBeGreaterThanOrEqual(44);

    // Both must sit inside the scene rather than off the bottom of a 393px
    // viewport, which is the failure this short profile exists to catch.
    const scene = await page.locator('#farmScene').boundingBox();
    expect(stick.y + stick.height).toBeLessThanOrEqual(scene.y + scene.height + 1);

    await page.evaluate(() => window.Farm3DScene.drive(0, -1));
    await page.waitForFunction(() => window.Farm3DScene.reachable() !== null, null, { timeout: 15_000 });
    await page.evaluate(() => window.Farm3DScene.drive(0, 0));

    const prompt = await page.locator('#actionPrompt').boundingBox();
    expect(prompt.height).toBeGreaterThanOrEqual(44);
    expect(prompt.width).toBeGreaterThanOrEqual(44);
    expect(prompt.y + prompt.height).toBeLessThanOrEqual(scene.y + scene.height + 1);
  });
});

test.describe('installed app framing', () => {
  test.use(PHONE);

  test('the viewport opts into the display cutout', async ({ page }) => {
    await load(page);
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('viewport-fit=cover');
  });

  test('layout padding reserves room for system insets', async ({ page }) => {
    await load(page);
    // env() resolves to 0 in the emulator, but the declaration must be present
    // so a notched device actually gets the inset.
    const usesInsets = await page.evaluate(async () => {
      const css = await fetch('styles.css').then((r) => r.text());
      return {
        app: /#app\s*{[^}]*env\(safe-area-inset-bottom\)/s.test(css),
        toast: /\.toast\s*{[^}]*env\(safe-area-inset-bottom\)/s.test(css),
      };
    });
    expect(usesInsets.app).toBe(true);
    expect(usesInsets.toast).toBe(true);
  });
});
