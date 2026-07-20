import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StyleConfig } from '../../core/services/style.config';
import { AiConfig } from '../../core/services/ai/ai.config';
import { ART_STYLES } from '../../core/style/art-styles';
import { ThemeConfig } from '../../core/services/theme.config';
import { FontSizeConfig } from '../../core/services/font-size.config';
import { BubbleFontSize } from '../../core/models/comic.model';
import { FontSizeSlider } from '../shared/font-size-slider';

/**
 * App settings: light/dark appearance, the DEFAULT art style for new comics
 * (every image prompt adapts to the comic's style), and the on-device AI
 * server address. Each setting is persisted to localStorage via its own
 * config service.
 */
@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink, FontSizeSlider],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private styleConfig = inject(StyleConfig);
  private aiConfig = inject(AiConfig);
  private themeConfig = inject(ThemeConfig);
  private fontSizeConfig = inject(FontSizeConfig);

  readonly styles = ART_STYLES;
  readonly defaultStyleId = this.styleConfig.defaultStyleId;
  readonly theme = this.themeConfig.theme;
  readonly defaultFontSize = this.fontSizeConfig.defaultForNewBooks;

  aiUrl = this.aiConfig.baseUrl;

  chooseStyle(id: string) {
    this.styleConfig.setDefaultStyle(id);
  }

  chooseTheme(theme: 'light' | 'dark') {
    this.themeConfig.setTheme(theme);
  }

  chooseFontSize(size: BubbleFontSize) {
    this.fontSizeConfig.setDefaultForNewBooks(size);
  }

  saveAiUrl() {
    this.aiConfig.baseUrl = this.aiUrl;
    this.aiUrl = this.aiConfig.baseUrl; // reflect normalisation
  }
}
