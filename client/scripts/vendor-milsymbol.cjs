/**
 * Copy milsymbol's browser bundle into public/ for offline SIDC builder.
 * Run after `npm install` or when bumping the milsymbol dependency.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'milsymbol', 'dist', 'milsymbol.js');
const destDir = path.join(root, 'public', 'vendor', 'milsymbol');
const dest = path.join(destDir, 'milsymbol.js');

if (!fs.existsSync(src)) {
  console.warn('[vendor-milsymbol] skip: node_modules/milsymbol not found (run npm install in client/)');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'milsymbol', 'package.json'), 'utf8'));
console.log(`[vendor-milsymbol] copied milsymbol ${pkg.version} → public/vendor/milsymbol/milsymbol.js`);
