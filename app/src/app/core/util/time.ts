/** Current wall-clock time in epoch milliseconds — the app's single time source. */
export function timestamp(): number {
  return Date.now();
}
