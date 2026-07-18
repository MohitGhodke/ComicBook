import { Injectable } from '@angular/core';
import { Character, Chapter, ComicBook, Page } from '../models/comic.model';
import { styleBlock } from '../style/art-style';

/**
 * Builds a static, copy-paste image-generation prompt from the story inputs.
 *
 * This is deliberately a pure, deterministic string builder for v1 (no AI). The
 * same seam can later delegate to an AI image API — the callers won't change.
 * Every prompt ends with the shared style bible ({@link styleBlock}) so all
 * pages across all books share one aspect ratio and look.
 */
@Injectable({ providedIn: 'root' })
export class PromptService {
  buildPagePrompt(
    book: Pick<ComicBook, 'idea' | 'characters'>,
    chapter: Pick<Chapter, 'synopsis'>,
    page: Pick<Page, 'caption' | 'dialogue'>,
  ): string {
    const lines: string[] = [];
    lines.push('A single full-page comic book illustration.');

    if (book.idea?.trim()) {
      lines.push(`Story theme: ${book.idea.trim()}`);
    }

    const cast = this.describeCast(book.characters);
    if (cast) lines.push(`Characters (keep their look identical on every page): ${cast}`);

    if (chapter.synopsis?.trim()) {
      lines.push(`Scene: ${chapter.synopsis.trim()}`);
    }
    if (page.caption?.trim()) {
      lines.push(`This page depicts: ${page.caption.trim()}`);
    }
    if (page.dialogue?.trim()) {
      lines.push(`Include a hand-lettered speech bubble reading: "${page.dialogue.trim()}"`);
    }

    lines.push('');
    lines.push(styleBlock());
    return lines.join('\n');
  }

  private describeCast(characters: Character[]): string {
    return (characters || [])
      .filter((c) => c.name?.trim())
      .map((c) => {
        const parts = [c.name.trim()];
        if (c.appearance?.trim()) parts.push(c.appearance.trim());
        if (c.traits?.trim()) parts.push(c.traits.trim());
        return parts.join(' — ');
      })
      .join('; ');
  }
}
