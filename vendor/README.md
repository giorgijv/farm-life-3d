# vendor/

Third-party code the game loads at runtime, kept local so the game works
offline and with zero external requests — the same promise the rest of the
app shell already makes.

- `three.module.js` — [three.js](https://threejs.org) r169, the minified ES
  module build (`build/three.module.min.js` from the `three` npm package),
  loaded through the import map in `index.html`. License: `THREE_LICENSE`
  (MIT).
- `jsm/**` — modules from the same r169's `examples/jsm/`, unminified, laid
  out in their original directory structure so their relative imports
  resolve unchanged. They reach `three` itself through the same import map
  entry as everything else. Same license. Currently:
  `controls/OrbitControls.js`, `loaders/GLTFLoader.js`, `objects/Sky.js`, and
  `utils/BufferGeometryUtils.js` — the last of which is here because
  GLTFLoader imports it, not because the game asks for it directly.

Everything in here is written by `tools/vendor.mjs`, which also fetches the
3D models into `assets/`. Don't edit these files by hand — add an entry to
that script and re-run it:

```bash
node tools/vendor.mjs
```

To move to a new three.js release, bump `THREE_REF` in that script, replace
`three.module.js` with the matching `build/three.module.min.js` from the
`three` npm package, re-run, and bump `CACHE_VERSION` in `sw.js` so the
service worker re-caches.
