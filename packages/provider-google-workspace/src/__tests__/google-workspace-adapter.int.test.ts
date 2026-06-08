import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  googleWorkspaceConfigSchema,
  GoogleWorkspaceProvider,
  inboundSamlSsoProfileSpecSchema,
  buildInboundSamlSsoProfileRefs,
  createGoogleWorkspaceHandle,
  InboundSamlSsoProfileResource,
  directorySchemaSpecSchema,
  userCustomAttributeSpecSchema,
  groupSpecSchema,
  buildGroupRefs,
  GroupResource,
  groupSettingsSpecSchema,
  buildGroupSettingsRefs,
  GroupSettingsResource,
  groupMemberSpecSchema,
  buildGroupMemberRefs,
  GroupMemberResource,
} from "../index.js";
import {
  CloudIdentityClient,
  GroupsClient,
  type GoogleRequester,
} from "../client.js";
import { ResolvedScopes } from "@infrasync-org/core/provider";
import type { ResourceHandle } from "@infrasync-org/core/handles";
import { RefToken } from "@infrasync-org/core/refs";
import { ProviderApiError } from "@infrasync-org/core/errors";

describe("Google Workspace adapter", () => {
  it("validates oauth-user config", () => {
    const config = {
      kind: "oauth-user" as const,
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      customerId: "C00abc123",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(result.success);
    assert.equal(result.data.kind, "oauth-user");
  });

  it("validates service-account config", () => {
    const config = {
      kind: "service-account" as const,
      serviceAccountKey: JSON.stringify({ type: "service_account" }),
      subjectEmail: "admin@example.com",
      customerId: "C00abc123",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(result.success);
    assert.equal(result.data.kind, "service-account");
  });

  it("rejects config missing discriminant", () => {
    const config = {
      clientId: "x",
      clientSecret: "y",
      refreshToken: "z",
      customerId: "C00",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("rejects service-account config with non-email subject", () => {
    const config = {
      kind: "service-account" as const,
      serviceAccountKey: "key",
      subjectEmail: "not-an-email",
      customerId: "C00",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("rejects oauth-user config with empty fields", () => {
    const config = {
      kind: "oauth-user" as const,
      clientId: "",
      clientSecret: "y",
      refreshToken: "z",
      customerId: "C00",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("rejects oauth-user config missing customerId", () => {
    const config = {
      kind: "oauth-user" as const,
      clientId: "x",
      clientSecret: "y",
      refreshToken: "z",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("rejects service-account config missing customerId", () => {
    const config = {
      kind: "service-account" as const,
      serviceAccountKey: JSON.stringify({ type: "service_account" }),
      subjectEmail: "admin@example.com",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("rejects oauth-user config with empty customerId", () => {
    const config = {
      kind: "oauth-user" as const,
      clientId: "x",
      clientSecret: "y",
      refreshToken: "z",
      customerId: "",
    };
    const result = googleWorkspaceConfigSchema.safeParse(config);
    assert.ok(!result.success);
  });

  it("provider lists supported kinds", () => {
    const provider = new GoogleWorkspaceProvider();
    assert.deepEqual(provider.supportedKinds(), [
      "InboundSamlSsoProfile",
      "DirectorySchema",
      "UserCustomAttribute",
      "Group",
      "GroupSettings",
      "GroupMember",
    ]);
  });

  it("provider creates handler for each supported kind", () => {
    const provider = new GoogleWorkspaceProvider();
    for (const kind of provider.supportedKinds()) {
      const handler = provider.resourceHandler(kind, ResolvedScopes.empty);
      assert.equal(handler.kind, kind);
    }
  });

  it("provider throws for unknown kind", () => {
    const provider = new GoogleWorkspaceProvider();
    assert.throws(
      () => provider.resourceHandler("Unknown", ResolvedScopes.empty),
      /No resource registered/,
    );
  });

  it("connectedClient throws before connect", () => {
    const provider = new GoogleWorkspaceProvider();
    assert.throws(() => provider.connectedClient(), /not connected/);
  });

  // ─── InboundSamlSsoProfile spec schema ───────────────────────────────────────────────────

  it("parses a valid InboundSamlSsoProfile spec", () => {
    const spec = {
      kind: "InboundSamlSsoProfile" as const,
      displayName: "Microsoft 365",
      idpConfig: {
        entityId: "https://accounts.google.com/o/saml2?idpid=C00abc123",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=C00abc123",
      },
      spConfig: {
        entityId: "urn:federation:MicrosoftOnline",
        assertionConsumerServiceUri:
          "https://login.microsoftonline.com/login.srf",
      },
    };
    const result = inboundSamlSsoProfileSpecSchema.safeParse(spec);
    assert.ok(result.success);
    assert.equal(result.data.displayName, "Microsoft 365");
  });

  it("parses a InboundSamlSsoProfile spec with optional IdP fields", () => {
    const spec = {
      kind: "InboundSamlSsoProfile" as const,
      displayName: "App",
      idpConfig: {
        entityId: "https://accounts.google.com/o/saml2?idpid=X",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=X",
        logoutRedirectUri: "https://example.com/logout",
        changePasswordUri: "https://example.com/password",
      },
      spConfig: {
        entityId: "urn:example:sp",
        assertionConsumerServiceUri: "https://example.com/acs",
      },
    };
    const result = inboundSamlSsoProfileSpecSchema.safeParse(spec);
    assert.ok(result.success);
    assert.equal(
      result.data.idpConfig.logoutRedirectUri,
      "https://example.com/logout",
    );
  });

  it("rejects InboundSamlSsoProfile spec with empty displayName", () => {
    const spec = {
      kind: "InboundSamlSsoProfile" as const,
      displayName: "",
      idpConfig: {
        entityId: "https://accounts.google.com/o/saml2?idpid=X",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=X",
      },
      spConfig: {
        entityId: "urn:example:sp",
        assertionConsumerServiceUri: "https://example.com/acs",
      },
    };
    const result = inboundSamlSsoProfileSpecSchema.safeParse(spec);
    assert.ok(!result.success);
  });

  it("rejects InboundSamlSsoProfile spec with invalid idpConfig URL", () => {
    const spec = {
      kind: "InboundSamlSsoProfile" as const,
      displayName: "App",
      idpConfig: {
        entityId: "not a url",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=X",
      },
      spConfig: {
        entityId: "urn:example:sp",
        assertionConsumerServiceUri: "https://example.com/acs",
      },
    };
    const result = inboundSamlSsoProfileSpecSchema.safeParse(spec);
    assert.ok(!result.success);
  });

  it("rejects InboundSamlSsoProfile spec with unknown extra fields", () => {
    const spec = {
      kind: "InboundSamlSsoProfile" as const,
      displayName: "App",
      idpConfig: {
        entityId: "https://accounts.google.com/o/saml2?idpid=X",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=X",
      },
      spConfig: {
        entityId: "urn:example:sp",
        assertionConsumerServiceUri: "https://example.com/acs",
      },
      unexpected: true,
    };
    const result = inboundSamlSsoProfileSpecSchema.safeParse(spec);
    assert.ok(!result.success);
  });

  // ─── Refs and handle ──────────────────────────────────────────────────────

  it("buildInboundSamlSsoProfileRefs produces typed RefTokens", () => {
    const refs = buildInboundSamlSsoProfileRefs("my-inbound-saml-sso-profile");
    assert.ok(refs.id instanceof RefToken);
    assert.ok(refs.name instanceof RefToken);
    assert.ok(refs.displayName instanceof RefToken);
    assert.equal(refs.id.resource, "my-inbound-saml-sso-profile");
    assert.equal(refs.id.path, "id");
    assert.equal(refs.name.path, "name");
    assert.equal(refs.displayName.path, "displayName");
  });

  it("typed handle registers an InboundSamlSsoProfile resource", () => {
    const registered: { kind: string; name: string }[] = [];
    const handle = createGoogleWorkspaceHandle(
      "gw",
      "google-workspace",
      (h: ResourceHandle<unknown, unknown>) => {
        registered.push({ kind: h.kind, name: h.name });
      },
    );
    const result = handle.inboundSamlSsoProfile("m365", {
      kind: "InboundSamlSsoProfile",
      displayName: "Microsoft 365",
      idpConfig: {
        entityId: "https://accounts.google.com/o/saml2?idpid=X",
        singleSignOnServiceUri:
          "https://accounts.google.com/o/saml2/idp?idpid=X",
      },
      spConfig: {
        entityId: "urn:federation:MicrosoftOnline",
        assertionConsumerServiceUri:
          "https://login.microsoftonline.com/login.srf",
      },
    });
    assert.deepEqual(registered, [
      { kind: "InboundSamlSsoProfile", name: "m365" },
    ]);
    assert.equal(result.kind, "InboundSamlSsoProfile");
    assert.equal(result.name, "m365");
    assert.ok(result.ref.id instanceof RefToken);
  });

  // ─── InboundSamlSsoProfileResource handler behaviour ────────────────────────────────────

  it("InboundSamlSsoProfile handler reports correct kind and identity surface", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "InboundSamlSsoProfile",
      ResolvedScopes.empty,
    );
    assert.equal(handler.kind, "InboundSamlSsoProfile");
    const identityResult = handler.identitySchema.safeParse({
      kind: "InboundSamlSsoProfile",
      displayName: "App",
    });
    assert.ok(identityResult.success);
  });

  it("InboundSamlSsoProfile handler getStateId extracts resource name", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "InboundSamlSsoProfile",
      ResolvedScopes.empty,
    );
    const id = handler.getStateId({
      name: "inboundSamlSsoProfiles/01abc23",
      displayName: "App",
    });
    assert.equal(id, "inboundSamlSsoProfiles/01abc23");
  });

  it("InboundSamlSsoProfile handler getStateId throws on missing name", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "InboundSamlSsoProfile",
      ResolvedScopes.empty,
    );
    assert.throws(() => handler.getStateId({ displayName: "App" }));
  });

  it("InboundSamlSsoProfile handler operations throw before connect", async () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "InboundSamlSsoProfile",
      ResolvedScopes.empty,
    );
    await assert.rejects(
      () =>
        handler.read({
          kind: "InboundSamlSsoProfile",
          displayName: "App",
          idpConfig: {
            entityId: "https://accounts.google.com/o/saml2?idpid=X",
            singleSignOnServiceUri:
              "https://accounts.google.com/o/saml2/idp?idpid=X",
          },
          spConfig: {
            entityId: "urn:example:sp",
            assertionConsumerServiceUri: "https://example.com/acs",
          },
        }),
      // `read()` now wraps all underlying errors in `ProviderApiError`. The
      // original "not connected" message survives on the first issue.
      (err: unknown) => {
        assert.ok(err instanceof ProviderApiError);
        assert.equal(err.operation, "read");
        assert.match(firstIssueMessage(err), /not connected/);
        return true;
      },
    );
  });

  // ─── LRO error boundary ───────────────────────────────────────────────────

  /**
   * Build a `GoogleRequester` stub that returns the supplied LRO response
   * regardless of the request. Used to drive `awaitOperation` into the
   * failure paths without hitting the network.
   */
  function stubRequester(operation: Record<string, unknown>): GoogleRequester {
    return {
      async request(): Promise<{ data: unknown }> {
        await Promise.resolve();
        return { data: operation };
      },
    } as unknown as GoogleRequester;
  }

  const validSamlSpec = {
    kind: "InboundSamlSsoProfile" as const,
    displayName: "App",
    idpConfig: {
      entityId: "https://accounts.google.com/o/saml2?idpid=X",
      singleSignOnServiceUri: "https://accounts.google.com/o/saml2/idp?idpid=X",
    },
    spConfig: {
      entityId: "urn:example:sp",
      assertionConsumerServiceUri: "https://example.com/acs",
    },
  };

  function firstIssueMessage(err: ProviderApiError): string {
    const first = err.issues[0];
    if (first === undefined) {
      throw new Error("expected at least one issue on ProviderApiError");
    }
    return first.message;
  }

  it("InboundSamlSsoProfile.create wraps OperationFailedError in ProviderApiError", async () => {
    const requester = stubRequester({
      name: "operations/failed-op",
      done: true,
      error: { code: 13, message: "internal failure" },
    });
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.create(validSamlSpec),
      (err: unknown) => {
        assert.ok(err instanceof ProviderApiError);
        assert.equal(err.provider, "google-workspace");
        assert.equal(err.operation, "create");
        assert.equal(err.issues.length, 1);
        assert.match(firstIssueMessage(err), /operations\/failed-op/);
        return true;
      },
    );
  });

  it("InboundSamlSsoProfile.update wraps OperationFailedError in ProviderApiError", async () => {
    const requester = stubRequester({
      name: "operations/failed-op",
      done: true,
      error: { code: 7, message: "permission denied" },
    });
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.update("inboundSamlSsoProfiles/01abc23", validSamlSpec),
      (err: unknown) => {
        assert.ok(err instanceof ProviderApiError);
        assert.equal(err.operation, "update");
        assert.match(firstIssueMessage(err), /permission denied/);
        return true;
      },
    );
  });

  it("awaitOperation fails loudly when error response omits message", async () => {
    // The previous implementation silently substituted "operation failed
    // without a message" when `error.message` was absent, masking malformed
    // responses. The schema now requires `error.message`, so a malformed
    // operation fails at parse time with a structured validation error.
    const requester = stubRequester({
      name: "operations/malformed-op",
      done: true,
      error: { code: 13 },
    });
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.create(validSamlSpec),
      (err: unknown) => {
        // `toProviderApiError` wraps the underlying parse error.
        assert.ok(err instanceof ProviderApiError);
        assert.equal(err.operation, "create");
        // The placeholder string must not appear anywhere in the error.
        assert.doesNotMatch(
          firstIssueMessage(err),
          /operation failed without a message/,
        );
        // The parse-failure message names the offending field.
        assert.match(firstIssueMessage(err), /error\.message|message/);
        return true;
      },
    );
  });

  // ─── customerId threading ─────────────────────────────────────────────────

  it("listProfiles sends customer filter scoped to configured customerId", async () => {
    interface CapturedRequest {
      readonly url: string | undefined;
      readonly params: unknown;
    }
    const captured: CapturedRequest[] = [];
    const requester: GoogleRequester = {
      async request(opts: {
        url?: string;
        params?: unknown;
      }): Promise<{ data: unknown }> {
        await Promise.resolve();
        captured.push({ url: opts.url, params: opts.params });
        return { data: { inboundSamlSsoProfiles: [] } };
      },
    } as unknown as GoogleRequester;
    const client = new CloudIdentityClient(requester, "C00xyz789");

    await client.listProfiles();

    assert.equal(captured.length, 1);
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.ok(first.url !== undefined);
    assert.match(first.url, /inboundSamlSsoProfiles$/);
    assert.deepEqual(first.params, {
      filter: 'customer=="customers/C00xyz789"',
    });
  });

  it("listProfiles paginates and searches across every page", async () => {
    // Cloud Identity lists are paginated; a tenant with more profiles than
    // fit on one page would have its target missed by `read()` if only the
    // first page were searched, producing a spurious create that fails on
    // the API's uniqueness constraint.
    interface CapturedRequest {
      readonly params: Record<string, unknown> | undefined;
    }
    const captured: CapturedRequest[] = [];
    const pages: { data: unknown }[] = [
      {
        data: {
          inboundSamlSsoProfiles: [
            {
              name: "inboundSamlSsoProfiles/page1-only",
              displayName: "Other App",
            },
          ],
          nextPageToken: "next",
        },
      },
      {
        data: {
          inboundSamlSsoProfiles: [
            {
              name: "inboundSamlSsoProfiles/page2-target",
              displayName: "Target App",
            },
          ],
        },
      },
    ];
    const requester: GoogleRequester = {
      async request(opts: {
        params?: Record<string, unknown>;
      }): Promise<{ data: unknown }> {
        await Promise.resolve();
        captured.push({ params: opts.params });
        const page = pages.shift();
        if (page === undefined) {
          throw new Error("requester called more times than pages provided");
        }
        return page;
      },
    } as unknown as GoogleRequester;

    const client = new CloudIdentityClient(requester, "C00xyz789");
    const resource = new InboundSamlSsoProfileResource(client);

    const result = await resource.read({
      ...validSamlSpec,
      displayName: "Target App",
    });

    // Both pages were fetched.
    assert.equal(captured.length, 2);
    // First request omits pageToken.
    const firstParams = captured[0]?.params;
    assert.ok(firstParams !== undefined);
    assert.equal(firstParams.pageToken, undefined);
    // Second request supplies the previous page's nextPageToken.
    const secondParams = captured[1]?.params;
    assert.ok(secondParams !== undefined);
    assert.equal(secondParams.pageToken, "next");
    // Match was found on page 2.
    assert.ok(typeof result === "object" && result !== null);
    assert.equal((result as { displayName: string }).displayName, "Target App");
  });

  it("InboundSamlSsoProfile.read wraps requester errors in ProviderApiError", async () => {
    // The list HTTP GET in `read()` does not poll an LRO, but it can still
    // throw a GaxiosError (or any other plain Error) on network/HTTP failure.
    // Without the try/catch the error escapes as a plain Error and crashes
    // the engine, which only catches ProviderApiError.
    const requester: GoogleRequester = {
      async request(): Promise<{ data: unknown }> {
        await Promise.resolve();
        throw new Error("HTTP 503 Service Unavailable");
      },
    } as unknown as GoogleRequester;
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.read(validSamlSpec),
      (err: unknown) => {
        assert.ok(err instanceof ProviderApiError);
        assert.equal(err.provider, "google-workspace");
        assert.equal(err.operation, "read");
        assert.match(firstIssueMessage(err), /503 Service Unavailable/);
        return true;
      },
    );
  });

  it("InboundSamlSsoProfile.read re-throws existing ProviderApiError unchanged", async () => {
    // Parallel to the create()/update() guarantees: a ProviderApiError raised
    // from within the requester must propagate unchanged so its structured
    // issues survive.
    const sentinel = new ProviderApiError("google-workspace", "read", [
      { path: ["sentinel"], message: "sentinel" },
    ]);
    const requester: GoogleRequester = {
      async request(): Promise<{ data: unknown }> {
        await Promise.resolve();
        throw sentinel;
      },
    } as unknown as GoogleRequester;
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.read(validSamlSpec),
      (err: unknown) => {
        assert.strictEqual(err, sentinel);
        return true;
      },
    );
  });

  it("InboundSamlSsoProfile.create re-throws existing ProviderApiError unchanged", async () => {
    // A `ProviderApiError` raised inside the requester must propagate
    // unchanged from `toProviderApiError` — re-wrapping would discard the
    // original `provider`, `operation`, and `issues` fields.
    const sentinel = new ProviderApiError("google-workspace", "create", [
      { path: ["sentinel"], message: "sentinel" },
    ]);
    const requester: GoogleRequester = {
      async request(): Promise<{ data: unknown }> {
        await Promise.resolve();
        throw sentinel;
      },
    } as unknown as GoogleRequester;
    const client = new CloudIdentityClient(requester, "C00abc123");
    const resource = new InboundSamlSsoProfileResource(client);

    await assert.rejects(
      () => resource.create(validSamlSpec),
      (err: unknown) => {
        assert.strictEqual(err, sentinel);
        return true;
      },
    );
  });

  // ─── DirectorySchema spec ──────────────────────────────────────────────────

  it("parses a valid DirectorySchema spec", () => {
    const result = directorySchemaSpecSchema.safeParse({
      kind: "DirectorySchema",
      schemaName: "microsoftEntra",
      fields: [
        {
          fieldName: "immutableId",
          fieldType: "STRING",
        },
      ],
    });
    assert.ok(result.success);
    assert.equal(result.data.schemaName, "microsoftEntra");
    assert.equal(result.data.fields.length, 1);
    const field = result.data.fields[0];
    assert.ok(field !== undefined);
    assert.equal(field.fieldName, "immutableId");
    assert.equal(field.fieldType, "STRING");
    assert.equal(field.multiValued, false);
    assert.equal(field.readAccessType, "ADMINS_AND_SELF");
  });

  it("rejects DirectorySchema with empty schemaName", () => {
    const result = directorySchemaSpecSchema.safeParse({
      kind: "DirectorySchema",
      schemaName: "",
      fields: [{ fieldName: "x", fieldType: "STRING" }],
    });
    assert.ok(!result.success);
  });

  it("rejects DirectorySchema with empty fields", () => {
    const result = directorySchemaSpecSchema.safeParse({
      kind: "DirectorySchema",
      schemaName: "test",
      fields: [],
    });
    assert.ok(!result.success);
  });

  it("rejects DirectorySchema with invalid fieldType", () => {
    const result = directorySchemaSpecSchema.safeParse({
      kind: "DirectorySchema",
      schemaName: "test",
      fields: [{ fieldName: "x", fieldType: "BINARY" }],
    });
    assert.ok(!result.success);
  });

  // ─── UserCustomAttribute spec ─────────────────────────────────────────────

  it("parses a valid UserCustomAttribute spec", () => {
    const result = userCustomAttributeSpecSchema.safeParse({
      kind: "UserCustomAttribute",
      primaryEmail: "joe@example.com",
      schemaName: "microsoftEntra",
      fieldName: "immutableId",
      value: "116671446635013837259",
    });
    assert.ok(result.success);
    assert.equal(result.data.primaryEmail, "joe@example.com");
    assert.equal(result.data.value, "116671446635013837259");
  });

  it("rejects UserCustomAttribute with invalid email", () => {
    const result = userCustomAttributeSpecSchema.safeParse({
      kind: "UserCustomAttribute",
      primaryEmail: "not-an-email",
      schemaName: "microsoftEntra",
      fieldName: "immutableId",
      value: "123",
    });
    assert.ok(!result.success);
  });

  it("rejects UserCustomAttribute with empty value", () => {
    const result = userCustomAttributeSpecSchema.safeParse({
      kind: "UserCustomAttribute",
      primaryEmail: "joe@example.com",
      schemaName: "microsoftEntra",
      fieldName: "immutableId",
      value: "",
    });
    assert.ok(!result.success);
  });

  // ─── DirectorySchemaResource handler ──────────────────────────────────────

  it("DirectorySchema handler reports correct kind", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "DirectorySchema",
      ResolvedScopes.empty,
    );
    assert.equal(handler.kind, "DirectorySchema");
  });

  it("DirectorySchema handler getStateId extracts schemaId", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "DirectorySchema",
      ResolvedScopes.empty,
    );
    const id = handler.getStateId({ schemaId: "schema-123" });
    assert.equal(id, "schema-123");
  });

  it("DirectorySchema handler getStateId throws on missing schemaId", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "DirectorySchema",
      ResolvedScopes.empty,
    );
    assert.throws(() => handler.getStateId({ schemaName: "test" }));
  });

  // ─── UserCustomAttributeResource handler ──────────────────────────────────

  it("UserCustomAttribute handler reports correct kind", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "UserCustomAttribute",
      ResolvedScopes.empty,
    );
    assert.equal(handler.kind, "UserCustomAttribute");
  });

  it("UserCustomAttribute handler getStateId composes composite key", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "UserCustomAttribute",
      ResolvedScopes.empty,
    );
    const id = handler.getStateId({
      primaryEmail: "joe@example.com",
      schemaName: "microsoftEntra",
      fieldName: "immutableId",
    });
    assert.equal(id, "joe@example.com#microsoftEntra#immutableId");
  });

  it("UserCustomAttribute handler getStateId throws on missing fields", () => {
    const provider = new GoogleWorkspaceProvider();
    const handler = provider.resourceHandler(
      "UserCustomAttribute",
      ResolvedScopes.empty,
    );
    assert.throws(() =>
      handler.getStateId({ primaryEmail: "joe@example.com" }),
    );
  });

  // ─── Typed handle for new resources ───────────────────────────────────────

  it("typed handle registers DirectorySchema and UserCustomAttribute", () => {
    const registered: { kind: string; name: string }[] = [];
    const handle = createGoogleWorkspaceHandle(
      "gw",
      "google-workspace",
      (h: ResourceHandle<unknown, unknown>) => {
        registered.push({ kind: h.kind, name: h.name });
      },
    );

    const schemaHandle = handle.directorySchema("entra-schema", {
      kind: "DirectorySchema",
      schemaName: "microsoftEntra",
      fields: [
        {
          fieldName: "immutableId",
          fieldType: "STRING",
          multiValued: false,
          readAccessType: "ADMINS_AND_SELF",
        },
      ],
    });
    assert.equal(schemaHandle.kind, "DirectorySchema");
    assert.equal(schemaHandle.name, "entra-schema");
    assert.ok(schemaHandle.ref.schemaId instanceof RefToken);

    const attrHandle = handle.userCustomAttribute("joe-immutable-id", {
      kind: "UserCustomAttribute",
      primaryEmail: "joe@example.com",
      schemaName: "microsoftEntra",
      fieldName: "immutableId",
      value: "116671446635013837259",
    });
    assert.equal(attrHandle.kind, "UserCustomAttribute");
    assert.equal(attrHandle.name, "joe-immutable-id");
    assert.ok(attrHandle.ref.value instanceof RefToken);

    assert.deepEqual(registered, [
      { kind: "DirectorySchema", name: "entra-schema" },
      { kind: "UserCustomAttribute", name: "joe-immutable-id" },
    ]);
  });
});

// ─── Groups: the shared-mailbox surface ──────────────────────────────────────

describe("Google Workspace groups", () => {
  interface Captured {
    readonly url: string | undefined;
    readonly method: string | undefined;
    readonly params: unknown;
    readonly data: unknown;
  }

  /**
   * Build a `GroupsClient` over a stub requester that records every request
   * and replies with `response` to each. Each test here issues a single
   * request, so one canned response suffices.
   */
  function stubGroups(response: unknown): {
    readonly client: GroupsClient;
    readonly captured: Captured[];
  } {
    const captured: Captured[] = [];
    const requester = {
      async request(opts: {
        url?: string;
        method?: string;
        params?: unknown;
        data?: unknown;
      }): Promise<{ data: unknown }> {
        await Promise.resolve();
        captured.push({
          url: opts.url,
          method: opts.method,
          params: opts.params,
          data: opts.data,
        });
        return { data: response };
      },
    } as unknown as GoogleRequester;
    return { client: new GroupsClient(requester), captured };
  }

  // ─── Group ────────────────────────────────────────────────────────────────

  it("parses a valid Group spec and defaults description to empty", () => {
    const result = groupSpecSchema.safeParse({
      kind: "Group",
      email: "support@example.com",
      displayName: "Support",
    });
    assert.ok(result.success);
    assert.equal(result.data.description, "");
  });

  it("rejects a Group spec with a non-email address", () => {
    const result = groupSpecSchema.safeParse({
      kind: "Group",
      email: "not-an-email",
      displayName: "Support",
    });
    assert.ok(!result.success);
  });

  it("buildGroupRefs exposes id and email ref tokens", () => {
    const refs = buildGroupRefs("support");
    assert.ok(refs.id instanceof RefToken);
    assert.ok(refs.email instanceof RefToken);
  });

  it("Group.read maps the API `name` field onto displayName", async () => {
    const { client } = stubGroups({
      id: "01234567890",
      email: "support@example.com",
      name: "Support",
      description: "Customer support inbox",
    });
    const resource = new GroupResource(client);
    const state = await resource.read({
      kind: "Group",
      email: "support@example.com",
      displayName: "Support",
    });
    assert.deepEqual(state, {
      id: "01234567890",
      email: "support@example.com",
      displayName: "Support",
      description: "Customer support inbox",
    });
  });

  it("Group.create sends name + description and returns mapped state", async () => {
    const { client, captured } = stubGroups({
      id: "01234567890",
      email: "support@example.com",
      name: "Support",
      description: "",
    });
    const resource = new GroupResource(client);
    await resource.create({
      kind: "Group",
      email: "support@example.com",
      displayName: "Support",
      description: "",
    });
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.equal(first.method, "POST");
    assert.deepEqual(first.data, {
      email: "support@example.com",
      name: "Support",
      description: "",
    });
  });

  it("Group.read returns undefined on a 404", async () => {
    const requester = {
      async request(): Promise<{ data: unknown }> {
        await Promise.resolve();
        const err = new Error("not found") as Error & { code: number };
        err.code = 404;
        throw err;
      },
    } as unknown as GoogleRequester;
    const resource = new GroupResource(new GroupsClient(requester));
    const state = await resource.read({
      kind: "Group",
      email: "absent@example.com",
      displayName: "Absent",
    });
    assert.equal(state, undefined);
  });

  // ─── GroupSettings ──────────────────────────────────────────────────────

  it("parses a valid public-facing GroupSettings spec", () => {
    const result = groupSettingsSpecSchema.safeParse({
      kind: "GroupSettings",
      groupEmail: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    });
    assert.ok(result.success);
  });

  it("rejects a GroupSettings spec with an unknown posting value", () => {
    const result = groupSettingsSpecSchema.safeParse({
      kind: "GroupSettings",
      groupEmail: "support@example.com",
      whoCanPostMessage: "EVERYONE",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    });
    assert.ok(!result.success);
  });

  it("GroupSettings.read coerces the API's string booleans to booleans", async () => {
    const { client, captured } = stubGroups({
      email: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: "false",
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: "true",
      includeInGlobalAddressList: "true",
    });
    const resource = new GroupSettingsResource(client);
    const state = await resource.read({
      kind: "GroupSettings",
      groupEmail: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    });
    assert.ok(state !== undefined && typeof state === "object");
    assert.equal(
      (state as { allowExternalMembers: unknown }).allowExternalMembers,
      false,
    );
    assert.equal((state as { isArchived: unknown }).isArchived, true);
    // The Groups Settings API must be asked for JSON explicitly.
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.deepEqual(first.params, { alt: "json" });
  });

  it("GroupSettings.update encodes booleans as strings in the PUT body", async () => {
    const settingsResponse = {
      email: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: "false",
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: "true",
      includeInGlobalAddressList: "true",
    };
    const { client, captured } = stubGroups(settingsResponse);
    const resource = new GroupSettingsResource(client);
    await resource.update("support@example.com", {
      kind: "GroupSettings",
      groupEmail: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    });
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.equal(first.method, "PUT");
    assert.ok(first.data !== null && typeof first.data === "object");
    const body = first.data as Record<string, unknown>;
    assert.equal(body.allowExternalMembers, "false");
    assert.equal(body.isArchived, "true");
    assert.equal(body.whoCanPostMessage, "ANYONE_CAN_POST");
  });

  it("buildGroupSettingsRefs exposes a groupEmail ref token", () => {
    const refs = buildGroupSettingsRefs("support-settings");
    assert.ok(refs.groupEmail instanceof RefToken);
  });

  // ─── GroupMember ──────────────────────────────────────────────────────────

  it("GroupMember spec defaults role to MEMBER and delivery to ALL_MAIL", () => {
    const result = groupMemberSpecSchema.safeParse({
      kind: "GroupMember",
      groupEmail: "support@example.com",
      memberEmail: "joe@example.com",
    });
    assert.ok(result.success);
    assert.equal(result.data.role, "MEMBER");
    assert.equal(result.data.deliverySettings, "ALL_MAIL");
  });

  it("GroupMember.create maps deliverySettings to the API's delivery_settings", async () => {
    const { client, captured } = stubGroups({
      id: "member-id-1",
      email: "joe@example.com",
      role: "MANAGER",
      delivery_settings: "ALL_MAIL",
    });
    const resource = new GroupMemberResource(client);
    const state = await resource.create({
      kind: "GroupMember",
      groupEmail: "support@example.com",
      memberEmail: "joe@example.com",
      role: "MANAGER",
      deliverySettings: "ALL_MAIL",
    });
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.equal(first.method, "POST");
    assert.ok(first.data !== null && typeof first.data === "object");
    assert.equal(
      (first.data as Record<string, unknown>).delivery_settings,
      "ALL_MAIL",
    );
    assert.deepEqual(state, {
      id: "member-id-1",
      groupEmail: "support@example.com",
      memberEmail: "joe@example.com",
      role: "MANAGER",
      deliverySettings: "ALL_MAIL",
    });
  });

  it("GroupMember.delete addresses the member by group and member email", async () => {
    const { client, captured } = stubGroups({});
    const resource = new GroupMemberResource(client);
    await resource.delete({
      id: "member-id-1",
      groupEmail: "support@example.com",
      memberEmail: "joe@example.com",
      role: "MANAGER",
      deliverySettings: "ALL_MAIL",
    });
    const first = captured[0];
    assert.ok(first !== undefined);
    assert.equal(first.method, "DELETE");
    assert.ok(first.url !== undefined);
    assert.match(
      first.url,
      /support%40example\.com\/members\/joe%40example\.com$/,
    );
  });

  it("buildGroupMemberRefs exposes an id ref token", () => {
    const refs = buildGroupMemberRefs("support-owner");
    assert.ok(refs.id instanceof RefToken);
  });

  it("typed handle registers group, settings and member resources", () => {
    const registered: { kind: string; name: string }[] = [];
    const handle = createGoogleWorkspaceHandle(
      "gw",
      "google-workspace",
      (h) => {
        registered.push({ kind: h.kind, name: h.name });
      },
    );

    handle.group("support", {
      kind: "Group",
      email: "support@example.com",
      displayName: "Support",
      description: "Customer support inbox",
    });
    handle.groupSettings("support-settings", {
      kind: "GroupSettings",
      groupEmail: "support@example.com",
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    });
    handle.groupMember("support-owner", {
      kind: "GroupMember",
      groupEmail: "support@example.com",
      memberEmail: "joe@example.com",
      role: "OWNER",
      deliverySettings: "ALL_MAIL",
    });

    assert.deepEqual(registered, [
      { kind: "Group", name: "support" },
      { kind: "GroupSettings", name: "support-settings" },
      { kind: "GroupMember", name: "support-owner" },
    ]);
  });
});
