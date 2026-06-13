import type { ServerResponse } from "node:http";

export interface SseHub {
  add(res: ServerResponse): void;
  remove(res: ServerResponse): void;
  broadcast(event: Record<string, unknown>): void;
  count(): number;
  close(): void;
}

/** A tiny Server-Sent-Events fan-out hub with periodic heartbeats. */
export function createSseHub(): SseHub {
  const clients = new Set<ServerResponse>();
  const heartbeat = setInterval(() => {
    for (const r of clients) {
      try {
        r.write(": hb\n\n");
      } catch {
        clients.delete(r);
      }
    }
  }, 25000);
  heartbeat.unref?.();

  return {
    add(res) {
      clients.add(res);
    },
    remove(res) {
      clients.delete(res);
    },
    broadcast(event) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const r of clients) {
        try {
          r.write(payload);
        } catch {
          clients.delete(r);
        }
      }
    },
    count() {
      return clients.size;
    },
    close() {
      clearInterval(heartbeat);
      for (const r of clients) {
        try {
          r.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
    },
  };
}
