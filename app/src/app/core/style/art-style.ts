/**
 * The shared "style bible" every image prompt appends — pages AND covers — so
 * the whole shelf reads as one cohesive collection: same art style, aspect
 * ratio, palette, lighting, and framing.
 *
 * To re-theme the entire app later, change these constants in ONE place. (This
 * can become a per-book `style` field down the line; for now it's a global
 * default so books on the shelf share a look.)
 */

/** Fixed page aspect ratio — keeps the flipbook uniform (reader detects ratio). */
export const PAGE_ASPECT = {
  label: 'portrait 2:3',
  ratio: '2:3',
  pixels: '832 x 1248',
  /** Common flags across tools (Midjourney `--ar`, SD width/height, etc.). */
  flags: '--ar 2:3',
};

/** The look-and-feel — Studio Ghibli inspired. */
export const ART_STYLE =
  'Studio Ghibli–inspired hand-painted animation art (in the spirit of Hayao Miyazaki / Studio Ghibli, ' +
  'e.g. Spirited Away, Kiki\'s Delivery Service): soft watercolor-painted backgrounds, gentle clean linework, ' +
  'warm natural light, lush painterly detail, expressive cel-shaded characters, nostalgic and whimsical mood, ' +
  'cinematic storybook composition.';

/** Shared palette + rendering so pages don't drift apart visually. */
export const PALETTE =
  'a warm, muted, earthy colour palette with soft golden highlights and gentle atmospheric depth';

/** Things to keep out of every image. */
export const NEGATIVE =
  'photorealism, 3D render, harsh or inked black outlines, neon colours, text watermark, signature, ' +
  'logo, page numbers, hard rectangular border frames, letterboxing / empty bars';

/**
 * The deterministic style block appended to every prompt. Repeating it verbatim
 * on each page is what makes the set look like one artist drew the whole book.
 */
export function styleBlock(): string {
  return [
    `Art style: ${ART_STYLE}`,
    `Colour & light: ${PALETTE}.`,
    `Framing: a single full-bleed illustration that fills the whole frame (no panel grid, no empty margins).`,
    `Aspect ratio: ${PAGE_ASPECT.label} — ${PAGE_ASPECT.ratio} (e.g. ${PAGE_ASPECT.pixels}px) ${PAGE_ASPECT.flags}.`,
    `Consistency: match the art style, palette, lighting and character designs across EVERY page of the book — ` +
      `reuse the same generation seed if your tool supports it so the whole comic feels drawn by one artist.`,
    `Avoid: ${NEGATIVE}.`,
  ].join('\n');
}
