export interface ChipSuggestion {
  id: string;
  title: string;
}

/**
 * Decides what a chip/autocomplete input should add when the typed value is
 * committed (Enter, Tab, blur or a separator key).
 *
 * Priority:
 * 1. the option the user actively highlighted (arrow keys / auto-active first option)
 * 2. an exact title match among *all* suggestions – so an already added or
 *    otherwise filtered out item is never duplicated as a new one
 * 3. the first offered completion – accepting what the panel shows
 *
 * Returns `undefined` when nothing matches, which means "create a new item
 * from the raw text".
 *
 * @param value the trimmed text the user typed
 * @param allSuggestions every known suggestion
 * @param filteredSuggestions exactly what the autocomplete panel offered for `value`
 * @param activeSuggestionId id of the highlighted option, if any
 */
export const resolveChipSuggestion = <T extends ChipSuggestion>(
  value: string,
  allSuggestions: readonly T[],
  filteredSuggestions: readonly T[],
  activeSuggestionId?: string | null,
): T | undefined => {
  const active = activeSuggestionId
    ? filteredSuggestions.find((suggestion) => suggestion.id === activeSuggestionId)
    : undefined;

  return (
    active ??
    allSuggestions.find((suggestion) => suggestion.title === value) ??
    filteredSuggestions[0]
  );
};
