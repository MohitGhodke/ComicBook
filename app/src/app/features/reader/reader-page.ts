import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Reader } from './reader';
import { ComicLibraryService } from '../../core/services/comic-library.service';
import { BubbleFontSize, ReaderPage } from '../../core/models/comic.model';

@Component({
  selector: 'app-reader-page',
  imports: [Reader],
  templateUrl: './reader-page.html',
  styleUrl: './reader-page.scss',
})
export class ReaderPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private library = inject(ComicLibraryService);

  readonly pages = signal<ReaderPage[]>([]);
  readonly title = signal('');
  readonly bookFontSize = signal<BubbleFontSize>('large');
  readonly notFound = signal(false);
  readonly ready = signal(false);

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    const book = await this.library.get(id);
    if (!book) {
      this.notFound.set(true);
      this.ready.set(true);
      return;
    }
    this.title.set(book.title);
    this.bookFontSize.set(book.bubbleFontSize ?? 'large');
    this.pages.set(await this.library.toReaderPages(book));
    this.ready.set(true);
  }

  backToShelf() {
    this.router.navigate(['/']);
  }
}
