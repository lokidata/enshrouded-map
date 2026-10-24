import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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

  it('orange: others only, violet: me (not everyone), green: all', () => {
    team('alice', 'bob', 'carol');
    store.others.set({ 'a:1:1': [2] });
    expect(store.halo('a:1:1')).toBe('others');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('mine');
    store.others.set({ 'a:1:1': [2, 3] });
    expect(store.halo('a:1:1')).toBe('all');
    expect(store.markedBy('a:1:1')).toEqual(['alice', 'bob', 'carol']);
  });

  it('a new member turns a full halo violet', () => {
    team('alice');
    progress.set(['a:1:1']);
    expect(store.halo('a:1:1')).toBe('all');
    team('alice', 'bob');
    expect(store.halo('a:1:1')).toBe('mine');
  });
});
