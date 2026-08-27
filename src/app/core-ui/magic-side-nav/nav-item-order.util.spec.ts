import { orderNavItemsByIds } from './nav-item-order.util';

describe('orderNavItemsByIds', () => {
  const items = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }));
  const ids = (list: { id: string }[]): string[] => list.map((i) => i.id);

  it('should keep the default order when there is no stored order', () => {
    const defaultItems = items('today', 'inbox', 'planner', 'habits');
    expect(ids(orderNavItemsByIds(defaultItems))).toEqual([
      'today',
      'inbox',
      'planner',
      'habits',
    ]);
    expect(ids(orderNavItemsByIds(defaultItems, []))).toEqual([
      'today',
      'inbox',
      'planner',
      'habits',
    ]);
  });

  it('should apply the stored order', () => {
    expect(
      ids(
        orderNavItemsByIds(items('today', 'inbox', 'planner', 'habits'), [
          'today',
          'habits',
          'inbox',
          'planner',
        ]),
      ),
    ).toEqual(['today', 'habits', 'inbox', 'planner']);
  });

  it('should append unknown items after the known ones, in default order', () => {
    // 'boards' + 'schedule' were added after the order was stored
    expect(
      ids(
        orderNavItemsByIds(
          items('today', 'inbox', 'planner', 'schedule', 'boards', 'habits'),
          ['habits', 'today', 'inbox'],
        ),
      ),
    ).toEqual(['habits', 'today', 'inbox', 'planner', 'schedule', 'boards']);
  });

  it('should keep every item exactly once, whatever the stored order contains', () => {
    const defaultItems = items('a', 'b', 'c');
    const result = orderNavItemsByIds(defaultItems, ['c', 'gone', 'a']);
    expect(ids(result)).toEqual(['c', 'a', 'b']);
    expect(result.length).toBe(defaultItems.length);
  });

  it('should not mutate the input array', () => {
    const defaultItems = items('a', 'b');
    orderNavItemsByIds(defaultItems, ['b', 'a']);
    expect(ids(defaultItems)).toEqual(['a', 'b']);
  });
});
