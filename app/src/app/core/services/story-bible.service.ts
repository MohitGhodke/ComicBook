import { Injectable, inject } from '@angular/core';
import { ReaderPage } from '../models/comic.model';
import { StoryBible } from '../models/story-bible.model';
import { timestamp } from '../util/time';
import { StorageService } from './storage.service';
import { bibleImageRefs, projectBibleToReaderPages } from './story-bible.projection';

/**
 * App-facing library for Story Bibles — the source-of-truth model.
 *
 * Owns persistence (through {@link StorageService}), the projection into the
 * Reader's page list, and image cleanup on delete. This is the Bible-era
 * counterpart to {@link ComicLibraryService}; as the wizard/reader/shelf move
 * onto Bibles (see STORY_ENGINE_PLAN.md), the old service is retired.
 */
@Injectable({ providedIn: 'root' })
export class StoryBibleService {
  private storage = inject(StorageService);

  /** The user's Bibles, newest first. */
  list(): Promise<StoryBible[]> {
    return this.storage.listBibles();
  }

  get(id: string): Promise<StoryBible | undefined> {
    return this.storage.getBible(id);
  }

  /** Persist, stamping `updatedAt` so the shelf ordering stays fresh. */
  save(bible: StoryBible): Promise<void> {
    bible.updatedAt = timestamp();
    return this.storage.saveBible(bible);
  }

  /** Delete a Bible and clean up every image blob it owns. */
  async delete(id: string): Promise<void> {
    const bible = await this.storage.getBible(id);
    if (bible) {
      for (const ref of bibleImageRefs(bible)) {
        await this.storage.deleteImage(ref);
      }
    }
    await this.storage.deleteBible(id);
  }

  /** Flatten a Bible into resolved Reader pages (cover → scenes → back cover). */
  toReaderPages(bible: StoryBible): Promise<ReaderPage[]> {
    return projectBibleToReaderPages(bible, (ref) => this.storage.resolveUrl(ref));
  }

  /** Count of scenes that will render as interior pages. */
  sceneCount(bible: StoryBible): number {
    return bible.scenes.length;
  }
}
