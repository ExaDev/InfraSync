/**
 * Google Workspace: a public-facing shared mailbox.
 *
 * Stands up `support@<your-domain>` as a Google group that anyone on the
 * internet can email, staffed by a couple of internal people. Three resources
 * compose the mailbox:
 *
 *   1. Group         — the addressable object (the email address itself).
 *   2. GroupSettings — the posting/visibility policy that makes it public.
 *   3. GroupMember   — the people who receive and answer the mail.
 *
 * The settings and members declare `dependsOn: [support]` so the engine
 * creates the group before configuring or populating it.
 *
 * Run it:
 *   pnpm plan     # preview
 *   pnpm apply    # create/converge
 *   pnpm drift    # detect out-of-band changes
 *
 * Credentials come from the environment (see README):
 *   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
 */

import { defineInfra } from "infrasync";
import {
  googleWorkspace,
  createGoogleWorkspaceHandle,
} from "infrasync/google-workspace";

export const adapters = { googleWorkspace };

// ─── Replace these with your own values ──────────────────────────────────────

/** Your primary Workspace domain. */
const DOMAIN = "example.com";

/**
 * Your Workspace customer id — Admin console → Account → Account settings →
 * Profile (looks like `C00xxxxxx`). Not a secret, so it lives in the config.
 */
const CUSTOMER_ID = "C00xxxxxx";

/** The shared mailbox address and the people who staff it. */
const SUPPORT_EMAIL = `support@${DOMAIN}`;
const STAFF = [
  { id: "alex", email: `alex@${DOMAIN}`, role: "OWNER" },
  { id: "sam", email: `sam@${DOMAIN}`, role: "MANAGER" },
] as const;

// ─── Infrastructure ──────────────────────────────────────────────────────────

export default defineInfra("google-workspace-shared-mailbox", (infra) => {
  const base = infra.provider("gw", googleWorkspace, {
    kind: "oauth-user",
    clientId: infra.secret.env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: infra.secret.env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken: infra.secret.env("GOOGLE_OAUTH_REFRESH_TOKEN"),
    customerId: CUSTOMER_ID,
  });

  const gw = createGoogleWorkspaceHandle(
    base.instanceKey,
    base.adapterName,
    base.register,
  );

  // The group itself — this is what owns the email address.
  const support = gw.group("support", {
    kind: "Group",
    email: SUPPORT_EMAIL,
    displayName: "Customer Support",
    description:
      "Public-facing support inbox. Email lands here and is answered by the support team.",
  });

  // The public-facing posture.
  //
  // `whoCanPostMessage: ANYONE_CAN_POST` is the setting that lets external,
  // non-member internet senders email the group — this is what makes it a
  // public inbox. `allowExternalMembers` is independent: it only governs
  // whether addresses *outside* the domain can be *members*. Internal staff
  // answer this mailbox, so it stays `false`. Flip it to `true` only if you
  // need an external contractor on the rota to receive the mail.
  gw.groupSettings(
    "support-settings",
    {
      kind: "GroupSettings",
      groupEmail: SUPPORT_EMAIL,
      whoCanPostMessage: "ANYONE_CAN_POST",
      allowExternalMembers: false,
      whoCanJoin: "INVITED_CAN_JOIN",
      whoCanViewGroup: "ALL_MEMBERS_CAN_VIEW",
      whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
      messageModerationLevel: "MODERATE_NONE",
      isArchived: true,
      includeInGlobalAddressList: true,
    },
    { dependsOn: [support] },
  );

  // The people who staff the mailbox.
  for (const person of STAFF) {
    gw.groupMember(
      `support-${person.role.toLowerCase()}-${person.id}`,
      {
        kind: "GroupMember",
        groupEmail: SUPPORT_EMAIL,
        memberEmail: person.email,
        role: person.role,
        deliverySettings: "ALL_MAIL",
      },
      { dependsOn: [support] },
    );
  }

  return { outputs: { supportMailbox: support.ref.email } };
});
