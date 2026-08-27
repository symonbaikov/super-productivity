import { inject, Injectable } from '@angular/core';

import { Observable } from 'rxjs';
import {
  concatMap,
  filter,
  first,
  map,
  switchMap,
  tap,
  withLatestFrom,
} from 'rxjs/operators';

import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { select, Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';

import { ConfettiService } from '../../../core/confetti/confetti.service';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from '../../../t.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getSimpleCounterStreakDuration } from '../get-simple-counter-streak-duration';
import {
  setSimpleCounterCounterForDate,
  setSimpleCounterCounterToday,
  tickSimpleCounterLocal,
  updateAllSimpleCounters,
} from './simple-counter.actions';
import { selectSimpleCounterById } from './simple-counter.reducer';
import { GlobalConfigService } from '../../config/global-config.service';
import { playDoneSound } from '../../tasks/util/play-done-sound';

@Injectable()
export class SimpleCounterEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store$ = inject<Store<any>>(Store);
  private _snackService = inject(SnackService);
  private _translateService = inject(TranslateService);
  private readonly _confettiService = inject(ConfettiService);
  private _globalConfigService = inject(GlobalConfigService);

  successFullCountersMap: { [key: string]: boolean } = {};

  // Note: StopWatch tick handling moved to SimpleCounterService for batched sync

  updateCfgSuccessSnack$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(updateAllSimpleCounters),
        tap(() =>
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.CONFIG.S.UPDATE_SECTION,
            translateParams: { sectionKey: 'Simple Counters' },
          }),
        ),
      ),
    { dispatch: false },
  );

  streakSuccessSnack$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(tickSimpleCounterLocal),
        switchMap((a) =>
          this._store$.pipe(select(selectSimpleCounterById, { id: a.id })),
        ),
        tap((sc) => {
          if (sc && !this.successFullCountersMap[sc.id] && sc.isTrackStreaks) {
            if ((sc.countOnDay?.[getDbDateStr()] ?? 0) >= (sc.streakMinValue || 0)) {
              const streakDuration = getSimpleCounterStreakDuration(sc);
              // eslint-disable-next-line max-len
              const msg = `<strong>${sc.title}</strong> <br />${this._translateService.instant(T.F.SIMPLE_COUNTER.S.GOAL_REACHED_1)}<br /> ${this._translateService.instant(T.F.SIMPLE_COUNTER.S.GOAL_REACHED_2)} <strong>${streakDuration}🔥</strong>`;

              const DURATION = 4000;
              this._snackService.open({
                type: 'SUCCESS',
                ico: sc.icon || undefined,
                // ico: 'celebration',
                // ico: '🎉',
                config: {
                  duration: DURATION,
                  horizontalPosition: 'center',
                  verticalPosition: 'top',
                },
                msg,
              });
              this.successFullCountersMap[sc.id] = true;

              this._celebrate();
            }
            // else if (
            //   sc.type !== SimpleCounterType.StopWatch &&
            //   sc.countOnDay[getWorklogStr()] > 0
            // ) {
            //   confetti({
            //     particleCount: 40,
            //     startVelocity: 10,
            //     spread: 200,
            //     angle: -180,
            //     ticks: 50,
            //     decay: 0.99,
            //     origin: { y: 0, x: 0.9 },
            //   });
            // }
          }
        }),
      ),
    { dispatch: false },
  );

  /**
   * Same completion ding as a done task (#9654), reusing the shared
   * `playDoneSound` helper and the existing `sound.doneSound` setting — no new
   * config surface. Deliberately silent for plain tally counters: only habits
   * with a goal (`isTrackStreaks`) can be "completed".
   *
   * `_actions$` is LOCAL_ACTIONS, so a habit ticked on another device replays
   * its op here without beeping.
   */
  habitDoneSound$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setSimpleCounterCounterToday, setSimpleCounterCounterForDate),
        // Only the store's goal config is needed; `newVal` comes from the action
        // because the reducer has already written it.
        concatMap(({ id, newVal }) =>
          this._store$.pipe(
            select(selectSimpleCounterById, { id }),
            first(),
            map((sc) => ({ sc, newVal })),
          ),
        ),
        // Equality, not `>=`, is what makes this the *moment* of completion: a
        // further click overshoots the goal and stays quiet, as does the 5-min
        // stopwatch value sync.
        filter(
          ({ sc, newVal }) => !!sc?.isTrackStreaks && newVal === (sc.streakMinValue || 1),
        ),
        withLatestFrom(this._globalConfigService.sound$),
        filter(([, soundCfg]) => !!soundCfg.doneSound),
        tap(([, soundCfg]) => playDoneSound(soundCfg)),
      ),
    { dispatch: false },
  );

  private _celebrate(): void {
    this._confettiService.createConfetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  }
}
