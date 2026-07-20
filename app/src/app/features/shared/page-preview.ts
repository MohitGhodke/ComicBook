import { Component, EventEmitter, Input, NgZone, Output, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { BubbleFontSize, Page, Panel } from '../../core/models/comic.model';
import { cleanDialogue } from '../../core/util/text';
import { DEFAULT_BUBBLE, DEFAULT_TAIL, tailWedgePoints } from '../../core/util/bubble-tail';
import { fontSizeClass } from '../../core/util/font-size';

export interface BubbleRepositionEvent {
  panel: Panel;
  bubbleX: number;
  bubbleY: number;
}
export interface TailRepositionEvent {
  panel: Panel;
  tailX: number;
  tailY: number;
}
export interface CaptionRepositionEvent {
  panel: Panel;
  captionX: number;
  captionY: number;
}

/** Matches the caption's fixed CSS default (left: 4%; top: 4%). */
const DEFAULT_CAPTION = { x: 4, y: 4 };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Renders a single composed comic page (layout + panels + speech bubbles) at a
 * 2:3 page ratio, using the shared global panel styles. Used for the live
 * preview while authoring a page. Panel images come from a resolved `thumbs`
 * map (panel id -> object URL).
 *
 * When `interactive` is set, each panel is a clickable target: clicking one
 * emits `panelSelect` and the `selectedId` panel is highlighted, so the editor
 * can show just that panel's fields (click-a-section-to-edit). Interactive mode
 * also lets the author drag a speech/thought bubble anywhere in its panel, and
 * drag its tail tip freely so it can point at whichever character is speaking.
 */
@Component({
  selector: 'app-page-preview',
  imports: [NgClass],
  template: `
    <div class="pp-frame">
      @if (page && page.panels?.length) {
        <div class="panel-grid" [ngClass]="'layout-' + (page.layout || 'splash') + ' ' + fontSizeClass(fontSize)">
          @for (panel of page.panels; track panel.id) {
            <figure class="panel"
                    [class.interactive]="interactive"
                    [class.is-selected]="interactive && panel.id === selectedId"
                    (click)="onSelect(panel.id)">
              @if (thumbs[panel.id]) {
                <img [src]="thumbs[panel.id]" alt="" />
              } @else {
                <div class="panel-empty">Panel {{ $index + 1 }}</div>
              }
              @if (panel.narration?.trim()) {
                <div class="caption" [class.custom-pos]="canDragCaption(panel)"
                     [style.left.%]="panel.captionX" [style.top.%]="panel.captionY"
                     [style.right]="panel.captionX != null ? 'auto' : null"
                     (pointerdown)="onCaptionDown($event, panel)">{{ panel.narration!.trim() }}</div>
              }
              @if (clean(panel.dialogue); as line) {
                <div class="bubble"
                     [class.thought]="panel.dialogueKind === 'thought'"
                     [class.narration]="panel.dialogueKind === 'narration'"
                     [class.custom-tail]="canDragTail(panel)"
                     [style.left.%]="panel.bubbleX"
                     [style.top.%]="panel.bubbleY"
                     [style.bottom]="panel.bubbleY != null ? 'auto' : null"
                     (pointerdown)="onBubbleDown($event, panel)">@if (panel.speaker?.trim()) {<span class="bubble-speaker">{{ panel.speaker!.trim() }}</span>}{{ line }}</div>
                @if (canDragTail(panel)) {
                  <svg class="tail-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <polygon [attr.points]="tailPoints(panel)"></polygon>
                  </svg>
                }
                @if (interactive && panel.dialogueKind !== 'narration') {
                  <div class="tail-handle"
                       [style.left.%]="panel.tailX ?? tailDefaults.x"
                       [style.top.%]="panel.tailY ?? tailDefaults.y"
                       (pointerdown)="onTailDown($event, panel)"></div>
                }
              }
            </figure>
          }
        </div>
      } @else {
        <div class="pp-empty faint">Nothing to preview yet</div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pp-frame {
      width: 100%;
      aspect-ratio: 2 / 3;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(22, 24, 31, 0.14);
      background: var(--card);
    }
    .pp-empty { height: 100%; display: grid; place-items: center; font-size: 0.9rem; }
    .panel.interactive { cursor: pointer; transition: outline-color 0.12s ease; outline: 2px solid transparent; outline-offset: -2px; }
    .panel.interactive:hover { outline-color: rgba(var(--accent-rgb), 0.45); }
    .panel.is-selected, .panel.is-selected.interactive:hover { outline-color: var(--accent); }
  `],
})
export class PagePreview {
  private zone = inject(NgZone);

  @Input() page: Page | null = null;
  @Input() thumbs: Record<string, string> = {};
  /** Bubble/caption text size for this page. */
  @Input() fontSize: BubbleFontSize = 'large';
  /** Enables click-to-select behaviour (used by the page editor). */
  @Input() interactive = false;
  /** Id of the panel currently being edited — gets the accent outline. */
  @Input() selectedId: string | null = null;
  /** Fires with a panel id when a panel is clicked (only when interactive). */
  @Output() panelSelect = new EventEmitter<string>();
  /** Fires once a bubble drag settles — the parent owns mutating + persisting. */
  @Output() bubbleReposition = new EventEmitter<BubbleRepositionEvent>();
  /** Fires once a tail-tip drag settles — the parent owns mutating + persisting. */
  @Output() tailReposition = new EventEmitter<TailRepositionEvent>();
  /** Fires once a caption drag settles — the parent owns mutating + persisting. */
  @Output() captionReposition = new EventEmitter<CaptionRepositionEvent>();

  readonly tailDefaults = DEFAULT_TAIL;
  readonly fontSizeClass = fontSizeClass;

  onSelect(id: string) {
    if (this.interactive) this.panelSelect.emit(id);
  }

  clean(d?: string): string {
    return cleanDialogue(d);
  }

  /** A custom (draggable) tail div replaces the fixed CSS tail once the panel
   *  is being edited, or once the author has actually customised it. */
  canDragTail(panel: Panel): boolean {
    return panel.dialogueKind !== 'narration' && (this.interactive || panel.tailX != null);
  }

  /** A custom (draggable) caption position replaces the fixed top banner once
   *  the panel is being edited, or once the author has actually moved it. */
  canDragCaption(panel: Panel): boolean {
    return this.interactive || panel.captionX != null;
  }

  tailPoints(panel: Panel): string {
    return tailWedgePoints(
      panel.bubbleX,
      panel.bubbleY,
      panel.tailX ?? this.tailDefaults.x,
      panel.tailY ?? this.tailDefaults.y,
    );
  }

  onBubbleDown(event: PointerEvent, panel: Panel) {
    if (!this.interactive || panel.dialogueKind === 'narration') return;
    event.preventDefault();
    const bubbleEl = event.currentTarget as HTMLElement;
    const panelEl = bubbleEl.closest('.panel') as HTMLElement | null;
    if (!panelEl) return;
    bubbleEl.setPointerCapture(event.pointerId);
    const polygonEl = panelEl.querySelector('.tail-svg polygon') as SVGPolygonElement | null;

    const panelRect = panelEl.getBoundingClientRect();
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const grabDxPct = ((event.clientX - bubbleRect.left) / panelRect.width) * 100;
    const grabDyPct = ((event.clientY - bubbleRect.top) / panelRect.height) * 100;

    let bubbleX = panel.bubbleX ?? DEFAULT_BUBBLE.x;
    let bubbleY = panel.bubbleY ?? DEFAULT_BUBBLE.y;

    const onMove = (e: PointerEvent) => {
      bubbleX = clamp(((e.clientX - panelRect.left) / panelRect.width) * 100 - grabDxPct, 3, 90);
      bubbleY = clamp(((e.clientY - panelRect.top) / panelRect.height) * 100 - grabDyPct, 3, 90);
      bubbleEl.style.left = bubbleX + '%';
      bubbleEl.style.top = bubbleY + '%';
      bubbleEl.style.bottom = 'auto';
      if (polygonEl) {
        const tailX = panel.tailX ?? DEFAULT_TAIL.x;
        const tailY = panel.tailY ?? DEFAULT_TAIL.y;
        polygonEl.setAttribute('points', tailWedgePoints(bubbleX, bubbleY, tailX, tailY));
      }
    };
    const finish = () => {
      bubbleEl.removeEventListener('pointermove', onMove);
      bubbleEl.removeEventListener('pointerup', finish);
      bubbleEl.removeEventListener('pointercancel', finish);
      bubbleEl.removeEventListener('lostpointercapture', finish);
      this.zone.run(() => this.bubbleReposition.emit({ panel, bubbleX, bubbleY }));
    };
    this.zone.runOutsideAngular(() => {
      bubbleEl.addEventListener('pointermove', onMove);
      bubbleEl.addEventListener('pointerup', finish);
      bubbleEl.addEventListener('pointercancel', finish);
      bubbleEl.addEventListener('lostpointercapture', finish);
    });
  }

  onTailDown(event: PointerEvent, panel: Panel) {
    if (!this.interactive || panel.dialogueKind === 'narration') return;
    event.preventDefault();
    const handleEl = event.currentTarget as HTMLElement;
    const panelEl = handleEl.closest('.panel') as HTMLElement | null;
    if (!panelEl) return;
    const polygonEl = panelEl.querySelector('.tail-svg polygon') as SVGPolygonElement | null;
    handleEl.setPointerCapture(event.pointerId);

    const panelRect = panelEl.getBoundingClientRect();
    const bubbleX = panel.bubbleX ?? DEFAULT_BUBBLE.x;
    const bubbleY = panel.bubbleY ?? DEFAULT_BUBBLE.y;
    let tailX = panel.tailX ?? DEFAULT_TAIL.x;
    let tailY = panel.tailY ?? DEFAULT_TAIL.y;

    const onMove = (e: PointerEvent) => {
      tailX = clamp(((e.clientX - panelRect.left) / panelRect.width) * 100, 0, 98);
      tailY = clamp(((e.clientY - panelRect.top) / panelRect.height) * 100, 0, 98);
      handleEl.style.left = tailX + '%';
      handleEl.style.top = tailY + '%';
      if (polygonEl) {
        polygonEl.setAttribute('points', tailWedgePoints(bubbleX, bubbleY, tailX, tailY));
      }
    };
    const finish = () => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', finish);
      handleEl.removeEventListener('pointercancel', finish);
      handleEl.removeEventListener('lostpointercapture', finish);
      this.zone.run(() => this.tailReposition.emit({ panel, tailX, tailY }));
    };
    this.zone.runOutsideAngular(() => {
      handleEl.addEventListener('pointermove', onMove);
      handleEl.addEventListener('pointerup', finish);
      handleEl.addEventListener('pointercancel', finish);
      handleEl.addEventListener('lostpointercapture', finish);
    });
  }

  onCaptionDown(event: PointerEvent, panel: Panel) {
    if (!this.interactive) return;
    event.preventDefault();
    const captionEl = event.currentTarget as HTMLElement;
    const panelEl = captionEl.closest('.panel') as HTMLElement | null;
    if (!panelEl) return;
    captionEl.setPointerCapture(event.pointerId);

    const panelRect = panelEl.getBoundingClientRect();
    const captionRect = captionEl.getBoundingClientRect();
    const grabDxPct = ((event.clientX - captionRect.left) / panelRect.width) * 100;
    const grabDyPct = ((event.clientY - captionRect.top) / panelRect.height) * 100;

    let captionX = panel.captionX ?? DEFAULT_CAPTION.x;
    let captionY = panel.captionY ?? DEFAULT_CAPTION.y;

    const onMove = (e: PointerEvent) => {
      captionX = clamp(((e.clientX - panelRect.left) / panelRect.width) * 100 - grabDxPct, 0, 85);
      captionY = clamp(((e.clientY - panelRect.top) / panelRect.height) * 100 - grabDyPct, 0, 92);
      captionEl.style.left = captionX + '%';
      captionEl.style.top = captionY + '%';
      captionEl.style.right = 'auto';
    };
    const finish = () => {
      captionEl.removeEventListener('pointermove', onMove);
      captionEl.removeEventListener('pointerup', finish);
      captionEl.removeEventListener('pointercancel', finish);
      captionEl.removeEventListener('lostpointercapture', finish);
      this.zone.run(() => this.captionReposition.emit({ panel, captionX, captionY }));
    };
    this.zone.runOutsideAngular(() => {
      captionEl.addEventListener('pointermove', onMove);
      captionEl.addEventListener('pointerup', finish);
      captionEl.addEventListener('pointercancel', finish);
      captionEl.addEventListener('lostpointercapture', finish);
    });
  }
}
