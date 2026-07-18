import { Component, inject, signal, computed, WritableSignal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Reader } from '../reader/reader';
import { PagePreview } from '../shared/page-preview';
import { ComicLibraryService } from '../../core/services/comic-library.service';
import { StorageService } from '../../core/services/storage.service';
import { PromptService } from '../../core/services/prompt.service';
import { ComicAssistant, StoryContext, SuggestedCharacter, SuggestedPage, ShapedIdea } from '../../core/services/ai/comic-assistant';
import { AiConfig } from '../../core/services/ai/ai.config';
import { ComicBook, Character, Chapter, Page, Panel, ImageRef, LayoutId, ReaderPage, BubbleKind } from '../../core/models/comic.model';
import { LAYOUTS, newPanel, applyLayout, migratePage } from '../../core/models/layout';
import { newId } from '../../core/util/id';
import { cleanDialogue } from '../../core/util/text';
import { Draft, emptyDraft, draftHasContent, newStyleSeed } from '../../core/services/draft';
import { StyleConfig } from '../../core/services/style.config';
import { ART_STYLES, artStyleById } from '../../core/style/art-styles';

type CoverSide = 'front' | 'back';
// (multi-book "add as chapter" was removed — every comic is its own book, edited in place)

interface StepDef {
  key: string;
  label: string;
  title: string;
  teach: string;
}

type AssembleMode = 'new' | 'existing';

@Component({
  selector: 'app-creator',
  imports: [FormsModule, RouterLink, Reader, PagePreview],
  templateUrl: './creator.html',
  styleUrl: './creator.scss',
})
export class Creator implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private library = inject(ComicLibraryService);
  private storage = inject(StorageService);
  private prompts = inject(PromptService);
  private assistant = inject(ComicAssistant);
  private aiConfig = inject(AiConfig);
  private styleConfig = inject(StyleConfig);

  /** All selectable art styles + the one this comic uses. */
  readonly artStyles = ART_STYLES;
  private style() { return artStyleById(this.draft.styleId); }

  /** The book being authored — always a real storage id (draft or finished). */
  bookId = '';
  /** True while it's still a draft; false once finished / when editing a book. */
  readonly isDraftBook = signal(true);
  readonly isEditing = computed(() => !this.isDraftBook());
  private createdAt = 0;

  readonly steps: StepDef[] = [
    { key: 'idea', label: 'Idea', title: 'Start with your idea',
      teach: 'Begin with the idea — the message or feeling you want a reader to walk away with. Don\'t worry about the title yet: write your idea, then let AI refine it and suggest a good name for the book.' },
    { key: 'characters', label: 'Characters', title: 'Who is in your story?',
      teach: 'Readers connect with characters. Describe how each one looks and what they are like. Consistent descriptions keep the artwork coherent across pages.' },
    { key: 'interactions', label: 'Interactions', title: 'What happens between them?',
      teach: 'A story is characters colliding — meeting, disagreeing, helping, changing. Sketch the beats of this chapter: how the characters interact, scene by scene.' },
    { key: 'pages', label: 'Pages', title: 'Build your pages',
      teach: 'Turn the story into pages. For each page write the caption and dialogue, then add art — upload an image, or copy a ready-made prompt to generate one in your favourite tool.' },
    { key: 'assemble', label: 'Finish', title: 'Cover & finish',
      teach: 'Add a front and back cover (optional), preview the flipbook, then save it to your shelf.' },
  ];

  draft: Draft = emptyDraft();
  readonly step = signal(0);

  // Thumbnails + preview
  readonly thumbs = signal<Record<string, string>>({});
  coverThumb = '';
  backThumb = '';
  readonly previewing = signal(false);
  readonly previewPages = signal<ReaderPage[]>([]);
  readonly publishing = signal(false);
  readonly copiedPanelId = signal<string | null>(null);
  readonly copiedCharId = signal<string | null>(null);
  readonly layouts = LAYOUTS;
  readonly defaultLayout: LayoutId = 'strip3';
  /** Index of the page being edited in the page-at-a-time Pages step. */
  readonly pageIndex = signal(0);

  // On-device AI assist
  readonly aiAvailable = signal(false);
  readonly aiModels = signal<string[]>([]);
  readonly aiError = signal<string | null>(null);
  private aiAbort: AbortController | null = null;

  // Per-step AI state
  readonly ideaLoading = signal(false);
  readonly ideaSuggestion = signal<ShapedIdea | null>(null);

  readonly charLoading = signal(false);
  readonly charSuggestions = signal<SuggestedCharacter[] | null>(null);
  readonly charProgress = signal<{ done: number; total: number } | null>(null);

  readonly beatsLoading = signal(false);
  readonly beatsSuggestion = signal<string | null>(null);

  readonly storyLoading = signal(false);
  readonly storySuggestions = signal<SuggestedPage[] | null>(null);
  readonly storyProgress = signal<{ done: number; total: number } | null>(null);
  storyboardCount = 6;

  readonly frontCoverLoading = signal(false);
  readonly frontCoverPrompt = signal<string | null>(null);
  readonly frontCoverCopied = signal(false);
  readonly backCoverLoading = signal(false);
  readonly backCoverPrompt = signal<string | null>(null);
  readonly backCoverCopied = signal(false);

  readonly current = computed(() => this.steps[this.step()]);
  readonly isLast = computed(() => this.step() === this.steps.length - 1);
  readonly isFirst = computed(() => this.step() === 0);

  async ngOnInit() {
    const paramId = this.route.snapshot.paramMap.get('bookId');
    if (paramId) {
      const book = await this.library.get(paramId);
      if (!book || book.readonly) { this.router.navigate(['/']); return; }
      this.loadBook(book); // resume/edit an existing book or draft
    } else {
      // Fresh comic: a brand-new draft book with its own id — clean slate.
      this.bookId = newId('book');
      this.isDraftBook.set(true);
      this.createdAt = timestamp();
      this.draft = emptyDraft();
      this.draft.styleId = this.styleConfig.defaultStyleId(); // capture the current default
    }
    await this.refreshThumbs();
    this.probeAi();
  }

  /** Load an existing book into the wizard's working draft. */
  private loadBook(book: ComicBook) {
    this.bookId = book.id;
    this.isDraftBook.set(book.draft ?? false);
    this.createdAt = book.createdAt;
    this.draft = {
      title: book.title,
      idea: book.idea ?? '',
      author: book.author ?? '',
      characters: book.characters ?? [],
      // All chapters' scene beats + pages are edited as one flat sequence.
      synopsis: book.chapters.map((c) => c.synopsis).filter((s) => s?.trim()).join('\n\n'),
      coverImageRef: book.coverImageRef,
      backCoverImageRef: book.backCoverImageRef,
      pages: book.chapters.flatMap((c) => c.pages).map(migratePage),
      // Older books have no seed — assign one now so their art can be cohesive.
      styleSeed: book.styleSeed ?? newStyleSeed(),
      styleId: book.styleId ?? this.styleConfig.defaultStyleId(),
    };
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

  // Step 1 — Idea (entry point; AI refines the idea and suggests a title)
  async shapeIdea() {
    if (!this.draft.idea.trim()) return;
    this.ideaSuggestion.set(null);
    const shaped = await this.run(this.ideaLoading, (s) => this.assistant.shapeIdea(this.draft.idea, s));
    if (shaped !== null) this.ideaSuggestion.set(shaped);
  }
  acceptIdea() {
    const s = this.ideaSuggestion();
    if (s) {
      if (s.logline) this.draft.idea = s.logline;
      if (s.title) this.draft.title = s.title;
      this.persist();
    }
    this.ideaSuggestion.set(null);
  }
  dismissIdea() { this.ideaSuggestion.set(null); }

  // Step 2 — Characters
  async suggestCharacters() {
    if (!this.draft.idea.trim()) return;
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
    // Empty plan → show the "nothing usable" card; partials from a cancel stay.
    if (list !== null && this.charSuggestions() === null) this.charSuggestions.set(list);
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
    this.storyProgress.set(null);
    const count = Math.min(Math.max(this.storyboardCount || 6, 1), 12);
    const pages = await this.run(this.storyLoading, (s) =>
      this.assistant.storyboardPages(
        this.storyContext(),
        count,
        (done, total, latest) => {
          this.storyProgress.set({ done, total });
          this.storySuggestions.update((cur) => [...(cur ?? []), latest]);
        },
        s,
      ),
    );
    this.storyProgress.set(null);
    if (pages !== null && this.storySuggestions() === null) this.storySuggestions.set(pages);
  }
  addStoryboardPages() {
    const sugg = this.storySuggestions() ?? [];
    if (!sugg.length) return;
    const firstNew = this.draft.pages.length;
    const created: Page[] = sugg.map((sp) => ({
      id: newId('page'),
      layout: sp.layout,
      panels: sp.panels.map((pl) => newPanel({ description: pl.description, dialogue: cleanDialogue(pl.dialogue), dialogueKind: pl.dialogueKind })),
    }));
    this.draft.pages = [...this.draft.pages, ...created]; // new array reference
    this.storySuggestions.set(null);
    this.pageIndex.set(firstNew); // jump to the first generated page
    this.persist();
  }
  dismissStoryboard() { this.storySuggestions.set(null); }

  // Step 5 — Cover image prompt (front / back)
  readonly coverSides: CoverSide[] = ['front', 'back'];
  coverImg(side: CoverSide): string { return side === 'front' ? this.coverThumb : this.backThumb; }
  coverBusy(side: CoverSide): boolean { return (side === 'front' ? this.frontCoverLoading : this.backCoverLoading)(); }
  coverText(side: CoverSide): string | null { return (side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt)(); }
  coverCopiedFor(side: CoverSide): boolean { return (side === 'front' ? this.frontCoverCopied : this.backCoverCopied)(); }

  async generateCoverPrompt(side: CoverSide) {
    if (!this.draft.idea.trim()) return;
    const loading = side === 'front' ? this.frontCoverLoading : this.backCoverLoading;
    const text = side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt;
    const copied = side === 'front' ? this.frontCoverCopied : this.backCoverCopied;
    copied.set(false);
    text.set(null);
    const prompt = await this.run(loading, (s) => this.assistant.coverPrompt(this.storyContext(), this.draft.title, this.style(), side, s));
    if (prompt !== null) {
      text.set(prompt || '(the model returned nothing — try again)');
      this.writeClipboard(prompt, copied);
    }
  }
  async copyCoverPrompt(side: CoverSide) {
    const text = (side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt)();
    const copied = side === 'front' ? this.frontCoverCopied : this.backCoverCopied;
    if (text) this.writeClipboard(text, copied);
  }
  dismissCoverPrompt(side: CoverSide) {
    (side === 'front' ? this.frontCoverPrompt : this.backCoverPrompt).set(null);
  }
  private async writeClipboard(t: string, copied: WritableSignal<boolean>) {
    try { await navigator.clipboard.writeText(t); copied.set(true); setTimeout(() => copied.set(false), 1800); } catch { /* blocked */ }
  }

  // ── Autosave — always to the book in storage ────────────────────────────────
  persist() {
    // A brand-new draft is only written once it has content (no empty shelf tiles);
    // an already-real book always saves.
    if (!this.isDraftBook() || draftHasContent(this.draft)) {
      this.library.save(this.buildBookFromDraft());
    }
  }

  private buildBookFromDraft(): ComicBook {
    return {
      id: this.bookId,
      title: this.draft.title.trim() || 'Untitled',
      idea: this.draft.idea.trim(),
      author: this.draft.author.trim() || undefined,
      coverImageRef: this.draft.coverImageRef,
      backCoverImageRef: this.draft.backCoverImageRef,
      characters: this.draft.characters,
      chapters: [{ id: 'chapter-1', title: this.draft.title || 'Chapter', synopsis: this.draft.synopsis, pages: this.draft.pages }],
      draft: this.isDraftBook(),
      styleSeed: this.draft.styleSeed,
      styleId: this.draft.styleId,
      createdAt: this.createdAt,
      updatedAt: timestamp(),
    };
  }

  private async refreshThumbs() {
    const map: Record<string, string> = {};
    for (const page of this.draft.pages) {
      for (const panel of page.panels ?? []) {
        if (panel.imageRef) map[panel.id] = await this.storage.resolveUrl(panel.imageRef);
      }
    }
    // Character reference images share the map (ids never collide with panel ids).
    for (const c of this.draft.characters) {
      if (c.referenceImageRef) map[c.id] = await this.storage.resolveUrl(c.referenceImageRef);
    }
    this.thumbs.set(map);
    this.coverThumb = this.draft.coverImageRef ? await this.storage.resolveUrl(this.draft.coverImageRef) : '';
    this.backThumb = this.draft.backCoverImageRef ? await this.storage.resolveUrl(this.draft.backCoverImageRef) : '';
  }

  private allPanels(): Panel[] {
    return this.draft.pages.flatMap((pg) => pg.panels ?? []);
  }

  // ── Stepper ────────────────────────────────────────────────────────────────
  canAdvance(): boolean {
    switch (this.steps[this.step()].key) {
      case 'idea': return this.draft.idea.trim().length > 0;
      // Images are optional — the user can build the story now and add art later.
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

  // ── Pages & panels (one page at a time) ──────────────────────────────────────
  get currentPage(): Page | null {
    const pages = this.draft.pages;
    if (!pages.length) return null;
    // Self-correct a stale index so pages always render.
    const i = Math.min(Math.max(this.pageIndex(), 0), pages.length - 1);
    return pages[i] ?? null;
  }

  /** Which panel of the current page is being edited (click-a-section-to-edit). */
  readonly selectedPanelId = signal<string | null>(null);
  selectPanel(id: string) { this.selectedPanelId.set(id); }

  /** The panel currently open in the editor — falls back to the first panel so
   *  something valid always shows, even right after navigating to a new page. */
  get selectedPanel(): Panel | null {
    const panels = this.currentPage?.panels;
    if (!panels?.length) return null;
    return panels.find((p) => p.id === this.selectedPanelId()) ?? panels[0];
  }
  /** Index of {@link selectedPanel} within its page (for the aspect-aware prompt). */
  get selectedPanelIndex(): number {
    const panels = this.currentPage?.panels ?? [];
    const sel = this.selectedPanel;
    return sel ? panels.findIndex((p) => p.id === sel.id) : 0;
  }
  private clampPageIndex() {
    const max = Math.max(0, this.draft.pages.length - 1);
    if (this.pageIndex() > max) this.pageIndex.set(max);
  }
  goToPage(i: number) {
    this.pageIndex.set(Math.min(Math.max(i, 0), Math.max(0, this.draft.pages.length - 1)));
  }
  prevPage() { this.goToPage(this.pageIndex() - 1); }
  nextPage() { this.goToPage(this.pageIndex() + 1); }

  addPage() {
    const page: Page = { id: newId('page'), layout: this.defaultLayout, panels: [] };
    applyLayout(page, this.defaultLayout);
    this.draft.pages = [...this.draft.pages, page]; // new array reference
    this.pageIndex.set(this.draft.pages.length - 1); // focus the new page
    this.persist();
  }
  removeCurrentPage() {
    const p = this.currentPage;
    if (!p) return;
    if (!confirm(`Delete page ${this.pageIndex() + 1}?`)) return;
    this.draft.pages = this.draft.pages.filter((x) => x.id !== p.id);
    this.clampPageIndex();
    this.persist();
  }
  /** Wipe every page at once — handy when the story's core changes. One prompt. */
  async removeAllPages() {
    const count = this.draft.pages.length;
    if (!count) return;
    if (!confirm(`Delete all ${count} page${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    // Free the panel image blobs so they don't orphan in storage.
    for (const page of this.draft.pages) {
      for (const panel of page.panels ?? []) {
        if (panel.imageRef?.kind === 'local') await this.storage.deleteImage(panel.imageRef);
      }
    }
    this.draft.pages = [];
    this.pageIndex.set(0);
    this.selectedPanelId.set(null);
    this.persist();
    await this.refreshThumbs();
  }
  moveCurrentPage(dir: -1 | 1) {
    const i = this.pageIndex();
    const j = i + dir;
    if (j < 0 || j >= this.draft.pages.length) return;
    const arr = this.draft.pages;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.pageIndex.set(j);
    this.persist();
  }
  changeLayout(page: Page, layout: LayoutId) {
    applyLayout(page, layout);
    this.persist();
  }

  /** Store a new image; delete the old local blob it replaces (avoids orphans). */
  private async putReplacing(oldRef: ImageRef | undefined, file: Blob): Promise<ImageRef> {
    if (oldRef?.kind === 'local') await this.storage.deleteImage(oldRef);
    return this.storage.putImage(file);
  }

  setBubbleKind(panel: Panel, kind: BubbleKind) {
    panel.dialogueKind = kind;
    this.persist();
  }

  async onPanelImage(event: Event, panel: Panel) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    panel.imageRef = await this.putReplacing(panel.imageRef, file);
    this.persist();
    await this.refreshThumbs();
  }

  async onCoverImage(event: Event, side: CoverSide) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (side === 'front') this.draft.coverImageRef = await this.putReplacing(this.draft.coverImageRef, file);
    else this.draft.backCoverImageRef = await this.putReplacing(this.draft.backCoverImageRef, file);
    this.persist();
    await this.refreshThumbs();
  }
  async removeCover(side: CoverSide) {
    const ref = side === 'front' ? this.draft.coverImageRef : this.draft.backCoverImageRef;
    if (ref) await this.storage.deleteImage(ref);
    if (side === 'front') { this.draft.coverImageRef = undefined; this.coverThumb = ''; }
    else { this.draft.backCoverImageRef = undefined; this.backThumb = ''; }
    this.persist();
  }

  /** Whether any character has a locked reference image (drives the attach-it hint). */
  get hasCharacterRefs(): boolean {
    return this.draft.characters.some((c) => !!c.referenceImageRef);
  }

  async copyPanelPrompt(page: Page, panel: Panel, index: number) {
    const prompt = this.prompts.buildPanelPrompt(
      { characters: this.draft.characters, style: this.style() },
      { description: panel.description },
      page.layout,
      index,
    );
    panel.imagePrompt = prompt;
    this.persist();
    try {
      await navigator.clipboard.writeText(prompt);
    } catch { /* clipboard blocked — prompt is still stored on the panel */ }
    this.copiedPanelId.set(panel.id);
    setTimeout(() => { if (this.copiedPanelId() === panel.id) this.copiedPanelId.set(null); }, 1800);
  }

  // ── Character reference art (locks each character's look across all panels) ──
  async copyCharacterPrompt(c: Character) {
    const prompt = this.prompts.buildCharacterPortraitPrompt(c, this.style());
    try {
      await navigator.clipboard.writeText(prompt);
    } catch { /* clipboard blocked */ }
    this.copiedCharId.set(c.id);
    setTimeout(() => { if (this.copiedCharId() === c.id) this.copiedCharId.set(null); }, 1800);
  }
  async onCharacterReference(event: Event, c: Character) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    c.referenceImageRef = await this.putReplacing(c.referenceImageRef, file);
    this.persist();
    await this.refreshThumbs();
  }
  async removeCharacterReference(c: Character) {
    if (c.referenceImageRef) await this.storage.deleteImage(c.referenceImageRef);
    c.referenceImageRef = undefined;
    this.persist();
    await this.refreshThumbs();
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
      backCoverImageRef: this.draft.backCoverImageRef,
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
      // Keep EVERY page, even ones without artwork yet — their caption/dialogue/
      // prompt are real content and must survive so they're editable later. The
      // reader simply skips imageless pages when rendering.
      pages: this.draft.pages,
    };
  }

  // ── Finish ──────────────────────────────────────────────────────────────────
  /** A title is all that's required to move a draft off the "Draft" state. */
  canFinish(): boolean {
    return this.draft.title.trim().length > 0;
  }

  /** Draft → finished book: flips it off "draft" and opens it in the reader. */
  async finishDraft() {
    if (!this.canFinish() || this.publishing()) return;
    this.publishing.set(true);
    this.isDraftBook.set(false);
    await this.library.save(this.buildBookFromDraft());
    this.router.navigate(['/read', this.bookId]);
  }

  /** Editing a finished book autosaves continuously, so "Done" just leaves. */
  done() {
    this.router.navigate(['/']);
  }
}

/** localStorage draft uses no timestamps; stamp only at publish time. */
function timestamp(): number {
  return Date.now();
}
