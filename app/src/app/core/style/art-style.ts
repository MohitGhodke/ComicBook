/**
 * The deterministic "style bible" every image prompt appends — pages AND covers.
 * The look (art style / palette / negatives) comes from the comic's chosen
 * {@link ArtStyle}; the framing/aspect rules are shared. Repeating the same
 * style block on every page/panel is what makes the set look like one book.
 */

import { LayoutId } from '../models/comic.model';
import { ArtStyle } from './art-styles';

/** Fixed page aspect ratio — keeps the flipbook uniform (reader detects ratio). */
export const PAGE_ASPECT = {
  label: 'portrait 2:3',
  ratio: '2:3',
  pixels: '832 x 1248',
  /** Common flags across tools (Midjourney `--ar`, SD width/height, etc.). */
  flags: '--ar 2:3',
};

/** Full-page (cover) style block for the given art style. */
export function styleBlock(style: ArtStyle): string {
  return [
    `Art style: ${style.artStyle}`,
    `Colour & light: ${style.palette}.`,
    `Framing: a single full-bleed illustration that fills the whole frame (no panel grid, no empty margins).`,
    `Aspect ratio: ${PAGE_ASPECT.label} — ${PAGE_ASPECT.ratio} (e.g. ${PAGE_ASPECT.pixels}px) ${PAGE_ASPECT.flags}.`,
    `Consistency: match the art style, palette, lighting and character designs across EVERY page of the book, ` +
      `so the whole comic feels drawn by one artist.`,
    `Avoid: ${style.negative}.`,
  ].join('\n');
}

/** The aspect ratio a generated image should target so it fits its slot. */
export interface AspectSpec {
  /** Human label, e.g. "wide landscape 2:1". */
  label: string;
  /** Bare ratio, e.g. "2:1". */
  ratio: string;
  /** Tool flags, e.g. "--ar 2:1". */
  flags: string;
}

function aspect(label: string, ratio: string): AspectSpec {
  return { label, ratio, flags: `--ar ${ratio}` };
}

/**
 * The aspect ratio of a single panel's CELL for a given layout + panel index.
 *
 * The page is portrait 2:3 and each layout slices it differently (see the grid
 * definitions in `styles.scss`). Generating each panel at the shape of the slot
 * it will drop into is what stops the art from being badly cropped when placed.
 *   splash   → whole page                          2:3
 *   strip3   → 1 col × 3 rows  → wide cells         2:1
 *   grid4    → 2 × 2           → portrait cells     2:3
 *   feature3 → hero + 2 unders → wide / portrait    ~1:1 / ~5:6
 *   six      → 2 × 3           → square cells        1:1
 */
export function panelAspect(layout: LayoutId | undefined, index: number): AspectSpec {
  switch (layout) {
    case 'strip3':
      return aspect('wide landscape 2:1', '2:1');
    case 'grid4':
      return aspect('portrait 2:3', '2:3');
    case 'six':
      return aspect('square 1:1', '1:1');
    case 'feature3':
      return index === 0
        ? aspect('wide landscape ~10:9 (large hero panel)', '10:9')
        : aspect('portrait ~5:6 (small lower panel)', '5:6');
    case 'splash':
    default:
      return aspect('portrait 2:3 (full page)', '2:3');
  }
}

/**
 * Style block for a CHARACTER REFERENCE sheet — the locked portrait the author
 * generates once per character, then attaches to every panel prompt so the
 * character keeps the same face/design across the whole book. Plain background,
 * clear full look, neutral pose — an ideal source for --cref / IP-Adapter.
 */
export function characterRefStyleBlock(style: ArtStyle): string {
  return [
    `Art style: ${style.artStyle}`,
    `Colour & light: ${style.palette}.`,
    `Framing: a clean character reference sheet — a single full-body portrait plus a clear head-and-shoulders ` +
      `close-up of the SAME character, front-facing, neutral relaxed pose and expression, standing against a ` +
      `plain flat neutral background with soft even lighting. Show the whole design clearly.`,
    `Aspect ratio: portrait 3:4 --ar 3:4.`,
    `Avoid: ${style.negative}, speech bubbles, dialogue text, captions or lettering of any kind, busy background, props, other characters.`,
  ].join('\n');
}

/**
 * Style block for an individual PANEL. The app draws the frame and renders the
 * speech bubble, so panel art must be borderless and text-free. The aspect
 * ratio is per-panel (see {@link panelAspect}) so the image matches the exact
 * slot it will occupy and isn't cropped when composed into the page.
 */
export function panelStyleBlock(style: ArtStyle, spec: AspectSpec): string {
  return [
    `Art style: ${style.artStyle}`,
    `Colour & light: ${style.palette}.`,
    `Framing: a single borderless comic panel illustration that fills the frame edge to edge — ` +
      `no panel border, no gutters, no rounded corners, no empty margins. Compose the subject to sit ` +
      `comfortably WITHIN this frame shape — keep the important action away from the very edges.`,
    `Aspect ratio: ${spec.label} — generate the image at exactly ${spec.ratio} ${spec.flags} so it drops ` +
      `into the page panel WITHOUT being cropped. This is important: match this ratio, do not use a square if it is not square.`,
    `Consistency: match the art style, palette, lighting and character designs across EVERY panel, ` +
      `so the whole comic feels drawn by one artist.`,
    `Avoid: ${style.negative}, speech bubbles, dialogue text, captions or lettering of any kind (dialogue is added separately).`,
  ].join('\n');
}
