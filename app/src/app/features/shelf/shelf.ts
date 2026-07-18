import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ComicLibraryService } from '../../core/services/comic-library.service';
import { StorageService } from '../../core/services/storage.service';
import { ComicBook } from '../../core/models/comic.model';

interface ShelfItem {
  book: ComicBook;
  coverUrl: string;
  pages: number;
  editable: boolean;
  isDraft: boolean;
}

@Component({
  selector: 'app-shelf',
  imports: [],
  templateUrl: './shelf.html',
  styleUrl: './shelf.scss',
})
export class Shelf implements OnInit {
  private library = inject(ComicLibraryService);
  private storage = inject(StorageService);
  private router = inject(Router);

  readonly items = signal<ShelfItem[]>([]);
  readonly loading = signal(true);

  async ngOnInit() {
    await this.reload();
  }

  private async reload() {
    this.loading.set(true);
    const books = await this.library.getAll();
    const items: ShelfItem[] = [];
    for (const book of books) {
      items.push({
        book,
        coverUrl: book.coverImageRef ? await this.storage.resolveUrl(book.coverImageRef) : '',
        pages: this.library.pageCount(book),
        editable: !book.readonly && !book.draft,
        isDraft: !!book.draft,
      });
    }
    this.items.set(items);
    this.loading.set(false);
  }

  open(item: ShelfItem) {
    // A draft resumes in the wizard; a finished book opens in the reader.
    if (item.isDraft) this.router.navigate(['/create', item.book.id]);
    else this.router.navigate(['/read', item.book.id]);
  }

  create() {
    this.router.navigate(['/create']);
  }

  settings() {
    this.router.navigate(['/settings']);
  }

  edit(event: Event, book: ComicBook) {
    event.stopPropagation();
    this.router.navigate(['/create', book.id]); // edit = the create wizard, pre-loaded
  }

  async remove(event: Event, item: ShelfItem) {
    event.stopPropagation();
    const msg = item.isDraft ? 'Discard this draft?' : `Delete "${item.book.title}"? This can't be undone.`;
    if (!confirm(msg)) return;
    await this.library.delete(item.book.id);
    await this.reload();
  }
}
