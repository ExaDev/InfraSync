/**
 * Typed authoring-time handle for the Google Workspace provider.
 *
 * Mirrors the Cloudflare pattern (`createCloudflareHandle`) so callers get
 * typed methods like `gw.inboundSamlSsoProfile(...)` with strongly typed ref surfaces.
 */

import type {
  ResourceHandle,
  ResourceOptions,
  RefBuilder,
} from "@infrasync/core/handles";
import { createResourceHandle } from "@infrasync/core/handles";
import type {
  InboundSamlSsoProfileRefs,
  InboundSamlSsoProfileSpec,
} from "./inbound-saml-sso-profile.js";
import { buildInboundSamlSsoProfileRefs } from "./inbound-saml-sso-profile.js";
import type {
  DirectorySchemaRefs,
  DirectorySchemaSpec,
} from "./directory-schema.js";
import { buildDirectorySchemaRefs } from "./directory-schema.js";
import type {
  UserCustomAttributeRefs,
  UserCustomAttributeSpec,
} from "./user-custom-attribute.js";
import { buildUserCustomAttributeRefs } from "./user-custom-attribute.js";
import type { GroupRefs, GroupSpec } from "./group.js";
import { buildGroupRefs } from "./group.js";
import type { GroupSettingsRefs, GroupSettingsSpec } from "./group-settings.js";
import { buildGroupSettingsRefs } from "./group-settings.js";
import type { GroupMemberRefs, GroupMemberSpec } from "./group-member.js";
import { buildGroupMemberRefs } from "./group-member.js";

// ─── Registration function ───────────────────────────────────────────────────

/**
 * Function that registers a resource handle with the authoring scope.
 * Obtained from the base `ProviderHandle.register` returned by
 * `infra.provider(...)`.
 */
export type ResourceRegistrar = (
  handle: ResourceHandle<unknown, unknown>,
) => void;

// ─── Typed Google Workspace handle ───────────────────────────────────────────

export interface GoogleWorkspaceProviderHandle {
  /** Provider instance key (e.g. "gw") */
  readonly instanceKey: string;

  /** Adapter name ("google-workspace") */
  readonly adapterName: string;

  /**
   * Create a SAML application (Cloud Identity inboundSamlSsoProfile).
   * Returns a handle with typed ref surface (id, name, displayName).
   */
  inboundSamlSsoProfile(
    id: string,
    spec: InboundSamlSsoProfileSpec,
    options?: ResourceOptions,
  ): ResourceHandle<InboundSamlSsoProfileSpec, InboundSamlSsoProfileRefs>;

  /**
   * Create a custom user schema (Directory API schemas resource).
   * Returns a handle with typed ref surface (schemaId, schemaName).
   */
  directorySchema(
    id: string,
    spec: DirectorySchemaSpec,
    options?: ResourceOptions,
  ): ResourceHandle<DirectorySchemaSpec, DirectorySchemaRefs>;

  /**
   * Set a custom attribute value on a user profile.
   * Returns a handle with typed ref surface (value).
   */
  userCustomAttribute(
    id: string,
    spec: UserCustomAttributeSpec,
    options?: ResourceOptions,
  ): ResourceHandle<UserCustomAttributeSpec, UserCustomAttributeRefs>;

  /**
   * Create a Google group (the object behind a shared mailbox address).
   * Returns a handle with typed ref surface (id, email).
   */
  group(
    id: string,
    spec: GroupSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupSpec, GroupRefs>;

  /**
   * Set a group's posting/visibility policy — the public-facing posture.
   * Returns a handle with typed ref surface (groupEmail).
   */
  groupSettings(
    id: string,
    spec: GroupSettingsSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupSettingsSpec, GroupSettingsRefs>;

  /**
   * Add a member to a group with a role and delivery preference.
   * Returns a handle with typed ref surface (id).
   */
  groupMember(
    id: string,
    spec: GroupMemberSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupMemberSpec, GroupMemberRefs>;
}

// ─── Implementation ──────────────────────────────────────────────────────────

class GoogleWorkspaceProviderHandleImpl implements GoogleWorkspaceProviderHandle {
  constructor(
    readonly instanceKey: string,
    readonly adapterName: string,
    private readonly registerResource: ResourceRegistrar,
  ) {}

  inboundSamlSsoProfile(
    id: string,
    spec: InboundSamlSsoProfileSpec,
    options?: ResourceOptions,
  ): ResourceHandle<InboundSamlSsoProfileSpec, InboundSamlSsoProfileRefs> {
    return this.typedResource(
      "InboundSamlSsoProfile",
      id,
      spec,
      options,
      buildInboundSamlSsoProfileRefs,
    );
  }

  directorySchema(
    id: string,
    spec: DirectorySchemaSpec,
    options?: ResourceOptions,
  ): ResourceHandle<DirectorySchemaSpec, DirectorySchemaRefs> {
    return this.typedResource(
      "DirectorySchema",
      id,
      spec,
      options,
      buildDirectorySchemaRefs,
    );
  }

  userCustomAttribute(
    id: string,
    spec: UserCustomAttributeSpec,
    options?: ResourceOptions,
  ): ResourceHandle<UserCustomAttributeSpec, UserCustomAttributeRefs> {
    return this.typedResource(
      "UserCustomAttribute",
      id,
      spec,
      options,
      buildUserCustomAttributeRefs,
    );
  }

  group(
    id: string,
    spec: GroupSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupSpec, GroupRefs> {
    return this.typedResource("Group", id, spec, options, buildGroupRefs);
  }

  groupSettings(
    id: string,
    spec: GroupSettingsSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupSettingsSpec, GroupSettingsRefs> {
    return this.typedResource(
      "GroupSettings",
      id,
      spec,
      options,
      buildGroupSettingsRefs,
    );
  }

  groupMember(
    id: string,
    spec: GroupMemberSpec,
    options?: ResourceOptions,
  ): ResourceHandle<GroupMemberSpec, GroupMemberRefs> {
    return this.typedResource(
      "GroupMember",
      id,
      spec,
      options,
      buildGroupMemberRefs,
    );
  }

  private typedResource<TSpec, TRefs>(
    kind: string,
    id: string,
    spec: TSpec,
    options: ResourceOptions | undefined,
    buildRefs: RefBuilder<TRefs>,
  ): ResourceHandle<TSpec, TRefs> {
    const handle = createResourceHandle(
      id,
      this.instanceKey,
      kind,
      spec,
      options,
      buildRefs,
    );
    this.registerResource(handle);
    return handle;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a typed Google Workspace provider handle.
 *
 * ```typescript
 * import {
 *   googleWorkspace,
 *   createGoogleWorkspaceHandle,
 * } from "@infrasync/google-workspace";
 *
 * const infra = defineInfra("prod", (infra) => {
 *   const baseGw = infra.provider("gw", googleWorkspace, {
 *     kind: "oauth-user",
 *     // …
 *   });
 *   const gw = createGoogleWorkspaceHandle(
 *     baseGw.instanceKey,
 *     baseGw.adapterName,
 *     baseGw.register,
 *   );
 *
 *   gw.inboundSamlSsoProfile("m365", {
 *     kind: "InboundSamlSsoProfile",
 *     displayName: "Microsoft 365",
 *     idpConfig: { ... },
 *     spConfig: { ... },
 *   });
 * });
 * ```
 */
export function createGoogleWorkspaceHandle(
  instanceKey: string,
  adapterName: string,
  registerResource: ResourceRegistrar,
): GoogleWorkspaceProviderHandle {
  return new GoogleWorkspaceProviderHandleImpl(
    instanceKey,
    adapterName,
    registerResource,
  );
}
