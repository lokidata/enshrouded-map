import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AddonEntry, parseEntries } from './addon.logic';

/** The add-ons the account may use, read from the site's API. Any failure means "none". */
@Injectable({ providedIn: 'root' })
export class AddonService {
  private readonly http = inject(HttpClient);
  private readonly loading = new Map<string, Promise<void>>(); // by script path
  private readonly styled = new Set<string>(); // stylesheet paths already added
  private readonly _entries = signal<AddonEntry[]>([]);
  readonly entries = this._entries.asReadonly();

  async load(): Promise<void> {
    let list: AddonEntry[] | null = null;
    try {
      list = parseEntries(await firstValueFrom(this.http.get<unknown>('/api/v1/addons')));
    } catch {
      // add-ons off or not allowed: no tab, nothing to report
    }
    this._entries.set(list ?? []);
  }

  clear(): void {
    this.loading.clear();
    this.styled.clear();
    this._entries.set([]);
  }

  /** Adds the entry's stylesheet and script, each once per path; a failure can be retried by calling again. */
  ensureLoaded(entry: AddonEntry): Promise<void> {
    const { script: src, styles } = entry;
    let p = this.loading.get(src);
    if (!p) {
      p = new Promise<void>((resolve, reject) => {
        const nodes: HTMLElement[] = [];
        if (!this.styled.has(styles)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = styles;
          this.styled.add(styles);
          nodes.push(link);
        }
        const script = document.createElement('script');
        script.type = 'module';
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          nodes.forEach((n) => n.remove());
          if (nodes.length) this.styled.delete(styles);
          this.loading.delete(src);
          reject(new Error('add-on script failed to load'));
        };
        document.head.append(...nodes, script);
      });
      this.loading.set(src, p);
    }
    return p;
  }
}
