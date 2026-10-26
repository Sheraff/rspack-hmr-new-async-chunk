# Rspack HMR: updated module re-executes before its new async vendor chunk is loaded

Issue: https://github.com/web-infra-dev/rspack/issues/16288

`src/lazy.js` is loaded with `import()` and self-accepts. `repro.mjs` starts the Rsbuild dev server, opens the page
in headless Chromium, then edits `src/lazy.js` to add its first `node_modules` import (`lodash`). `splitChunks` puts
lodash in a new async chunk, and the hot update re-executes `src/lazy.js` before that chunk is loaded.

```sh
npm install
npx playwright install chromium   # or set CHROME_PATH
npm run repro                     # Rsbuild's default splitChunks: fails
node repro.mjs async              # splitChunks { preset: 'none', chunks: 'async' }: fails
node repro.mjs no-groups          # control, default cache groups off (no new chunk): works
node repro.mjs default --no-lazy  # dev.lazyCompilation: false: fails the same way
```

Output with @rsbuild/core 2.2.14 / @rspack/core 2.2.9:

```
variant=default @rsbuild/core=2.2.14 @rspack/core=2.2.9
FAILED: the page still shows "lazy-v0 none"
page errors:
  TypeError: Cannot read properties of undefined (reading 'call')
    at __webpack_require__ (http://127.0.0.1:3618/static/js/index.js:53:29)
    at fn (http://127.0.0.1:3618/static/js/index.js:232:10)
    at ./src/lazy.js (http://127.0.0.1:3618/src_lazy_js.a9f1d732bcbbc318.hot-update.js:5:44)
```

Expected: `OK: the page shows lazy-v1 function`, as in the `no-groups` control.

Manual steps: `npx rsbuild dev`, open the page, add `import _ from 'lodash'` to `src/lazy.js`, check the console.
