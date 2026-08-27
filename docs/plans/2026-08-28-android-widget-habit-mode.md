# Android widget habit mode

> **Status:** Proposed — not implemented, not accepted
>
> **Tracking issue:** [#9662](https://github.com/super-productivity/super-productivity/issues/9662)
> ("android widget habit tracker"), labelled `help wanted`
>
> **Last verified against the code:** 2026-08-28
>
> **Delete this plan when:** the maintainer declines the feature, or an
> implementation merges and its contract moves into
> [the maintained widget guide](../android-home-screen-widget.md).

The request: a habit icon / "today" toggle in the widget header that switches the
list between today's scheduled habits and today's tasks, with tick-to-complete
from the widget, so marking a habit does not require opening the app.

This note maps what that would touch. It is a proposal, not a decision, and no
part of it has been built or run.

## Why this is a note and not a patch

The existing widget is a clean one-way projection, but a habit mode is not a
small extension of it: it needs a second data feed in the blob, a second
write-back queue with its own day semantics, per-widget mode state, and new
header chrome — across both languages, none of it verifiable without a device
build. The closest comparable change, open PR
[#9624](https://github.com/super-productivity/super-productivity/pull/9624)
(per-widget project selection), is 19 files and ~740 added lines and was
validated by its author with an F-Droid debug build on an emulator. This one is
larger, because #9624 reuses the existing rows and write-back path and this does
not.

Demand is also unestablished: as of 2026-08-28 the issue has zero reactions and
no human comments. The `help wanted` label says the maintainer is open to a
contribution, not that the design below is the one to build. See "Leaner options
to put first", below — one of them may close the issue for a fraction of the
cost.

## What a "habit" is in this codebase

Habits are `SimpleCounter` entities — there is no separate habit model.

- Model: `src/app/features/simple-counter/simple-counter.model.ts`
- UI: `/habits` → `src/app/pages/habit-page/habit-page.component.ts` →
  `src/app/features/simple-counter/habit-tracker/habit-tracker.component.ts`
- Feature flag: `isHabitsEnabled` in
  `src/app/features/config/global-config.model.ts` (default `true`)
- Store: `src/app/features/simple-counter/store/`

Three semantics the widget would have to mirror, all of which live today only in
`HabitTrackerComponent`:

**Scheduled today.** From `HabitTrackerComponent.isDayEnabled()`: a counter is
day-restricted only when `isTrackStreaks && streakMode !== 'weekly-frequency' &&
streakWeekDays`; otherwise it applies every day. So the widget's list is enabled
counters where `!isTrackStreaks || streakMode === 'weekly-frequency' ||
!streakWeekDays || streakWeekDays[dow]`.

_Trap:_ `isDayEnabled` takes its `dow` from a wall-clock `Date`, and
`get-simple-counter-streak-duration.ts` uses `getDbDateStr(new Date())`. The
widget selector must derive both the day string and its weekday from
`selectTodayStr` (the logical day, per sync rule 4), or the widget and the habit
page will disagree for the length of the user's start-of-next-day offset — the
same class of bug as #9098.

**Done.** `countOnDay[dayStr] >= (streakMinValue || 1)`, matching
`getProgress()`/`isSimpleCompletion()`.

**Ticking.** `SimpleCounterService.setCounterForDate(id, dayStr, newVal)` →
`setSimpleCounterCounterForDate`, which is `isPersistent: true`,
`entityType: 'SIMPLE_COUNTER'`, `opType: Update`. Tick = `streakMinValue || 1`,
untick = `0`.

## Blob contract

`src/app/features/android/android-widget.model.ts`, additive:

```ts
export interface AndroidWidgetHabit {
  id: string;
  title: string;
  isDone: boolean;
}
// on AndroidWidgetData:
habits?: AndroidWidgetHabit[];
```

**No `v` bump.** `v` guards breaking shape changes; this is a new optional key.
An old native reader ignores it; a new native reader against an old blob (app
upgraded, not yet run) sees no `habits`, renders an empty habit list, and
self-heals on the next push. Bumping `v` would instead blank the whole widget for
every user until the app next runs. Follow the existing `AndroidWidgetTask`
convention and **omit** absent fields rather than emitting `null` — Android's
`org.json` `optString` maps JSON null to the literal string `"null"`.

Omit `habits` entirely when `isHabitsEnabled` is false, and have native hide the
toggle when the key is absent. That is cheaper than shipping the flag separately
and avoids a toggle that leads to a permanently empty list.

Note this blob is a `KeyValStore` value, not a synced persisted model, so
CLAUDE.md sync rule 11 does not apply to it.

## Write-back path

Mirror `WidgetDoneQueue`, with one addition: **the queue entry must carry the day
it was ticked for.** A tick at 23:59 drained at 00:05 must not land on the next
day. The task queue gets away with `{taskId: isDone}` because task completion is
not day-indexed; `countOnDay` is.

```
{ "<counterId>": { "day": "2026-08-28", "isDone": true } }
```

Last-wins per counter, same as the done queue, so repeated taps collapse to one
op. Native peeks it at render time to overlay pending state and never writes the
snapshot.

Angular drains it in `android-widget.effects.ts`. **Reuse the existing
`drainWidgetDoneQueue$` trigger chain rather than adding a second effect** — the
`concatMap` onto `isAllDataLoadedInitially$` is load-bearing here in a way it is
not for tasks: `initialSimpleCounterState` is seeded from
`DEFAULT_SIMPLE_COUNTERS`, so a tick applied before hydration would write
`countOnDay` onto placeholder counters and then be persisted over the user's real
ones. Mirror `getTaskDoneChangesToApply` exactly: skip counters that no longer
exist and ones already at the target value, and export the pure function so it is
testable without the `IS_ANDROID_WEB_VIEW` gate.

### Sync implications

- One drained tick = one `setSimpleCounterCounterForDate` op per counter. That is
  the same cost as the habit page and is fine.
- `countOnDay` is a map on the counter entity, so concurrent edits are resolved
  at whatever granularity the merge currently offers. Two devices ticking
  _different_ days of the _same_ habit both write `countOnDay`; under
  whole-entity LWW one of those days is lost. This exposure already exists via
  the habit page, but the widget widens it materially, because its whole point is
  ticking while the app process is dead and unsynced. Before building this,
  confirm the current disjoint-field merge behaviour on `SIMPLE_COUNTER` against
  a real two-client reproduction (CLAUDE.md "Judging sync severity" #2 and #5) —
  do not assume either that it is safe or that it is broken.
- The day stamp in the queue entry is what keeps a stale-snapshot tick honest.
  The header must still report the snapshot as outdated; the tick itself lands on
  the right day regardless.

## Files a full implementation touches

**Angular**

| File                                                              | Change                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/features/android/android-widget.model.ts`                | `AndroidWidgetHabit`, optional `habits`                                                                                            |
| `src/app/features/android/store/android-widget.selectors.ts`      | add `selectSimpleCounterFeatureState` + the habits feature flag as inputs; project scheduled-today habits using `dayStr`'s weekday |
| `src/app/features/android/store/android-widget.selectors.spec.ts` | extend the golden shape (locked against `WidgetDataTest.kt`)                                                                       |
| `src/app/features/android/android-interface.ts`                   | `getWidgetHabitQueue?(): string \| null`                                                                                           |
| `src/app/features/android/store/android-widget.effects.ts`        | drain habit queue inside the existing chain; exported pure `getHabitChangesToApply`                                                |
| `src/app/features/android/store/android-widget.effects.spec.ts`   | cover the pure function                                                                                                            |
| `src/app/t.const.ts`, `src/assets/i18n/en.json`                   | snack string for habits updated (`en.json` only)                                                                                   |

**Kotlin / resources**

| File                                        | Change                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.../widget/WidgetData.kt`                  | `WidgetHabit` + `parseHabits(json, pendingTargets)`                                                                                                     |
| `.../widget/WidgetHabitQueue.kt`            | new; `{id: {day, isDone}}`, `commit()` not `apply()`                                                                                                    |
| `.../widget/TaskListWidgetProvider.kt`      | per-widget mode store, header toggle PendingIntent, `ACTION_TOGGLE_MODE`, habit tap handling, mode-dependent header and empty text, `onDeleted` cleanup |
| `.../widget/TaskListWidgetService.kt`       | factory reads its widget's mode in `onDataSetChanged()` and builds either list                                                                          |
| `res/layout/widget_task_list.xml`           | toggle `ImageView` in `widget_header`                                                                                                                   |
| `res/drawable/ic_widget_habit.xml`          | new vector                                                                                                                                              |
| `res/values/strings.xml`                    | header/empty/content-description strings per mode                                                                                                       |
| `.../webview/JavaScriptInterface.kt`        | `getWidgetHabitQueue()`                                                                                                                                 |
| `app/src/test/.../widget/WidgetDataTest.kt` | habit parse goldens                                                                                                                                     |
| `docs/android-home-screen-widget.md`        | contract update                                                                                                                                         |

The existing row layout (`widget_task_row.xml`) is reusable as-is — a habit is a
title plus a checkbox, and the project dot is simply hidden.

**Two native footguns worth naming up front:**

1. `PendingIntent` equality ignores extras. The per-widget mode-toggle intents
   must differ by request code (use the `appWidgetId`) or every widget on the
   screen will toggle the same one.
2. A child view with its own `setOnClickPendingIntent` inside `widget_header`
   takes precedence over the header's own open-app intent, so the toggle can live
   there — but the header's open-app intent must stay for the rest of the row.

Per-widget mode (not global) is the right default and matches what #9624
established for project selection: two widgets on one screen forced into the same
mode is worse than the extra code. It also means this plan and #9624 both write
per-`appWidgetId` SharedPreferences state and both need `onDeleted` cleanup — if
#9624 merges first, share that store rather than adding a second one.

## Open UI questions

1. **Which counter types appear?** `StopWatch` counters have no binary
   completion — their `countOnDay` value is milliseconds. Suggested: show
   `ClickCounter` and `RepeatedCountdownReminder` only; a `StopWatch` habit is
   absent from the widget rather than rendered with a meaningless checkbox.
2. **Goal > 1.** With `streakMinValue > 1`, does a widget tick jump straight to
   the goal or increment by one like the habit page does? A checkbox implies
   binary; the habit page's cell click increments. Either choice makes the two
   surfaces disagree, which is a real cost — decide it deliberately.
3. **Untick semantics.** Setting `countOnDay` to `0` discards a partial count the
   user accumulated in-app. Guarding against that means the widget checkbox is no
   longer a plain toggle.
4. **Mode persistence.** The mode must survive the 30-minute platform update and
   process death, hence per-`appWidgetId` SharedPreferences and `onDeleted`
   cleanup.
5. **Streak display.** The issue does not ask for it, and it should stay out —
   the manifesto rejects streak-as-dopamine chrome, and the widget has no room.

## Leaner options to put first

The reporter's actual complaint is time-to-mark, not the absence of a mode
toggle. Two cheaper answers exist:

- **A launcher shortcut to `/habits`.** `res/xml/shortcuts.xml` plus a deep link
  is a handful of lines with no blob change, no queue, and no sync surface. It
  does not give tick-from-home-screen, so it is a partial answer — but it removes
  most of the "wait 7-8 sec then navigate" cost the issue describes.
- **A separate habit widget.** More files than a mode toggle, but each is
  simpler: no mode state, no per-widget preference, no toggle chrome, no
  precedence puzzle in the header. It also lets the user keep tasks and habits
  visible at once, which is strictly better than switching. The issue frames this
  as a toggle only because it assumes one widget.

Both should be offered before the mode-toggle design is built.

## Completion condition

Delete this note once #9662 is closed, or once an implementation merges and its
contract and limitations have moved into
[`android-home-screen-widget.md`](../android-home-screen-widget.md).
