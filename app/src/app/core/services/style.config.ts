import { Injectable, signal } from '@angular/core';
import { DEFAULT_STYLE_ID } from '../style/art-styles';

const STYLE_KEY = 'comic-studio-default-style';

/**
 * App-wide default art style for NEW comics, persisted to localStorage and set
 * from the Settings page. Each comic captures this into its own metadata at
 * creation (`ComicBook.styleId`), so changing it later never rewrites old books.
 */
@Injectable({ providedIn: 'root' })
export class StyleConfig {
  /** Signal so the Settings UI reflects changes immediately. */
  readonly defaultStyleId = signal<string>(localStorage.getItem(STYLE_KEY) || DEFAULT_STYLE_ID);

  setDefaultStyle(id: string) {
    localStorage.setItem(STYLE_KEY, id);
    this.defaultStyleId.set(id);
  }
}
