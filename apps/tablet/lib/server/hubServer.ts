/**
 * Minimal HTTP/1.1 server for the tablet hub, built on react-native-tcp-socket.
 *
 * React Native can't run Express or a socket.io *server*, so we hand-roll a
 * tiny request parser over a raw TCP server. Routes are injected as handlers so
 * this module stays decoupled from the Spotify/device stores.
 */
import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { createLogger, type CasaAction } from '@casacontrol/shared';

const log = createLogger('hub-server');

export interface HubHandlers {
  getHealth: () => Promise<Record<string, unknown>>;
  getDevices: () => Promise<unknown>;
  getPlayback: () => Promise<unknown>;
  getPs5Status: () => Promise<unknown>;
  getPrinterStatus: () => Promise<unknown>;
  getSystemVolume: () => Promise<number>;
  bleDiscover: () => Promise<unknown>;
  bleWrite: (id: string, svc: string, chr: string, val: string, resp: boolean) => Promise<void>;
  spotifyDevices: () => Promise<unknown>;
  spotifySearch: (query: string) => Promise<unknown>;
  spotifyStart: (uri: string) => Promise<unknown>;
  spotifyRemoteConnect: () => Promise<unknown>;
  profilesList: () => Promise<unknown>;
  profileSave: (body: unknown) => Promise<unknown>;
  profileExecute: (body: unknown) => Promise<unknown>;
  profileDelete: (body: unknown) => Promise<unknown>;
  goveeDevices: () => Promise<unknown>;
  goveeScenes: (sku: string, device: string) => Promise<unknown>;
  goveeDiyScenes: (sku: string, device: string) => Promise<unknown>;
  goveeState: (sku: string, device: string) => Promise<unknown>;
  shieldStatus: () => Promise<unknown>;
  shieldPairStart: () => Promise<unknown>;
  shieldPairCode: (code: string) => Promise<unknown>;
  shieldConnect: () => Promise<unknown>;
  runCommand: (action: CasaAction) => Promise<unknown>;
}

interface ParsedRequest {
  method: string;
  path: string;
  body: string;
}

/** Split a raw path into its pathname and decoded query params. */
function splitQuery(path: string): { pathname: string; query: Record<string, string> } {
  const qi = path.indexOf('?');
  if (qi === -1) return { pathname: path, query: {} };
  const pathname = path.slice(0, qi);
  const query: Record<string, string> = {};
  for (const pair of path.slice(qi + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? '' : pair.slice(eq + 1);
    try {
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      query[k] = v;
    }
  }
  return { pathname, query };
}

function parseRequest(raw: string): ParsedRequest | null {
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null; // headers not complete yet

  const head = raw.slice(0, headerEnd);
  const lines = head.split('\r\n');
  const requestLine = lines[0] ?? '';
  const [method = 'GET', path = '/'] = requestLine.split(' ');

  const lenLine = lines.find((l) => l.toLowerCase().startsWith('content-length:'));
  const contentLength = lenLine ? parseInt(lenLine.split(':')[1]!.trim(), 10) : 0;

  const body = raw.slice(headerEnd + 4);
  if (body.length < contentLength) return null; // body still arriving
  return { method: method.toUpperCase(), path, body };
}

function httpResponse(status: number, payload: unknown): string {
  const body = JSON.stringify(payload);
  const statusText = status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Error';
  return (
    `HTTP/1.1 ${status} ${statusText}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Access-Control-Allow-Origin: *\r\n' +
    'Connection: close\r\n' +
    '\r\n' +
    body
  );
}

export class HubServer {
  private server: ReturnType<typeof TcpSocket.createServer> | null = null;
  private readonly startedAt = Date.now();

  constructor(private readonly handlers: HubHandlers) {}

  start(port: number): void {
    if (this.server) return;
    this.server = TcpSocket.createServer((socket) => {
      let buffer = '';
      let handled = false;
      socket.on('data', (data) => {
        if (handled) return; // one request/response per connection (Connection: close)
        buffer += typeof data === 'string' ? data : data.toString('utf8');
        const req = parseRequest(buffer);
        if (!req) return; // headers/body still arriving
        handled = true;
        this.route(req)
          .then((res) => this.send(socket, res))
          .catch((e) =>
            this.send(socket, httpResponse(500, { ok: false, error: String(e) })),
          );
      });
      socket.on('error', () => {
        try {
          socket.destroy();
        } catch {
          /* noop */
        }
      });
    });

    this.server.on('error', (e: unknown) => log.error('server error', String(e)));
    this.server.listen({ port, host: '0.0.0.0' });
  }

  /**
   * Write the response and close *gracefully*. `socket.end(data)` flushes the
   * data and then sends a FIN — unlike the previous `write()` + immediate
   * `destroy()`, which raced the OS flush and frequently RST-reset the
   * connection, making real HTTP clients (OkHttp/fetch, curl) fail intermittently.
   */
  private send(socket: ReturnType<typeof TcpSocket.createConnection>, res: string): void {
    try {
      socket.end(res);
    } catch (e) {
      log.error('failed to write response', String(e));
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private async route(req: ParsedRequest): Promise<string> {
    const { method } = req;
    const { pathname: path, query } = splitQuery(req.path);
    try {
      if (method === 'GET' && path === '/health') {
        const extra = await this.handlers.getHealth().catch(() => ({}));
        return httpResponse(200, { ok: true, uptimeMs: Date.now() - this.startedAt, ...extra });
      }
      if (method === 'GET' && path === '/devices') {
        return httpResponse(200, await this.handlers.getDevices());
      }
      if (method === 'GET' && path === '/playback') {
        return httpResponse(200, await this.handlers.getPlayback());
      }
      if (method === 'GET' && path === '/ps5/status') {
        return httpResponse(200, await this.handlers.getPs5Status());
      }
      if (method === 'GET' && path === '/printer/status') {
        return httpResponse(200, await this.handlers.getPrinterStatus());
      }
      if (method === 'GET' && path === '/system/volume') {
        return httpResponse(200, { volume: await this.handlers.getSystemVolume() });
      }
      if (method === 'GET' && path === '/ble/discover') {
        return httpResponse(200, await this.handlers.bleDiscover());
      }
      if (method === 'GET' && path === '/ble/wake') {
        await this.handlers.runCommand({ action: 'speaker.wake' });
        return httpResponse(200, { ok: true, action: 'speaker.wake' });
      }
      if (method === 'GET' && path === '/ble/sleep') {
        await this.handlers.runCommand({ action: 'speaker.sleep' });
        return httpResponse(200, { ok: true, action: 'speaker.sleep' });
      }
      // Spotify test/debug routes (the phone normally uses POST /command):
      if (method === 'GET' && path === '/spotify/devices') {
        return httpResponse(200, await this.handlers.spotifyDevices());
      }
      if (method === 'GET' && path === '/spotify/search') {
        return httpResponse(200, await this.handlers.spotifySearch(query.q ?? ''));
      }
      if (method === 'GET' && path === '/spotify/start') {
        if (!query.uri) return httpResponse(400, { ok: false, error: 'need uri' });
        return httpResponse(200, await this.handlers.spotifyStart(query.uri));
      }
      // One-time App Remote authorization (call with the tablet unlocked).
      if (method === 'GET' && path === '/spotify/remote-connect') {
        return httpResponse(200, await this.handlers.spotifyRemoteConnect());
      }
      // Generic BLE write for discovery/debugging:
      //   /ble/write?id=MAC&svc=UUID&chr=UUID&val=BASE64&resp=1
      if (method === 'GET' && path === '/ble/write') {
        const { id, svc, chr, val } = query;
        if (!id || !svc || !chr || !val) {
          return httpResponse(400, { ok: false, error: 'need id, svc, chr, val' });
        }
        await this.handlers.bleWrite(id, svc, chr, val, query.resp !== '0');
        return httpResponse(200, { ok: true, wrote: { id, svc, chr, val, resp: query.resp !== '0' } });
      }
      // --- Adaptive device profiles ---
      if (method === 'GET' && path === '/profiles') {
        return httpResponse(200, await this.handlers.profilesList());
      }
      if (method === 'POST' && path === '/profiles/save') {
        return httpResponse(200, await this.handlers.profileSave(JSON.parse(req.body || '{}')));
      }
      if (method === 'POST' && path === '/profiles/execute') {
        return httpResponse(200, await this.handlers.profileExecute(JSON.parse(req.body || '{}')));
      }
      if (method === 'POST' && path === '/profiles/delete') {
        return httpResponse(200, await this.handlers.profileDelete(JSON.parse(req.body || '{}')));
      }
      // --- Govee lights ---
      if (method === 'GET' && path === '/govee/devices') {
        return httpResponse(200, await this.handlers.goveeDevices());
      }
      if (method === 'GET' && path === '/govee/scenes') {
        return httpResponse(200, await this.handlers.goveeScenes(query.sku ?? '', query.device ?? ''));
      }
      if (method === 'GET' && path === '/govee/diy-scenes') {
        return httpResponse(200, await this.handlers.goveeDiyScenes(query.sku ?? '', query.device ?? ''));
      }
      if (method === 'GET' && path === '/govee/state') {
        return httpResponse(200, await this.handlers.goveeState(query.sku ?? '', query.device ?? ''));
      }
      // --- Nvidia Shield / Android TV ---
      if (method === 'GET' && path === '/shield/status') {
        return httpResponse(200, await this.handlers.shieldStatus());
      }
      if (method === 'POST' && path === '/shield/pair/start') {
        return httpResponse(200, await this.handlers.shieldPairStart());
      }
      if (method === 'POST' && path === '/shield/pair/code') {
        const code = (JSON.parse(req.body || '{}') as { code?: string }).code ?? '';
        if (!code) return httpResponse(400, { ok: false, error: 'need code' });
        return httpResponse(200, await this.handlers.shieldPairCode(code));
      }
      if (method === 'POST' && path === '/shield/connect') {
        return httpResponse(200, await this.handlers.shieldConnect());
      }
      if (method === 'POST' && path === '/command') {
        const action = JSON.parse(req.body || '{}') as CasaAction;
        const result = await this.handlers.runCommand(action);
        return httpResponse(200, { ok: true, result });
      }
      return httpResponse(404, { ok: false, error: 'not found' });
    } catch (e) {
      return httpResponse(500, { ok: false, error: String(e) });
    }
  }
}
