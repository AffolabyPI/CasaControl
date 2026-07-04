/**
 * Printer control via IPP (Internet Printing Protocol, port 631).
 *
 * Implements just enough IPP/1.1 to:
 *   - Get-Printer-Attributes  -> state + supply (marker) levels
 *   - Print-Job               -> submit a document (image/PDF)
 *
 * IPP is binary-over-HTTP. The HTTP round-trip is injected via `IppTransport`
 * so shared stays native-free; `fetchIppTransport` is a ready default.
 */
import { PORTS } from '../constants';
import type { PrinterState, PrinterStatus } from '../types';

// --- IPP tag constants -----------------------------------------------------
const TAG = {
  operationAttributes: 0x01,
  endOfAttributes: 0x03,
  integer: 0x21,
  enum: 0x23,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  nameWithoutLanguage: 0x42,
  textWithoutLanguage: 0x41,
} as const;

const OP = { getPrinterAttributes: 0x000b, printJob: 0x0002 } as const;

// --- byte writer -----------------------------------------------------------
function ascii(str: string): number[] {
  return Array.from(str, (c) => c.charCodeAt(0) & 0xff);
}
function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function attribute(tag: number, name: string, value: string): number[] {
  const nameB = ascii(name);
  const valB = ascii(value);
  return [tag, ...u16(nameB.length), ...nameB, ...u16(valB.length), ...valB];
}
/** Additional value of a 1setOf attribute (empty name). */
function addValue(tag: number, value: string): number[] {
  const valB = ascii(value);
  return [tag, ...u16(0), ...u16(valB.length), ...valB];
}

function printerUri(host: string): string {
  return `ipp://${host}:${PORTS.ipp}/ipp/print`;
}

function ippHeader(operation: number, requestId = 1): number[] {
  return [0x02, 0x00, ...u16(operation), ...u32(requestId)];
}

function operationHeaderAttrs(host: string): number[] {
  return [
    TAG.operationAttributes,
    ...attribute(TAG.charset, 'attributes-charset', 'utf-8'),
    ...attribute(TAG.naturalLanguage, 'attributes-natural-language', 'en'),
    ...attribute(TAG.uri, 'printer-uri', printerUri(host)),
  ];
}

export function encodeGetPrinterAttributes(host: string): Uint8Array {
  const bytes = [
    ...ippHeader(OP.getPrinterAttributes),
    ...operationHeaderAttrs(host),
    ...attribute(TAG.keyword, 'requested-attributes', 'printer-state'),
    ...addValue(TAG.keyword, 'printer-state-message'),
    ...addValue(TAG.keyword, 'printer-state-reasons'),
    ...addValue(TAG.keyword, 'marker-names'),
    ...addValue(TAG.keyword, 'marker-levels'),
    TAG.endOfAttributes,
  ];
  return Uint8Array.from(bytes);
}

export function encodePrintJob(
  host: string,
  document: Uint8Array,
  opts: { jobName: string; documentFormat: string; user: string },
): Uint8Array {
  const head = [
    ...ippHeader(OP.printJob, 2),
    ...operationHeaderAttrs(host),
    ...attribute(TAG.nameWithoutLanguage, 'requesting-user-name', opts.user),
    ...attribute(TAG.nameWithoutLanguage, 'job-name', opts.jobName),
    ...attribute(TAG.mimeMediaType, 'document-format', opts.documentFormat),
    TAG.endOfAttributes,
  ];
  const out = new Uint8Array(head.length + document.length);
  out.set(head, 0);
  out.set(document, head.length);
  return out;
}

// --- response decoding -----------------------------------------------------

interface DecodedAttrs {
  ints: Record<string, number[]>;
  strings: Record<string, string[]>;
}

/** Minimal IPP response attribute parser (enough for state + markers). */
export function decodeAttributes(data: Uint8Array): DecodedAttrs {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ints: Record<string, number[]> = {};
  const strings: Record<string, string[]> = {};

  let pos = 8; // skip version(2) + status(2) + request-id(4)
  let lastName = '';

  while (pos < data.length) {
    const tag = data[pos++]!;
    if (tag === TAG.endOfAttributes) break;
    if (tag <= 0x05) continue; // delimiter/group tag — move on

    const nameLen = view.getUint16(pos);
    pos += 2;
    const name = nameLen > 0 ? asciiSlice(data, pos, nameLen) : lastName;
    pos += nameLen;
    if (nameLen > 0) lastName = name;

    const valLen = view.getUint16(pos);
    pos += 2;

    if (tag === TAG.integer || tag === TAG.enum) {
      const n = valLen === 4 ? view.getInt32(pos) : 0;
      (ints[name] ??= []).push(n);
    } else {
      (strings[name] ??= []).push(asciiSlice(data, pos, valLen));
    }
    pos += valLen;
  }
  return { ints, strings };
}

function asciiSlice(data: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(data[start + i]!);
  return s;
}

const STATE_MAP: Record<number, PrinterState> = {
  3: 'ready', // idle
  4: 'busy', // processing
  5: 'stopped',
};

export function statusFromAttributes(attrs: DecodedAttrs): PrinterStatus {
  const stateEnum = attrs.ints['printer-state']?.[0];
  const names = attrs.strings['marker-names'] ?? [];
  const levels = attrs.ints['marker-levels'] ?? [];
  const supplies: Record<string, number> = {};
  names.forEach((n, i) => {
    if (typeof levels[i] === 'number') supplies[n] = levels[i]!;
  });

  return {
    state: stateEnum ? (STATE_MAP[stateEnum] ?? 'unknown') : 'unknown',
    stateMessage:
      attrs.strings['printer-state-message']?.[0] ??
      attrs.strings['printer-state-reasons']?.[0] ??
      null,
    supplies,
  };
}

// --- transport + controller ------------------------------------------------

export interface IppTransport {
  /** POST binary IPP `body` to `url`, return the binary IPP response. */
  post(url: string, body: Uint8Array): Promise<Uint8Array>;
}

/** Default fetch-based transport (works where RN fetch supports binary bodies). */
export const fetchIppTransport: IppTransport = {
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp' },
      body: body as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`IPP HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

export class PrinterController {
  constructor(
    private readonly host: string,
    private readonly transport: IppTransport = fetchIppTransport,
  ) {}

  private url(): string {
    return `http://${this.host}:${PORTS.ipp}/ipp/print`;
  }

  async getStatus(): Promise<PrinterStatus> {
    try {
      const reply = await this.transport.post(
        this.url(),
        encodeGetPrinterAttributes(this.host),
      );
      return statusFromAttributes(decodeAttributes(reply));
    } catch {
      return { state: 'offline', stateMessage: null, supplies: {} };
    }
  }

  async printDocument(
    document: Uint8Array,
    opts: { jobName?: string; documentFormat?: string; user?: string } = {},
  ): Promise<void> {
    const body = encodePrintJob(this.host, document, {
      jobName: opts.jobName ?? 'CasaControl Job',
      documentFormat: opts.documentFormat ?? 'application/octet-stream',
      user: opts.user ?? 'CasaControl',
    });
    await this.transport.post(this.url(), body);
  }
}
