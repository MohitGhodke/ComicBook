/**
 * Clean dialogue for a speech bubble so it reads like a real comic line:
 *  - strip stage directions / expression cues in (parentheses) or [brackets]
 *  - strip a leading speaker label the model prepends ("Marcus: hello" → "hello")
 *    — comics show WHO speaks via the art / bubble tail, never a name inside it
 *  - salvage crammed multi-speaker strings ("Marcus: Stop! Elias: Wait") by
 *    keeping only the first speaker's line (each speaker belongs in its OWN panel)
 *  - strip surrounding quotes.
 */
export function cleanDialogue(text: string | undefined): string {
  if (!text) return '';
  let out = text
    .replace(/\([^)]*\)/g, '') // (nervously)
    .replace(/\[[^\]]*\]/g, '') // [smiling]
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Drop a leading "Name:" speaker label (capitalised, 1–3 words).
  out = out.replace(/^\s*\p{Lu}[\p{L}.'’-]*(?:\s\p{Lu}[\p{L}.'’-]*){0,2}:\s+/u, '');

  // If another "Name:" label appears later, the model crammed several speakers
  // into one bubble — keep only the first line (the rest belong in later panels).
  const next = out.match(/\s\p{Lu}[\p{L}.'’-]*(?:\s\p{Lu}[\p{L}.'’-]*){0,2}:\s/u);
  if (next && next.index !== undefined) out = out.slice(0, next.index);

  return out.replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
}
