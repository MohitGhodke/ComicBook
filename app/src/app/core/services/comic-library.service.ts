import { Injectable, inject } from '@angular/core';
import { ComicBook, ReaderPage, ReaderPanel } from '../models/comic.model';
import { migratePage } from '../models/layout';
import { cleanDialogue } from '../util/text';
import { SEED_COMIC } from '../seed/seed-comic';
import { StorageService } from './storage.service';

/**
 * App-facing library of comics. Merges the read-only bundled sample(s) with the
 * user's own books (persisted through {@link StorageService}) and flattens a
 * book into the ordered page list the Reader consumes.
 */
@Injectable({ providedIn: 'root' })
export class ComicLibraryService {
  private storage = inject(StorageService);

  private readonly seeds: ComicBook[] = [SEED_COMIC];

  /** All books (drafts included): user's newest first, samples last. */
  async getAll(): Promise<ComicBook[]> {
    const user = await this.storage.listBooks();
    return [...user, ...this.seeds];
  }

  /** Only the user's editable books. */
  async getUserBooks(): Promise<ComicBook[]> {
    return this.storage.listBooks();
  }

  async get(id: string): Promise<ComicBook | undefined> {
    const seed = this.seeds.find((b) => b.id === id);
    if (seed) return seed;
    return this.storage.getBook(id);
  }

  async save(book: ComicBook): Promise<void> {
    await this.storage.saveBook(book);
  }

  /** Delete a book and clean up every image blob it owns. Seeds are protected. */
  async delete(id: string): Promise<void> {
    const book = await this.storage.getBook(id);
    if (book) {
      for (const ref of this.imageRefs(book)) {
        await this.storage.deleteImage(ref);
      }
    }
    await this.storage.deleteBook(id);
  }

  /** Every image reference a book holds (cover, back cover, and all panels). */
  private imageRefs(book: ComicBook) {
    const refs = [];
    if (book.coverImageRef) refs.push(book.coverImageRef);
    if (book.backCoverImageRef) refs.push(book.backCoverImageRef);
    for (const c of book.characters ?? []) {
      if (c.referenceImageRef) refs.push(c.referenceImageRef);
    }
    for (const chapter of book.chapters) {
      for (const page of chapter.pages) {
        if (page.imageRef) refs.push(page.imageRef); // legacy
        for (const panel of page.panels ?? []) {
          if (panel.imageRef) refs.push(panel.imageRef);
        }
      }
    }
    return refs;
  }

  /** Count of renderable interior pages (excludes covers). */
  pageCount(book: ComicBook): number {
    return book.chapters.reduce((sum, c) => sum + c.pages.length, 0);
  }

  /**
   * Flatten cover -> every chapter's pages -> back cover into resolved
   * ReaderPages. A page is included once it has at least one panel with
   * artwork; panels without art are skipped so the layout only shows real
   * frames.
   */
  async toReaderPages(book: ComicBook): Promise<ReaderPage[]> {
    const out: ReaderPage[] = [];

    if (book.coverImageRef) {
      out.push({
        isCover: true,
        isBack: false,
        alt: book.title,
        coverSrc: await this.storage.resolveUrl(book.coverImageRef),
      });
    }

    let n = 0;
    for (const chapter of book.chapters) {
      for (const raw of chapter.pages) {
        const page = migratePage(raw);
        const panels: ReaderPanel[] = [];
        for (const panel of page.panels ?? []) {
          if (!panel.imageRef) continue;
          panels.push({
            src: await this.storage.resolveUrl(panel.imageRef),
            dialogue: cleanDialogue(panel.dialogue),
            dialogueKind: panel.dialogueKind ?? 'speech',
            bubbleX: panel.bubbleX,
            bubbleY: panel.bubbleY,
            tailX: panel.tailX,
            tailY: panel.tailY,
            tailAngle: panel.tailAngle,
          });
        }
        if (panels.length === 0) continue; // nothing to render yet
        n++;
        out.push({
          isCover: false,
          isBack: false,
          alt: `Page ${n}`,
          layout: page.layout,
          panels,
        });
      }
    }

    if (book.backCoverImageRef) {
      out.push({
        isCover: true,
        isBack: true,
        alt: 'Back cover',
        coverSrc: await this.storage.resolveUrl(book.backCoverImageRef),
      });
    }

    return out;
  }
}
