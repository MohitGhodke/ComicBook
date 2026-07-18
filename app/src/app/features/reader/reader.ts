import {
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ViewEncapsulation,
  signal,
  computed,
  inject,
} from '@angular/core';
import { PageFlip } from 'page-flip';
import { ReaderPage } from '../../core/models/comic.model';

const NAV_H = 60; // nav bar + gap
const PAD = 16; // breathing room
const LENS_RADIUS = 275; // half of the 550px lens
const ZOOM_FACTOR = 1.5;

/**
 * Flipbook viewer — a faithful Angular port of the original vanilla `main.js`
 * StPageFlip presenter: two-page spread sizing, jump-to-page popover, debounced
 * resize reinit, and the storyteller magnifier lens.
 *
 * The book's inner DOM is built imperatively (StPageFlip owns/mutates it), so
 * this component uses no view encapsulation — its class names are reader-scoped.
 */
@Component({
  selector: 'app-reader',
  imports: [],
  templateUrl: './reader.html',
  styleUrl: './reader.scss',
  encapsulation: ViewEncapsulation.None,
})
export class Reader implements AfterViewInit, OnChanges, OnDestroy {
  private zone = inject(NgZone);

  @Input() pages: ReaderPage[] = [];

  @ViewChild('scene', { static: true }) sceneRef!: ElementRef<HTMLDivElement>;
  @ViewChild('bookHost', { static: true }) bookHostRef!: ElementRef<HTMLDivElement>;
  @ViewChild('lensImg', { static: true }) lensImgRef!: ElementRef<HTMLImageElement>;

  readonly totalPages = signal(0);
  readonly currentIndex = signal(0);
  readonly jumpOpen = signal(false);
  readonly storytellerActive = signal(false);
  readonly loading = signal(true);

  readonly pageInfo = computed(() => `${this.currentIndex() + 1} / ${this.totalPages()}`);
  readonly dots = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i));
  readonly atStart = computed(() => this.currentIndex() <= 0);
  readonly atEnd = computed(() => this.currentIndex() >= this.totalPages() - 1);

  private pageFlip: PageFlip | null = null;
  private bookEl: HTMLDivElement | null = null;
  private pageRatio = 1100 / 733; // fallback portrait ratio
  private resizeTimer: any = null;
  private viewReady = false;

  private readonly onResize = () => {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const current = this.pageFlip ? this.pageFlip.getCurrentPageIndex() : 0;
      this.initPageFlip(current);
    }, 250);
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    this.setLensPosition(e.clientX, e.clientY);
    if (this.storytellerActive()) this.updateMagnifier(e.clientX, e.clientY);
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') this.next();
    if (e.key === 'ArrowLeft') this.prev();
    if (e.key === 'Escape') {
      this.closeJump();
      if (this.storytellerActive()) this.toggleStoryteller();
    }
  };

  ngAfterViewInit() {
    this.viewReady = true;
    window.addEventListener('resize', this.onResize);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    this.setLensPosition(window.innerWidth / 2, window.innerHeight / 2);
    this.preloadAndInit();
  }

  ngOnChanges() {
    if (this.viewReady) this.preloadAndInit();
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    clearTimeout(this.resizeTimer);
    if (this.pageFlip) {
      try { this.pageFlip.destroy(); } catch { /* mid-animation */ }
      this.pageFlip = null;
    }
  }

  // ── Preload images (detect aspect ratio), then build the book ──────────────
  private preloadAndInit() {
    const srcs = this.pages.map((p) => p.src).filter(Boolean);
    if (srcs.length === 0) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    let remaining = srcs.length;
    const firstInterior = this.pages.find((p) => !p.isCover)?.src;

    const done = () => {
      if (--remaining <= 0) {
        this.zone.run(() => {
          this.initPageFlip(0);
          this.loading.set(false);
        });
      }
    };
    srcs.forEach((src) => {
      const img = new Image();
      img.onload = () => {
        if (src === firstInterior || (!firstInterior && this.pages[0]?.src === src)) {
          this.pageRatio = img.naturalHeight / img.naturalWidth;
        }
        done();
      };
      img.onerror = done;
      img.src = src;
    });
    // Safety net so a stalled image never traps the loader
    setTimeout(() => this.zone.run(() => { if (this.loading()) { this.initPageFlip(0); this.loading.set(false); } }), 10000);
  }

  private calcPageSize() {
    const availW = window.innerWidth - PAD;
    const availH = window.innerHeight - NAV_H - PAD;
    let pageW = Math.floor(availW / 2);
    let pageH = Math.round(pageW * this.pageRatio);
    if (pageH > availH) {
      pageH = availH;
      pageW = Math.round(pageH / this.pageRatio);
    }
    return { w: Math.max(pageW, 80), h: Math.max(pageH, 80) };
  }

  private buildBook() {
    const host = this.bookHostRef.nativeElement;
    host.innerHTML = '';
    const book = document.createElement('div');
    book.id = 'book';
    this.pages.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'page' + (p.isCover ? ' page-cover' : '') + (p.isBack ? ' page-back' : '');
      // Covers are rigid boards (hard); interior leaves fold (soft). Hard pages
      // don't reveal a blank back when turned. StPageFlip reads data-density.
      div.dataset['density'] = p.isCover ? 'hard' : 'soft';
      const img = document.createElement('img');
      img.src = p.src;
      img.alt = p.alt;
      div.appendChild(img);
      book.appendChild(div);
    });
    host.appendChild(book);
    this.bookEl = book;
  }

  private initPageFlip(goToPage: number) {
    if (this.pageFlip) {
      try { this.pageFlip.destroy(); } catch { /* ignore */ }
      this.pageFlip = null;
    }
    this.buildBook();
    const size = this.calcPageSize();

    this.pageFlip = new PageFlip(this.bookEl!, {
      width: size.w,
      height: size.h,
      showCover: true,
      drawShadow: true,
      flippingTime: 1000,
      usePortrait: false,
      autoSize: false,
      maxShadowOpacity: 0.4,
      mobileScrollSupport: false,
    } as any);

    this.pageFlip.loadFromHTML(this.bookEl!.querySelectorAll('.page'));
    this.totalPages.set(this.pageFlip.getPageCount());

    const startPage = goToPage > 0 ? goToPage : 0;
    this.currentIndex.set(startPage);

    this.pageFlip.on('flip', (e: any) => {
      this.zone.run(() => this.currentIndex.set(e.data as number));
    });

    if (startPage > 0) {
      setTimeout(() => { if (this.pageFlip) this.pageFlip.turnToPage(startPage); }, 50);
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  next() { this.pageFlip?.flipNext(); }
  prev() { this.pageFlip?.flipPrev(); }
  toFirst() { this.closeJump(); this.pageFlip?.turnToPage(0); }

  goTo(idx: number) {
    this.closeJump();
    this.pageFlip?.turnToPage(idx);
  }

  toggleJump() { this.jumpOpen.update((v) => !v); }
  closeJump() { this.jumpOpen.set(false); }

  // ── Storyteller mode ─────────────────────────────────────────────────────
  toggleStoryteller() {
    const active = !this.storytellerActive();
    this.storytellerActive.set(active);
    if (active) this.closeJump();
  }

  private setLensPosition(cx: number, cy: number) {
    const el = this.sceneRef?.nativeElement;
    if (!el) return;
    el.style.setProperty('--cx', cx + 'px');
    el.style.setProperty('--cy', cy + 'px');
  }

  private updateMagnifier(cx: number, cy: number) {
    const lensImg = this.lensImgRef.nativeElement;
    const els = document.elementsFromPoint(cx, cy);
    let pageImg: HTMLImageElement | null = null;
    for (const el of els) {
      if (el.tagName === 'IMG' && (el as HTMLElement).closest('.page')) {
        pageImg = el as HTMLImageElement;
        break;
      }
    }
    if (!pageImg) {
      lensImg.style.display = 'none';
      return;
    }
    const rect = pageImg.getBoundingClientRect();
    const scaledW = rect.width * ZOOM_FACTOR;
    const scaledH = rect.height * ZOOM_FACTOR;
    const imgLeft = LENS_RADIUS - (cx - rect.left) * ZOOM_FACTOR;
    const imgTop = LENS_RADIUS - (cy - rect.top) * ZOOM_FACTOR;
    lensImg.src = pageImg.src;
    lensImg.style.display = 'block';
    lensImg.style.width = scaledW + 'px';
    lensImg.style.height = scaledH + 'px';
    lensImg.style.left = imgLeft + 'px';
    lensImg.style.top = imgTop + 'px';
  }
}
