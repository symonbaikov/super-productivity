import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Subject, of } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { SimpleCounterEffects } from './simple-counter.effects';
import {
  setSimpleCounterCounterForDate,
  setSimpleCounterCounterToday,
} from './simple-counter.actions';
import { SIMPLE_COUNTER_FEATURE_NAME } from './simple-counter.reducer';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { GlobalConfigService } from '../../config/global-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ConfettiService } from '../../../core/confetti/confetti.service';
import { SoundConfig } from '../../config/global-config.model';
import { clearAudioBufferCache, closeAudioContext } from '../../../util/audio-context';

const SOUND_CFG: SoundConfig = {
  isIncreaseDoneSoundPitch: false,
  doneSound: 'ding-small-bell.mp3',
  breakReminderSound: null,
  volume: 75,
};

const HABIT: SimpleCounter = {
  id: 'h1',
  title: 'Pushups',
  isEnabled: true,
  icon: null,
  type: SimpleCounterType.ClickCounter,
  isTrackStreaks: true,
  streakMinValue: 3,
  countOnDay: {},
  isOn: false,
};

describe('SimpleCounterEffects habitDoneSound$ (#9654)', () => {
  let actions$: Subject<any>;
  let effects: SimpleCounterEffects;
  let startSpy: jasmine.Spy;
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;

  const setup = (counter: SimpleCounter, sound: SoundConfig = SOUND_CFG): void => {
    actions$ = new Subject<any>();
    TestBed.configureTestingModule({
      providers: [
        SimpleCounterEffects,
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            [SIMPLE_COUNTER_FEATURE_NAME]: {
              ids: [counter.id],
              entities: { [counter.id]: counter },
            },
          },
        }),
        { provide: LOCAL_ACTIONS, useValue: actions$ },
        { provide: GlobalConfigService, useValue: { sound$: of(sound) } },
        { provide: SnackService, useValue: { open: (): void => undefined } },
        { provide: ConfettiService, useValue: { createConfetti: (): void => undefined } },
        { provide: TranslateService, useValue: { instant: (k: string): string => k } },
      ],
    });
    effects = TestBed.inject(SimpleCounterEffects);
    effects.habitDoneSound$.subscribe();
  };

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;
    startSpy = jasmine.createSpy('start');
    const mockContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.resolveTo(undefined),
      close: jasmine.createSpy('close'),
      decodeAudioData: jasmine
        .createSpy('decodeAudioData')
        .and.resolveTo({} as AudioBuffer),
      createBufferSource: jasmine.createSpy('createBufferSource').and.returnValue({
        detune: { value: 0 },
        connect: jasmine.createSpy('connect'),
        disconnect: jasmine.createSpy('disconnect'),
        start: startSpy,
        buffer: null,
        onended: null,
      }),
      createGain: jasmine.createSpy('createGain').and.returnValue({
        connect: jasmine.createSpy('connect'),
        disconnect: jasmine.createSpy('disconnect'),
        gain: { value: 1 },
      }),
      destination: {} as AudioDestinationNode,
    };
    (window as any).AudioContext = jasmine
      .createSpy('AudioContext')
      .and.returnValue(mockContext);
    (window as any).fetch = jasmine.createSpy('fetch').and.resolveTo({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);
    closeAudioContext();
    clearAudioBufferCache();
  });

  afterEach(() => {
    closeAudioContext();
    (window as any).AudioContext = originalAudioContext;
    (window as any).fetch = originalFetch;
  });

  /** playDoneSound is async — let its promise chain settle before asserting. */
  const flush = (): Promise<void> =>
    new Promise((resolve) => setTimeout(() => resolve(), 0));

  it('plays the done sound when the goal is reached', async () => {
    setup(HABIT);
    actions$.next(
      setSimpleCounterCounterToday({ id: 'h1', newVal: 3, today: '2026-08-28' }),
    );
    await flush();
    expect(startSpy).toHaveBeenCalled();
  });

  it('plays for the habit-tracker cell click path too', async () => {
    setup(HABIT);
    actions$.next(
      setSimpleCounterCounterForDate({ id: 'h1', newVal: 3, date: '2026-08-28' }),
    );
    await flush();
    expect(startSpy).toHaveBeenCalled();
  });

  it('stays silent below the goal and on every further click past it', async () => {
    setup(HABIT);
    actions$.next(
      setSimpleCounterCounterToday({ id: 'h1', newVal: 2, today: '2026-08-28' }),
    );
    actions$.next(
      setSimpleCounterCounterToday({ id: 'h1', newVal: 4, today: '2026-08-28' }),
    );
    await flush();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('stays silent for a plain tally counter that has no goal', async () => {
    setup({ ...HABIT, isTrackStreaks: false });
    actions$.next(
      setSimpleCounterCounterToday({ id: 'h1', newVal: 3, today: '2026-08-28' }),
    );
    await flush();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('stays silent when the done sound is set to NONE', async () => {
    setup(HABIT, { ...SOUND_CFG, doneSound: null });
    actions$.next(
      setSimpleCounterCounterToday({ id: 'h1', newVal: 3, today: '2026-08-28' }),
    );
    await flush();
    expect(startSpy).not.toHaveBeenCalled();
  });
});
