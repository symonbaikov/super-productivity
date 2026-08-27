import { playChecklistItemDoneSound } from './play-checklist-item-done-sound';
import { clearAudioBufferCache, closeAudioContext } from '../../util/audio-context';
import { SoundConfig } from '../config/global-config.model';

describe('playChecklistItemDoneSound', () => {
  let originalAudioContext: typeof AudioContext;
  let originalFetch: typeof window.fetch;
  let startSpy: jasmine.Spy;

  const CFG: SoundConfig = {
    isIncreaseDoneSoundPitch: true,
    doneSound: 'ding-small-bell.mp3',
    breakReminderSound: null,
    volume: 75,
  };

  /** Runs the helper and resolves once the (mocked) audio pipeline has settled. */
  const play = async (
    cfg: SoundConfig | undefined,
    prev: string,
    next: string,
  ): Promise<number> => {
    playChecklistItemDoneSound(cfg, prev, next);
    // One macrotask boundary drains the whole (all-microtask) fetch -> decode ->
    // playBuffer chain, so a fixed number of Promise.resolve() ticks is not needed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return startSpy.calls.count();
  };

  beforeEach(() => {
    originalAudioContext = (window as any).AudioContext;
    originalFetch = window.fetch;

    startSpy = jasmine.createSpy('start');
    const mockSource = {
      detune: { value: 0 },
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      start: startSpy,
      buffer: null,
      onended: null,
    };
    const mockContext = {
      state: 'running',
      resume: jasmine.createSpy('resume').and.resolveTo(undefined),
      close: jasmine.createSpy('close'),
      decodeAudioData: jasmine.createSpy('decodeAudioData').and.resolveTo({}),
      createBufferSource: jasmine
        .createSpy('createBufferSource')
        .and.returnValue(mockSource),
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

  it('plays when an item goes from unchecked to checked', async () => {
    expect(await play(CFG, '- [ ] a\n- [ ] b', '- [x] a\n- [ ] b')).toBe(1);
  });

  it('stays silent when an item is unchecked', async () => {
    expect(await play(CFG, '- [x] a\n- [x] b', '- [ ] a\n- [x] b')).toBe(0);
  });

  it('stays silent when the done sound is set to NONE', async () => {
    expect(await play({ ...CFG, doneSound: null }, '- [ ] a', '- [x] a')).toBe(0);
  });

  it('stays silent when the sound config is not loaded yet', async () => {
    expect(await play(undefined, '- [ ] a', '- [x] a')).toBe(0);
  });

  it('ignores edits that do not check anything', async () => {
    expect(await play(CFG, '- [x] a', '- [x] a\n- [ ] b')).toBe(0);
  });
});
