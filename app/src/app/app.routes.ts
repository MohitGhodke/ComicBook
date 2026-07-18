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
    path: 'create/:draftId',
    loadComponent: () => import('./features/creator/creator').then((m) => m.Creator),
  },
  { path: '**', redirectTo: '' },
];
