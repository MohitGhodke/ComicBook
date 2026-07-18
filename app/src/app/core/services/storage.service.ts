import { ComicBook, ImageRef } from '../models/comic.model';

/**
 * Persistence seam for the whole app.
 *
 * v1 is implemented by `LocalStorageService` (IndexedDB). A future
 * `AzureBlobService` can implement the same contract — `putImage` uploads to a
 * container and returns an `azure` ImageRef, `resolveUrl` returns the blob URL —
 * with no changes required anywhere in the UI.
 */
export abstract class StorageService {
  abstract listBooks(): Promise<ComicBook[]>;
  abstract getBook(id: string): Promise<ComicBook | undefined>;
  abstract saveBook(book: ComicBook): Promise<void>;
  abstract deleteBook(id: string): Promise<void>;

  /** Persist an image blob and return a reference to it. */
  abstract putImage(blob: Blob): Promise<ImageRef>;

  /** Turn an ImageRef into a URL usable directly in an <img src>. */
  abstract resolveUrl(ref: ImageRef): Promise<string>;

  /** Remove a stored image. No-op for refs this store doesn't own (asset/azure). */
  abstract deleteImage(ref: ImageRef): Promise<void>;
}
