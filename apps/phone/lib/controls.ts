/**
 * Phone-side device actions.
 *  - PS5 wake/status go through the hub (the tablet owns the UDP socket).
 *  - Printing is done directly from the phone (Home mode) via shared IPP,
 *    since the phone holds the picked file.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  PrinterController,
  fetchIppTransport,
  type Device,
  type Ps5Status,
  type PrinterStatus,
} from '@casacontrol/shared';
import { hubClient } from './connection';

export function wakePs5(): Promise<{ ok: boolean; result?: unknown }> {
  return hubClient.sendCommand({ action: 'ps5.wake' });
}

export function fetchPs5Status(): Promise<Ps5Status> {
  return hubClient.getPs5Status();
}

export function fetchPrinterStatus(): Promise<PrinterStatus> {
  return hubClient.getPrinterStatus();
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode a base64 string to bytes without relying on atob (Hermes-safe). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_CHARS.indexOf(clean[i]!);
    const b = B64_CHARS.indexOf(clean[i + 1]!);
    const c = clean[i + 2] ? B64_CHARS.indexOf(clean[i + 2]!) : -1;
    const d = clean[i + 3] ? B64_CHARS.indexOf(clean[i + 3]!) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

/**
 * Open the file picker and send the chosen image/PDF to `printer` via IPP.
 * Returns a human-readable result for a toast/alert.
 */
export async function pickAndPrint(printer: Device): Promise<{ ok: boolean; message: string }> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]) return { ok: false, message: 'Cancelled' };

  const asset = res.assets[0];
  try {
    const b64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    const controller = new PrinterController(printer.ip, fetchIppTransport);
    await controller.printDocument(bytes, {
      jobName: asset.name ?? 'CasaControl',
      documentFormat: asset.mimeType ?? 'application/octet-stream',
    });
    return { ok: true, message: `Sent "${asset.name}" to ${printer.name}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
