import { AutomationContext, IAutomationAction } from './definitions';
import { resolveDateValue } from './date-value';

const resolveTagId = async (ctx: AutomationContext, value: string): Promise<string | null> => {
  const tag = (await ctx.dataCache.getTags()).find((t) => t.id === value || t.title === value);
  if (!tag) {
    ctx.plugin.log.warn(`[Automation] Tag "${value}" not found.`);
    return null;
  }
  return tag.id;
};

export const ActionCreateTask: IAutomationAction = {
  id: 'createTask',
  name: 'Create Task',
  execute: async (ctx, event, value) => {
    if (!value) return;
    await ctx.plugin.addTask({
      title: value,
      projectId: event.task?.projectId,
    });
    ctx.plugin.log.info(`[Automation] Action: Created task "${value}"`);
  },
};

export const ActionDeleteTask: IAutomationAction = {
  id: 'deleteTask',
  name: 'Delete Task',
  execute: async (ctx, event) => {
    if (!event.task?.id) {
      ctx.plugin.log.warn('[Automation] Cannot delete task without task context.');
      return;
    }

    await ctx.plugin.deleteTask(event.task.id);
    ctx.plugin.log.info(`[Automation] Action: Deleted task "${event.task.title}"`);
  },
};

export const ActionAddTag: IAutomationAction = {
  id: 'addTag',
  name: 'Add Tag',
  execute: async (ctx, event, value) => {
    if (!event.task || !value) {
      ctx.plugin.log.warn(`[Automation] Cannot add tag "${value}" without task context.`);
      return;
    }
    const tagId = await resolveTagId(ctx, value);
    if (!tagId) return;
    if (event.task.tagIds.includes(tagId)) return;

    await ctx.plugin.updateTask(event.task.id, {
      tagIds: [...event.task.tagIds, tagId],
    });
    ctx.plugin.log.info(`[Automation] Action: Added tag "${value}"`);
  },
};

export const ActionRemoveTag: IAutomationAction = {
  id: 'removeTag',
  name: 'Remove Tag',
  execute: async (ctx, event, value) => {
    if (!event.task || !value) {
      ctx.plugin.log.warn(`[Automation] Cannot remove tag "${value}" without task context.`);
      return;
    }
    const tagId = await resolveTagId(ctx, value);
    if (!tagId) return;
    if (!event.task.tagIds.includes(tagId)) return;

    await ctx.plugin.updateTask(event.task.id, {
      tagIds: event.task.tagIds.filter((id) => id !== tagId),
    });
    ctx.plugin.log.info(`[Automation] Action: Removed tag "${value}"`);
  },
};

export const ActionMoveToProject: IAutomationAction = {
  id: 'moveToProject',
  name: 'Move to Project',
  execute: async (ctx, event, value) => {
    if (!event.task || !value) {
      ctx.plugin.log.warn(
        `[Automation] Cannot move task to project "${value}" without task context.`,
      );
      return;
    }
    const projects = await ctx.dataCache.getProjects();
    const project = projects.find((p) => p.id === value || p.title === value);

    if (!project) {
      ctx.plugin.log.warn(
        `[Automation] Project "${value}" not found in: ${projects.map((p) => p.title).join(', ')}`,
      );
      return;
    }

    if (event.task.projectId === project.id) {
      ctx.plugin.log.info(`[Automation] Task already in project "${project.title}"`);
      return;
    }

    await ctx.plugin.updateTask(event.task.id, { projectId: project.id });
    ctx.plugin.log.info(`[Automation] Action: Moved task to project "${project.title}"`);
  },
};

export const ActionDisplaySnack: IAutomationAction = {
  id: 'displaySnack',
  name: 'Display Snack',
  execute: async (ctx, event, value) => {
    if (!value) return;
    ctx.plugin.showSnack({ msg: value, type: 'SUCCESS' });
    ctx.plugin.log.info(`[Automation] Action: Displayed snack "${value}"`);
  },
};

export const ActionDisplayDialog: IAutomationAction = {
  id: 'displayDialog',
  name: 'Display Dialog',
  execute: async (ctx, event, value) => {
    if (!value) return;
    const escapedValue = value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    await ctx.plugin.openDialog({
      htmlContent: `<p>${escapedValue}</p>`,
      buttons: [{ label: 'OK', onClick: () => {} }],
    });
    ctx.plugin.log.info(`[Automation] Action: Displayed dialog "${value}"`);
  },
};

export const ActionWebhook: IAutomationAction = {
  id: 'webhook',
  name: 'Webhook',
  execute: async (ctx, event, value) => {
    if (!value) return;
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      ctx.plugin.log.warn(
        `[Automation] Invalid webhook URL: "${value}". Must start with http:// or https://`,
      );
      return;
    }

    // Sanitize event data to avoid leaking all task details
    const sanitizedEvent = {
      type: event.type,
      task: event.task
        ? {
            id: event.task.id,
            title: event.task.title,
            projectId: event.task.projectId,
            isDone: event.task.isDone,
            tagIds: event.task.tagIds,
          }
        : undefined,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch(value, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedEvent),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      ctx.plugin.log.info(`[Automation] Action: Webhook sent to "${value}"`);
    } catch (e) {
      ctx.plugin.log.error(`[Automation] Webhook failed: ${e}`);
    }
  },
};

const DATE_VALUE_HINT =
  'Use an absolute "YYYY-MM-DD" or an offset from the task creation date like "+3d", "+2w", "+1m", "+1y".';

const resolveDayOrWarn = (
  ctx: AutomationContext,
  createdTs: number,
  value?: string,
): string | null => {
  // Offsets are counted from task creation (as requested in #9700), not from
  // "now", so re-running a rule on the same task always yields the same day.
  const day = value ? resolveDateValue(value, new Date(createdTs)) : null;
  if (!day) {
    ctx.plugin.log.warn(`[Automation] Invalid date value: "${value}". ${DATE_VALUE_HINT}`);
  }
  return day;
};

export const ActionSetDueDate: IAutomationAction = {
  id: 'setDueDate',
  name: 'Set Due Date',
  description: `Schedules the task for a day. ${DATE_VALUE_HINT}`,
  execute: async (ctx, event, value) => {
    if (!event.task) {
      ctx.plugin.log.warn('[Automation] Cannot set a due date without task context.');
      return;
    }
    // A task scheduled to an exact time owns a reminder that only the host can
    // clear; overwriting dueWithTime from here would leave that reminder firing
    // for a date the task no longer has. Leave those tasks alone instead.
    if (event.task.dueWithTime) {
      ctx.plugin.log.warn(
        '[Automation] Skipped setting a due date: task is scheduled with a time.',
      );
      return;
    }
    const dueDay = resolveDayOrWarn(ctx, event.task.created, value);
    if (!dueDay) return;
    if (event.task.dueDay === dueDay) return;

    await ctx.plugin.updateTask(event.task.id, { dueDay });
    ctx.plugin.log.info(`[Automation] Action: Set due date to ${dueDay}`);
  },
};

export const ActionSetDeadline: IAutomationAction = {
  id: 'setDeadline',
  name: 'Set Deadline',
  description: `Sets the task deadline. ${DATE_VALUE_HINT}`,
  execute: async (ctx, event, value) => {
    if (!event.task) {
      ctx.plugin.log.warn('[Automation] Cannot set a deadline without task context.');
      return;
    }
    // Same reasoning as setDueDate: a deadline with a time carries its own reminder.
    if (event.task.deadlineWithTime) {
      ctx.plugin.log.warn(
        '[Automation] Skipped setting a deadline: task has a deadline with a time.',
      );
      return;
    }
    const deadlineDay = resolveDayOrWarn(ctx, event.task.created, value);
    if (!deadlineDay) return;
    if (event.task.deadlineDay === deadlineDay) return;

    await ctx.plugin.updateTask(event.task.id, { deadlineDay });
    ctx.plugin.log.info(`[Automation] Action: Set deadline to ${deadlineDay}`);
  },
};
