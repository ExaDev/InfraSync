/**
 * The programmatic InfraSync SDK — the `infrasync` package's main entry.
 *
 * Re-exports the core authoring API (`defineInfra` and friends). Providers are
 * not re-exported here; import each from its own subpath, e.g.
 * `import { googleWorkspace } from "infrasync/google-workspace"`, so that a
 * provider's heavy SDK is only pulled in when you actually use it.
 */

export * from "@infrasync/core/compiler";
export * from "@infrasync/core/refs";
export * from "@infrasync/core/plugin";
export type * from "@infrasync/core/provider";
export type * from "@infrasync/core/handles";
export type * from "@infrasync/core/types";
