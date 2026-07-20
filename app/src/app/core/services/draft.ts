import { BubbleFontSize, Character, ImageRef, Page } from '../models/comic.model';
import { DEFAULT_STYLE_ID } from '../style/art-styles';

/**
 * The wizard's in-memory working shape for one comic. It's a flat, single-chapter
 * view (title, idea, characters, one page list) that maps to/from a ComicBook.
 * Comics — including unfinished drafts — are persisted as real books in storage
 * (draft: true), each with its own id; there is no shared localStorage draft.
 */
export interface Draft {
  title: string;
  idea: string;
  /** The story's world / place (optional — feeds every generation for coherence). */
  setting: string;
  /** The time period / era. */
  era: string;
  /** Genre + mood. */
  tone: string;
  author: string;
  characters: Character[];
  /** The interactions / scene beats — becomes the chapter synopsis. */
  synopsis: string;
  coverImageRef?: ImageRef;
  backCoverImageRef?: ImageRef;
  pages: Page[];
  /** Stable seed reused in every panel prompt so the book's art stays cohesive. */
  styleSeed: number;
  /** Chosen art style id — captured into the book's metadata. */
  styleId: string;
  /** Bubble/caption text size for the whole book — captured from Settings at creation. */
  bubbleFontSize: BubbleFontSize;
}

/** A fresh, book-stable style seed (5 digits — easy to paste into image tools). */
export function newStyleSeed(): number {
  return Math.floor(10000 + Math.random() * 90000);
}

export function emptyDraft(): Draft {
  return {
    title: '', idea: '', setting: '', era: '', tone: '', author: '', characters: [], synopsis: '', pages: [],
    styleSeed: newStyleSeed(), styleId: DEFAULT_STYLE_ID, bubbleFontSize: 'large',
  };
}

/** True once the draft has anything worth saving to the shelf. */
export function draftHasContent(d: Draft): boolean {
  return !!(d.title?.trim() || d.idea?.trim() || d.characters?.length || d.pages?.length);
}
