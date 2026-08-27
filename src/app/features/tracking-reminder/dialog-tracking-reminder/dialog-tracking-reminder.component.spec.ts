import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { DialogTrackingReminderComponent } from './dialog-tracking-reminder.component';
import { SelectTaskComponent } from '../../tasks/select-task/select-task.component';
import { TaskService } from '../../tasks/task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { Task } from '../../tasks/task.model';
import { selectAllProjects } from '../../project/store/project.selectors';
import {
  selectStartableTasksActiveContextFirst,
  selectTrackableTasksActiveContextFirst,
} from '../../work-context/store/work-context.selectors';

describe('DialogTrackingReminderComponent', () => {
  const OTHER_PROJECT_TASK = {
    id: 'OTHER_PROJECT_TASK',
    title: 'Task in another project',
    projectId: 'OTHER_PROJECT',
    isDone: false,
    subTaskIds: [],
    tagIds: [],
  } as Partial<Task> as Task;

  let fixture: ComponentFixture<DialogTrackingReminderComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DialogTrackingReminderComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        provideNoopAnimations(),
        {
          provide: MatDialogRef,
          useValue: jasmine.createSpyObj('MatDialogRef', ['close']),
        },
        { provide: MAT_DIALOG_DATA, useValue: { remindCounter$: of(60000) } },
        { provide: TaskService, useValue: { getByIdOnce$: () => of(null) } },
        {
          provide: WorkContextService,
          // #9731: must stay unused — the dialog searches globally, not per context
          useValue: {
            trackableTasksForActiveContext$: of([]),
            startableTasksForActiveContext$: of([]),
          },
        },
        {
          provide: GlobalConfigService,
          useValue: { shortSyntax: () => ({ isEnableProject: false }) },
        },
      ],
    });

    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectAllProjects, []);
    store.overrideSelector(selectTrackableTasksActiveContextFirst, [OTHER_PROJECT_TASK]);
    store.overrideSelector(selectStartableTasksActiveContextFirst, [OTHER_PROJECT_TASK]);

    fixture = TestBed.createComponent(DialogTrackingReminderComponent);
    fixture.detectChanges();
  });

  it('should offer tasks from other projects, not just the active context (#9731)', () => {
    const selectTask = fixture.debugElement.query(By.directive(SelectTaskComponent))
      .componentInstance as SelectTaskComponent;

    expect(selectTask.isLimitToProject()).toBe(false);

    selectTask.taskSelectCtrl.setValue('another');
    fixture.detectChanges();

    expect(selectTask.filteredTasks().map((t) => t.id)).toEqual(['OTHER_PROJECT_TASK']);
  });
});
