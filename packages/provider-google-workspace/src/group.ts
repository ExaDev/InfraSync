/**
 * Group — a Google Workspace group, backed by the Admin Directory API.
 *
 * A group is the unit behind a shared, addressable mailbox: it owns an email
 * address (e.g. `support@example.com`), a display name and a description.
 * Posting policy and visibility — what makes the mailbox public-facing — live
 * in the companion `GroupSettings` resource; membership lives in
 * `GroupMember`.
 *
 * The Google API field for the human-readable label is `name`, which would
 * collide with the resource-instance `name` key used across this provider, so
 * it is exposed here as `displayName` and mapped on the wire (mirroring how
 * `DirectorySchema` exposes `schemaName`).
 *
 * Wraps the `groups` REST surface
 * (https://developers.google.com/workspace/admin/directory/v1/reference/groups).
 *
 * The group's `email` is the identity key; the API assigns an immutable `id`
 * which is used as the update/delete key.
 */

import * as z from "zod";
import type { ResourcePort } from "@infrasync/core/provider";
import { RefToken } from "@infrasync/core/refs";
import type { RefBuilder } from "@infrasync/core/handles";
import { ProviderApiError } from "@infrasync/core/errors";
import type { GroupsClient } from "./client.js";
import { PROVIDER_NAME, isNotFound, toProviderApiError } from "./helpers.js";

// ─── Ref type ────────────────────────────────────────────────────────────────

export interface GroupRefs {
  readonly id: RefToken;
  readonly email: RefToken;
}

export const buildGroupRefs: RefBuilder<GroupRefs> = (resourceName) => ({
  id: new RefToken(resourceName, "id"),
  email: new RefToken(resourceName, "email"),
});

// ─── Spec schema ─────────────────────────────────────────────────────────────

export const groupSpecSchema = z.object({
  kind: z.literal("Group"),
  name: z.string().trim().min(1).optional(),
  /** The group's primary email address — the identity key. */
  email: z.email(),
  /** Human-readable label (maps to the Directory API `name` field). */
  displayName: z.string().trim().min(1),
  /** Free-text description. Defaults to empty to match the API's own default. */
  description: z.string().trim().default(""),
});

export type GroupSpec = z.infer<typeof groupSpecSchema>;

// ─── State schema ────────────────────────────────────────────────────────────

const groupStateSchema = z
  .looseObject({
    id: z.string().trim().min(1),
    email: z.email(),
    displayName: z.string().trim().min(1),
    description: z.string().trim(),
  })
  .readonly();

// ─── Identity and desired-state sub-schemas ──────────────────────────────────

const groupIdentitySchema = z.object({
  kind: z.literal("Group"),
  name: z.string().trim().min(1).optional(),
  email: groupSpecSchema.shape.email,
});

const groupDesiredStateSchema = z.object({
  displayName: groupSpecSchema.shape.displayName,
  description: groupSpecSchema.shape.description,
});

// ─── API response validation ─────────────────────────────────────────────────

// The Directory API always returns `name` and `description` on a group
// (description is "" when unset), so both are required here — a missing field
// is a genuine contract violation worth failing on, not a default to paper over.
const groupResponseSchema = z.looseObject({
  id: z.string().trim().min(1),
  email: z.email(),
  name: z.string().trim().min(1),
  description: z.string().trim(),
});

function toState(
  raw: z.infer<typeof groupResponseSchema>,
): z.infer<typeof groupStateSchema> {
  return {
    id: raw.id,
    email: raw.email,
    displayName: raw.name,
    description: raw.description,
  };
}

// ─── Resource implementation ────────────────────────────────────────────────

export class GroupResource implements ResourcePort<
  typeof groupSpecSchema,
  typeof groupStateSchema
> {
  readonly kind = "Group";
  readonly specSchema = groupSpecSchema;
  readonly stateSchema = groupStateSchema;
  readonly identitySchema = groupIdentitySchema;
  readonly desiredStateSchema = groupDesiredStateSchema;

  constructor(private readonly client: GroupsClient | undefined) {}

  getStateId(state: unknown): string {
    if (
      typeof state === "object" &&
      state !== null &&
      "id" in state &&
      typeof state.id === "string"
    ) {
      return state.id;
    }
    throw new ProviderApiError(PROVIDER_NAME, "getStateId", [
      { path: [], message: "Group state object does not contain a valid id" },
    ]);
  }

  private connected(operation: string): GroupsClient {
    if (this.client === undefined) {
      throw new ProviderApiError(PROVIDER_NAME, operation, [
        { path: [], message: "Google Workspace provider not connected" },
      ]);
    }
    return this.client;
  }

  async read(spec: unknown): Promise<unknown> {
    const parsed = groupSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "read", parsed.error.issues);
    }
    const client = this.connected("read");

    try {
      const raw = await client.getGroup(parsed.data.email);
      const result = groupResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(PROVIDER_NAME, "read", result.error.issues);
      }
      return toState(result.data);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "read");
    }
  }

  async create(spec: unknown): Promise<unknown> {
    const parsed = groupSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "create", parsed.error.issues);
    }
    const client = this.connected("create");

    try {
      const raw = await client.createGroup({
        email: parsed.data.email,
        name: parsed.data.displayName,
        description: parsed.data.description,
      });
      const result = groupResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(
          PROVIDER_NAME,
          "create",
          result.error.issues,
        );
      }
      return toState(result.data);
    } catch (error) {
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "create");
    }
  }

  async update(id: string, spec: unknown): Promise<unknown> {
    const parsed = groupSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "update", parsed.error.issues);
    }
    const client = this.connected("update");

    try {
      const raw = await client.patchGroup(id, {
        name: parsed.data.displayName,
        description: parsed.data.description,
      });
      const result = groupResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(
          PROVIDER_NAME,
          "update",
          result.error.issues,
        );
      }
      return toState(result.data);
    } catch (error) {
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "update");
    }
  }

  async delete(state: unknown): Promise<void> {
    const id = this.getStateId(state);
    const client = this.connected("delete");
    try {
      await client.deleteGroup(id);
    } catch (error) {
      if (isNotFound(error)) return;
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "delete");
    }
  }
}
