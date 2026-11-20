import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ViewStore } from './view.store';

describe('ViewStore add-on', () => {
  it('openAddon sets the view and the id', () => {
    const v = TestBed.inject(ViewStore);
    expect(v.addonId()).toBeNull();
    v.openAddon('server');
    expect(v.view()).toBe('addon');
    expect(v.addonId()).toBe('server');
  });
});
