import { SoundConfig } from '../config/global-config.model';
import { playDoneSound } from '../tasks/util/play-done-sound';
import { isCheckedItemLine } from './checklist-operations';

const countChecked = (notes: string): number =>
  notes.split('\n').filter(isCheckedItemLine).length;

/**
 * Plays the existing "done" sound when a checklist item goes from unchecked to
 * checked (#9655). Unchecking stays silent.
 *
 * Configured by the existing Settings > Sound > "Done sound" option (set it to
 * NONE to silence both task and checklist ticks) — deliberately no separate
 * toggle. Pitch is never raised here (nrOfDoneTasks stays 0), so ticking items
 * does not ride the task-completion pitch ramp.
 */
export const playChecklistItemDoneSound = (
  soundCfg: SoundConfig | undefined,
  prevNotes: string,
  nextNotes: string,
): void => {
  if (!soundCfg?.doneSound) {
    return;
  }
  if (countChecked(nextNotes) <= countChecked(prevNotes)) {
    return;
  }
  playDoneSound(soundCfg);
};
