import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { ProgressStore } from './progress.store';
import { TeamStore } from './team.store';

describe('TeamStore halo', () => {
  let store: TeamStore;
  let progress: ProgressStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TeamStore);
    progress = TestBed.inject(ProgressStore);
    TestBed.inject(AuthService).user.set('alice');
  });

  const team = (...names: string[]) =>
    store.team.set({
      id: 1,
      name: 'T',
      owner_id: 1,
      is_owner: true,
      members: names.map((username, i) => ({ id: i + 1, username })),
    });

  it('without a team, my mark is a full halo', () => {
    expect(store.halo('a:1:1')).toBe('none');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('all');
  });

  it('team of 3: none, orange, blue, violet, green', () => {
    team('alice', 'bob', 'carol');
    expect(store.halo('a:1:1')).toBe('none');
    store.others.set({ 'a:1:1': [2] }); // bob only
    expect(store.halo('a:1:1')).toBe('others');
    store.others.set({ 'a:1:1': [2, 3] }); // bob and carol, not me
    expect(store.halo('a:1:1')).toBe('others');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('all');
    store.others.set({ 'a:1:1': [3] }); // me and carol
    expect(store.halo('a:1:1')).toBe('mine');
    store.others.set({});
    expect(store.halo('a:1:1')).toBe('alone'); // only me
    expect(store.markedBy('a:1:1')).toEqual(['alice']);
  });

  it('team of 2 has no violet: alone, then all', () => {
    team('alice', 'bob');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('alone');
    store.others.set({ 'a:1:1': [2] });
    expect(store.halo('a:1:1')).toBe('all');
  });

  it('team of 4: violet covers every partial case', () => {
    team('alice', 'bob', 'carol', 'dave');
    progress.set(['a:1:1']);
    store.others.set({ 'a:1:1': [2] });
    expect(store.halo('a:1:1')).toBe('mine');
    store.others.set({ 'a:1:1': [2, 3] });
    expect(store.halo('a:1:1')).toBe('mine');
    store.others.set({ 'a:1:1': [2, 3, 4] });
    expect(store.halo('a:1:1')).toBe('all');
  });

  it('a new member turns a full halo blue (nobody else has marked it)', () => {
    team('alice');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('all');
    team('alice', 'bob');
    expect(store.halo('a:1:1')).toBe('alone');
  });
});

describe('TeamStore marks refresh', () => {
  const mine = {
    id: 1,
    name: 'T',
    owner_id: 1,
    is_owner: true,
    members: [{ id: 1, username: 'a' }],
  };

  it('sends the ETag back and keeps the marks on a 304', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(TeamStore);
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).user.set('alice');
    const run = async (marks: { status: number; body?: object; etag?: string }) => {
      const done = store.load();
      http.expectOne('api/v1/team').flush(mine);
      await Promise.resolve();
      await Promise.resolve();
      const req = http.expectOne('api/v1/team/marks');
      const sent = req.request.headers.get('If-None-Match');
      req.flush(marks.body ?? null, {
        status: marks.status,
        statusText: '',
        headers: marks.etag ? { ETag: marks.etag } : {},
      });
      await done;
      return sent;
    };
    expect(await run({ status: 200, body: { marks: { 'a:1:1': [2] } }, etag: '"x"' })).toBeNull();
    expect(await run({ status: 304 })).toBe('"x"');
    expect(store.others()).toEqual({ 'a:1:1': [2] }); // kept
    expect(await run({ status: 200, body: { marks: {} }, etag: '"y"' })).toBe('"x"');
    expect(store.others()).toEqual({});
  });
});
