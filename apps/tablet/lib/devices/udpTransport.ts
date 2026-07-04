/**
 * Concrete UdpTransport for the tablet, backed by react-native-udp.
 * Used by the shared Ps5Controller for Wake-on-LAN + status probes.
 */
import dgram from 'react-native-udp';
import { Buffer } from 'buffer';
import type { UdpTransport } from '@casacontrol/shared';

export const nativeUdpTransport: UdpTransport = {
  send(data, port, address) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4' });
      socket.once('error', (err) => {
        socket.close();
        reject(err);
      });
      socket.bind(0, () => {
        socket.setBroadcast(true);
        const buf = Buffer.from(data);
        socket.send(buf, 0, buf.length, port, address, (err) => {
          socket.close();
          if (err) reject(err);
          else resolve();
        });
      });
    });
  },

  request(data, port, address, timeoutMs) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: 'udp4' });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('UDP request timeout'));
      }, timeoutMs);

      socket.once('error', (err) => {
        clearTimeout(timer);
        socket.close();
        reject(err);
      });
      socket.on('message', (msg: Uint8Array) => {
        clearTimeout(timer);
        socket.close();
        resolve(Uint8Array.from(msg));
      });
      socket.bind(0, () => {
        socket.setBroadcast(true);
        const buf = Buffer.from(data);
        socket.send(buf, 0, buf.length, port, address, (err) => {
          if (err) {
            clearTimeout(timer);
            socket.close();
            reject(err);
          }
        });
      });
    });
  },
};
