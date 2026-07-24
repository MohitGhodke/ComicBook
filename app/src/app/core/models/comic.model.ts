/**
 * Core domain model for the comic platform.
 *
 * Images are never stored inline on the book JSON. They are referenced by an
 * `ImageRef` and resolved to a displayable URL through the StorageService. This
 * is the single seam that lets local IndexedDB blobs (v1) be swapped for Azure
 * Blob Storage URLs later without touching any UI code.
 */

import type { StoryBible } from './story-bible.model';

export type ImageRefKind = 'local' | 'azure' | 'asset';

export interface ImageRef {
  /**
   * `local`  = key is an IndexedDB blob id (user-created content).
   * `azure`  = key is a blob URL (future remote storage).
   * `asset`  = key is a bundled static path, e.g. `seed/cover.png`.
   */
  kind: ImageRefKind;
  key: string;
}

export interface Character {
  id: string;
  name: string;
  /** Visual description — kept consistent so generated art stays cohesive. */
  appearance: string;
  /** Personality / role traits. */
  traits: string;
  /**
   * A locked "character reference" image (a clean portrait/turnaround). Each
   * panel prompt tells the author to attach this so the character keeps the
   * same face/design across every panel (Midjourney --cref, SD IP-Adapter).
   */
  referenceImageRef?: ImageRef;
}

/** A page's frame layout. `splash` = one full image (legacy/simple pages). */
export type LayoutId = 'splash' | 'strip3' | 'grid4' | 'feature3' | 'six';

/**
 * How a panel's line is lettered:
 *  - `speech`    — spoken aloud (speech bubble with a tail)
 *  - `thought`   — inner thought (thought bubble with trailing dots)
 *  - `narration` — a caption box (scene/time setting, e.g. "Later…")
 */
export type BubbleKind = 'speech' | 'thought' | 'narration';

/** Text size for every bubble/caption in a book — 'large' matches the original fixed size. */
export type BubbleFontSize = 'small' | 'medium' | 'large';

/** One frame of a comic page. The app draws the frame; the art is borderless. */
export interface Panel {
  id: string;
  /** What this panel depicts — feeds the image prompt. */
  description?: string;
  /** Clean spoken words for the speech bubble (no stage directions). */
  dialogue?: string;
  /** How the line is lettered (speech / thought / narration). Defaults to speech. */
  dialogueKind?: BubbleKind;
  /**
   * A narration/caption printed ON the panel (a box, not a bubble) — carries the
   * scene's premise, a time/place bridge, or context the art can't show. Coexists
   * with `dialogue` so a panel can have both a caption and a spoken line.
   */
  narration?: string;
  /** Custom caption position, top-left anchor as % of the panel. Unset = default (spans the top edge). */
  captionX?: number;
  captionY?: number;
  /** Who speaks `dialogue` (a cast name) — so it's clear who is talking. */
  speaker?: string;
  /** The panel artwork. Optional while being authored. */
  imageRef?: ImageRef;
  /** Static, copy-paste image prompt for this panel. */
  imagePrompt?: string;
  /** Custom bubble position, top-left anchor as % of the panel. Unset = default (left:7%; bottom:9%). */
  bubbleX?: number;
  bubbleY?: number;
  /**
   * Custom tail-tip position as % of the panel (where the tail points — e.g.
   * a character's mouth). Unset = default fixed pseudo-element tail. The
   * wedge connecting the bubble to this tip is derived at render time from
   * `bubbleX`/`bubbleY` + this point (see core/util/bubble-tail.ts), so the
   * tail always tracks the bubble even after it's dragged.
   */
  tailX?: number;
  tailY?: number;
  /** @deprecated no longer written — direction is derived from bubbleX/Y + tailX/Y at render time. Kept for reading older saved comics. */
  tailAngle?: number;
}

export interface Page {
  id: string;
  /** Frame layout for this page. Absent on legacy pages (treated as splash). */
  layout?: LayoutId;
  /** Ordered panels. Absent on legacy pages (migrated from the fields below). */
  panels?: Panel[];

  // ── Legacy single-image fields (pre-panels). Kept for back-compat and
  //    migrated to a one-panel splash by migratePage(). Do not write new. ──
  /** @deprecated legacy narration/caption. */
  caption?: string;
  /** @deprecated legacy dialogue. */
  dialogue?: string;
  /** @deprecated legacy full-page artwork. */
  imageRef?: ImageRef;
  /** @deprecated legacy image prompt. */
  imagePrompt?: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** How the characters meet / interact in this chapter (the scene beats). */
  synopsis: string;
  pages: Page[];
}

export interface ComicBook {
  id: string;
  title: string;
  /** The core message / theme the book communicates — the author's own words. */
  idea: string;
  /** The AI-refined premise / logline, kept separate so `idea` is never overwritten. */
  premise?: string;
  /** The story's world / place — anchors both prose and art so they don't drift. */
  setting?: string;
  /** The time period / era. */
  era?: string;
  /** Genre + mood the whole book carries. */
  tone?: string;
  author?: string;
  coverImageRef?: ImageRef;
  backCoverImageRef?: ImageRef;
  characters: Character[];
  chapters: Chapter[];
  /** Bundled sample books are read-only and cannot be edited/deleted. */
  readonly?: boolean;
  /** True while still being authored (shown on the shelf as a resumable draft). */
  draft?: boolean;
  /** Stable seed reused across every panel prompt so the book's art stays cohesive. */
  styleSeed?: number;
  /** Chosen art style id (see art-styles.ts). Every image prompt adapts to it. */
  styleId?: string;
  /** Text size for every bubble/caption in the book. Unset = 'large' (the original fixed size). */
  bubbleFontSize?: BubbleFontSize;
  createdAt: number;
  updatedAt: number;
  /**
   * The Story Bible — the single JSON source of truth this comic was generated
   * from (world → spine → locked cast → scenes → sections). When present, the
   * story was composed by the bible engine; the pages above are its projection.
   */
  bible?: StoryBible;
}

/** A resolved panel for the reader: displayable image URL + clean dialogue. */
export interface ReaderPanel {
  src: string;
  dialogue?: string;
  dialogueKind?: BubbleKind;
  /** Narration caption printed on the panel (coexists with dialogue). */
  narration?: string;
  /** Who speaks the dialogue line. */
  speaker?: string;
  bubbleX?: number;
  bubbleY?: number;
  tailX?: number;
  tailY?: number;
  tailAngle?: number;
  captionX?: number;
  captionY?: number;
}

/** A single spread page the Reader renders, flattened from a ComicBook. */
export interface ReaderPage {
  isCover: boolean;
  isBack: boolean;
  alt: string;
  /** Covers render this single image. */
  coverSrc?: string;
  /** Interior pages render this framed panel layout. */
  layout?: LayoutId;
  panels?: ReaderPanel[];
}
