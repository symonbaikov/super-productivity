import { isDBDateStr } from '../../../util/get-db-date-str';
import { Task } from '../task.model';
import { isDeadlineOverdue } from './is-deadline-overdue';

export const isScheduleOverdue = (
  task: Task,
  todayStr: string,
  isTodayFn: (timestamp: number) => boolean,
): boolean => {
  if (task.isDone) {
    return false;
  }

  const isDueWithTimeOverdue = !!(
    task.dueWithTime &&
    !isTodayFn(task.dueWithTime) &&
    task.dueWithTime < Date.now()
  );
  const isDueDayOverdue = !!(
    task.dueDay &&
    isDBDateStr(task.dueDay) &&
    task.dueDay !== todayStr &&
    task.dueDay < todayStr
  );

  if (!isDueWithTimeOverdue && !isDueDayOverdue) {
    return false;
  }

  const hasDeadline =
    typeof task.deadlineWithTime === 'number' ||
    !!(task.deadlineDay && isDBDateStr(task.deadlineDay));

  return !hasDeadline || isDeadlineOverdue(task, todayStr);
};
