import { Injectable, effect, signal } from '@angular/core';

const THEME_KEY = 'comic-studio-theme';

export type Theme = 'light' | 'dark';

/**
 * App-wide light/dark theme, persisted to localStorage and set from the
 * Settings page. Applies as a `data-theme` attribute on <html> so every
 * `var(--token)` in styles.scss resolves to the right palette.
 */
@Injectable({ providedIn: 'root' })
export class ThemeConfig {
  readonly theme = signal<Theme>(
    localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
  );

  constructor() {
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.theme());
    });
  }

  setTheme(theme: Theme) {
    localStorage.setItem(THEME_KEY, theme);
    this.theme.set(theme);
  }

  toggle() {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }
}
