import { useEffect, useRef, useState } from 'react';
import { API_URL, TOKEN_KEY } from '../utils/constants';

/**
 * Subscribe to a backend SSE endpoint.
 *
 * @param {string|null} path  - e.g. "/scraping/events". Pass null to disable.
 * @param {*}           init  - initial value for `data`
 * @returns {{ data: *, connected: boolean }}
 */
export default function useSSE(path, init = null) {
  const [data,      setData]      = useState(init);
  const [connected, setConnected] = useState(false);
  const abortRef  = useRef(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!path) return;

    activeRef.current = true;
    abortRef.current  = new AbortController();

    async function connect() {
      const token = localStorage.getItem(TOKEN_KEY);
      const url   = `${API_URL}${path}`;

      try {
        const resp = await fetch(url, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
          signal:  abortRef.current.signal,
        });

        if (!resp.ok || !resp.body) {
          scheduleReconnect();
          return;
        }

        setConnected(true);
        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let   buf     = '';

        while (activeRef.current) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });

          // SSE frames are separated by double newlines
          const frames = buf.split('\n\n');
          buf = frames.pop();           // keep trailing incomplete frame

          for (const frame of frames) {
            const line = frame.split('\n').find(l => l.startsWith('data: '));
            if (line) {
              try { setData(JSON.parse(line.slice(6))); } catch { /* ignore */ }
            }
          }
        }
      } catch (err) {
        if (!activeRef.current) return; // intentional abort — don't reconnect
        scheduleReconnect();
      } finally {
        setConnected(false);
      }
    }

    function scheduleReconnect() {
      if (activeRef.current) setTimeout(connect, 3000);
    }

    connect();

    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
    };
  }, [path]);

  return { data, connected };
}
