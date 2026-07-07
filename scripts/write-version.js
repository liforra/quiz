// Runs before `vite build` (see the "production" npm script). Stamps this
// build with an id that ends up in two places that must agree:
//   - public/version.json  — copied into dist/ as-is, fetched at runtime
//   - .env.production.local — read by `vite build` into import.meta.env.VITE_BUILD_ID,
//     baked into the JS bundle itself
// The client compares the two: if they ever differ, a newer build has been
// deployed since the page loaded, and it shows the update-available card
// instead of silently reloading (see the old dev-server HMR behavior this
// replaces in production).
import { writeFileSync, mkdirSync } from 'fs';

const buildId = Date.now().toString();

mkdirSync('public', { recursive: true });
writeFileSync('public/version.json', JSON.stringify({ buildId }));
writeFileSync('.env.production.local', `VITE_BUILD_ID=${buildId}\n`);

console.log(`Stamped build ${buildId}`);
