import { Component, EventEmitter, Input, Output } from '@angular/core';
import { BubbleFontSize } from '../../core/models/comic.model';
import { FONT_SIZES, FONT_SIZE_LABELS } from '../../core/util/font-size';

/** A 3-step small/medium/big slider for bubble & caption text size. */
@Component({
  selector: 'app-font-size-slider',
  template: `
    <div class="fss">
      <input class="fss-range" type="range" min="0" max="2" step="1"
             [value]="index" (input)="onInput($event)"
             [attr.aria-label]="ariaLabel || 'Bubble text size'" />
      <div class="fss-ticks">
        @for (s of sizes; track s) { <span [class.active]="s === value">{{ labels[s] }}</span> }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fss { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; max-width: 240px; }
    .fss-range {
      -webkit-appearance: none; appearance: none; width: 100%; height: 3px;
      background: var(--line-2); border-radius: 999px; outline: none; cursor: pointer; margin: 0.5rem 0;
    }
    .fss-range::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%;
      background: var(--accent); cursor: pointer; border: none;
    }
    .fss-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--accent); cursor: pointer; border: none; }
    .fss-ticks { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--ink-faint); }
    .fss-ticks .active { color: var(--accent); font-weight: 600; }
  `],
})
export class FontSizeSlider {
  @Input() value: BubbleFontSize = 'large';
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<BubbleFontSize>();

  readonly sizes = FONT_SIZES;
  readonly labels = FONT_SIZE_LABELS;

  get index(): number {
    return FONT_SIZES.indexOf(this.value);
  }

  onInput(e: Event) {
    const idx = Number((e.target as HTMLInputElement).value);
    this.valueChange.emit(FONT_SIZES[idx]);
  }
}
