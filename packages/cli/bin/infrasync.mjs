#!/usr/bin/env node
// The CLI runs from the bundled dist, which inlines the @infrasync/* internals
// so the published package is self-contained. jiti is still used at runtime
// (inside the bundle, via loader.ts) to load the user's TypeScript
// infra.config.ts.
import "../dist/index.mjs";
