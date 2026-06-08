/**
 * GroupMember — a single membership in a Google group, backed by the Admin
 * Directory API `members` surface.
 *
 * Adds a user (or another group/service account) to a group with a role
 * (OWNER / MANAGER / MEMBER) and a delivery preference. For a shared mailbox
 * the members are the people who staff it — owners and managers who receive
 * and reply to incoming mail.
 *
 * The membership is identified by the pair (`groupEmail`, `memberEmail`); the
 * API assigns an immutable member `id`. `role` and `deliverySettings` are the
 * mutable desired-state fields.
 *
 * Note the Directory API's quirk: the delivery preference field is wire-named
 * `delivery_settings` (snake_case, unlike every other field), so it is mapped
 * at the boundary from the camelCase `deliverySettings` spec field.
 *
 * Wraps the `members` REST surface
 * (https://developers.google.com/workspace/admin/directory/v1/reference/members).
 */

import * as z from "zod";
import type { ResourcePort } from "@infrasync-org/core/provider";
import { RefToken } from "@infrasync-org/core/refs";
import type { RefBuilder } from "@infrasync-org/core/handles";
import { ProviderApiError } from "@infrasync-org/core/errors";
import type { GroupsClient } from "./client.js";
import { PROVIDER_NAME, isNotFound, toProviderApiError } from "./helpers.js";

// ─── Ref type ────────────────────────────────────────────────────────────────

export interface GroupMemberRefs {
  readonly id: RefToken;
}

export const buildGroupMemberRefs: RefBuilder<GroupMemberRefs> = (
  resourceName,
) => ({
  id: new RefToken(resourceName, "id"),
});

// ─── Enums ───────────────────────────────────────────────────────────────────

const memberRoleSchema = z.enum(["OWNER", "MANAGER", "MEMBER"]);

const deliverySettingsSchema = z.enum([
  "ALL_MAIL",
  "DAILY",
  "DIGEST",
  "DISABLED",
  "NONE",
]);

// ─── Spec schema ─────────────────────────────────────────────────────────────

export const groupMemberSpecSchema = z.object({
  kind: z.literal("GroupMember"),
  name: z.string().trim().min(1).optional(),
  /** The group's primary email — part of the identity key. */
  groupEmail: z.email(),
  /** The member's email — part of the identity key. */
  memberEmail: z.email(),
  role: memberRoleSchema.default("MEMBER"),
  deliverySettings: deliverySettingsSchema.default("ALL_MAIL"),
});

export type GroupMemberSpec = z.infer<typeof groupMemberSpecSchema>;

// ─── State schema ────────────────────────────────────────────────────────────

const groupMemberStateSchema = z
  .looseObject({
    id: z.string().trim().min(1),
    groupEmail: z.email(),
    memberEmail: z.email(),
    role: memberRoleSchema,
    deliverySettings: deliverySettingsSchema,
  })
  .readonly();

// ─── Identity and desired-state sub-schemas ──────────────────────────────────

const groupMemberIdentitySchema = z.object({
  kind: z.literal("GroupMember"),
  name: z.string().trim().min(1).optional(),
  groupEmail: groupMemberSpecSchema.shape.groupEmail,
  memberEmail: groupMemberSpecSchema.shape.memberEmail,
});

const groupMemberDesiredStateSchema = z.object({
  role: memberRoleSchema,
  deliverySettings: deliverySettingsSchema,
});

// ─── API response validation ─────────────────────────────────────────────────

const memberResponseSchema = z.looseObject({
  id: z.string().trim().min(1),
  email: z.email(),
  role: memberRoleSchema,
  delivery_settings: deliverySettingsSchema,
});

function toState(
  groupEmail: string,
  raw: z.infer<typeof memberResponseSchema>,
): z.infer<typeof groupMemberStateSchema> {
  return {
    id: raw.id,
    groupEmail,
    memberEmail: raw.email,
    role: raw.role,
    deliverySettings: raw.delivery_settings,
  };
}

function toBody(spec: GroupMemberSpec): Record<string, string> {
  return {
    email: spec.memberEmail,
    role: spec.role,
    delivery_settings: spec.deliverySettings,
  };
}

// ─── Resource implementation ────────────────────────────────────────────────

export class GroupMemberResource implements ResourcePort<
  typeof groupMemberSpecSchema,
  typeof groupMemberStateSchema
> {
  readonly kind = "GroupMember";
  readonly specSchema = groupMemberSpecSchema;
  readonly stateSchema = groupMemberStateSchema;
  readonly identitySchema = groupMemberIdentitySchema;
  readonly desiredStateSchema = groupMemberDesiredStateSchema;

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
      {
        path: [],
        message: "GroupMember state object does not contain a valid id",
      },
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
    const parsed = groupMemberSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "read", parsed.error.issues);
    }
    const client = this.connected("read");

    try {
      const raw = await client.getMember(
        parsed.data.groupEmail,
        parsed.data.memberEmail,
      );
      const result = memberResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(PROVIDER_NAME, "read", result.error.issues);
      }
      return toState(parsed.data.groupEmail, result.data);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "read");
    }
  }

  async create(spec: unknown): Promise<unknown> {
    const parsed = groupMemberSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "create", parsed.error.issues);
    }
    const client = this.connected("create");

    try {
      const raw = await client.insertMember(
        parsed.data.groupEmail,
        toBody(parsed.data),
      );
      const result = memberResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(
          PROVIDER_NAME,
          "create",
          result.error.issues,
        );
      }
      return toState(parsed.data.groupEmail, result.data);
    } catch (error) {
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "create");
    }
  }

  async update(_id: string, spec: unknown): Promise<unknown> {
    const parsed = groupMemberSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "update", parsed.error.issues);
    }
    const client = this.connected("update");

    try {
      const raw = await client.patchMember(
        parsed.data.groupEmail,
        parsed.data.memberEmail,
        toBody(parsed.data),
      );
      const result = memberResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(
          PROVIDER_NAME,
          "update",
          result.error.issues,
        );
      }
      return toState(parsed.data.groupEmail, result.data);
    } catch (error) {
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "update");
    }
  }

  async delete(state: unknown): Promise<void> {
    const parsed = groupMemberStateSchema.safeParse(state);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "delete", parsed.error.issues);
    }
    const client = this.connected("delete");
    try {
      await client.deleteMember(
        parsed.data.groupEmail,
        parsed.data.memberEmail,
      );
    } catch (error) {
      if (isNotFound(error)) return;
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, "delete");
    }
  }
}
