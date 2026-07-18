import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { StorageService } from './core/services/storage.service';
import { LocalStorageService } from './core/services/local-storage.service';
import { AiService } from './core/services/ai/ai.service';
import { LocalServerAiService } from './core/services/ai/local-server-ai.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Hash routing so refreshes work on static hosting and future Electron file://
    provideRouter(routes, withHashLocation()),
    // v1 persistence seam -> IndexedDB. Swap for AzureBlobService later.
    { provide: StorageService, useClass: LocalStorageService },
    // On-device AI seam -> local OpenAI-compatible server. Swap for WebLLM /
    // Electron-native later. No cloud.
    { provide: AiService, useClass: LocalServerAiService },
  ],
};
