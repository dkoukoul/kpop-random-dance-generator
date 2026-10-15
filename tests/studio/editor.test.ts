import { describe, expect, test } from 'bun:test';
import { heatPath, readTypedTime } from '../../public/app/studio/editor.js';

describe('typed cut times', () => {
  test.each([
    ['83', 83],
    ['5', 5],
    ['123', 83],
    ['1234', 754],
    ['1:23', 83],
    ['01:02:03', 3723],
    [' 0:45 ', 45],
  ])('%p is %p seconds', (typed, seconds) => {
    expect(readTypedTime(typed)).toBe(seconds);
  });

  test.each(['', 'abc', '1:75', '175', '12345', '1.5'])('%p is not a time', (typed) => {
    expect(readTypedTime(typed)).toBeNull();
  });
});

describe('Most replayed curve', () => {
  test('is a closed shape across the whole strip', () => {
    const d = heatPath([0, 0.5, 1]);
    expect(d.startsWith('M0,20 L0.00,')).toBe(true);
    expect(d).toContain('L50.00,10.50');
    expect(d).toContain('L100.00,1.00');
    expect(d.endsWith('L100,20 Z')).toBe(true);
  });

  test('keeps a sliver for silent parts and is empty without data', () => {
    expect(heatPath([0])).toContain(',19.24');
    expect(heatPath([])).toBe('');
    expect(heatPath(null as any)).toBe('');
  });
});
