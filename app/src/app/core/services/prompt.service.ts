import { Injectable } from '@angular/core';
import { Character, LayoutId, Panel } from '../models/comic.model';
import { characterRefStyleBlock, panelAspect, panelStyleBlock } from '../style/art-style';
import { ArtStyle } from '../style/art-styles';

/** The subset of book fields the image prompts need. */
interface PromptBook {
  characters: Character[];
  /** The chosen art style — the prompt's whole look adapts to this. */
  style: ArtStyle;
}

/**
 * Builds static, copy-paste image-generation prompts from the story inputs.
 *
 * This is a pure, deterministic string builder (no AI). Two products:
 *  - {@link buildCharacterPortraitPrompt}: the one-time character REFERENCE
 *    sheet the author generates per character and locks in.
 *  - {@link buildPanelPrompt}: the per-panel shot prompt, which references those
 *    locked character designs so the whole book stays visually consistent
 *    panel to panel.
 */
@Injectable({ providedIn: 'root' })
export class PromptService {
  /**
   * The one-time REFERENCE prompt for a single character. The author generates
   * this once and uploads the result as the character's locked reference; every
   * panel then points back to it so faces/designs stay identical.
   */
  buildCharacterPortraitPrompt(character: Pick<Character, 'name' | 'appearance'>, style: ArtStyle): string {
    const lines: string[] = [];
    const name = character.name?.trim() || 'the character';
    lines.push(`Character reference sheet for ${name}.`);
    if (character.appearance?.trim()) {
      lines.push(`${name} looks like this: ${character.appearance.trim()}`);
    }
    lines.push('');
    lines.push(characterRefStyleBlock(style));
    return lines.join('\n');
  }

  /**
   * A copy-paste image prompt for ONE panel.
   *
   * KEY PRINCIPLES:
   *  - An image model draws a single FRAME, not a story — so this prompt
   *    describes only what's visible in this one panel, never the plot.
   *  - Consistency comes from LOCKED character references: for each character in
   *    the shot we restate their exact appearance and, if a reference image
   *    exists, tell the author to attach it (--cref / IP-Adapter). A shared seed
   *    ties the whole book's look together.
   *
   * No dialogue/text is baked in — the app renders the speech bubble.
   */
  buildPanelPrompt(
    book: PromptBook,
    panel: Pick<Panel, 'description'>,
    layout: LayoutId | undefined,
    index: number,
  ): string {
    const lines: string[] = [];

    // Lead with the shot itself — this is what the model must actually draw.
    const shot = panel.description?.trim();
    lines.push(
      shot
        ? `A single comic panel. Depict exactly this moment, and nothing else: ${shot}`
        : 'A single comic panel illustration.',
    );

    // Which characters are actually in this shot? Match names against the
    // description; if none match, fall back to the whole cast as a look-up.
    const present = this.charactersInShot(book.characters, shot);
    if (present.length) {
      lines.push('');
      lines.push('Keep these characters EXACTLY like their established design — same face, hair, build and clothing:');
      for (const c of present) {
        lines.push(`- ${c.name.trim()}: ${c.appearance!.trim()}`);
      }
    }

    lines.push('');
    lines.push(panelStyleBlock(book.style, panelAspect(layout, index)));
    return lines.join('\n');
  }

  /**
   * Characters whose name appears in the shot description (word-boundary match).
   * Falls back to every described character when the shot names none, so the
   * prompt still carries the cast as a consistency reference.
   */
  private charactersInShot(characters: Character[], shot: string | undefined): Character[] {
    const cast = (characters || []).filter((c) => c.name?.trim() && c.appearance?.trim());
    if (!shot) return cast;
    const hay = shot.toLowerCase();
    const named = cast.filter((c) => {
      const first = c.name.trim().split(/\s+/)[0].toLowerCase();
      return hay.includes(c.name.trim().toLowerCase()) || (first.length >= 3 && hay.includes(first));
    });
    return named.length ? named : cast;
  }
}
