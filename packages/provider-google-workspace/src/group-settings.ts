/**
 * GroupSettings — the posting, membership and visibility policy of a Google
 * group, backed by the Groups Settings API.
 *
 * This is what turns a plain group into a public-facing shared mailbox:
 * `whoCanPostMessage: ANYONE_CAN_POST` lets external, non-member internet
 * senders email the group, while moderation and visibility settings control
 * the rest of the posture.
 *
 * Settings are a singleton tied to the group — they come into existence with
 * the group and die with it — so this resource has no create/delete of its
 * own: `read` is a GET, and both `create` and `update` issue the same PUT to
 * converge the live settings onto the desired policy. The companion `Group`
 * resource owns the lifecycle.
 *
 * The Groups Settings API represents booleans as the strings "true"/"false"
 * and defaults to Atom XML; the client handles the `alt=json` requirement and
 * this resource coerces the string booleans at the boundary so the spec stays
 * genuinely boolean.
 *
 * Wraps the Groups Settings `groups` REST surface
 * (https://developers.google.com/workspace/admin/groups-settings/v1/reference/groups).
 *
 * The group's `groupEmail` is the identity key.
 */

import * as z from "zod";
import type { ResourcePort } from "@infrasync-org/core/provider";
import { RefToken } from "@infrasync-org/core/refs";
import type { RefBuilder } from "@infrasync-org/core/handles";
import { ProviderApiError } from "@infrasync-org/core/errors";
import type { GroupsClient } from "./client.js";
import { PROVIDER_NAME, isNotFound, toProviderApiError } from "./helpers.js";

// ─── Ref type ────────────────────────────────────────────────────────────────

export interface GroupSettingsRefs {
  readonly groupEmail: RefToken;
}

export const buildGroupSettingsRefs: RefBuilder<GroupSettingsRefs> = (
  resourceName,
) => ({
  groupEmail: new RefToken(resourceName, "groupEmail"),
});

// ─── Enums (Groups Settings API value sets) ──────────────────────────────────

const whoCanPostMessageSchema = z.enum([
  "NONE_CAN_POST",
  "ALL_MANAGERS_CAN_POST",
  "ALL_OWNERS_CAN_POST",
  "ALL_MEMBERS_CAN_POST",
  "ALL_IN_DOMAIN_CAN_POST",
  "ANYONE_CAN_POST",
]);

const whoCanJoinSchema = z.enum([
  "ANYONE_CAN_JOIN",
  "ALL_IN_DOMAIN_CAN_JOIN",
  "INVITED_CAN_JOIN",
  "CAN_REQUEST_TO_JOIN",
]);

const whoCanViewGroupSchema = z.enum([
  "ANYONE_CAN_VIEW",
  "ALL_IN_DOMAIN_CAN_VIEW",
  "ALL_MEMBERS_CAN_VIEW",
  "ALL_MANAGERS_CAN_VIEW",
  "ALL_OWNERS_CAN_VIEW",
]);

const whoCanViewMembershipSchema = z.enum([
  "ALL_IN_DOMAIN_CAN_VIEW",
  "ALL_MEMBERS_CAN_VIEW",
  "ALL_MANAGERS_CAN_VIEW",
  "ALL_OWNERS_CAN_VIEW",
]);

const messageModerationLevelSchema = z.enum([
  "MODERATE_ALL_MESSAGES",
  "MODERATE_NON_MEMBERS",
  "MODERATE_NEW_MEMBERS",
  "MODERATE_NONE",
]);

// ─── Spec schema ─────────────────────────────────────────────────────────────

export const groupSettingsSpecSchema = z.object({
  kind: z.literal("GroupSettings"),
  name: z.string().trim().min(1).optional(),
  /** The group's primary email — the identity key. */
  groupEmail: z.email(),
  /** Who may post (email) the group. `ANYONE_CAN_POST` = public inbox. */
  whoCanPostMessage: whoCanPostMessageSchema,
  /** Whether addresses outside the domain may be *members* of the group. */
  allowExternalMembers: z.boolean(),
  whoCanJoin: whoCanJoinSchema,
  whoCanViewGroup: whoCanViewGroupSchema,
  whoCanViewMembership: whoCanViewMembershipSchema,
  messageModerationLevel: messageModerationLevelSchema,
  /** Retain a copy of every message in the group archive. */
  isArchived: z.boolean(),
  /** Show the group in the organisation's global address list. */
  includeInGlobalAddressList: z.boolean(),
});

export type GroupSettingsSpec = z.infer<typeof groupSettingsSpecSchema>;

// ─── State schema ────────────────────────────────────────────────────────────

const groupSettingsStateSchema = z
  .looseObject({
    groupEmail: z.email(),
    whoCanPostMessage: whoCanPostMessageSchema,
    allowExternalMembers: z.boolean(),
    whoCanJoin: whoCanJoinSchema,
    whoCanViewGroup: whoCanViewGroupSchema,
    whoCanViewMembership: whoCanViewMembershipSchema,
    messageModerationLevel: messageModerationLevelSchema,
    isArchived: z.boolean(),
    includeInGlobalAddressList: z.boolean(),
  })
  .readonly();

// ─── Identity and desired-state sub-schemas ──────────────────────────────────

const groupSettingsIdentitySchema = z.object({
  kind: z.literal("GroupSettings"),
  name: z.string().trim().min(1).optional(),
  groupEmail: groupSettingsSpecSchema.shape.groupEmail,
});

const groupSettingsDesiredStateSchema = z.object({
  whoCanPostMessage: whoCanPostMessageSchema,
  allowExternalMembers: z.boolean(),
  whoCanJoin: whoCanJoinSchema,
  whoCanViewGroup: whoCanViewGroupSchema,
  whoCanViewMembership: whoCanViewMembershipSchema,
  messageModerationLevel: messageModerationLevelSchema,
  isArchived: z.boolean(),
  includeInGlobalAddressList: z.boolean(),
});

// ─── API response validation ─────────────────────────────────────────────────

/** The Groups Settings API encodes booleans as the strings "true"/"false". */
const apiBoolSchema = z.enum(["true", "false"]).transform((v) => v === "true");

const settingsResponseSchema = z.looseObject({
  email: z.email(),
  whoCanPostMessage: whoCanPostMessageSchema,
  allowExternalMembers: apiBoolSchema,
  whoCanJoin: whoCanJoinSchema,
  whoCanViewGroup: whoCanViewGroupSchema,
  whoCanViewMembership: whoCanViewMembershipSchema,
  messageModerationLevel: messageModerationLevelSchema,
  isArchived: apiBoolSchema,
  includeInGlobalAddressList: apiBoolSchema,
});

function toState(
  raw: z.infer<typeof settingsResponseSchema>,
): z.infer<typeof groupSettingsStateSchema> {
  return {
    groupEmail: raw.email,
    whoCanPostMessage: raw.whoCanPostMessage,
    allowExternalMembers: raw.allowExternalMembers,
    whoCanJoin: raw.whoCanJoin,
    whoCanViewGroup: raw.whoCanViewGroup,
    whoCanViewMembership: raw.whoCanViewMembership,
    messageModerationLevel: raw.messageModerationLevel,
    isArchived: raw.isArchived,
    includeInGlobalAddressList: raw.includeInGlobalAddressList,
  };
}

/** Encode the spec as the Groups Settings API expects (booleans as strings). */
function toBody(spec: GroupSettingsSpec): Record<string, string> {
  return {
    whoCanPostMessage: spec.whoCanPostMessage,
    allowExternalMembers: String(spec.allowExternalMembers),
    whoCanJoin: spec.whoCanJoin,
    whoCanViewGroup: spec.whoCanViewGroup,
    whoCanViewMembership: spec.whoCanViewMembership,
    messageModerationLevel: spec.messageModerationLevel,
    isArchived: String(spec.isArchived),
    includeInGlobalAddressList: String(spec.includeInGlobalAddressList),
  };
}

// ─── Resource implementation ────────────────────────────────────────────────

export class GroupSettingsResource implements ResourcePort<
  typeof groupSettingsSpecSchema,
  typeof groupSettingsStateSchema
> {
  readonly kind = "GroupSettings";
  readonly specSchema = groupSettingsSpecSchema;
  readonly stateSchema = groupSettingsStateSchema;
  readonly identitySchema = groupSettingsIdentitySchema;
  readonly desiredStateSchema = groupSettingsDesiredStateSchema;

  constructor(private readonly client: GroupsClient | undefined) {}

  getStateId(state: unknown): string {
    if (
      typeof state === "object" &&
      state !== null &&
      "groupEmail" in state &&
      typeof state.groupEmail === "string"
    ) {
      return state.groupEmail;
    }
    throw new ProviderApiError(PROVIDER_NAME, "getStateId", [
      {
        path: [],
        message:
          "GroupSettings state object does not contain a valid groupEmail",
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
    const parsed = groupSettingsSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, "read", parsed.error.issues);
    }
    const client = this.connected("read");

    try {
      const raw = await client.getSettings(parsed.data.groupEmail);
      const result = settingsResponseSchema.safeParse(raw);
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
    return this.put(spec, "create");
  }

  async update(_id: string, spec: unknown): Promise<unknown> {
    return this.put(spec, "update");
  }

  /**
   * Converge the live settings onto the desired policy via PUT, then return
   * the resulting state. Shared by `create` and `update` because group
   * settings always already exist alongside the group.
   */
  private async put(spec: unknown, operation: string): Promise<unknown> {
    const parsed = groupSettingsSpecSchema.safeParse(spec);
    if (!parsed.success) {
      throw new ProviderApiError(PROVIDER_NAME, operation, parsed.error.issues);
    }
    const client = this.connected(operation);

    try {
      const raw = await client.updateSettings(
        parsed.data.groupEmail,
        toBody(parsed.data),
      );
      const result = settingsResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new ProviderApiError(
          PROVIDER_NAME,
          operation,
          result.error.issues,
        );
      }
      return toState(result.data);
    } catch (error) {
      if (error instanceof ProviderApiError) throw error;
      throw toProviderApiError(error, operation);
    }
  }
}
