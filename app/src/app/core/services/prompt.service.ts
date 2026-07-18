import { Injectable } from '@angular/core';
import { Character, Chapter, ComicBook, Page } from '../models/comic.model';

/**
 * Builds a static, copy-paste image-generation prompt from the story inputs.
 *
 * This is deliberately a pure, deterministic string builder for v1 (no AI). The
 * same seam can later delegate to an AI image API — the callers won't change.
 */
@Injectable({ providedIn: 'root' })
export class PromptService {
  buildPagePrompt(
    book: Pick<ComicBook, 'idea' | 'characters'>,
    chapter: Pick<Chapter, 'synopsis'>,
    page: Pick<Page, 'caption' | 'dialogue'>,
  ): string {
    const lines: string[] = [];
    lines.push('Comic book panel, clean line art, consistent character design, dynamic composition.');

    if (book.idea?.trim()) {
      lines.push(`Theme: ${book.idea.trim()}`);
    }

    const cast = this.describeCast(book.characters);
    if (cast) lines.push(`Characters: ${cast}`);

    if (chapter.synopsis?.trim()) {
      lines.push(`Scene: ${chapter.synopsis.trim()}`);
    }
    if (page.caption?.trim()) {
      lines.push(`Moment: ${page.caption.trim()}`);
    }
    if (page.dialogue?.trim()) {
      lines.push(`Dialogue in a speech bubble: "${page.dialogue.trim()}"`);
    }

    lines.push('Portrait orientation, single panel, no watermark, no page numbers.');
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
