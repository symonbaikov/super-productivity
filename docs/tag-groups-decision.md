# Tag groups (mutually exclusive tags) — design note and decision

**Issue:** [#9705](https://github.com/super-productivity/super-productivity/issues/9705) —
"Tag groups for single-choice task classifications"
**Status:** Not implemented. Design recorded so a future attempt starts from the real
constraints instead of re-deriving them.
**Date:** 2026-08-28

## What was requested

User-defined named groups of tags whose members are mutually exclusive on a task. A tag
belongs to at most one group; assigning a group member to a task that already carries
another member removes the previous one. Default rule "newest wins", optional "oldest
wins". Plus a conflict audit/repair pass over existing tasks, and enforcement applied
"consistently across the task detail panel, quick-add syntax, task creation,
integrations, and sync or replay".

This is a **data invariant**, explicitly distinct from visual grouping.

## Decision

Declined for now. Three independent reasons, in order of weight:

1. **No demand signal yet.** See [Demand evidence](#demand-evidence).
2. **The stated motivation does not survive verification.** The claim that contradictory
   tag pairs "can also be introduced through ... sync" does not reproduce on the current
   code path. See [The sync premise is not real](#the-sync-premise-is-not-real-today).
3. **Enforcement has no correct home in the current architecture.** Both candidate
   enforcement points are wrong in a way that costs user data, not just tidiness. See
   [Why the enforcement point is the hard part](#why-the-enforcement-point-is-the-hard-part).

Reason 3 is the one that would still stand if reasons 1 and 2 went away. It is not
"this is a lot of work" — it is "the obvious implementation silently diverges synced
clients".

## Demand evidence

Checked 2026-08-28.

| Signal                                  | Value                                           |
| --------------------------------------- | ----------------------------------------------- |
| #9705 age                               | 5 days (opened 2026-08-23)                      |
| Reactions on #9705                      | **0**                                           |
| Human comments                          | **0** (both comments are `github-actions` bots) |
| Distinct participants                   | 1 (the author, a first-time issue author)       |
| Labels / maintainer scoping             | none                                            |
| Other issues requesting tag exclusivity | none found                                      |

Searched closed issues for a prior "no" on this specific invariant: none found, so this
is not a re-litigation. But the two issues #9705 itself cites as "related but distinct"
are both **already closed as completed**:

- [#4873](https://github.com/super-productivity/super-productivity/issues/4873) — group
  tags by categories in sidebar (0 reactions) — shipped as the menu tree
  (`src/app/features/menu-tree/store/menu-tree.model.ts`).
- [#3510](https://github.com/super-productivity/super-productivity/issues/3510) —
  projects + tags in folders (5 thumbs up) — same feature.

So the _visual_ half of "organize my tags" already exists and users can put `admin`,
`fun`, `boring` in one sidebar folder today. What #9705 adds on top is only the
automatic removal of the previous member.

**The author has already built and published a working plugin**
(`roosmsg/super-productivity-taggroups`) with configurable groups, both rules, and
conflict audit/repair. The escape hatch for this workflow is not hypothetical — it is
shipped. Per the manifesto's "adapt, don't impose", a plugin covering one user's
classification discipline is the right altitude until several users want it in core.

The author's stated plugin limitation is **partly correct and worth recording**: plugin
hooks are dispatched from `plugin-hooks.effects.ts`, which injects `LOCAL_ACTIONS`
(line 58). Plugins therefore never observe remote/replayed updates, and cannot react
while the app is closed. That is a real gap — but see below for why it is not the gap
the issue claims it is.

## The sync premise is not real today

The issue's strongest argument for core-over-plugin is that sync can introduce
contradictory pairs behind the plugin's back. It cannot, on the current code path.

Tag assignment from the UI goes through `TaskService.updateTags()`
(`src/app/features/tasks/task.service.ts:542`), which dispatches
`TaskSharedActions.updateTask` with the **entire resolved `tagIds` array** as one field
change. (`TaskSharedActions.addTagToTask` still exists at
`src/app/root-store/meta/task-shared.actions.ts:435` and is handled by reducers, but has
**zero dispatch sites** in `src/` — it is legacy, kept for replaying old logs, and is
pinned in the blocked multi-entity conflict set at
`src/app/op-log/sync/conflict-resolution.service.ts:2484`.)

`tagIds` is thus a **single field carrying a whole array**. SPAP-14 disjoint-field
auto-merge (`src/app/op-log/sync/conflict-disjoint-merge.util.ts`) merges _different
fields_ across two sides; it does not union two arrays inside the _same_ field. So when
device A sets `tagIds: ['fun']` and device B concurrently sets `tagIds: ['boring']`, LWW
picks one array wholesale. The result is `['fun']` or `['boring']` — never
`['fun', 'boring']`.

Concurrent sync cannot manufacture the contradiction. It can lose one device's edit
entirely (a separate, real, already-known whole-array LWW problem), which no tag-group
feature fixes.

Remaining genuine sources of a contradictory pair are all **local intent**: the user
picks both in the task detail panel, quick-add syntax, `board-panel.component.ts`,
`short-syntax.effects.ts`, `plugin-bridge.service.ts`, or a repeat config. Every one of
those is a path a plugin's `TASK_UPDATE` hook already sees.

## Why the enforcement point is the hard part

There is no single choke point for `tagIds`. Writers include at least
`task.service.ts`, `task.reducer.ts`, `short-syntax.effects.ts`,
`board-panel.component.ts`, `plugin-bridge.service.ts`,
`dialog-edit-task-repeat-cfg.component.ts`, plus the meta-reducers
`tag-shared.reducer.ts`, `task-shared-crud.reducer.ts`, `planner-shared.reducer.ts`, and
`lww-update.meta-reducer.ts`. "Apply the rule consistently across every path" means
touching all of them or finding one post-pass.

Two candidate homes, both defective:

### Option A — enforce in the meta-reducer (what CLAUDE.md rule 3 would normally imply)

This is where a multi-entity change (task's `tagIds` + both tags' `taskIds`) belongs. It
is also **replay-unsafe here**, for two compounding reasons:

1. **The op does not carry the enforcement.** Operation capture does no state diffing —
   `operation-capture.meta-reducer.ts:226` explicitly documents that it enqueues the
   _action_ and builds the operation from the **action payload**. A meta-reducer that
   strips `fun` after the fact changes local state but not the emitted payload. The op
   uploaded to peers still says `tagIds: ['fun', 'boring']`.
2. **Remote replay re-derives the decision locally.** `operation-converter.util.ts:362`
   reconstructs the original action with `isRemote: true` and re-dispatches it through
   the same reducer chain. So the receiving device re-runs the strip — **against its own
   copy of the group config**.

That second point is the failure mode. Group config is itself synced state with its own
op ordering. If device B has not yet applied the "create group {fun, boring}" op when it
replays "set tagIds ['fun','boring']", B keeps both tags while A kept one. Two devices,
same op log, different resulting state, **no conflicting operation for vector clocks to
detect**. That is silent, permanent divergence — the exact class of bug the sync docs
exist to prevent, and it would be produced _by the feature's own enforcement_.

### Option B — enforce at intent time, before dispatch

Resolve the group in `TaskService.updateTags()` (and friends) so the dispatched payload
already contains the final array. This is replay-deterministic: the op carries data, not
a rule, and every device applies the identical array. **This is the correct design.**

Its cost is that it is per-call-site, so it delivers exactly what the plugin already
delivers — coverage of local intent paths — and explicitly _not_ the "enforced on sync
or replay" property that was the issue's reason for wanting it in core. Historical data
and ops authored by older clients stay unenforced forever, because retroactively
enforcing them is Option A.

### Corollary

The invariant is **not** conflict-free and cannot be made so by a reducer. If it is ever
built, it must be built as Option B — a pre-dispatch normalization producing explicit
data — and the issue's "consistently across ... sync or replay" bullet must be dropped
from the spec as unachievable without a schema bump. Which brings us to migration.

## Data model, if it is ever built

Reuse before adding. In order of preference:

1. **Derive the group from the existing menu tree.** A `MenuTreeFolderNode`
   (`src/app/features/menu-tree/store/menu-tree.model.ts`) already holds an ordered set
   of tag ids under a user-given name, already syncs, already has settings UI, and
   already gives "a tag belongs to at most one group" for free — a tree node has exactly
   one parent. Adding one optional `isExclusive?: boolean` to `MenuTreeFolderNode` buys
   the entire feature with **one optional boolean** and no new model, no new settings
   screen, no new sync surface. This is by far the cheapest correct shape.
2. Failing that, one optional field on `Tag`: `exclusiveGroupId?: string`, plus a group
   name registry. Strictly worse — it needs a second model and its own referential
   integrity (dangling group ids on tag delete).

**Never** a new required field. Per CLAUDE.md sync rule 11, a required field on a
persisted model breaks every existing install: typia rejects hydration of on-disk data
that lacks it, TypeScript only guards _new_ data, and there is no automatic per-field
heal. Optional (`?`) plus a runtime default, always.

Drop from scope regardless:

- **"Oldest wins".** A second rule doubles the state space and the test matrix to dodge
  one default decision. Manifesto: one calm default. Newest-wins is what direct
  manipulation already means everywhere else in the app.
- **The audit/repair pass.** A new scan-and-bulk-rewrite flow over every task is a
  multi-entity write with an unbounded op count, and #9705 offers no evidence anyone has
  accumulated conflicts worth repairing. Users can fix a handful of tasks by hand.

## Migration story

- **No `CURRENT_SCHEMA_VERSION` bump.** Sync rule 10: a bump hard-blocks every lagging
  post-v18.14.0 client with a frozen cursor and is effectively irreversible once ops
  carry the version. An optional `isExclusive` flag on a menu-tree folder is something
  old clients simply ignore — they keep both tags, which is exactly today's behavior.
  That is graceful degradation, so a bump buys nothing.
- **Existing data needs no migration.** Absent the flag, every group is non-exclusive,
  which is the current semantics.
- **Mixed-version fleets diverge by design and must be documented as such.** A v18
  client assigning tags will not enforce the rule. Under Option B this is benign (it
  just does not enforce); under Option A it is data divergence. Another reason Option A
  is disqualified.
- **Tag deletion** must not leave the invariant referencing a dead tag. With the
  menu-tree shape this is already handled — tag deletion already prunes the tree node.
  With a `Tag.exclusiveGroupId` field it would be new work.

## Replay / sync implications, summarized

| Scenario                                                       | Outcome                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Two devices concurrently add different group members           | Whole-array LWW on `tagIds`; one array wins. Contradiction impossible; one edit lost (pre-existing behavior, unrelated to this feature). |
| Group config op arrives after the tag-assignment op (Option A) | **Silent divergence.** Devices apply different rules to the same op. Undetectable by vector clocks. Disqualifies Option A.               |
| Same, Option B                                                 | No divergence. The op carries the resolved array; the rule never re-runs.                                                                |
| Old client (< the feature) replays a group-enforced op         | Applies the array verbatim. Correct under Option B.                                                                                      |
| Historical ops predating the group                             | Never enforced. Accepted; the alternative is a bulk rewrite.                                                                             |

## If demand appears

Ship the smallest thing that holds: `isExclusive?: boolean` on `MenuTreeFolderNode`,
newest-wins only, normalization applied **pre-dispatch** in `TaskService.updateTags()`
with unit tests covering (a) adding a second group member drops the first, (b) tags
outside the folder and `TODAY_TAG` / `IN_PROGRESS_TAG` are untouched, (c) a
non-exclusive folder changes nothing. No new model, no new settings page, no audit pass,
no second rule. Re-read this note's Option A section before moving enforcement into a
meta-reducer.
