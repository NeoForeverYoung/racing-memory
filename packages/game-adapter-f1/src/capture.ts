/** Binary capture primitives shared by the live receiver and offline replay. */
export const F1_UDP_CAPTURE_VERSION = 1;

const MAGIC = new Uint8Array([0x4c, 0x57, 0x46, 0x31, 0x55, 0x44, 0x50, 0x0a]); // "LWF1UDP\n"
const HEADER_BYTES = 12;
const RECORD_PREFIX_BYTES = 12;

export interface F1UdpDatagram {
  /** Unix epoch milliseconds measured by the receiver, not the game. */
  receivedAtMs: number;
  bytes: Uint8Array;
}

export class F1UdpCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "F1UdpCaptureError";
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function bytesOf(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function assertDatagram(datagram: F1UdpDatagram): void {
  if (!Number.isSafeInteger(datagram.receivedAtMs) || datagram.receivedAtMs < 0) {
    throw new F1UdpCaptureError("receivedAtMs must be a non-negative safe integer.");
  }
  if (datagram.bytes.byteLength > 0xffff_ffff) {
    throw new F1UdpCaptureError("UDP datagram exceeds the capture format limit.");
  }
}

export function encodeF1UdpCaptureHeader(): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  const view = new DataView(header.buffer);
  view.setUint16(8, F1_UDP_CAPTURE_VERSION, true);
  view.setUint16(10, HEADER_BYTES, true);
  return header;
}

export function encodeF1UdpCaptureRecord(datagram: F1UdpDatagram): Uint8Array {
  assertDatagram(datagram);
  const record = new Uint8Array(RECORD_PREFIX_BYTES + datagram.bytes.byteLength);
  const view = new DataView(record.buffer);
  view.setBigUint64(0, BigInt(datagram.receivedAtMs), true);
  view.setUint32(8, datagram.bytes.byteLength, true);
  record.set(datagram.bytes, RECORD_PREFIX_BYTES);
  return record;
}

/** Encodes a versioned, length-prefixed `.f1udp` capture without opening a socket. */
export function encodeF1UdpCapture(datagrams: readonly F1UdpDatagram[]): Uint8Array {
  return concat([encodeF1UdpCaptureHeader(), ...datagrams.map(encodeF1UdpCaptureRecord)]);
}

/** Decodes all records, rejecting truncated, unsupported, or trailing-corrupt data. */
export function decodeF1UdpCapture(input: ArrayBuffer | Uint8Array): F1UdpDatagram[] {
  const bytes = bytesOf(input);
  if (bytes.byteLength < HEADER_BYTES) throw new F1UdpCaptureError("Capture is shorter than its header.");
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) throw new F1UdpCaptureError("Capture magic does not identify an F1 UDP capture.");
  }

  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  const version = header.getUint16(8, true);
  const headerLength = header.getUint16(10, true);
  if (version !== F1_UDP_CAPTURE_VERSION) {
    throw new F1UdpCaptureError(`Unsupported F1 UDP capture version: ${version}.`);
  }
  if (headerLength < HEADER_BYTES || headerLength > bytes.byteLength) {
    throw new F1UdpCaptureError("Capture has an invalid header length.");
  }

  const datagrams: F1UdpDatagram[] = [];
  let offset = headerLength;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < RECORD_PREFIX_BYTES) {
      throw new F1UdpCaptureError("Capture ends in a truncated record prefix.");
    }
    const prefix = new DataView(bytes.buffer, bytes.byteOffset + offset, RECORD_PREFIX_BYTES);
    const receivedAtMs = Number(prefix.getBigUint64(0, true));
    const length = prefix.getUint32(8, true);
    offset += RECORD_PREFIX_BYTES;
    if (!Number.isSafeInteger(receivedAtMs)) {
      throw new F1UdpCaptureError("Capture contains a timestamp outside the safe integer range.");
    }
    if (length > bytes.byteLength - offset) {
      throw new F1UdpCaptureError("Capture ends in a truncated UDP datagram.");
    }
    datagrams.push({ receivedAtMs, bytes: Uint8Array.from(bytes.subarray(offset, offset + length)) });
    offset += length;
  }
  return datagrams;
}
