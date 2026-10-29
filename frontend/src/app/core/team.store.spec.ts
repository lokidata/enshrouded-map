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
