const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 4173;

module.exports = defineConfig({
  testDir: './tests',

  /* Sixty seconds a test, where Playwright's own default is thirty.

     Not because any test here is unusually slow — because the *baseline* is.
     Almost every test in this suite boots a full 3D scene: terrain, sky,
     water, a rigged character, four roads and about a hundred props, drawn
     by a software rasteriser on CI. That costs twelve to fifteen seconds
     before a single assertion runs, so the default budget leaves fifteen
     seconds of actual test time, and contention between two workers roughly
     doubles what is left. A test doing sixteen sequential checks on top of
     that load measures 14s alone and blows thirty under load.

     Five tests had already been marked `test.slow()` one at a time as each
     crossed the line, and a sixth was about to be. That is treating a
     baseline as a series of exceptions. The number the suite needed was a
     bigger default, and this is it.

     The safety net is not this number any more, it is the shard timeout in
     the workflow: a genuinely hung test costs sixty seconds instead of
     thirty, and a systemic hang still trips a twenty-minute job ceiling. */
  timeout: 60_000,

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    launchOptions: {
      // Needed when the suite runs as root in a container.
      args: ['--no-sandbox'],
      // Escape hatch for sandboxes that ship a prebuilt Chromium whose build
      // number does not match this Playwright version. Unset in CI, where
      // `playwright install` provides the matching browser.
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'node tests/server.js',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
