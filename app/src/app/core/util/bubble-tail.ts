/** Shared geometry for a speech-bubble tail — used by both the reader (plain
 *  DOM) and the creator's live preview (Angular template), so a dragged
 *  bubble and a dragged tail tip always render identically in both places. */

/** Bubble position when the author hasn't customised it — matches the fixed
 *  CSS default (left: 7%; bottom: 9%, bubble ~78% down a typical panel). */
export const DEFAULT_BUBBLE = { x: 7, y: 78 };
/** Tail-tip position when the author hasn't customised it. */
export const DEFAULT_TAIL = { x: 14, y: 93 };

/** Fixed offset (in the same % units as bubbleX/Y) from the bubble's anchor
 *  corner to where the tail visually leaves the bubble. Keeping this relative
 *  to the bubble — rather than storing an independent point — is what makes
 *  the tail follow the bubble whenever it's dragged. */
const ANCHOR_OFFSET = { x: 7, y: 15 };

/** Half-width of the tail's base, in panel-percent units. */
const BASE_HALF_WIDTH = 2.6;

/**
 * Returns the "points" attribute for an SVG `<polygon>` — a wedge that
 * bridges the bubble to its tip — in a 0–100 coordinate space. Render it
 * inside an `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` sized to
 * exactly cover the panel: that non-uniform scaling matches how bubbleX/Y and
 * tailX/Y are already interpreted (independent % of width / % of height), so
 * these raw numbers need no pixel measurement to land in the right place.
 */
export function tailWedgePoints(
  bubbleX: number | undefined,
  bubbleY: number | undefined,
  tailX: number,
  tailY: number,
): string {
  const anchor = {
    x: (bubbleX ?? DEFAULT_BUBBLE.x) + ANCHOR_OFFSET.x,
    y: (bubbleY ?? DEFAULT_BUBBLE.y) + ANCHOR_OFFSET.y,
  };
  let dx = tailX - anchor.x;
  let dy = tailY - anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const perpX = -dy * BASE_HALF_WIDTH;
  const perpY = dx * BASE_HALF_WIDTH;
  // Nudge the base a touch past the anchor, into the bubble, so it tucks
  // under the bubble's rounded edge instead of leaving a visible seam.
  const base1 = { x: anchor.x + perpX - dx, y: anchor.y + perpY - dy };
  const base2 = { x: anchor.x - perpX - dx, y: anchor.y - perpY - dy };
  return `${base1.x},${base1.y} ${base2.x},${base2.y} ${tailX},${tailY}`;
}
