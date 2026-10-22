import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  isDevMode,
  provideAppInitializer,
  inject,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TranslocoService, provideTransloco } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './core/auth.interceptor';
import { MapDataService } from './core/map-data.service';
import { SessionService } from './core/session.service';
import { TranslocoHttpLoader } from './core/transloco-loader';

const storedLang = (): string => {
  try {
    const lang = localStorage.getItem('lang');
    if (lang === 'fr' || lang === 'en') return lang;
  } catch {
    // storage blocked
  }
  return 'fr';
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // XSRF: Angular echoes the XSRF-TOKEN cookie in X-XSRF-TOKEN on unsafe same-origin requests.
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTransloco({
      config: {
        availableLangs: ['fr', 'en'],
        defaultLang: storedLang(),
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
    provideAppInitializer(async () => {
      document.documentElement.lang = inject(TranslocoService).getActiveLang();
      await Promise.all([
        inject(MapDataService).load(),
        firstValueFrom(inject(TranslocoService).load(storedLang())),
      ]);
    }),
    provideAppInitializer(() => {
      void inject(SessionService).start(); // not awaited: the map shows while the session is checked
    }),
  ],
};
