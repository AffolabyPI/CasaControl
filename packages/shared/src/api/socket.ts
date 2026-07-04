import { io, Socket } from 'socket.io-client';
import type {
  CasaAction,
  Device,
  Ps5Status,
  PrinterStatus,
  SpotifyPlaybackState,
} from '../types';
import { SOCKET_EVENTS } from '../constants';

/** Strongly-typed payloads the hub pushes to connected phones. */
export interface HubToPhoneEvents {
  [SOCKET_EVENTS.playbackState]: (state: SpotifyPlaybackState) => void;
  [SOCKET_EVENTS.devicesUpdate]: (devices: Device[]) => void;
  [SOCKET_EVENTS.ps5Status]: (status: Ps5Status) => void;
  [SOCKET_EVENTS.printerStatus]: (status: PrinterStatus) => void;
  [SOCKET_EVENTS.pong]: (sentAt: number) => void;
}

/** Payloads the phone sends up to the hub. */
export interface PhoneToHubEvents {
  [SOCKET_EVENTS.command]: (action: CasaAction) => void;
  [SOCKET_EVENTS.requestSnapshot]: () => void;
  [SOCKET_EVENTS.ping]: (sentAt: number) => void;
}

export type CasaSocket = Socket<HubToPhoneEvents, PhoneToHubEvents>;

/**
 * Create a socket.io client pointed at the hub (tablet).
 * `baseUrl` switches between the local WiFi IP and the Tailscale IP (Phase 5).
 */
export function createHubSocket(baseUrl: string): CasaSocket {
  return io(baseUrl, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    timeout: 8_000,
  });
}

/**
 * Round-trip latency helper used by the phone's connection badge (Phase 5).
 * Resolves with the measured ms, or rejects on timeout.
 */
export function measureLatency(socket: CasaSocket, timeoutMs = 3_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sentAt = Date.now();
    const timer = setTimeout(() => {
      socket.off(SOCKET_EVENTS.pong, onPong);
      reject(new Error('latency timeout'));
    }, timeoutMs);

    const onPong = () => {
      clearTimeout(timer);
      socket.off(SOCKET_EVENTS.pong, onPong);
      resolve(Date.now() - sentAt);
    };

    socket.on(SOCKET_EVENTS.pong, onPong);
    socket.emit(SOCKET_EVENTS.ping, sentAt);
  });
}
