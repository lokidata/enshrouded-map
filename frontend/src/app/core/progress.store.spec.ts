import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProgressStore } from './progress.store';

describe('ProgressStore', () => {
  let store: ProgressStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ProgressStore);
    http = TestBed.inject(HttpTestingController);
  });

  it('marks right away and sends the change', async () => {
    const saving = store.toggle('boss:1:2');
    expect(store.done().has('boss:1:2')).toBe(true);
    const req = http.expectOne('api/v1/progress');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ ids: ['boss:1:2'], done: true });
    req.flush({});
    await saving;
    expect(store.saveFailed()).toBe(false);
  });

  it('puts the mark back when the server refuses', async () => {
    store.set(['boss:1:2']);
    const saving = store.toggle('boss:1:2'); // unmark
    expect(store.done().has('boss:1:2')).toBe(false);
    http.expectOne('api/v1/progress').flush({ detail: 'x' }, { status: 500, statusText: 'err' });
    await saving;
    expect(store.done().has('boss:1:2')).toBe(true);
    expect(store.saveFailed()).toBe(true);
  });

  it('sends the changes one after the other, in the order of the clicks', async () => {
    const first = store.toggle('boss:1:2');
    const second = store.toggle('boss:1:2'); // unmark again before the first answer
    const req = http.expectOne('api/v1/progress'); // only the first is in flight
    expect(req.request.body).toEqual({ ids: ['boss:1:2'], done: true });
    req.flush({});
    await first;
    await new Promise((r) => setTimeout(r)); // the queued save goes out once the first is settled
    const next = http.expectOne('api/v1/progress');
    expect(next.request.body).toEqual({ ids: ['boss:1:2'], done: false });
    next.flush({});
    await second;
    expect(store.done().has('boss:1:2')).toBe(false);
  });
});
