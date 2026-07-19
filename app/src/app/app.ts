import { Component, inject, isDevMode } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeConfig } from './core/services/theme.config';
import { EvalBridge, installEvalBridge } from './core/eval/eval-bridge';

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

  constructor() {
    // Dev-only: expose the real pipeline on window.__comicEval for the E2E
    // continuity eval. Guarded so a production build never even constructs it.
    if (isDevMode()) installEvalBridge(inject(EvalBridge));
  }
}
