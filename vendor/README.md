# vendor/

Third-party code the game loads at runtime, kept local so the game works
offline and with zero external requests — the same promise the rest of the
app shell already makes.

- `three.module.js` — [three.js](https://threejs.org) r169, the minified ES
  module build (`build/three.module.min.js` from the `three` npm package),
  loaded through the import map in `index.html`. License: `THREE_LICENSE`
  (MIT).

To update the version, fetch the new `three.module.min.js` from the `three`
npm package's `build/` directory, overwrite this file, and bump
`CACHE_VERSION` in `sw.js` so the service worker re-caches it.
