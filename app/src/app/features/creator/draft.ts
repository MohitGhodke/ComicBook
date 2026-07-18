import { Character, ImageRef, Page } from '../../core/models/comic.model';

/**
 * The in-progress comic being authored by the wizard. Only serializable data is
 * kept here — image blobs live in storage and are referenced via ImageRef — so
 * the whole draft can be JSON-persisted to localStorage for crash-safe resume.
 */
export interface Draft {
  title: string;
  idea: string;
  author: string;
  characters: Character[];
  /** The interactions / scene beats — becomes the chapter synopsis. */
  synopsis: string;
  coverImageRef?: ImageRef;
  pages: Page[];
}

export const DRAFT_KEY = 'comic-studio-draft';

export function emptyDraft(): Draft {
  return {
    title: '',
    idea: '',
    author: '',
    characters: [],
    synopsis: '',
    pages: [],
  };
}

export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Draft) };
  } catch { /* ignore corrupt draft */ }
  return emptyDraft();
}

export function saveDraft(draft: Draft): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* quota */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}
