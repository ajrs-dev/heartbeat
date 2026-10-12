import dns from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { HttpError } from './errors.js';

/**
 * Heartbeat makes HTTP requests to URLs chosen by users, which is a classic server-side request
 * forgery (SSRF) risk: a user could point a monitor at http://169.254.169.254/ (cloud metadata) or
 * at an internal admin service. Defence is layered:
 *
 *   1. `parseTargetUrl` rejects obviously bad URLs when a monitor is created.
 *   2. `createGuardedLookup` re-validates the *resolved* addresses at connect time. Checking the
 *      hostname once and then letting the HTTP client resolve it again would be vulnerable to DNS
 *      rebinding (a name that resolves to a public address first and a private one second).
 *   3. The checker never follows redirects, so a public URL can't bounce us to an internal one.
 */

function isBlockedV4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

function isBlockedV6(address: string): boolean {
  if (address === '::' || address === '::1') return true;
  const first = Number.parseInt(address.split(':')[0] || '0', 16);
  return (
    first === 0 || // unspecified, loopback and IPv4-compatible space
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xff00) === 0xff00 || // multicast
    address.startsWith('64:ff9b:') || // NAT64 can reach IPv4 private space
    address.startsWith('2001:db8:') // documentation range
  );
}

/** True if the address must not be contacted. Anything that isn't a valid IP fails closed. */
export function isBlockedAddress(raw: string): boolean {
  let address = raw.toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) is just IPv4 in disguise.
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (dotted) {
    address = dotted[1]!;
  } else if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    address = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }

  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return true;
}

/** Validates and parses a monitor URL. Throws a 400 HttpError describing the problem. */
export function parseTargetUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'URL must start with http:// or https://');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'URLs with embedded credentials are not allowed');
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) {
      throw new HttpError(400, 'URL points at a private or internal address');
    }
    if (isIP(host) && isBlockedAddress(host)) {
      throw new HttpError(400, 'URL points at a private or internal address');
    }
  }
  return url;
}

export interface SsrfError extends Error {
  code: 'ESSRF';
}

/** A DNS lookup that refuses to return private addresses. Pass as the `lookup` option of http.request. */
export function createGuardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
        const blocked = new Error(`${hostname} resolves to a private or internal address`) as SsrfError;
        blocked.code = 'ESSRF';
        return callback(blocked as NodeJS.ErrnoException, '', 4);
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0]!;
      callback(null, first.address, first.family);
    });
  };
}
