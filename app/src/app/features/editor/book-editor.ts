import { Component, inject, signal, computed, WritableSignal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Reader } from '../reader/reader';
import { ComicLibraryService } from '../../core/services/comic-library.service';
import { StorageService } from '../../core/services/storage.service';
import { PromptService } from '../../core/services/prompt.service';
import { ComicAssistant, StoryContext, SuggestedCharacter, SuggestedPage } from '../../core/services/ai/comic-assistant';
import { ComicBook, Chapter, Page, Character, ImageRef, ReaderPage } from '../../core/models/comic.model';
import { newId } from '../../core/util/id';

interface ReviewItem {
  level: 'warn' | 'tip';
  text: string;
  anchor: string;
}

@Component({
  selector: 'app-book-editor',
  imports: [FormsModule, Reader],
  templateUrl: './book-editor.html',
  styleUrl: './book-editor.scss',
})
export class BookEditor implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private library = inject(ComicLibraryService);
  private storage = inject(StorageService);
  private prompts = inject(PromptService);
  private assistant = inject(ComicAssistant);

  book: ComicBook | null = null;
  readonly ready = signal(false);
  readonly notFound = signal(false);
  readonly isReadonly = signal(false);

  // Resolved image URLs
  readonly thumbs = signal<Record<string, string>>({});
  coverThumb = '';
  backThumb = '';
  readonly copiedPageId = signal<string | null>(null);

  // AI shared
  readonly aiAvailable = signal(false);
  readonly aiError = signal<string | null>(null);
  private aiAbort: AbortController | null = null;

  // AI per-feature
  readonly ideaLoading = signal(false);
  readonly ideaSuggestion = signal<string | null>(null);
  readonly charLoading = signal(false);
  readonly charSuggestions = signal<SuggestedCharacter[] | null>(null);
  readonly charProgress = signal<{ done: number; total: number } | null>(null);
  readonly frontCoverLoading = signal(false);
  readonly frontCoverPrompt = signal<string | null>(null);
  readonly frontCoverCopied = signal(false);
  readonly backCoverLoading = signal(false);
  readonly backCoverPrompt = signal<string | null>(null);
  readonly backCoverCopied = signal(false);
  readonly beatsLoading = signal(false);
  readonly beatsSuggestion = signal<{ chapterId: string; text: string } | null>(null);
  readonly storyLoading = signal(false);
  readonly storySuggestions = signal<{ chapterId: string; pages: SuggestedPage[] } | null>(null);
  readonly storyProgress = signal<{ done: number; total: number } | null>(null);
  storyboardCount = 4;

  // Review
  readonly reviewLoading = signal(false);
  readonly reviewItems = signal<ReviewItem[] | null>(null);
  readonly aiSuggestions = signal<string[] | null>(null);
  readonly highlight = signal<string | null>(null);

  // Preview
  readonly previewing = signal(false);
  readonly previewPages = signal<ReaderPage[]>([]);

  readonly totalPages = computed(() => this.book?.chapters.reduce((n, c) => n + c.pages.length, 0) ?? 0);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    const book = await this.library.get(id);
    if (!book) { this.notFound.set(true); this.ready.set(true); return; }
    if (book.readonly) { this.isReadonly.set(true); this.ready.set(true); return; }
    // Work on a clone; autosave commits changes back.
    this.book = structuredClone(book);
    await this.refreshThumbs();
    this.ready.set(true);
    this.probeAi();
  }

  // ── Persistence ──────────────────────────────────────────────────────────────
  async save() {
    if (!this.book) return;
    this.book.updatedAt = Date.now();
    await this.library.save(this.book);
  }

  private async refreshThumbs() {
    if (!this.book) return;
    const map: Record<string, string> = {};
    for (const ch of this.book.chapters) {
      for (const p of ch.pages) {
        if (p.imageRef) map[p.id] = await this.storage.resolveUrl(p.imageRef);
      }
    }
    this.thumbs.set(map);
    this.coverThumb = this.book.coverImageRef ? await this.storage.resolveUrl(this.book.coverImageRef) : '';
    this.backThumb = this.book.backCoverImageRef ? await this.storage.resolveUrl(this.book.backCoverImageRef) : '';
  }

  private async putReplacing(oldRef: ImageRef | undefined, file: Blob): Promise<ImageRef> {
    if (oldRef?.kind === 'local') await this.storage.deleteImage(oldRef);
    return this.storage.putImage(file);
  }

  // ── Details ──────────────────────────────────────────────────────────────────
  onDetailChange() { this.save(); }

  // ── Cover ────────────────────────────────────────────────────────────────────
  async onCoverImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.book) return;
    this.book.coverImageRef = await this.putReplacing(this.book.coverImageRef, file);
    await this.save();
    await this.refreshThumbs();
  }
  async removeCover() {
    if (!this.book?.coverImageRef) return;
    await this.storage.deleteImage(this.book.coverImageRef);
    this.book.coverImageRef = undefined;
    this.coverThumb = '';
    await this.save();
  }
  async onBackImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.book) return;
    this.book.backCoverImageRef = await this.putReplacing(this.book.backCoverImageRef, file);
    await this.save();
    await this.refreshThumbs();
  }
  async removeBack() {
    if (!this.book?.backCoverImageRef) return;
    await this.storage.deleteImage(this.book.backCoverImageRef);
    this.book.backCoverImageRef = undefined;
    this.backThumb = '';
    await this.save();
  }

  // ── Characters ───────────────────────────────────────────────────────────────
  addCharacter() {
    this.book?.characters.push({ id: newId('char'), name: '', appearance: '', traits: '' });
    this.save();
  }
  removeCharacter(c: Character) {
    if (!this.book) return;
    this.book.characters = this.book.characters.filter((x) => x.id !== c.id);
    this.save();
  }

  // ── Chapters & pages ─────────────────────────────────────────────────────────
  addChapter() {
    if (!this.book) return;
    this.book.chapters.push({ id: newId('chapter'), title: `Chapter ${this.book.chapters.length + 1}`, synopsis: '', pages: [] });
    this.save();
  }
  async removeChapter(ch: Chapter) {
    if (!this.book) return;
    if (!confirm(`Delete "${ch.title}" and its ${ch.pages.length} page(s)?`)) return;
    for (const p of ch.pages) if (p.imageRef) await this.storage.deleteImage(p.imageRef);
    this.book.chapters = this.book.chapters.filter((x) => x.id !== ch.id);
    await this.save();
  }

  addPage(ch: Chapter) {
    ch.pages.push({ id: newId('page'), caption: '', dialogue: '' });
    this.save();
  }
  async removePage(ch: Chapter, p: Page) {
    if (p.imageRef) await this.storage.deleteImage(p.imageRef);
    ch.pages = ch.pages.filter((x) => x.id !== p.id);
    await this.save();
  }
  movePage(ch: Chapter, p: Page, dir: -1 | 1) {
    const i = ch.pages.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ch.pages.length) return;
    [ch.pages[i], ch.pages[j]] = [ch.pages[j], ch.pages[i]];
    this.save();
  }
  async onPageImage(event: Event, p: Page) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    p.imageRef = await this.putReplacing(p.imageRef, file);
    await this.save();
    await this.refreshThumbs();
  }
  async copyPrompt(ch: Chapter, p: Page) {
    if (!this.book) return;
    const prompt = this.prompts.buildPagePrompt(
      { idea: this.book.idea, characters: this.book.characters },
      { synopsis: ch.synopsis },
      { caption: p.caption, dialogue: p.dialogue },
    );
    p.imagePrompt = prompt;
    await this.save();
    try { await navigator.clipboard.writeText(prompt); } catch { /* blocked */ }
    this.copiedPageId.set(p.id);
    setTimeout(() => { if (this.copiedPageId() === p.id) this.copiedPageId.set(null); }, 1800);
  }

  // ── AI plumbing ──────────────────────────────────────────────────────────────
  private storyContext(): StoryContext {
    return {
      idea: this.book?.idea ?? '',
      characters: this.book?.characters.map((c) => ({ name: c.name, appearance: c.appearance, traits: c.traits })) ?? [],
      synopsis: this.book?.chapters.map((c) => c.synopsis).filter(Boolean).join('\n') ?? '',
    };
  }
  private async probeAi() {
    try { this.aiAvailable.set(await this.assistant.isAvailable()); } catch { this.aiAvailable.set(false); }
  }
  private async run<T>(loading: WritableSignal<boolean>, fn: (s: AbortSignal) => Promise<T>): Promise<T | null> {
    if (loading()) return null;
    this.aiError.set(null);
    loading.set(true);
    this.aiAbort = new AbortController();
    try {
      return await fn(this.aiAbort.signal);
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      this.aiError.set(
        e instanceof TypeError
          ? 'Could not reach the local model. Is your server running?'
          : e?.message || 'Something went wrong talking to the model.',
      );
      return null;
    } finally {
      loading.set(false);
      this.aiAbort = null;
    }
  }
  cancelAi() { this.aiAbort?.abort(); }

  async shapeIdea() {
    if (!this.book?.idea.trim()) return;
    this.ideaSuggestion.set(null);
    const shaped = await this.run(this.ideaLoading, (s) => this.assistant.shapeIdea(this.book!.idea, s));
    if (shaped !== null) this.ideaSuggestion.set(shaped.logline || '(nothing returned — try again)');
  }
  acceptIdea() { const s = this.ideaSuggestion(); if (s && this.book) { this.book.idea = s; this.save(); } this.ideaSuggestion.set(null); }
  dismissIdea() { this.ideaSuggestion.set(null); }

  async suggestCharacters() {
    this.charSuggestions.set(null);
    this.charProgress.set(null);
    const list = await this.run(this.charLoading, (s) =>
      this.assistant.suggestCharacters(
        this.storyContext(),
        (done, total, latest) => {
          this.charProgress.set({ done, total });
          this.charSuggestions.update((cur) => [...(cur ?? []), latest]);
        },
        s,
      ),
    );
    this.charProgress.set(null);
    if (list !== null && this.charSuggestions() === null) this.charSuggestions.set(list);
  }
  addSuggestedCharacter(c: SuggestedCharacter) {
    this.book?.characters.push({ id: newId('char'), name: c.name, appearance: c.appearance, traits: c.traits });
    this.charSuggestions.update((l) => (l ? l.filter((x) => x !== c) : l));
    this.save();
  }
  addAllCharacters() {
    for (const c of this.charSuggestions() ?? []) {
      this.book?.characters.push({ id: newId('char'), name: c.name, appearance: c.appearance, traits: c.traits });
    }
    this.charSuggestions.set(null);
    this.save();
  }
  dismissCharacters() { this.charSuggestions.set(null); }

  async generateCoverPrompt(side: 'front' | 'back') {
    if (!this.book?.idea.trim()) return;
    const loading = side === 'front' ? this.frontCoverLoading : this.backCoverLoading;
    const text = side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt;
    const copied = side === 'front' ? this.frontCoverCopied : this.backCoverCopied;
    copied.set(false);
    text.set(null);
    const prompt = await this.run(loading, (s) => this.assistant.coverPrompt(this.storyContext(), this.book!.title, side, s));
    if (prompt !== null) {
      text.set(prompt || '(nothing returned — try again)');
      this.writeClipboard(prompt, copied);
    }
  }
  async copyCoverPrompt(side: 'front' | 'back') {
    const text = side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt;
    const copied = side === 'front' ? this.frontCoverCopied : this.backCoverCopied;
    const t = text();
    if (t) this.writeClipboard(t, copied);
  }
  dismissCoverPrompt(side: 'front' | 'back') {
    (side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt).set(null);
  }
  private async writeClipboard(t: string, copied: WritableSignal<boolean>) {
    try { await navigator.clipboard.writeText(t); copied.set(true); setTimeout(() => copied.set(false), 1800); } catch { /* blocked */ }
  }

  async draftBeats(ch: Chapter) {
    this.beatsSuggestion.set(null);
    const beats = await this.run(this.beatsLoading, (s) => this.assistant.draftInteractions(this.storyContext(), s));
    if (beats !== null) this.beatsSuggestion.set({ chapterId: ch.id, text: beats || '(nothing returned — try again)' });
  }
  acceptBeats(ch: Chapter) { const b = this.beatsSuggestion(); if (b?.chapterId === ch.id) { ch.synopsis = b.text; this.save(); } this.beatsSuggestion.set(null); }
  dismissBeats() { this.beatsSuggestion.set(null); }

  async storyboard(ch: Chapter) {
    this.storySuggestions.set(null);
    this.storyProgress.set(null);
    const count = Math.min(Math.max(this.storyboardCount || 4, 1), 12);
    const pages = await this.run(this.storyLoading, (s) =>
      this.assistant.storyboardPages(
        this.storyContext(),
        count,
        (done, total, latest) => {
          this.storyProgress.set({ done, total });
          this.storySuggestions.update((cur) => {
            const existing = cur?.chapterId === ch.id ? cur.pages : [];
            return { chapterId: ch.id, pages: [...existing, latest] };
          });
        },
        s,
      ),
    );
    this.storyProgress.set(null);
    if (pages !== null && this.storySuggestions() === null) this.storySuggestions.set({ chapterId: ch.id, pages });
  }
  addStoryboard(ch: Chapter) {
    const sb = this.storySuggestions();
    if (sb?.chapterId === ch.id) {
      for (const p of sb.pages) ch.pages.push({ id: newId('page'), caption: p.caption, dialogue: p.dialogue });
      this.save();
    }
    this.storySuggestions.set(null);
  }
  dismissStoryboard() { this.storySuggestions.set(null); }

  // ── Review ("what's missing / what to improve") ──────────────────────────────
  async runReview() {
    if (!this.book) return;
    this.reviewItems.set(this.checklist());
    this.aiSuggestions.set(null);
    if (this.aiAvailable()) {
      const stats = this.statsLine();
      const list = await this.run(this.reviewLoading, (s) => this.assistant.reviewComic(this.storyContext(), stats, s));
      if (list !== null) this.aiSuggestions.set(list);
    }
  }

  private statsLine(): string {
    const pages = this.allPages();
    const withArt = pages.filter((p) => p.imageRef).length;
    return `${pages.length} page(s) across ${this.book!.chapters.length} chapter(s); ${withArt} have artwork; front cover: ${this.book!.coverImageRef ? 'yes' : 'no'}.`;
  }

  private allPages(): Page[] {
    return this.book ? this.book.chapters.flatMap((c) => c.pages) : [];
  }

  private checklist(): ReviewItem[] {
    const b = this.book!;
    const items: ReviewItem[] = [];
    const pages = this.allPages();
    if (!b.coverImageRef) items.push({ level: 'warn', text: 'No front cover yet — add one so your comic looks finished on the shelf.', anchor: 'sec-cover' });
    if (b.idea.trim().length < 15) items.push({ level: 'tip', text: 'Your big idea is thin — expand it into one clear premise.', anchor: 'sec-details' });
    if (b.characters.length === 0) items.push({ level: 'tip', text: 'No characters described — add at least one so the art stays consistent.', anchor: 'sec-characters' });
    if (pages.length === 0) items.push({ level: 'warn', text: 'This comic has no pages yet — add some.', anchor: 'sec-chapters' });
    const noArt = pages.length - pages.filter((p) => p.imageRef).length;
    if (noArt > 0) items.push({ level: 'warn', text: `${noArt} page(s) have no artwork yet — upload or generate art.`, anchor: 'sec-chapters' });
    const noText = pages.filter((p) => !p.caption?.trim() && !p.dialogue?.trim()).length;
    if (noText > 0) items.push({ level: 'tip', text: `${noText} page(s) have no caption or dialogue.`, anchor: 'sec-chapters' });
    for (const ch of b.chapters) {
      if (!ch.synopsis.trim()) { items.push({ level: 'tip', text: `"${ch.title}" has no scene beats — sketch what happens.`, anchor: 'sec-chapters' }); break; }
    }
    if (!b.backCoverImageRef) items.push({ level: 'tip', text: 'Optional: add a back cover to round the book off.', anchor: 'sec-cover' });
    return items;
  }

  jumpTo(anchor: string) {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlight.set(anchor);
    setTimeout(() => { if (this.highlight() === anchor) this.highlight.set(null); }, 1400);
  }

  // ── Preview / exit ───────────────────────────────────────────────────────────
  async openPreview() {
    if (!this.book) return;
    this.previewPages.set(await this.library.toReaderPages(this.book));
    this.previewing.set(true);
  }
  closePreview() { this.previewing.set(false); }
  exit() { this.router.navigate(['/']); }
  read() { if (this.book) this.router.navigate(['/read', this.book.id]); }
}
