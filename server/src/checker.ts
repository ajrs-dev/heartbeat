import http from 'node:http';
import https from 'node:https';
import { createGuardedLookup, parseTargetUrl } from './ssrf.js';

export interface CheckResult {
  ok: boolean;
  statusCode: number | null;
  /** Time until response headers arrived, including DNS, TCP and TLS. Null if no response. */
  latencyMs: number | null;
  error: string | null;
}

const failure = (error: string): CheckResult => ({ ok: false, statusCode: null, latencyMs: null, error });

function describeError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'DNS lookup failed';
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
      return 'Connection reset';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Host unreachable';
    case 'ESSRF':
      return err.message;
    default:
      if (err.code?.startsWith('ERR_TLS') || err.code?.includes('CERT') || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
        return `TLS error (${err.code})`;
      }
      return err.message || 'Request failed';
  }
}

/**
 * Performs one HTTP check. A check is "ok" when the server answers with a 2xx or 3xx status.
 * Redirects are deliberately not followed (see ssrf.ts), and a fresh connection is used each time
 * (`agent: false`) so the latency reflects a real connection rather than a reused socket.
 */
export function runCheck(rawUrl: string, timeoutMs: number, allowPrivate: boolean): Promise<CheckResult> {
  let url: URL;
  try {
    url = parseTargetUrl(rawUrl, allowPrivate);
  } catch (err) {
    return Promise.resolve(failure((err as Error).message));
  }

  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;

    const finish = (result: CheckResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        headers: { 'user-agent': 'Heartbeat-Monitor/1.0', accept: '*/*' },
        lookup: createGuardedLookup(allowPrivate),
      },
      (res) => {
        const latencyMs = Math.round(performance.now() - started);
        const statusCode = res.statusCode ?? 0;
        res.destroy(); // We only need the headers.
        const ok = statusCode >= 200 && statusCode < 400;
        finish({ ok, statusCode, latencyMs, error: ok ? null : `HTTP ${statusCode}` });
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish(failure(`Timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    req.on('error', (err) => finish(failure(describeError(err))));
    req.end();
  });
}
