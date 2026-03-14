// ============================================================
// CORTEX-PM: WebSocket Hook
// Connects to backend WS, emits typed events.
// Auto-reconnects on disconnect.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';

export interface WSMessage {
  type: string;
  data: any;
  timestamp: string;
}

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    // --- Determine WS URL ---
    const wsUrl = import.meta.env.VITE_WS_URL
      || `ws://${window.location.hostname}:4000`;

    console.log(`[WS] Connecting to ${wsUrl}/ws`);
    const ws = new WebSocket(`${wsUrl}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        onMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 3s...');
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { connected };
}
