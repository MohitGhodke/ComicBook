import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeConfig } from './core/services/theme.config';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // Injected so its constructor effect runs from app start, keeping
  // <html data-theme> in sync everywhere — no template usage needed.
  private theme = inject(ThemeConfig);
}
