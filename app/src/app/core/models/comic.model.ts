/**
 * Core domain model for the comic platform.
 *
 * Images are never stored inline on the book JSON. They are referenced by an
 * `ImageRef` and resolved to a displayable URL through the StorageService. This
 * is the single seam that lets local IndexedDB blobs (v1) be swapped for Azure
 * Blob Storage URLs later without touching any UI code.
 */

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
}

export interface Page {
  id: string;
  /** Narration/caption text for the panel. */
  caption?: string;
  /** Spoken dialogue for the panel. */
  dialogue?: string;
  /** The page artwork. Optional while the page is still being authored. */
  imageRef?: ImageRef;
  /** Static, copy-paste prompt generated from the story inputs (manual v1). */
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
  /** The core message / theme the book communicates. */
  idea: string;
  author?: string;
  coverImageRef?: ImageRef;
  backCoverImageRef?: ImageRef;
  characters: Character[];
  chapters: Chapter[];
  /** Bundled sample books are read-only and cannot be edited/deleted. */
  readonly?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A single spread page the Reader renders, flattened from a ComicBook. */
export interface ReaderPage {
  /** Resolved, displayable image URL. */
  src: string;
  alt: string;
  isCover: boolean;
  isBack: boolean;
}
