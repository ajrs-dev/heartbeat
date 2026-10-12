import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { createGuardedLookup, isBlockedAddress, parseTargetUrl } from '../src/ssrf.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // the same address in hex form
    '::ffff:169.254.169.254',
    'not-an-ip', // fails closed
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('parseTargetUrl', () => {
  it('accepts ordinary public URLs', () => {
    expect(parseTargetUrl('https://example.com/health?x=1', false).hostname).toBe('example.com');
  });

  it.each([
    ['ftp://example.com', /http/],
    ['file:///etc/passwd', /http/],
    ['javascript:alert(1)', /http/],
    ['not a url', /valid/],
    ['https://user:pass@example.com', /credentials/],
    ['http://localhost:8080', /private/],
    ['http://api.localhost', /private/],
    ['http://127.0.0.1', /private/],
    ['http://169.254.169.254/latest/meta-data', /private/],
    ['http://[::1]/', /private/],
    ['http://[::ffff:7f00:1]/', /private/],
  ])('rejects %s', (url, message) => {
    expect(() => parseTargetUrl(url, false)).toThrowError(HttpError);
    expect(() => parseTargetUrl(url, false)).toThrowError(message);
  });

  it('allows private targets when explicitly enabled', () => {
    expect(parseTargetUrl('http://127.0.0.1:4000', true).port).toBe('4000');
  });
});

describe('createGuardedLookup', () => {
  const lookup = (host: string, allowPrivate: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address?: unknown }>((resolve) => {
      createGuardedLookup(allowPrivate)(host, {}, (err, address) => resolve({ err, address }));
    });

  it('refuses a name that resolves to loopback (checked at connect time, not just creation)', async () => {
    const { err } = await lookup('localhost', false);
    expect(err?.code).toBe('ESSRF');
  });

  it('resolves loopback when private targets are allowed', async () => {
    const { err, address } = await lookup('localhost', true);
    expect(err).toBeNull();
    expect(typeof address).toBe('string');
  });
});
