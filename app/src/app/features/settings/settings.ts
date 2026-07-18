import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StyleConfig } from '../../core/services/style.config';
import { AiConfig } from '../../core/services/ai/ai.config';
import { ART_STYLES } from '../../core/style/art-styles';

/**
 * App settings. Right now: the DEFAULT art style for new comics (every image
 * prompt adapts to the comic's style) and the on-device AI server address.
 * Each setting is persisted to localStorage via its config service.
 */
@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private styleConfig = inject(StyleConfig);
  private aiConfig = inject(AiConfig);

  readonly styles = ART_STYLES;
  readonly defaultStyleId = this.styleConfig.defaultStyleId;

  aiUrl = this.aiConfig.baseUrl;

  chooseStyle(id: string) {
    this.styleConfig.setDefaultStyle(id);
  }

  saveAiUrl() {
    this.aiConfig.baseUrl = this.aiUrl;
    this.aiUrl = this.aiConfig.baseUrl; // reflect normalisation
  }
}
