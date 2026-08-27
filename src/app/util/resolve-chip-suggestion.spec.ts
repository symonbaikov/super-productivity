import { resolveChipSuggestion } from './resolve-chip-suggestion';

describe('resolveChipSuggestion', () => {
  const IMPORTANT = { id: 'ID_IMPORTANT', title: 'important' };
  const IMPOSSIBLE = { id: 'ID_IMPOSSIBLE', title: 'impossible' };
  const OTHER = { id: 'ID_OTHER', title: 'other' };
  const ALL = [IMPORTANT, IMPOSSIBLE, OTHER];

  it('should accept the first offered completion for a partial input', () => {
    // the #9722 case: typing "impo" and committing must not create a new tag
    expect(resolveChipSuggestion('impo', ALL, [IMPORTANT, IMPOSSIBLE])).toBe(IMPORTANT);
  });

  it('should accept the highlighted option over the first one', () => {
    expect(
      resolveChipSuggestion('impo', ALL, [IMPORTANT, IMPOSSIBLE], IMPOSSIBLE.id),
    ).toBe(IMPOSSIBLE);
  });

  it('should prefer an exact title match over the first completion', () => {
    const IMP = { id: 'ID_IMP', title: 'imp' };
    // "imp" sorts after nothing here, so the first completion would be a different item
    expect(
      resolveChipSuggestion('imp', [...ALL, IMP], [IMPORTANT, IMPOSSIBLE, IMP]),
    ).toBe(IMP);
  });

  it('should find an exact match that is not offered anymore (already added)', () => {
    expect(resolveChipSuggestion('important', ALL, [])).toBe(IMPORTANT);
  });

  it('should return undefined when nothing matches, so a new item is created', () => {
    expect(resolveChipSuggestion('brandNew', ALL, [])).toBeUndefined();
  });

  it('should ignore a stale active id that is no longer offered', () => {
    expect(resolveChipSuggestion('impo', ALL, [IMPORTANT, IMPOSSIBLE], 'ID_GONE')).toBe(
      IMPORTANT,
    );
  });

  it('should ignore a stale active id and still prefer an exact match', () => {
    expect(resolveChipSuggestion('other', ALL, [OTHER], 'ID_GONE')).toBe(OTHER);
  });
});
