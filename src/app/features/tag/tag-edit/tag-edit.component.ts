import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatAutocomplete,
  MatAutocompleteActivatedEvent,
  MatAutocompleteSelectedEvent,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import {
  MatChipGrid,
  MatChipInput,
  MatChipInputEvent,
  MatChipRemove,
  MatChipRow,
} from '@angular/material/chips';
import { MatIcon } from '@angular/material/icon';
import { ReactiveFormsModule, UntypedFormControl } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { T } from '../../../t.const';
import { TagService } from '../tag.service';
import { TaskService } from '../../tasks/task.service';
import { TaskCopy } from '../../tasks/task.model';
import { TagComponent } from '../tag/tag.component';
import { TranslatePipe } from '@ngx-translate/core';
import { TODAY_TAG } from '../tag.const';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { resolveChipSuggestion } from '../../../util/resolve-chip-suggestion';

interface Suggestion {
  id: string;
  title: string;

  [key: string]: any;
}

const DEFAULT_SEPARATOR_KEY_CODES: number[] = [ENTER, COMMA];

@Component({
  selector: 'tag-edit',
  standalone: true,
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatChipGrid,
    MatChipInput,
    MatChipRow,
    MatIcon,
    MatChipRemove,
    TagComponent,
    ReactiveFormsModule,
    MatOption,
    TranslatePipe,
  ],
  templateUrl: './tag-edit.component.html',
  styleUrl: './tag-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagEditComponent {
  T: typeof T = T;

  private _tagService = inject(TagService);
  private _taskService = inject(TaskService);
  private readonly _destroyRef = inject(DestroyRef);

  task = input<TaskCopy>();
  isShowMyDayTag = input<boolean>(false);
  tagIds = input.required<string[]>();
  excludedTagIds = input<string[]>();
  tagUpdate = output<string[]>();

  escapePress = output<void>();

  inputCtrl: UntypedFormControl = new UntypedFormControl();
  separatorKeysCodes: number[] = DEFAULT_SEPARATOR_KEY_CODES;

  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputElRef');
  readonly matAutocomplete = viewChild<MatAutocomplete>('autoElRef');

  inputVal = signal<string>('');
  private _activeSuggestionId: string | null = null;
  tagSuggestions = computed(() =>
    this.isShowMyDayTag()
      ? this._tagService.tagsInTreeOrder()
      : this._tagService.tagsNoMyDayAndNoListInTreeOrder(),
  );

  constructor() {
    this.inputCtrl.valueChanges
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((value: string | null) => {
        this.inputVal.set(value ?? '');
      });
  }

  allExcludedTagIds = computed<string[]>(() => [
    ...this.tagIds(),
    ...(this.excludedTagIds() || []),
    TODAY_TAG.id,
  ]);
  filteredSuggestions = computed(() => {
    const val = this.inputVal();
    const allExcludedTagIds = this.allExcludedTagIds();

    if (!val) {
      return this.tagSuggestions().filter(
        (suggestion) => !allExcludedTagIds.includes(suggestion.id),
      );
    }
    const filterValue = val.toLowerCase();

    return this.tagSuggestions().filter(
      (suggestion) =>
        suggestion.title.toLowerCase().indexOf(filterValue) === 0 &&
        !allExcludedTagIds.includes(suggestion.id),
    );
  });

  tagItems = computed<Suggestion[]>(() => {
    const suggestions = this.tagSuggestions();
    return suggestions.length
      ? (this.tagIds()
          .map((id) => suggestions.find((suggestion) => suggestion.id === id))
          .filter((v) => v) as Suggestion[])
      : [];
  });

  add(event: MatChipInputEvent): void {
    const matAutocomplete = this.matAutocomplete();
    if (!matAutocomplete) {
      throw new Error('Auto complete undefined');
    }

    // while the panel is open the autocomplete itself commits the selection
    if (matAutocomplete.isOpen) {
      return;
    }

    const rawValue = event.value || '';
    if (rawValue.trim()) {
      this._addByTitle(rawValue);
    }

    event.input.value = '';
    this.inputCtrl.setValue(null);
    this._activeSuggestionId = null;
  }

  onOptionActivated(event: MatAutocompleteActivatedEvent): void {
    const val: unknown = event.option?.value;
    this._activeSuggestionId = typeof val === 'string' ? val : null;
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      this.escapePress.emit();
    }
  }

  focusInput(): void {
    const inputEl = this.inputEl();
    if (inputEl) {
      inputEl.nativeElement.focus();
    }
  }

  remove(id: string): void {
    this._updateModel(this.tagIds().filter((tid) => tid !== id));
  }

  selected(event: MatAutocompleteSelectedEvent): void {
    this._activeSuggestionId = null;
    this._add(event.option.value);
    const inputEl = this.inputEl();
    if (inputEl) {
      inputEl.nativeElement.value = '';
    }
    this.inputCtrl.setValue(null);
  }

  private _updateModel(v: string[]): void {
    this.tagUpdate.emit(v);
    const task = this.task();
    if (task) {
      this._taskService.updateTags(task, v);
    }
  }

  private _add(id: string): void {
    // prevent double items
    if (!this.tagIds().includes(id)) {
      this._updateModel([...this.tagIds(), id]);
    }
  }

  private _addByTitle(rawValue: string): void {
    const value = rawValue.trim();
    const match = resolveChipSuggestion(
      value,
      this.tagSuggestions(),
      this.filteredSuggestions(),
      this._activeSuggestionId,
    );
    if (match) {
      if (!this.allExcludedTagIds().includes(match.id)) {
        this._add(match.id);
      }
    } else {
      this._createNewTag(value);
    }
  }

  private _createNewTag(title: string): void {
    const cleanTitle = (t: string): string => {
      return t.replace('#', '');
    };

    const id = this._tagService.addTag({ title: cleanTitle(title) });
    this._add(id);
  }

  protected readonly onkeydown = onkeydown;
}
