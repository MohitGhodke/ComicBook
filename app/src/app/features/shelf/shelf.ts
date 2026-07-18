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
        editable: !book.readonly,
      });
    }
    this.items.set(items);
    this.loading.set(false);
  }

  open(book: ComicBook) {
    this.router.navigate(['/read', book.id]);
  }

  create() {
    this.router.navigate(['/create']);
  }

  async remove(event: Event, book: ComicBook) {
    event.stopPropagation();
    if (!confirm(`Delete "${book.title}"? This can't be undone.`)) return;
    await this.library.delete(book.id);
    await this.reload();
  }
}
