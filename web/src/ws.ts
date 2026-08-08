/** Cliente WebSocket: reconexión con backoff, cola de ops hasta el snapshot. */

import { useStore } from "./store";

function uuid(): string {
  return crypto.randomUUID();
}

class WSClient {
  private ws: WebSocket | null = null;
  private token = "";
  private queue: string[] = [];
  private reconnectDelay = 500;
  private closedByUser = false;
  private heartbeatTimer: number | null = null;

  connect(token: string, name: string, clientId: string) {
    this.token = token;
    this.closedByUser = false;
    useStore.setState({ fatalReason: null });
    this.open(name, clientId);
  }

  disconnect() {
    this.closedByUser = true;
    this.ws?.close();
  }

  private open(name: string, clientId: string) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/${this.token}?name=${encodeURIComponent(
      name,
    )}&clientId=${encodeURIComponent(clientId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    const store = useStore.getState();

    ws.onopen = () => {
      this.reconnectDelay = 500;
      this.heartbeatTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat" }));
        }
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const st = useStore.getState();

      if (msg.type === "scene.snapshot") {
        st.applySnapshot(msg);
        // flush de ops encoladas pre-snapshot
        const queued = this.queue;
        this.queue = [];
        for (const text of queued) ws.send(text);
        return;
      }
      // nunca procesar ops antes del snapshot (reconnect race)
      if (!useStore.getState().snapshotReceived) return;

      switch (msg.type) {
        case "op":
          st.applyServerOp(msg.op);
          break;
        case "presence":
          st.applyPresence(msg.users);
          break;
        case "presence.cursor":
          st.applyCursor(msg.clientId, msg.x, msg.y);
          break;
        case "ping":
          st.addPing(msg.x, msg.y, msg.name);
          break;
        case "camera":
          if (useStore.getState().followDm) {
            st.setCamera({ x: msg.x, y: msg.y, scale: msg.scale });
          }
          break;
        case "scene.switched":
          // el snapshot nuevo ya llegó antes de este mensaje
          break;
        case "scene.update":
          st.setSceneUpdate(msg);
          break;
        case "library.update":
          st.setLibrary(msg.library);
          break;
        case "tunnel.url":
          st.setTunnelUrl(msg.url);
          break;
        case "error":
          console.warn("op rechazada:", msg.reason);
          break;
        case "heartbeat":
          break;
      }
    };

    ws.onclose = (ev) => {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      useStore.setState({ connected: false, snapshotReceived: false });
      // cierres fatales: el server rechazó el link o la campaña dejó de
      // existir — reconectar sería un loop inútil
      if (ev.code === 4401 || ev.code === 4409) {
        this.closedByUser = true;
        useStore.setState({
          fatalReason:
            ev.code === 4401
              ? "Este link ya no es válido."
              : "La campaña ya no está disponible (pudo haber sido borrada).",
        });
        return;
      }
      if (!this.closedByUser) {
        setTimeout(() => {
          // reconectar: el snapshot nuevo pisa el estado optimista
          const st = useStore.getState();
          this.open(st.name, st.clientId);
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
      }
    };
  }

  /** Encola si el snapshot todavía no llegó (reconnect race). */
  send(type: string, payload: Record<string, any> = {}) {
    const text = JSON.stringify({ type, opId: uuid(), payload });
    if (this.ws?.readyState === WebSocket.OPEN && useStore.getState().snapshotReceived) {
      this.ws.send(text);
    } else {
      this.queue.push(text);
    }
  }
}

export const wsClient = new WSClient();

// ---- throttles de eventos de alta frecuencia (~30 Hz) -----------------------

const throttled = new Map<string, number>();

export function sendThrottled(key: string, type: string, payload: Record<string, any>) {
  const now = performance.now();
  const last = throttled.get(key) ?? 0;
  if (now - last < 33) return;
  throttled.set(key, now);
  wsClient.send(type, payload);
}
