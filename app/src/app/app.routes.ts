import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/shelf/shelf').then((m) => m.Shelf),
  },
  {
    path: 'read/:id',
    loadComponent: () => import('./features/reader/reader-page').then((m) => m.ReaderPageComponent),
  },
  {
    path: 'create',
    loadComponent: () => import('./features/creator/creator').then((m) => m.Creator),
  },
  {
    // Editing reuses the create wizard, pre-loaded with the book.
    path: 'create/:bookId',
    loadComponent: () => import('./features/creator/creator').then((m) => m.Creator),
  },
  { path: 'edit/:id', redirectTo: 'create/:id' },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  { path: '**', redirectTo: '' },
];
