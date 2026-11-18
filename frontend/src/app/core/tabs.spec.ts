import { describe, expect, it } from 'vitest';
import { tabAfterKey } from './tabs';

const tabs = ['a', 'b', 'c'];

describe('tabAfterKey', () => {
  it('moves with the arrows and wraps around', () => {
    expect(tabAfterKey(tabs, 'a', 'ArrowRight')).toBe('b');
    expect(tabAfterKey(tabs, 'c', 'ArrowRight')).toBe('a');
    expect(tabAfterKey(tabs, 'a', 'ArrowLeft')).toBe('c');
  });
  it('jumps with Home and End', () => {
    expect(tabAfterKey(tabs, 'b', 'Home')).toBe('a');
    expect(tabAfterKey(tabs, 'b', 'End')).toBe('c');
  });
  it('ignores other keys and unknown tabs', () => {
    expect(tabAfterKey(tabs, 'a', 'Enter')).toBeNull();
    expect(tabAfterKey(tabs, 'x', 'ArrowRight')).toBeNull();
  });
});
