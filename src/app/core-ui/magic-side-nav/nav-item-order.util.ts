/**
 * Applies a user defined order (list of nav item ids) to the fixed side nav
 * items above the project list (#9653).
 *
 * Rules:
 * - ids present in `storedOrder` come first, in exactly that order
 * - every item NOT mentioned in `storedOrder` (a nav item added by a later
 *   release, a newly enabled feature, a freshly installed plugin) is kept and
 *   appended after them, preserving the built-in default order among themselves
 * - ids in `storedOrder` without a matching item are ignored
 *
 * This is why `sideNavItemOrder` needs no migration: an absent or partial list
 * always resolves to a complete, deterministic order.
 */
// Number.MAX_SAFE_INTEGER (not Infinity) so `unknown - unknown === 0` and the
// comparator stays stable instead of returning NaN.
const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

export const orderNavItemsByIds = <T extends { id: string }>(
  items: T[],
  storedOrder?: string[],
): T[] => {
  if (!storedOrder?.length) {
    return items;
  }
  const rankById = new Map(storedOrder.map((id, i) => [id, i]));
  // Array.prototype.sort is stable, so equally ranked (unknown) items keep
  // their default relative order.
  return [...items].sort(
    (a, b) => (rankById.get(a.id) ?? UNKNOWN_RANK) - (rankById.get(b.id) ?? UNKNOWN_RANK),
  );
};
