import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { StorageService } from './core/services/storage.service';
import { LocalStorageService } from './core/services/local-storage.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Hash routing so refreshes work on static hosting and future Electron file://
    provideRouter(routes, withHashLocation()),
    // v1 persistence seam -> IndexedDB. Swap for AzureBlobService later.
    { provide: StorageService, useClass: LocalStorageService },
  ],
};
