import { describe, expect, test } from 'bun:test';
import { clock, parseTime, shortTime } from '../../public/app/studio/util.js';

describe('studio time helpers', () => {
  test('clock pads minutes and shows hours only when needed', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(41)).toBe('00:41');
    expect(clock(402.9)).toBe('06:42');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(-5)).toBe('00:00');
    expect(clock(NaN)).toBe('00:00');
  });

  test('shortTime writes the m:ss the server and project files use', () => {
    expect(shortTime(52)).toBe('0:52');
    expect(shortTime(82)).toBe('1:22');
    expect(shortTime(3725)).toBe('1:02:05');
  });

  test('parseTime reads typed times', () => {
    expect(parseTime('0:52')).toBe(52);
    expect(parseTime('01:22')).toBe(82);
    expect(parseTime(' 1:02:05 ')).toBe(3725);
    expect(parseTime('83')).toBe(83);
    expect(parseTime(83)).toBe(83);
  });

  test.each(['', '1:75', 'abc', '1:2:3:4', '-3', '1.5', null, undefined])('parseTime rejects %p', (v) => {
    expect(parseTime(v as any)).toBeNull();
  });
});
