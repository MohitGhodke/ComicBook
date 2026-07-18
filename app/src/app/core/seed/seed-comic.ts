import { ComicBook, Page } from '../models/comic.model';

/**
 * The original 46-page comic, migrated in as a read-only bundled sample so the
 * Shelf and Reader are demonstrable from a fresh install. Artwork lives in
 * `public/seed/` and is referenced via `asset` image refs.
 */
function interiorPages(): Page[] {
  const pages: Page[] = [];
  for (let i = 1; i <= 46; i++) {
    const n = String(i).padStart(2, '0');
    pages.push({
      id: `seed-page-${n}`,
      imageRef: { kind: 'asset', key: `seed/page-${n}.png` },
    });
  }
  return pages;
}

export const SEED_COMIC: ComicBook = {
  id: 'seed-edlevo',
  title: 'Edlevo Comic',
  idea: 'The original Edlevo comic book — the sample that ships with the app.',
  author: 'Edlevo',
  readonly: true,
  coverImageRef: { kind: 'asset', key: 'seed/cover.png' },
  backCoverImageRef: { kind: 'asset', key: 'seed/back-cover.png' },
  characters: [],
  chapters: [
    {
      id: 'seed-chapter-1',
      title: 'Chapter 1',
      synopsis: '',
      pages: interiorPages(),
    },
  ],
  createdAt: 0,
  updatedAt: 0,
};
