import { BubbleFontSize } from '../models/comic.model';

/** Small → Medium → Big, in slider order. */
export const FONT_SIZES: BubbleFontSize[] = ['small', 'medium', 'large'];
export const FONT_SIZE_LABELS: Record<BubbleFontSize, string> = { small: 'Small', medium: 'Medium', large: 'Big' };

/** Class applied to a `.panel-grid` so its bubbles/captions render at this size. */
export function fontSizeClass(size: BubbleFontSize | undefined): string {
  return 'font-size-' + (size ?? 'large');
}
