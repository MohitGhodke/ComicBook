import { Injectable, signal } from '@angular/core';
import { BubbleFontSize } from '../models/comic.model';

const DEFAULT_KEY = 'comic-studio-default-font-size';
const READER_KEY = 'comic-studio-reader-font-size';

const VALID: BubbleFontSize[] = ['small', 'medium', 'large'];
function readSize(key: string): BubbleFontSize | null {
  const v = localStorage.getItem(key);
  return (VALID as string[]).includes(v ?? '') ? (v as BubbleFontSize) : null;
}

/**
 * Bubble/caption text size, persisted to localStorage. Two independent knobs:
 *  - `defaultForNewBooks` — set from Settings, captured into a new comic's own
 *    `bubbleFontSize` at creation (so the author never has to think about it).
 *  - `readerOverride` — set from the Reader itself; 'auto' defers to whatever
 *    the book/author chose, so a reader can bump text up without touching the
 *    author's saved choice.
 */
@Injectable({ providedIn: 'root' })
export class FontSizeConfig {
  readonly defaultForNewBooks = signal<BubbleFontSize>(readSize(DEFAULT_KEY) ?? 'large');
  readonly readerOverride = signal<BubbleFontSize | 'auto'>(
    (localStorage.getItem(READER_KEY) as BubbleFontSize | 'auto' | null) ?? 'auto',
  );

  setDefaultForNewBooks(size: BubbleFontSize) {
    localStorage.setItem(DEFAULT_KEY, size);
    this.defaultForNewBooks.set(size);
  }

  setReaderOverride(size: BubbleFontSize | 'auto') {
    localStorage.setItem(READER_KEY, size);
    this.readerOverride.set(size);
  }
}
