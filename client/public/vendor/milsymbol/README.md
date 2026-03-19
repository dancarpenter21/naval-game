# Vendored milsymbol (offline SIDC preview)

This directory contains a **browser bundle** of [milsymbol](https://github.com/spatialillusions/milsymbol) for the static **SIDC builder** (`/sidc-picker/index.html`) so previews work without a public CDN.

- **Source:** `milsymbol` npm package → `dist/milsymbol.js` (UMD; exposes `window.ms`)
- **License:** MIT — see the license block at the top of `milsymbol.js` and the [upstream LICENSE](https://github.com/spatialillusions/milsymbol/blob/master/LICENSE).

Refresh this file after upgrading the `milsymbol` dependency:

```bash
cd client && npm run vendor:milsymbol
```
