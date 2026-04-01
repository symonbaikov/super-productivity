import { Task } from '../task.model';
import { isScheduleOverdue } from './is-schedule-overdue';

const createTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 'task1',
    isDone: false,
    dueDay: undefined,
    dueWithTime: undefined,
    deadlineDay: undefined,
    deadlineWithTime: undefined,
    ...overrides,
  }) as Task;

describe('isScheduleOverdue', () => {
  const TODAY_STR = '2026-03-15';
  const isNeverToday = (): boolean => false;

  it('should return true when dueDay is before today and there is no deadline', () => {
    const task = createTask({ dueDay: '2026-03-14' });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(true);
  });

  it('should return false when dueDay is before today and deadlineDay is in the future', () => {
    const task = createTask({
      dueDay: '2026-03-14',
      deadlineDay: '2026-03-16',
    });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(false);
  });

  it('should return true when dueDay is before today and deadlineDay is overdue', () => {
    const task = createTask({
      dueDay: '2026-03-14',
      deadlineDay: '2026-03-14',
    });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(true);
  });

  it('should return false when dueWithTime is in the past and deadlineWithTime is in the future', () => {
    const task = createTask({
      dueWithTime: Date.now() - 60_000,
      deadlineWithTime: Date.now() + 60_000,
    });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(false);
  });

  it('should return true when dueWithTime is in the past and deadlineWithTime is overdue', () => {
    const task = createTask({
      dueWithTime: Date.now() - 120_000,
      deadlineWithTime: Date.now() - 60_000,
    });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(true);
  });

  it('should return false when dueDay equals today', () => {
    const task = createTask({ dueDay: TODAY_STR });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(false);
  });

  it('should return false for done tasks', () => {
    const task = createTask({ isDone: true, dueDay: '2026-03-14' });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(false);
  });

  it('should not suppress overdue when deadlineDay is malformed', () => {
    const task = createTask({
      dueDay: '2026-03-14',
      deadlineDay: '-/-/2026',
    });

    expect(isScheduleOverdue(task, TODAY_STR, isNeverToday)).toBe(true);
  });
});
