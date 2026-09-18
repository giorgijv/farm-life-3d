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
    // Stated rather than left to the migration to infer from the cow: a
    // fixture should say what farm it is, not depend on a rule about old
    // saves that has its own test elsewhere.
    pasture: true,
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

  /* The yard is the game; on a phone it was getting a quarter of the screen.
     Measured at 393x852 before this: the 3D scene came out 325x244, which is
     28.6% of the viewport, and it began 571px down — on a shorter phone,
     below the fold, so you had to scroll to see the farm you were playing.
     Three rows of tab buttons, two rows of top bar and a scene locked to a
     4:3 box did that between them.

     Asserted as a fraction rather than a pixel count so it keeps meaning the
     same thing on a screen this profile does not describe, and set well
     under what the layout now achieves (48.6%) so that ordinary retuning
     does not trip it and a real regression does. */
  test('the farm gets most of the phone screen, without scrolling to it', async ({ page }) => {
    await load(page);
    await page.waitForFunction(() => !!window.Farm3DScene);

    const m = await page.evaluate(() => {
      const scene = document.getElementById('farmScene').getBoundingClientRect();
      return { top: scene.top, height: scene.height, vh: window.innerHeight };
    });

    expect(m.height / m.vh, 'the 3D yard is a fraction of the phone screen').toBeGreaterThan(0.4);
    // And it starts above the fold: the farm is the first thing you see, not
    // something you have to go looking for.
    expect(m.top).toBeLessThan(m.vh * 0.55);
  });

  /* Row 2 of the field, straight up from where she starts, so driving her
     there is a push on the stick rather than a manoeuvre. */
  const RIPE_PLOT = 8;

  test('the whole loop is playable by tapping', async ({ page }) => {
    /* The longest test in the suite by some way: it plays the entire loop
       through the touch interface — walk onto a tile, harvest it, open the
       Animals tab, buy a cow, feed it, wait for it to produce — on a phone
       viewport, on a software rasteriser, at whatever frame rate four
       contending workers leave it. It overran the default 30s budget on CI
       both before and after the walk helper below was rewritten, which is
       the sign that the budget is the wrong number rather than the test. */
    test.slow();
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

    /* Walks her onto one particular tile with the stick, in pushes that
       are bounded by *distance* and released from inside the page.

       Two earlier versions failed, and the second failure is the
       instructive one. The original pushed once and waited up to fifteen
       seconds for the tile to come into reach — a sampling problem the
       game always wins, since she walks at wall-clock speed and
       `reachable()` can only be read once a frame. Instrumented under four
       contending pages the frame interval sits near 328ms, which is 1.38
       units a step against a window onto plot 8 that is 1.49 units wide;
       every captured failure had her against the far wall at z = -14.7,
       having walked past all sixteen plots without one sample landing near
       the one it wanted.

       The obvious fix — push for a measured number of milliseconds — does
       not work either, and it is worth recording why, because it looks
       like it should. advanceFarmer credits a starved frame with the real
       time that elapsed, and it reads the stick at frame time: so if a
       1.5-second stall happens to straddle a held stick, she covers six
       units no matter how brief the push was meant to be. That version
       oscillated and left her *south* of where she started, which is what
       a bounded-time push looks like when time is not what bounds it.

       What does bound it is distance, checked in the page where it can be
       acted on without a round trip: each push releases the drive the
       moment she has covered its allowance, or the moment the tile comes
       into reach. Corrections also push the stick gently rather than
       hard — the knob's offset sets her speed (RADIUS is 44px in
       scene.js), so a 9px nudge walks her at a fifth of full pace and a
       stall during one moves her a fifth as far.

       It is still a thumb on the stick, which is what this test is for:
       every push here is a real pointer press on the real control. */
    async function pushStick(dy, allowance, plot) {
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x, centre.y + dy);
      await page.evaluate(([travel, p]) => new Promise((resolve) => {
        const s = window.Farm3DScene;
        const from = s.farmerAt();
        const deadline = performance.now() + 8000;
        const tick = () => {
          const her = s.farmerAt();
          const gone = Math.hypot(her.x - from.x, her.z - from.z);
          const there = s.reachable()?.plot === p;
          if (there || gone >= travel || performance.now() > deadline) {
            // Released here rather than by lifting the mouse, because
            // lifting it is a round trip from Node and she keeps walking
            // across it. The pointer is still down; with no further
            // pointermove the stick will not set it again.
            s.drive(0, 0);
            return resolve();
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), [allowance, plot]);
      await page.mouse.up();
    }

    async function driveOnto(plot) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const state = await page.evaluate((p) => ({
          onIt: window.Farm3DScene.reachable()?.plot === p,
          her: window.Farm3DScene.farmerAt(),
          tile: window.Farm3DScene.plotAt(p),
        }), plot);
        if (state.onIt) return;

        const gap = state.tile.z - state.her.z;
        // Up the screen is north, which is z decreasing — hence the sign.
        const far = Math.abs(gap) > 0.8;
        await pushStick(
          Math.sign(gap) * (far ? 40 : 9),
          far ? Math.abs(gap) - 0.3 : 0.35,
          plot,
        );
      }
      const where = await page.evaluate(() => window.Farm3DScene.farmerAt());
      throw new Error(
        `driveOnto: never settled on plot ${plot} — `
        + `left at (${where.x.toFixed(2)}, ${where.z.toFixed(2)})`,
      );
    }

    await driveOnto(RIPE_PLOT); // up the field, however many nudges it takes

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

    /* Driven and stopped inside one evaluate, on the page's own frames,
       because the two-step version of this walked her straight past the plot.

       advanceFarmer credits a starved frame the real wall-clock time it
       lasted — deliberately, and for good reasons written up at its own
       definition — so a step taken under load is not a small step, it is a
       long one. Waiting for reachable() from the test and then sending a
       separate drive(0, 0) puts a whole round-trip between noticing she has
       arrived and telling her to stop, and at --workers=4 she covers the
       tile and comes out the far side within it. What the run then saw was a
       button carrying a stale aria-label from the moment she was briefly in
       reach, still hidden, staying hidden: 8 failures in 12, and the same
       8 in 12 on the build before this change, which is how it was ruled out
       as anything the WebGL work had done.

       Stopping her in the same frame the target comes into reach closes the
       window entirely. This is the shape driveOnto in this file already uses,
       for the same reason. */
    await page.evaluate(async () => {
      const deadline = performance.now() + 14_000;
      window.Farm3DScene.drive(0, -1);
      await new Promise((resolve) => {
        const tick = () => {
          if (window.Farm3DScene.reachable() !== null || performance.now() > deadline) {
            window.Farm3DScene.drive(0, 0);
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });

    /* And then wait for the button rather than assuming it followed.
       reachable() answers live; the button is shown by syncPrompt(), which
       runs only on a drawn frame, and drawing is paced to 30fps and skipped
       when the frame budget is starved. boundingBox() on a hidden element is
       null rather than a failed assertion, which is why the original
       surfaced as "Cannot read properties of null" rather than as anything
       about prompts. */
    await expect(page.locator('#actionPrompt')).toBeVisible({ timeout: 15_000 });

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
