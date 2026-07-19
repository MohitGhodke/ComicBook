import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
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

type SortOrder = 'updated' | 'title-asc' | 'title-desc' | 'newest' | 'oldest';

const SORT_LABELS: Record<SortOrder, string> = {
  updated: 'Recently updated',
  newest: 'Newest first',
  oldest: 'Oldest first',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
};

@Component({
  selector: 'app-shelf',
  imports: [FormsModule],
  templateUrl: './shelf.html',
  styleUrl: './shelf.scss',
})
export class Shelf implements OnInit {
  private library = inject(ComicLibraryService);
  private storage = inject(StorageService);
  private router = inject(Router);

  readonly items = signal<ShelfItem[]>([]);
  readonly loading = signal(true);
  readonly query = signal('');
  readonly sortOrder = signal<SortOrder>('updated');
  readonly sortOptions: { value: SortOrder; label: string }[] = (
    Object.entries(SORT_LABELS) as [SortOrder, string][]
  ).map(([value, label]) => ({ value, label }));

  readonly visibleItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    const filtered = q
      ? this.items().filter(
          (item) =>
            item.book.title.toLowerCase().includes(q) ||
            (item.book.author ?? '').toLowerCase().includes(q),
        )
      : this.items().slice();

    const order = this.sortOrder();
    filtered.sort((a, b) => {
      switch (order) {
        case 'title-asc':
          return a.book.title.localeCompare(b.book.title);
        case 'title-desc':
          return b.book.title.localeCompare(a.book.title);
        case 'newest':
          return b.book.createdAt - a.book.createdAt;
        case 'oldest':
          return a.book.createdAt - b.book.createdAt;
        case 'updated':
        default:
          return b.book.updatedAt - a.book.updatedAt;
      }
    });
    return filtered;
  });

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
