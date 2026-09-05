# vendor/

Third-party code the game loads at runtime, kept local so the game works
offline and with zero external requests — the same promise the rest of the
app shell already makes.

- `three.module.js` — [three.js](https://threejs.org) r169, the minified ES
  module build (`build/three.module.min.js` from the `three` npm package),
  loaded through the import map in `index.html`. License: `THREE_LICENSE`
  (MIT).
- `jsm/controls/OrbitControls.js` — the same r169's
  `examples/jsm/controls/OrbitControls.js`, unminified (32K, not worth a
  build step for). Resolves its own `import ... from 'three'` through the
  same import map entry as everything else. Same license.

To update the version, fetch the new `three.module.min.js` and
`examples/jsm/controls/OrbitControls.js` from the `three` npm package,
overwrite these files, and bump `CACHE_VERSION` in `sw.js` so the service
worker re-caches them.
