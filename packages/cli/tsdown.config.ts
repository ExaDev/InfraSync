import { defineConfig } from "tsdown";

export default defineConfig({
  // Three kinds of entry:
  //  - index.ts        → the CLI runner (the `infrasync` bin)
  //  - sdk.ts          → the programmatic SDK (the "." export)
  //  - providers/*.ts  → one bundle per provider (the "./<provider>" exports)
  entry: ["src/index.ts", "src/sdk.ts", "src/providers/*.ts"],
  format: "esm",
  target: "node20",
  dts: true,
  sourcemap: true,
  clean: true,
  // Inline the first-party @infrasync/* workspace packages so the published
  // `infrasync` package is self-contained and depends on none of them. All
  // third-party packages (zod, jiti, and the optional provider SDKs) stay
  // external and resolve from the consumer's node_modules at runtime.
  noExternal: [/^@infrasync\//],
});
