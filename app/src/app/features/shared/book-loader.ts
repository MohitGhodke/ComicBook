import { Component, Input } from '@angular/core';

/**
 * The app's one, consistent loading animation: a little book whose pages flip.
 * Ported from the sample comic (css/style.css `.loader-book`) and recoloured to
 * the app's cool tokens (no warm cover). Used both inline and as the persistent
 * floating loader that stays up while an AI task runs in the background.
 */
@Component({
  selector: 'app-book-loader',
  template: `
    <div class="bl" [class.bl--row]="compact" role="status" aria-live="polite">
      <div class="bl-book" [attr.aria-label]="label || 'Loading'">
        <div class="bl-page"></div>
        <div class="bl-page bl-page2"></div>
      </div>
      @if (label) { <span class="bl-label">{{ label }}</span> }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }
    .bl { display: flex; flex-direction: column; align-items: center; gap: 0.85rem; }
    .bl-book {
      width: 116px; height: 11px;
      background: var(--accent);
      border-bottom: 2px solid color-mix(in srgb, var(--accent) 55%, #000);
      display: flex; align-items: flex-start; justify-content: flex-end; position: relative;
    }
    .bl-page {
      width: 50%; height: 2px; background: var(--accent);
      transform-origin: left; animation: bl-paging 0.7s ease-out infinite;
    }
    .bl-page2 { position: absolute; animation-duration: 0.8s; }
    @keyframes bl-paging {
      10%  { transform: rotateZ(0deg); }
      100% { transform: rotateZ(-180deg); }
    }
    .bl-label {
      font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--ink-faint); text-align: center;
    }

    /* Compact single-line variant: a small book beside the status text. */
    .bl--row { flex-direction: row; align-items: center; gap: 0.7rem; }
    .bl--row .bl-book { width: 44px; height: 7px; }
    .bl--row .bl-label { font-size: 0.68rem; letter-spacing: 0.1em; text-align: left; white-space: nowrap; }

    @media (prefers-reduced-motion: reduce) {
      .bl-page { animation-duration: 1.6s; }
    }
  `],
})
export class BookLoader {
  /** Optional caption shown with the book (e.g. "Writing page 3 of 8…"). */
  @Input() label = '';
  /** Lay the book and label out on ONE line (small footprint) instead of stacked. */
  @Input() compact = false;
}
