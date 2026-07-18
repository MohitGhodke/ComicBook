import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';
import { Page } from '../../core/models/comic.model';
import { cleanDialogue } from '../../core/util/text';

/**
 * Renders a single composed comic page (layout + panels + speech bubbles) at a
 * 2:3 page ratio, using the shared global panel styles. Used for the live
 * preview while authoring a page. Panel images come from a resolved `thumbs`
 * map (panel id -> object URL).
 *
 * When `interactive` is set, each panel is a clickable target: clicking one
 * emits `panelSelect` and the `selectedId` panel is highlighted, so the editor
 * can show just that panel's fields (click-a-section-to-edit).
 */
@Component({
  selector: 'app-page-preview',
  imports: [NgClass],
  template: `
    <div class="pp-frame">
      @if (page && page.panels?.length) {
        <div class="panel-grid" [ngClass]="'layout-' + (page.layout || 'splash')">
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
              @if (clean(panel.dialogue); as line) {
                <div class="bubble"
                     [class.thought]="panel.dialogueKind === 'thought'"
                     [class.narration]="panel.dialogueKind === 'narration'">{{ line }}</div>
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
  @Input() page: Page | null = null;
  @Input() thumbs: Record<string, string> = {};
  /** Enables click-to-select behaviour (used by the page editor). */
  @Input() interactive = false;
  /** Id of the panel currently being edited — gets the accent outline. */
  @Input() selectedId: string | null = null;
  /** Fires with a panel id when a panel is clicked (only when interactive). */
  @Output() panelSelect = new EventEmitter<string>();

  onSelect(id: string) {
    if (this.interactive) this.panelSelect.emit(id);
  }

  clean(d?: string): string {
    return cleanDialogue(d);
  }
}
