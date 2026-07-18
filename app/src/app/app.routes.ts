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
    path: 'edit/:id',
    loadComponent: () => import('./features/editor/book-editor').then((m) => m.BookEditor),
  },
  {
    path: 'create/:draftId',
    loadComponent: () => import('./features/creator/creator').then((m) => m.Creator),
  },
  { path: '**', redirectTo: '' },
];
