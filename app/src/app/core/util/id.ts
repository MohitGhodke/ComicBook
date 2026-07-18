/** Generate a stable unique id for domain entities. */
export function newId(prefix = 'id'): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid}`;
}
