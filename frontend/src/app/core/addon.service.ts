import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AddonEntry, AddonManifest, parseManifest } from './addon.logic';

/** The add-ons the account may use, read from the add-on's manifest. Any failure means "none". */
@Injectable({ providedIn: 'root' })
export class AddonService {
  private readonly http = inject(HttpClient);
  private manifest: AddonManifest | null = null;
  private loading: Promise<void> | null = null;
  private readonly _entries = signal<AddonEntry[]>([]);
  readonly entries = this._entries.asReadonly();

  async load(): Promise<void> {
    try {
      this.manifest = parseManifest(
        await firstValueFrom(this.http.get<unknown>('/addon/api/manifest')),
      );
    } catch {
      this.manifest = null; // add-on down, not installed or not allowed: no tab, nothing to report
    }
    this._entries.set(this.manifest?.entries ?? []);
  }

  clear(): void {
    this.manifest = null;
    this.loading = null;
    this._entries.set([]);
  }

  /** Adds the add-on's stylesheet and script once; a failure can be retried by calling again. */
  ensureLoaded(): Promise<void> {
    const m = this.manifest;
    if (!m) return Promise.reject(new Error('no add-on manifest'));
    this.loading ??= new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = m.styles;
      const script = document.createElement('script');
      script.type = 'module';
      script.src = m.script;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        link.remove();
        this.loading = null;
        reject(new Error('add-on script failed to load'));
      };
      document.head.append(link, script);
    });
    return this.loading;
  }
}
