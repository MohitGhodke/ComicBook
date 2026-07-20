import { ImageRef, ReaderPage, ReaderPanel } from '../models/comic.model';
import { StoryBible } from '../models/story-bible.model';
import { cleanDialogue } from '../util/text';

/** Resolves an ImageRef to a displayable URL (injected so this stays storage-free). */
export type ResolveUrl = (ref: ImageRef) => Promise<string>;

/**
 * Project a Story Bible into the ordered ReaderPage list the flipbook consumes:
 * front cover → each scene (as a page) → back cover. Scenes/sections are the
 * source of truth; a section renders only once it has artwork, and a scene with
 * no rendered sections is skipped — matching how the reader treats empty frames.
 *
 * Pure but for the injected `resolveUrl`, so it can be unit-tested with a stub.
 */
export async function projectBibleToReaderPages(
  bible: StoryBible,
  resolveUrl: ResolveUrl,
): Promise<ReaderPage[]> {
  const out: ReaderPage[] = [];

  if (bible.coverImageRef) {
    out.push({
      isCover: true,
      isBack: false,
      alt: bible.title.value,
      coverSrc: await resolveUrl(bible.coverImageRef),
    });
  }

  let pageNo = 0;
  for (const scene of bible.scenes) {
    const panels: ReaderPanel[] = [];
    for (const section of scene.sections) {
      if (!section.imageRef) continue; // nothing to draw yet
      panels.push({
        src: await resolveUrl(section.imageRef),
        dialogue: cleanDialogue(section.line.value),
        dialogueKind: section.dialogueKind ?? 'speech',
        narration: section.narration?.value,
        speaker: section.speaker?.value,
        bubbleX: section.bubbleX,
        bubbleY: section.bubbleY,
        tailX: section.tailX,
        tailY: section.tailY,
        tailAngle: section.tailAngle,
      });
    }
    if (panels.length === 0) continue;
    pageNo++;
    out.push({
      isCover: false,
      isBack: false,
      alt: `Page ${pageNo}`,
      layout: scene.layout,
      panels,
    });
  }

  if (bible.backCoverImageRef) {
    out.push({
      isCover: true,
      isBack: true,
      alt: 'Back cover',
      coverSrc: await resolveUrl(bible.backCoverImageRef),
    });
  }

  return out;
}

/** Every image ref a Bible owns (covers, character refs, and all section art). */
export function bibleImageRefs(bible: StoryBible): ImageRef[] {
  const refs: ImageRef[] = [];
  if (bible.coverImageRef) refs.push(bible.coverImageRef);
  if (bible.backCoverImageRef) refs.push(bible.backCoverImageRef);
  for (const c of bible.characters) if (c.referenceImageRef) refs.push(c.referenceImageRef);
  for (const scene of bible.scenes) {
    for (const section of scene.sections) if (section.imageRef) refs.push(section.imageRef);
  }
  return refs;
}
