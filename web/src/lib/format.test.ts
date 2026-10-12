import { describe, expect, it } from 'vitest';
import { bucketTone, formatDuration, formatInterval, formatMs, formatUptime, hostOf, timeAgo } from './format';

describe('formatUptime', () => {
  it('truncates instead of rounding so failures are never hidden', () => {
    expect(formatUptime(99.996)).toBe('99.99%');
    expect(formatUptime(99.9)).toBe('99.90%');
    expect(formatUptime(100)).toBe('100%');
    expect(formatUptime(0)).toBe('0%');
  });
  it('shows a dash when there is no data', () => {
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(undefined)).toBe('—');
  });
});

describe('formatMs', () => {
  it('switches to seconds at one second', () => {
    expect(formatMs(87)).toBe('87 ms');
    expect(formatMs(999.6)).toBe('1000 ms');
    expect(formatMs(1500)).toBe('1.50 s');
    expect(formatMs(null)).toBe('—');
  });
});

describe('formatDuration / timeAgo', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(5 * 60_000 + 20_000)).toBe('5m 20s');
    expect(formatDuration(3 * 3_600_000)).toBe('3h');
    expect(formatDuration(26 * 3_600_000)).toBe('1d 2h');
  });
  it('describes relative times', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo(1_000_000, 1_002_000)).toBe('just now');
    expect(timeAgo(1_000_000, 1_090_000)).toBe('1m 30s ago');
  });
});

describe('misc helpers', () => {
  it('maps bucket health to a tone', () => {
    expect(bucketTone(0, 0)).toBe('empty');
    expect(bucketTone(10, 10)).toBe('good');
    expect(bucketTone(10, 9)).toBe('warn');
    expect(bucketTone(10, 5)).toBe('bad');
  });
  it('formats intervals and hosts', () => {
    expect(formatInterval(30)).toBe('30s');
    expect(formatInterval(300)).toBe('5 min');
    expect(formatInterval(3600)).toBe('1 h');
    expect(hostOf('https://api.example.com/health?x=1')).toBe('api.example.com');
    expect(hostOf('nonsense')).toBe('nonsense');
  });
});
