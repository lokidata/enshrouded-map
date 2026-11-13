import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlannerStore } from './planner.store';

describe('PlannerStore sheet on the server', () => {
  let store: PlannerStore;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en' },
          loader: class {
            getTranslation = () => of({});
          },
        }),
      ],
    });
    store = TestBed.inject(PlannerStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => vi.useRealTimers());

  /** The microtasks of an awaited flush have run: the requests of switchProfile are out. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  async function open(id: number, sheet: unknown, stamp: string | null = null): Promise<void> {
    const opening = store.switchProfile(id);
    await settle();
    http.expectOne('api/v1/builds').flush([]);
    http.expectOne(`api/v1/characters/${id}/sheet`).flush({ sheet, updated_at: stamp });
    await opening;
  }

  it('takes the sheet the server holds', async () => {
    await open(7, { level: 20, flame: 3, active: 'weapon2', itemLevels: { head: 5 } }, 'T1');
    expect(store.level()).toBe(20);
    expect(store.flame()).toBe(3);
    expect(store.active()).toBe('weapon2');
    expect(store.itemLevels()).toEqual({ head: 5 });
    expect(localStorage.getItem('sheetStamp:7')).toBe('T1');
  });

  it('sends this browser copy when the server has none', async () => {
    vi.useFakeTimers();
    localStorage.setItem('skillDraft:7', JSON.stringify({ level: 9 }));
    await open(7, null);
    vi.advanceTimersByTime(900);
    const req = http.expectOne('api/v1/characters/7/sheet');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.settings.level).toBe(9);
    expect(req.request.body.base).toBeNull();
  });

  it('sends a change after a pause, once, based on the copy it read', async () => {
    vi.useFakeTimers();
    await open(7, { level: 3 }, 'T1');
    store.setActive('weapon3');
    store.setActive('ranged');
    vi.advanceTimersByTime(900);
    const req = http.expectOne('api/v1/characters/7/sheet');
    expect(req.request.body.settings.active).toBe('ranged');
    expect(req.request.body.base).toBe('T1');
    req.flush({ sheet: {}, updated_at: 'T2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem('sheetStamp:7')).toBe('T2');
    expect(localStorage.getItem('sheetDirty:7')).toBeNull();
  });

  it('sends the last change of a profile before opening another one', async () => {
    await open(7, { level: 3 }, 'T1');
    store.setActive('weapon2');
    const switching = store.switchProfile(8);
    const req = http.expectOne('api/v1/characters/7/sheet'); // not waited for: sent now
    expect(req.request.body.settings.active).toBe('weapon2');
    req.flush({ sheet: {}, updated_at: 'T2' });
    await settle();
    http.expectOne('api/v1/builds').flush([]);
    http.expectOne('api/v1/characters/8/sheet').flush({ sheet: null, updated_at: null });
    await switching;
  });

  it('takes the server copy when another device wrote since the last sync', async () => {
    localStorage.setItem('sheetStamp:7', 'T1');
    localStorage.setItem('sheetDirty:7', '1');
    localStorage.setItem('skillDraft:7', JSON.stringify({ level: 9 }));
    await open(7, { level: 30 }, 'T5'); // T5 is not the stamp this browser saw
    expect(store.level()).toBe(30);
    expect(localStorage.getItem('sheetDirty:7')).toBeNull();
  });

  it('sends changes made here when the server copy is the one it last saw', async () => {
    localStorage.setItem('sheetStamp:7', 'T1');
    localStorage.setItem('sheetDirty:7', '1');
    localStorage.setItem('skillDraft:7', JSON.stringify({ level: 9 }));
    const opening = store.switchProfile(7);
    await settle();
    http.expectOne('api/v1/builds').flush([]);
    http.expectOne('api/v1/characters/7/sheet').flush({ sheet: { level: 2 }, updated_at: 'T1' });
    await settle();
    const req = http.expectOne('api/v1/characters/7/sheet');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ settings: { level: 9 }, base: 'T1' });
    req.flush({ sheet: {}, updated_at: 'T2' });
    await opening;
    expect(store.level()).toBe(9);
  });

  it('takes the server copy when a write is refused', async () => {
    vi.useFakeTimers();
    await open(7, { level: 3 }, 'T1');
    store.setActive('weapon2');
    vi.advanceTimersByTime(900);
    http
      .expectOne('api/v1/characters/7/sheet')
      .flush({ detail: 'sheet_changed' }, { status: 409, statusText: 'Conflict' });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('api/v1/characters/7/sheet').flush({ sheet: { level: 40 }, updated_at: 'T9' });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.level()).toBe(40);
    expect(localStorage.getItem('sheetStamp:7')).toBe('T9');
  });
});
