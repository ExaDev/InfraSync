# Google Workspace: public-facing shared mailbox

Stands up `support@<your-domain>` as a Google group that anyone on the internet
can email, answered by a couple of internal staff. It's the canonical "shared
inbox" / "team mailbox" setup, expressed as code.

The mailbox is three resources that compose together:

- **`Group`** — the addressable object, i.e. the email address itself.
- **`GroupSettings`** — the posting and visibility policy. This is the bit that
  makes the mailbox public: `whoCanPostMessage: ANYONE_CAN_POST`.
- **`GroupMember`** — the people who receive and answer the mail.

`GroupSettings` and each `GroupMember` declare `dependsOn: [support]`, so the
engine creates the group before it configures or populates it.

## Packages

Everything comes from the single `infrasync` package: `defineInfra` from
`infrasync`, and the Google Workspace adapter from the `infrasync/google-workspace`
subpath. Each provider's heavy SDK is an optional peer dependency, pulled in
only when you use that provider — so this example also installs
`google-auth-library` (the Google Workspace provider's SDK). See
[`package.json`](./package.json).

## Anyone-can-post vs external members

These are independent settings and people routinely conflate them:

- `whoCanPostMessage: ANYONE_CAN_POST` lets external, non-member internet
  senders email the group. This is what makes it a public inbox.
- `allowExternalMembers` only controls whether addresses *outside* your domain
  can be *members* of the group.

A public support inbox staffed by your own people wants the first and not the
second, so this example keeps `allowExternalMembers: false`. Flip it to `true`
only when someone external (a contractor on the support rota) needs to be a
member and receive the mail.

One operational caveat: a wide-open `ANYONE_CAN_POST` inbox with
`messageModerationLevel: MODERATE_NONE` will receive spam like any public
address. If that becomes a problem, switch the moderation level to
`MODERATE_NON_MEMBERS` to hold external posts for approval — the trade-off is a
human has to let legitimate first-time senders through.

## Prerequisites

- A Google Workspace tenant and **super-admin** credentials.
- The Admin SDK and Groups Settings API enabled on the associated Google Cloud
  project.
- OAuth credentials (a client id/secret and a refresh token bound to the
  super-admin) granted these scopes:
  - `https://www.googleapis.com/auth/admin.directory.group`
  - `https://www.googleapis.com/auth/apps.groups.settings`

  See the provider README (`packages/provider-google-workspace`) for the
  service-account alternative (domain-wide delegation), which suits CI.

## Configure

Edit the constants at the top of [`infra.config.ts`](./infra.config.ts):

- `DOMAIN` — your primary Workspace domain.
- `CUSTOMER_ID` — Admin console → Account → Account settings → Profile
  (looks like `C00xxxxxx`).
- `STAFF` — the people on the mailbox and their roles
  (`OWNER` / `MANAGER` / `MEMBER`).

Then export the credentials:

```bash
export GOOGLE_OAUTH_CLIENT_ID=...
export GOOGLE_OAUTH_CLIENT_SECRET=...
export GOOGLE_OAUTH_REFRESH_TOKEN=...
```

## Run

```bash
pnpm install
pnpm plan     # preview what would change
pnpm apply    # create and converge the mailbox
pnpm drift    # detect out-of-band changes made in the Admin console
```

`plan` is read-only and safe to run first.
