# Multi-URL Sync Targets: Why One Provider Config Addresses One URL

**Verdict: not implemented, and not implementable as a config-shape change
alone.** A provider's base URL is part of the remote's _identity_ in this
codebase, not a transport detail. A fallback list asserts "these N URLs are the
same remote"; the client has no way to verify that claim, and the sync cursors
that keep user data safe are keyed on the very field the list would vary.

Origin: [#9707](https://github.com/super-productivity/super-productivity/issues/9707)
(reporter runs Tailscale + Nginx Proxy Manager, needs a different URL on-LAN vs
remote). Source specifics below were verified 2026-08 — re-check the named files
before relying on exact line-level detail.

## What was requested

Two shapes, from the issue:

1. **SSID-based URL selection** (the Immich / Home Assistant pattern). Reading
   the current SSID needs Android location permission, which fights
   _Privacy & offline first_ (AGENTS.md), and has no equivalent on desktop or
   web. The reporter raised this objection themselves and offered (2) instead.
2. **A list of URLs tried in succession until one connects.** No permissions, no
   platform APIs, same shape on every platform. This is the only viable
   candidate, and the rest of this document is about why it is still not safe
   here.

A collaborator declined on the issue, recommending split-horizon DNS (a single
uniform FQDN resolved differently per network, via Tailscale's Override-local-DNS
/ Split DNS plus a router DNS rewrite). That remains the recommended fix: it
solves the problem once, at the layer that owns name-to-address mapping, for
every self-hosted app rather than one at a time.

## Where the single URL lives today

| Layer            | Location                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form field       | `src/app/features/config/form-cfgs/sync-form.const.ts` — `createWebdavFormFields`, Formly key `baseUrl`; reused by WebDAV and SuperSync                              |
| Form defaults    | `src/app/imex/sync/sync-config.service.ts` — `PROVIDER_FIELD_DEFAULTS` (`baseUrl: ''` for WebDAV and SuperSync; Nextcloud uses `serverUrl`)                          |
| Type (WebDAV)    | `packages/sync-providers/src/file-based/webdav/webdav.model.ts` — `WebdavPrivateCfg.baseUrl: string` (required)                                                      |
| Type (SuperSync) | `packages/sync-providers/src/super-sync/super-sync.model.ts` — `SuperSyncPrivateCfg.baseUrl?: string`, empty falls back to the host-supplied `defaultBaseUrl`        |
| Persistence      | `src/app/op-log/sync-providers/credential-store.service.ts` — IndexedDB `sup-sync` / store `credentials`, key `PRIVATE_CFG_PREFIX + providerId` (`__sp_cred_WebDAV`) |
| Request-time use | `packages/sync-providers/src/super-sync/super-sync.ts` — `_resolveBaseUrl(cfg)`, which applies that fallback and strips a trailing slash                             |

There is no `baseUrl` in `packages/sync-core` and none in `src/app/pfapi/` (which
is now only `api/` plus `pfapi-config.js`); URL handling lives entirely in
`packages/sync-providers` plus the op-log provider wrappers.

Note the split in `SyncConfigService.updateSettingsFromForm`: `SyncPublicConfig`
is `Omit<SyncConfig, 'encryptKey' | 'webDav' | 'localFileSync' | 'superSync' |
'nextcloud' | 'oneDrive'>`, so the provider blocks — URLs included — are
deliberately kept out of `globalConfig` and only ever written to the device-local
credential store. The URL is therefore **not** synced between devices, which is
the one thing in this area that already works in the feature's favour.

## Config shape: what a `baseUrls` field would cost

The credential store types its records as `value: unknown` and runs no typia
validation, so adding `baseUrls?: string[]` to `WebdavPrivateCfg` /
`SuperSyncPrivateCfg` alone would need **no** `CURRENT_SCHEMA_VERSION` bump and
would not trip hydration validation (AGENTS.md sync rule 10 — the bump is
near-irreversible and buys nothing here).

The Formly form model is the part that _is_ validated: `WebDavConfig` /
`SuperSyncConfig` in `src/app/features/config/global-config.model.ts` are
reachable from `GlobalConfigState`, which is a registered op-log model
(`src/app/op-log/model/model-config.ts`, `globalConfig: ModelCfg<GlobalConfigState>`)
with `DEFAULT_GLOBAL_CONFIG` as its default data — and that default data does
carry `sync.webDav` / `sync.superSync` blocks. So a field added there must be
optional with a runtime default, per AGENTS.md sync rule 11
([persisted-model-fields.md](./persisted-model-fields.md)): a required field
would reject every already-stored `globalConfig` on hydration, and the failure is
latent until an unrelated migration drags old data onto the validation path.

Conclusion: the persisted shape is the _cheap_ part. Everything below is the
expensive part.

## The invariant a URL list would break

`src/app/op-log/sync-providers/sync-target-identity.util.ts` treats every
provider-config field except `encryptKey` and `isEncryptionEnabled` as
identity-affecting. `baseUrl` is therefore, by deliberate design, part of the
answer to "which remote is this?":

```ts
const CONTENT_ONLY_CFG_FIELDS: ReadonlySet<string> = new Set([
  'encryptKey',
  'isEncryptionEnabled',
]);
```

The file's own comment states the bias: an unrecognised or newly added field
"errs toward invalidating rather than silently reusing one target's cursor
against another." A URL list inverts that default — it declares a set of
addresses interchangeable — while the mechanism enforcing the invariant is a
string comparison that cannot tell a mirror from a stranger.

## Failure 1 — the same-server case already loses data

This is the surprising one. Even if both URLs provably address the same server,
SuperSync's `lastServerSeq` cursor is keyed on a hash of the **raw base URL plus
access token** (`packages/sync-providers/src/super-sync/super-sync.ts`,
`_computeServerSeqKey`):

```ts
const identifier = `${baseUrl || this._deps.defaultBaseUrl}|${accessToken}`;
```

So each URL in the list gets its own cursor. Failing over from URL A to URL B
finds no stored value, and `getLastServerSeq()` returns `0`. A cursor of 0 means
`isForceFromZero`, which returns a `snapshotState`; for a client holding unsynced
ops that classifies CONCURRENT and, with `AUTO_MERGE_CONCURRENT_SNAPSHOT` false
(`packages/sync-providers/src/file-based-sync-data.ts`), dead-ends in a **binary
conflict dialog whose either answer discards data**. That hazard is documented
verbatim in the canonical warning on
`FileBasedSyncAdapterService.invalidateAllTargets`. A seq of 0 additionally makes
the client read as never-synced at
`src/app/op-log/sync/operation-log-sync.service.ts:732`
(`hasCompletedSyncBaseline`), which decides whether a `lastSyncedVectorClock`
baseline exists for every conflict surfaced in that snapshot attempt.

How much this cursor matters is settled by existing code: `signOutAllOtherDevices`
goes out of its way to compute the new token's key _before_ persisting the token
purely so it can hand-carry `lastServerSeq` across the key change. There is no
equivalent migration for a URL change, because until now a URL change was always
a genuine target move.

Net: every network transition — exactly the event the feature exists to
serve — would trip a force-from-zero on a laptop that moves between home and
away. That is a routine daily action turned into a recurring conflict prompt.

## Failure 2 — the different-servers case is silent

Nothing on the wire identifies the server. The SuperSync server exposes no
instance-identity endpoint: `/health` and `/live` return liveness only
(`packages/super-sync-server/src/server.ts`), and the `/api/*` surface is
`/sync`, `/account`, the login/register/recover routes and `/replace-token`
(`packages/super-sync-server/src/api.ts`) — no `remoteId`, no `_meta` handshake.
`clientId` is a local _device_ id (the vector-clock owner key), not a server id.
WebDAV, being generic HTTP, offers nothing at all.

For file-based providers (WebDAV, Nextcloud), per-target state is keyed by
**provider id only** — `_targetScopedMaps` in `file-based-sync-adapter.service.ts`
covers `_expectedSyncVersions`, `_lastSeenVectorClocks`, `_pendingVectorClocks`,
`_localSeqCounters`, `_lastSeenRevs`, `_pendingRevs` and the within-cycle caches.
The URL protects that state only indirectly, by making `isSyncTargetChanged` fire
on a config save. A runtime fallback list bypasses that entirely: the URL changes
without any config save, so the client applies server A's sync versions, revs,
local seq counters and last-seen vector clocks against server B.

Concretely, server B's state would be compared against a vector clock that
already counts server A's history. `compareVectorClocks`
(`packages/sync-core/src/vector-clock.ts`) reports `CONCURRENT` only when each
side leads on some client id; a clock carrying A's counters generally leads B's
outright, so the comparison reads `GREATER_THAN` — "B happened before A" — and
B's divergent state is treated as stale history rather than as a conflict to
surface. Neither store notices, because each looks internally consistent. This is
read off the comparison semantics, not from a reproduction; anyone building the
feature must reproduce it first (AGENTS.md: "Start from a reproducible problem").

Credentials make this worse rather than better. They are stored per provider id,
not per URL (`credential-store.service.ts`, key `PRIVATE_CFG_PREFIX + providerId`),
so the single username/password/token is replayed against whichever host answers
first. A typo'd or stale entry in the list that happens to accept the same
credentials becomes a silent second sync target.

## Failure 3 — editing the list is itself a target move

`toTargetIdentity` filters out only `undefined` and `''` (`isUnset`) and
serialises what remains with `JSON.stringify`. A list-valued field is never
"unset" — even `[]` serialises — so **any** edit (adding a URL, reordering,
fixing a typo) changes the identity string, fires `isSyncTargetChanged`, and
calls `invalidateAllTargets()`, whose canonical warning is that it must be called
only when the target actually moved. Users would be nudged toward exactly the
edits that reset their cursors.

The same function documents why it is flat: "every provider privateCfg is
`string | boolean | number` throughout". An array field is the first violation of
that stated assumption, so ordering stability inside the list becomes
load-bearing for target identity — a property no form control guarantees.

## What would have to exist first

Not a config-shape change — a protocol change:

1. **A server-issued remote identity** (stable instance UUID) returned by a
   cheap unauthenticated-or-token endpoint, so the client can _verify_ that two
   URLs are one server instead of taking the user's word. WebDAV has no such
   endpoint to add, so this can only ever cover SuperSync — the feature would be
   provider-asymmetric from day one, while the request is about WebDAV.
2. **Cursors and per-target state keyed on that identity**, not on the URL
   string. For SuperSync this replaces `_computeServerSeqKey`'s URL+token hash;
   for file-based providers it means introducing per-target keying that does not
   exist today.
3. **A refusal path** when a listed URL reports a _different_ identity: treat it
   as a wrong target and stop, never as a failover.
4. **Failover semantics that do not race** — a "try until one connects" loop
   needs a definition of connected that a captive portal, a 200-serving reverse
   proxy, or a half-open TCP connection cannot satisfy spuriously.

That is a server-side contract plus a client-side re-keying of the most
data-loss-sensitive state in the app, against a feature request with **zero
reactions, one requester, and a working DNS-level workaround** (AGENTS.md, "Does
it earn its place?"). The order is wrong: (1) and (2) are worth having on their
own merits as a defence against the misconfiguration hazards described above,
and only once they exist does a URL list become a small feature rather than a
data-loss vector.

## Incidental finding (not fixed here)

`_computeServerSeqKey` hashes the **raw** `cfg.baseUrl`, while `_resolveBaseUrl`
strips a trailing slash before issuing requests. So `https://x.example` and
`https://x.example/` are the same server for every request but two different
`lastServerSeq` keys. Impact today is limited — editing the URL in the settings
form also trips `isSyncTargetChanged`, so the cursor reset is consistent with
how the rest of the system treats that edit — but the normalisation asymmetry is
latent, and it becomes load-bearing the moment cursors are re-keyed per item 2
above. Fixing it needs its own reproduction (AGENTS.md: "Start from a
reproducible problem"), not a drive-by change on this issue.

## Related

| Location                                                                      | Content                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/op-log/sync-providers/sync-target-identity.util.ts`                  | `isSyncTargetChanged` / `toTargetIdentity` — the identity comparison |
| `src/app/op-log/sync-providers/file-based/file-based-sync-adapter.service.ts` | `_targetScopedMaps`, `invalidateAllTargets` canonical warning        |
| `packages/sync-providers/src/super-sync/super-sync.ts`                        | `_computeServerSeqKey`, `_resolveBaseUrl`, cursor carry-over         |
| `src/app/op-log/sync-providers/credential-store.service.ts`                   | Per-provider-id credential storage (`sup-sync` IndexedDB)            |
| `src/app/imex/sync/sync-config.service.ts`                                    | `PROVIDER_FIELD_DEFAULTS`, public/private config split               |
| [persisted-model-fields.md](./persisted-model-fields.md)                      | Why a new required config field breaks existing installs             |
| [vector-clocks.md](./vector-clocks.md)                                        | What the per-target vector clocks in Failure 2 actually guard        |
