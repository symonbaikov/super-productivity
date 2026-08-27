# Notes stay dateless — decision record

> **Status:** Active (re-affirmed 2026-08-28 for [#9697](https://github.com/super-productivity/super-productivity/issues/9697))
>
> Notes carry no due/review date and no reminder. A dated thing is a task.

## The recurring request

[#9697](https://github.com/super-productivity/super-productivity/issues/9697) asks for
two things, framed as TickTick parity:

1. notes with due/review dates,
2. a desktop widget listing the notes of a folder with those dates.

This request pattern recurs. Record it here so the next person does not
re-derive the answer from scratch.

## What the code actually has today

- `Note` (`src/app/features/note/note.model.ts`) has `created` and `modified`
  only. No date, no reminder, no folder — notes are grouped by `projectId` plus
  the virtual `isPinnedToToday` flag.
- There is no note → task conversion anywhere. The note context menu
  (`note.component.html`) offers move-to-project, lock/unlock, delete.
- "Widget" already means two concrete, task-only surfaces:
  - the Electron always-on-top task widget (`electron/task-widget/`, config
    `taskWidget` in `global-config.model.ts`),
  - the Android home-screen widget
    ([`docs/android-home-screen-widget.md`](android-home-screen-widget.md)),
    a versioned JSON snapshot with a Kotlin parser locked to it by golden tests.

  Both are projections of a task snapshot, not generic list renderers.

## Prior decision: note reminders existed and were deliberately removed

This is not an unexplored idea — it shipped and was taken out.

- [#426](https://github.com/super-productivity/super-productivity/issues/426)
  ("Differentiate between reminders and notes", closed 2021-02-21) argued notes
  had drifted into being reminders and the two should be separated. The
  maintainer agreed.
- Commit `251e3cce1` (2021-04-25, _"feat(note): remove reminders for notes"_)
  did it: **-627 lines**, deleting `dialog-add-note-reminder`,
  `dialog-view-note-reminder`, the `reminderId` field on `Note`, and the note
  branch of the reminder effects.

So "notes with dates" was tried, judged to be the wrong split, and removed. Per
`AGENTS.md` → _Does it earn its place?_, a prior "no" needs **new evidence**, not
a new PR. #9697 carries 1 thumbs-up (measured 2026-08-28) and a collaborator
already asked the obvious question in-thread: _isn't "review document X by date
Y" a task?_ That is not new evidence.

## Why the framing does not survive contact

- **Competitor parity is not demand.** The scope guard is a personal deep-work
  tool; "so I can drop my second app" is one user's migration checklist.
- **Dating a note re-creates the task.** A note with a due date needs
  scheduling, overdue handling, snooze, planner/schedule placement, and a
  notification path — i.e. a second, weaker task entity, plus a second set of
  sync semantics for a model that today has no date fields at all.
- **The widget is the expensive half.** Neither widget surface is generic. A
  note-folder widget means a second snapshot contract, a second settings block,
  and a second Kotlin/Electron renderer to keep in sync forever — for a feature
  whose data model does not exist yet.

## The real gap, if demand ever appears

Ordered cheapest first. Do **not** pre-build these; they are here so the next
triage starts above zero.

1. **Notes panel via plugin — already possible, zero core code.** The plugin API
   exposes notes read-only (`PluginAppState.notes` via `getAppState()`, see
   `packages/plugin-api/src/types.ts`) and can render a side panel
   (`registerSidePanelButton`). "Show me the notes of project X in a panel" is a
   plugin, and it needs nothing from core. This is the honest answer to
   request (2).
2. **Note → task conversion.** The genuinely missing primitive: one menu entry
   that creates a task whose `notes` field is the note content, then deletes the
   note. It makes the collaborator's answer ("that's a task") a single click
   instead of copy-paste, without adding a date to `Note`. Roughly one menu item
   plus one service method — but there is currently **no issue asking for it**,
   so building it now would be inventing scope. Wait for a request.
3. **Dates on `Note`.** Only reconsider with real, repeated demand, and only by
   re-reading `251e3cce1` first to see what was removed and why.

## Related

- [`AGENTS.md`](../AGENTS.md) → Product principles, _Does it earn its place?_
- [`docs/android-home-screen-widget.md`](android-home-screen-widget.md) — the
  snapshot contract any new widget surface would have to duplicate.
