import { Injectable, inject } from '@angular/core';
import { ComicBook, ReaderPage } from '../models/comic.model';
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

  /** All books: bundled samples first, then the user's, newest-updated first. */
  async getAll(): Promise<ComicBook[]> {
    const user = await this.storage.listBooks();
    return [...this.seeds, ...user];
  }

  /** Only the user's editable books (used as add-chapter targets). */
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

  /** Every image reference a book holds (cover, back cover, and all pages). */
  private imageRefs(book: ComicBook) {
    const refs = [];
    if (book.coverImageRef) refs.push(book.coverImageRef);
    if (book.backCoverImageRef) refs.push(book.backCoverImageRef);
    for (const chapter of book.chapters) {
      for (const page of chapter.pages) {
        if (page.imageRef) refs.push(page.imageRef);
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
   * ReaderPages. Pages without artwork yet are skipped so the flipbook always
   * gets valid image sources.
   */
  async toReaderPages(book: ComicBook): Promise<ReaderPage[]> {
    const out: ReaderPage[] = [];

    if (book.coverImageRef) {
      out.push({
        src: await this.storage.resolveUrl(book.coverImageRef),
        alt: book.title,
        isCover: true,
        isBack: false,
      });
    }

    let n = 0;
    for (const chapter of book.chapters) {
      for (const page of chapter.pages) {
        if (!page.imageRef) continue;
        n++;
        out.push({
          src: await this.storage.resolveUrl(page.imageRef),
          alt: page.caption || `Page ${n}`,
          isCover: false,
          isBack: false,
        });
      }
    }

    if (book.backCoverImageRef) {
      out.push({
        src: await this.storage.resolveUrl(book.backCoverImageRef),
        alt: 'Back cover',
        isCover: true,
        isBack: true,
      });
    }

    return out;
  }
}
