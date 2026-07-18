import { Component, inject, signal, computed, WritableSignal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Reader } from '../reader/reader';
import { ComicLibraryService } from '../../core/services/comic-library.service';
import { StorageService } from '../../core/services/storage.service';
import { PromptService } from '../../core/services/prompt.service';
import { ComicAssistant, StoryContext, SuggestedCharacter, SuggestedPage } from '../../core/services/ai/comic-assistant';
import { AiConfig } from '../../core/services/ai/ai.config';
import { ComicBook, Character, Chapter, Page, ReaderPage } from '../../core/models/comic.model';
import { newId } from '../../core/util/id';
import { Draft, loadDraft, saveDraft, clearDraft, emptyDraft } from './draft';

interface StepDef {
  key: string;
  label: string;
  title: string;
  teach: string;
}

type AssembleMode = 'new' | 'existing';

@Component({
  selector: 'app-creator',
  imports: [FormsModule, Reader],
  templateUrl: './creator.html',
  styleUrl: './creator.scss',
})
export class Creator implements OnInit {
  private router = inject(Router);
  private library = inject(ComicLibraryService);
  private storage = inject(StorageService);
  private prompts = inject(PromptService);
  private assistant = inject(ComicAssistant);
  private aiConfig = inject(AiConfig);

  readonly steps: StepDef[] = [
    { key: 'idea', label: 'Idea', title: 'What is your comic about?',
      teach: 'Every comic starts with one clear idea — the message or feeling you want a reader to walk away with. Name the book and describe that idea in a sentence or two.' },
    { key: 'characters', label: 'Characters', title: 'Who is in your story?',
      teach: 'Readers connect with characters. Describe how each one looks and what they are like. Consistent descriptions keep the artwork coherent across pages.' },
    { key: 'interactions', label: 'Interactions', title: 'What happens between them?',
      teach: 'A story is characters colliding — meeting, disagreeing, helping, changing. Sketch the beats of this chapter: how the characters interact, scene by scene.' },
    { key: 'pages', label: 'Pages', title: 'Build your pages',
      teach: 'Turn the story into pages. For each page write the caption and dialogue, then add art — upload an image, or copy a ready-made prompt to generate one in your favourite tool.' },
    { key: 'assemble', label: 'Assemble', title: 'Assemble & publish',
      teach: 'Start a brand-new book, or add this as a new chapter to a book you already made. Preview the flipbook, then publish it to your shelf.' },
  ];

  draft: Draft = emptyDraft();
  readonly step = signal(0);

  // Assemble step state
  readonly assembleMode = signal<AssembleMode>('new');
  readonly userBooks = signal<ComicBook[]>([]);
  targetBookId = '';

  // Thumbnails + preview
  readonly thumbs = signal<Record<string, string>>({});
  coverThumb = '';
  readonly previewing = signal(false);
  readonly previewPages = signal<ReaderPage[]>([]);
  readonly publishing = signal(false);
  readonly copiedPageId = signal<string | null>(null);

  // On-device AI assist
  readonly aiAvailable = signal(false);
  readonly aiModels = signal<string[]>([]);
  readonly aiError = signal<string | null>(null);
  private aiAbort: AbortController | null = null;

  // Per-step AI state
  readonly ideaLoading = signal(false);
  readonly ideaSuggestion = signal<string | null>(null);

  readonly charLoading = signal(false);
  readonly charSuggestions = signal<SuggestedCharacter[] | null>(null);

  readonly beatsLoading = signal(false);
  readonly beatsSuggestion = signal<string | null>(null);

  readonly storyLoading = signal(false);
  readonly storySuggestions = signal<SuggestedPage[] | null>(null);
  storyboardCount = 6;

  readonly coverLoading = signal(false);
  readonly coverPromptText = signal<string | null>(null);
  readonly coverCopied = signal(false);

  readonly current = computed(() => this.steps[this.step()]);
  readonly isLast = computed(() => this.step() === this.steps.length - 1);
  readonly isFirst = computed(() => this.step() === 0);

  async ngOnInit() {
    this.draft = loadDraft();
    await this.refreshThumbs();
    this.userBooks.set(await this.library.getUserBooks());
    this.probeAi();
  }

  // ── On-device AI ───────────────────────────────────────────────────────────
  get aiModel(): string {
    return this.aiConfig.model;
  }
  set aiModel(v: string) {
    this.aiConfig.model = v;
  }

  private async probeAi() {
    try {
      const models = await this.assistant.listModels();
      this.aiModels.set(models);
      this.aiAvailable.set(models.length > 0);
      if (!this.aiConfig.model && models[0]) this.aiConfig.model = models[0];
    } catch {
      this.aiAvailable.set(false);
    }
  }

  /** The story so far, fed into every AI task so the steps stay connected. */
  private storyContext(): StoryContext {
    return {
      idea: this.draft.idea,
      characters: this.draft.characters.map((c) => ({ name: c.name, appearance: c.appearance, traits: c.traits })),
      synopsis: this.draft.synopsis,
    };
  }

  /** Run an AI task with shared loading/error/abort handling. */
  private async run<T>(loading: WritableSignal<boolean>, fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
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

  cancelAi() {
    this.aiAbort?.abort();
  }

  // Step 1 — Idea
  async shapeIdea() {
    if (!this.draft.idea.trim()) return;
    this.ideaSuggestion.set(null);
    const shaped = await this.run(this.ideaLoading, (s) => this.assistant.shapeIdea(this.draft.idea, s));
    if (shaped !== null) this.ideaSuggestion.set(shaped || '(the model returned nothing — try again)');
  }
  acceptIdea() {
    const s = this.ideaSuggestion();
    if (s) { this.draft.idea = s; this.persist(); }
    this.ideaSuggestion.set(null);
  }
  dismissIdea() { this.ideaSuggestion.set(null); }

  // Step 2 — Characters
  async suggestCharacters() {
    if (!this.draft.idea.trim()) return;
    this.charSuggestions.set(null);
    const list = await this.run(this.charLoading, (s) => this.assistant.suggestCharacters(this.storyContext(), s));
    if (list !== null) this.charSuggestions.set(list);
  }
  addSuggestedCharacter(c: SuggestedCharacter) {
    this.draft.characters.push({ id: newId('char'), name: c.name, appearance: c.appearance, traits: c.traits });
    this.charSuggestions.update((list) => (list ? list.filter((x) => x !== c) : list));
    this.persist();
  }
  addAllCharacters() {
    for (const c of this.charSuggestions() ?? []) {
      this.draft.characters.push({ id: newId('char'), name: c.name, appearance: c.appearance, traits: c.traits });
    }
    this.charSuggestions.set(null);
    this.persist();
  }
  dismissCharacters() { this.charSuggestions.set(null); }

  // Step 3 — Interactions
  async draftInteractions() {
    this.beatsSuggestion.set(null);
    const beats = await this.run(this.beatsLoading, (s) => this.assistant.draftInteractions(this.storyContext(), s));
    if (beats !== null) this.beatsSuggestion.set(beats || '(the model returned nothing — try again)');
  }
  acceptBeats() {
    const s = this.beatsSuggestion();
    if (s) { this.draft.synopsis = s; this.persist(); }
    this.beatsSuggestion.set(null);
  }
  dismissBeats() { this.beatsSuggestion.set(null); }

  // Step 4 — Pages (storyboard)
  async storyboard() {
    this.storySuggestions.set(null);
    const count = Math.min(Math.max(this.storyboardCount || 6, 1), 12);
    const pages = await this.run(this.storyLoading, (s) => this.assistant.storyboardPages(this.storyContext(), count, s));
    if (pages !== null) this.storySuggestions.set(pages);
  }
  addStoryboardPages() {
    for (const p of this.storySuggestions() ?? []) {
      this.draft.pages.push({ id: newId('page'), caption: p.caption, dialogue: p.dialogue });
    }
    this.storySuggestions.set(null);
    this.persist();
  }
  dismissStoryboard() { this.storySuggestions.set(null); }

  // Step 5 — Cover image prompt
  async generateCoverPrompt() {
    if (!this.draft.idea.trim()) return;
    this.coverCopied.set(false);
    this.coverPromptText.set(null);
    const prompt = await this.run(this.coverLoading, (s) =>
      this.assistant.coverPrompt(this.storyContext(), this.draft.title, 'front', s),
    );
    if (prompt !== null) {
      this.coverPromptText.set(prompt || '(the model returned nothing — try again)');
      this.copyCoverPrompt();
    }
  }
  async copyCoverPrompt() {
    const text = this.coverPromptText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.coverCopied.set(true);
      setTimeout(() => this.coverCopied.set(false), 1800);
    } catch { /* clipboard blocked — text is still shown for manual copy */ }
  }
  dismissCoverPrompt() { this.coverPromptText.set(null); }

  // ── Draft persistence ──────────────────────────────────────────────────────
  persist() {
    saveDraft(this.draft);
  }

  private async refreshThumbs() {
    const map: Record<string, string> = {};
    for (const page of this.draft.pages) {
      if (page.imageRef) map[page.id] = await this.storage.resolveUrl(page.imageRef);
    }
    this.thumbs.set(map);
    this.coverThumb = this.draft.coverImageRef ? await this.storage.resolveUrl(this.draft.coverImageRef) : '';
  }

  // ── Stepper ────────────────────────────────────────────────────────────────
  canAdvance(): boolean {
    switch (this.steps[this.step()].key) {
      case 'idea': return this.draft.title.trim().length > 0 && this.draft.idea.trim().length > 0;
      case 'pages': return this.draft.pages.some((p) => !!p.imageRef);
      default: return true;
    }
  }

  next() {
    if (!this.canAdvance() || this.isLast()) return;
    this.step.update((s) => Math.min(s + 1, this.steps.length - 1));
    this.persist();
  }
  back() {
    if (this.isFirst()) { this.exit(); return; }
    this.step.update((s) => Math.max(s - 1, 0));
  }
  goToStep(i: number) {
    if (i <= this.step()) this.step.set(i);
  }
  exit() {
    this.router.navigate(['/']);
  }

  // ── Characters ─────────────────────────────────────────────────────────────
  addCharacter() {
    this.draft.characters.push({ id: newId('char'), name: '', appearance: '', traits: '' });
    this.persist();
  }
  removeCharacter(c: Character) {
    this.draft.characters = this.draft.characters.filter((x) => x.id !== c.id);
    this.persist();
  }

  // ── Pages ──────────────────────────────────────────────────────────────────
  addPage() {
    this.draft.pages.push({ id: newId('page'), caption: '', dialogue: '' });
    this.persist();
  }
  removePage(p: Page) {
    this.draft.pages = this.draft.pages.filter((x) => x.id !== p.id);
    this.persist();
  }
  movePage(p: Page, dir: -1 | 1) {
    const i = this.draft.pages.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.draft.pages.length) return;
    const arr = this.draft.pages;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.persist();
  }

  async onPageImage(event: Event, page: Page) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    page.imageRef = await this.storage.putImage(file);
    this.persist();
    await this.refreshThumbs();
  }

  async onCoverImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.draft.coverImageRef = await this.storage.putImage(file);
    this.persist();
    await this.refreshThumbs();
  }

  async copyPrompt(page: Page) {
    const prompt = this.prompts.buildPagePrompt(
      { idea: this.draft.idea, characters: this.draft.characters },
      { synopsis: this.draft.synopsis },
      { caption: page.caption, dialogue: page.dialogue },
    );
    page.imagePrompt = prompt;
    this.persist();
    try {
      await navigator.clipboard.writeText(prompt);
    } catch { /* clipboard blocked — prompt is still stored on the page */ }
    this.copiedPageId.set(page.id);
    setTimeout(() => { if (this.copiedPageId() === page.id) this.copiedPageId.set(null); }, 1800);
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  async openPreview() {
    const book = this.buildBookForPreview();
    this.previewPages.set(await this.library.toReaderPages(book));
    this.previewing.set(true);
  }
  closePreview() {
    this.previewing.set(false);
  }

  private buildBookForPreview(): ComicBook {
    const chapter = this.buildChapter();
    return {
      id: 'preview',
      title: this.draft.title || 'Untitled',
      idea: this.draft.idea,
      author: this.draft.author,
      coverImageRef: this.draft.coverImageRef,
      characters: this.draft.characters,
      chapters: [chapter],
      createdAt: 0,
      updatedAt: 0,
    };
  }

  private buildChapter(): Chapter {
    return {
      id: newId('chapter'),
      title: this.draft.title || 'Chapter',
      synopsis: this.draft.synopsis,
      pages: this.draft.pages.filter((p) => !!p.imageRef),
    };
  }

  // ── Publish ────────────────────────────────────────────────────────────────
  canPublish(): boolean {
    if (!this.draft.pages.some((p) => !!p.imageRef)) return false;
    if (this.assembleMode() === 'new') return this.draft.title.trim().length > 0;
    return !!this.targetBookId;
  }

  async publish() {
    if (!this.canPublish() || this.publishing()) return;
    this.publishing.set(true);
    const now = timestamp();
    const chapter = this.buildChapter();

    if (this.assembleMode() === 'new') {
      const book: ComicBook = {
        id: newId('book'),
        title: this.draft.title.trim(),
        idea: this.draft.idea.trim(),
        author: this.draft.author.trim() || undefined,
        coverImageRef: this.draft.coverImageRef ?? chapter.pages[0]?.imageRef,
        characters: this.draft.characters,
        chapters: [chapter],
        createdAt: now,
        updatedAt: now,
      };
      await this.library.save(book);
      this.finish(book.id);
    } else {
      const target = await this.library.get(this.targetBookId);
      if (!target || target.readonly) { this.publishing.set(false); return; }
      // Merge any newly described characters into the existing book.
      const known = new Set(target.characters.map((c) => c.name.trim().toLowerCase()));
      for (const c of this.draft.characters) {
        if (c.name.trim() && !known.has(c.name.trim().toLowerCase())) target.characters.push(c);
      }
      target.chapters.push(chapter);
      target.updatedAt = now;
      await this.library.save(target);
      this.finish(target.id);
    }
  }

  private finish(bookId: string) {
    clearDraft();
    this.router.navigate(['/read', bookId]);
  }

  onModeChange(mode: AssembleMode) {
    this.assembleMode.set(mode);
  }
}

/** localStorage draft uses no timestamps; stamp only at publish time. */
function timestamp(): number {
  return Date.now();
}
