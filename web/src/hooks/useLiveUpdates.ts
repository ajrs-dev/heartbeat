import { useEffect, useRef, useState } from 'react';
import type { CheckEvent } from '../types';

/**
 * Subscribes to the server's event stream (SSE). EventSource reconnects on its own after a
 * dropped connection; `connected` lets the UI show whether updates are currently live.
 */
export function useLiveUpdates(onCheck: (event: CheckEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  // Keep the latest callback without re-opening the connection whenever it changes.
  const handler = useRef(onCheck);
  useEffect(() => {
    handler.current = onCheck;
  });

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('check', (e) => handler.current(JSON.parse((e as MessageEvent<string>).data) as CheckEvent));
    return () => source.close();
  }, []);

  return connected;
}
