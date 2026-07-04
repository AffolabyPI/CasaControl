// Ambient type shims for native modules that don't ship TypeScript definitions.

declare module 'react-native-zeroconf' {
  export interface ZeroconfService {
    name: string;
    fullName?: string;
    host?: string;
    port?: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
  }

  type ZeroconfEvent =
    | 'start'
    | 'stop'
    | 'found'
    | 'resolved'
    | 'remove'
    | 'update'
    | 'error';

  export default class Zeroconf {
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
    on(event: ZeroconfEvent, callback: (arg: never) => void): void;
    getServices(): Record<string, ZeroconfService>;
  }
}

declare module 'react-native-ping' {
  interface PingOptions {
    timeout?: number;
  }
  const Ping: {
    /** Resolves with round-trip time in ms, or rejects if the host is down. */
    start(ipAddress: string, options?: PingOptions): Promise<number>;
  };
  export default Ping;
}
