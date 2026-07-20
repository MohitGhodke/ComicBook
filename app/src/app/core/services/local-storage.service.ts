import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';
import { ComicBook, ImageRef } from '../models/comic.model';
import { StoryBible } from '../models/story-bible.model';
import { StorageService } from './storage.service';

const DB_NAME = 'comicbook';
const DB_VERSION = 2;
const BOOKS = 'books';
const BIBLES = 'bibles';
const IMAGES = 'images';

/**
 * IndexedDB-backed implementation of {@link StorageService}.
 *
 * Books are stored as plain JSON in the `books` store; image blobs live in the
 * `images` store keyed by a generated id. Resolved object URLs are cached so we
 * don't leak a new URL on every render.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageService extends StorageService {
  private dbPromise: Promise<IDBPDatabase> | null = null;
  private urlCache = new Map<string, string>();
  private imageSeq = 0;

  private db(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          // Idempotent: each store is created only if missing, so the same
          // callback safely covers a fresh install and any version step.
          if (!db.objectStoreNames.contains(BOOKS)) {
            db.createObjectStore(BOOKS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(BIBLES)) {
            db.createObjectStore(BIBLES, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(IMAGES)) {
            db.createObjectStore(IMAGES);
          }
        },
      });
    }
    return this.dbPromise;
  }

  async listBooks(): Promise<ComicBook[]> {
    const db = await this.db();
    const books = (await db.getAll(BOOKS)) as ComicBook[];
    return books.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getBook(id: string): Promise<ComicBook | undefined> {
    const db = await this.db();
    return (await db.get(BOOKS, id)) as ComicBook | undefined;
  }

  async saveBook(book: ComicBook): Promise<void> {
    const db = await this.db();
    await db.put(BOOKS, book);
  }

  async deleteBook(id: string): Promise<void> {
    const db = await this.db();
    await db.delete(BOOKS, id);
  }

  async listBibles(): Promise<StoryBible[]> {
    const db = await this.db();
    const bibles = (await db.getAll(BIBLES)) as StoryBible[];
    return bibles.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getBible(id: string): Promise<StoryBible | undefined> {
    const db = await this.db();
    return (await db.get(BIBLES, id)) as StoryBible | undefined;
  }

  async saveBible(bible: StoryBible): Promise<void> {
    const db = await this.db();
    await db.put(BIBLES, bible);
  }

  async deleteBible(id: string): Promise<void> {
    const db = await this.db();
    await db.delete(BIBLES, id);
  }

  async putImage(blob: Blob): Promise<ImageRef> {
    const db = await this.db();
    // Time-free unique key (Date.now is unavailable in some sandboxes; a
    // monotonic counter + random-free suffix is enough for local keys).
    const key = `img_${this.imageSeq++}_${(await db.count(IMAGES))}`;
    await db.put(IMAGES, blob, key);
    return { kind: 'local', key };
  }

  async resolveUrl(ref: ImageRef): Promise<string> {
    // Azure refs are already displayable URLs; asset refs are bundled paths.
    if (ref.kind === 'azure' || ref.kind === 'asset') return ref.key;

    const cached = this.urlCache.get(ref.key);
    if (cached) return cached;

    const db = await this.db();
    const blob = (await db.get(IMAGES, ref.key)) as Blob | undefined;
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    this.urlCache.set(ref.key, url);
    return url;
  }

  async deleteImage(ref: ImageRef): Promise<void> {
    // Only local blobs are owned by this store; asset/azure refs are external.
    if (ref.kind !== 'local') return;
    const cached = this.urlCache.get(ref.key);
    if (cached) {
      URL.revokeObjectURL(cached);
      this.urlCache.delete(ref.key);
    }
    const db = await this.db();
    await db.delete(IMAGES, ref.key);
  }
}
