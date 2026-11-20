import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { LANGUAGES } from './lang';
import { MapDataService } from './map-data.service';
import { mergeTexts } from './texts';

/** Loads the data files that are split by language (see texts.ts): the structure, then the texts of the languages wanted. */
@Injectable({ providedIn: 'root' })
export class DataFiles {
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);
  private readonly mapData = inject(MapDataService);
  private readonly files = new Map<string, { data: object; done: Set<string> }>();
  private readonly wanted = new Set<string>();

  async load<T extends object>(name: string): Promise<T> {
    const data = await firstValueFrom(this.http.get<T>(`${name}.json`));
    const file = { data, done: new Set<string>() };
    this.files.set(name, file);
    this.wanted.add(this.transloco.getActiveLang());
    await Promise.all([...this.wanted].map((code) => this.addTexts(name, file, code)));
    return data;
  }

  /** Before the site switches to a language: its texts are put in every file already loaded (and in the ones loaded later). */
  async addLanguage(code: string): Promise<void> {
    this.wanted.add(code);
    await Promise.all([...this.files].map(([name, file]) => this.addTexts(name, file, code)));
  }

  private async addTexts(name: string, file: { data: object; done: Set<string> }, code: string): Promise<void> {
    if (file.done.has(code)) return;
    file.done.add(code);
    const languages = this.mapData.data?.languages ?? LANGUAGES;
    const index = languages.indexOf(code);
    if (index < 0) return;
    const texts = await firstValueFrom(this.http.get<string[]>(`${name}.${code}.json`));
    mergeTexts(file.data, texts, index, languages.length);
  }
}
