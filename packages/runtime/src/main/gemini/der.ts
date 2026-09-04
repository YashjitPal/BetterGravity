/**
 * Just enough ASN.1 DER to mint an X.509 certificate.
 *
 * Antigravity's language server will not talk to an HTTPS endpoint it cannot
 * verify, and it exposes no flag to skip the check, so the translator has to
 * serve a certificate Windows trusts. Node generates keys but not
 * certificates, and a certificate library would be a dependency shipped inside
 * Antigravity for the sake of one file — so the bytes are written by hand, the
 * way the asar pickle and Discord's framing already are.
 *
 * DER is tag-length-value all the way down. Only the definite-length form
 * appears here, which is all a certificate needs.
 */

/** Definite length: short below 128, otherwise a byte count then the bytes. */
function encodeLength(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, ...content: readonly Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.byteLength), body]);
}

export const sequence = (...content: readonly Buffer[]): Buffer => tlv(0x30, ...content);
export const set = (...content: readonly Buffer[]): Buffer => tlv(0x31, ...content);
export const octetString = (value: Buffer): Buffer => tlv(0x04, value);
/** The count of unused trailing bits DER puts first; zero for whole bytes. */
export const bitString = (value: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.from([unused]), value);
export const bool = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
export const utf8String = (value: string): Buffer => tlv(0x0c, Buffer.from(value, "utf8"));
export const ia5String = (value: string): Buffer => tlv(0x16, Buffer.from(value, "latin1"));
export const nullValue = (): Buffer => tlv(0x05);

/** `[n] { ... }`, the shape explicit tagging produces. */
export const explicit = (index: number, ...content: readonly Buffer[]): Buffer => tlv(0xa0 | index, ...content);
/** `[n] value`, the shape implicit tagging produces. */
export const implicit = (index: number, value: Buffer): Buffer => tlv(0x80 | index, value);

/**
 * INTEGER is minimal two's-complement big-endian, so a value whose leading bit
 * is set needs a zero byte in front of it to stay positive. Only non-negative
 * values arise here — serial numbers and version numbers.
 */
export function integer(value: number | Buffer): Buffer {
  if (typeof value === "number") {
    const bytes: number[] = [];
    for (let rest = Math.floor(value); rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
    if (bytes.length === 0) bytes.push(0);
    if (((bytes[0] ?? 0) & 0x80) !== 0) bytes.unshift(0);
    return tlv(0x02, Buffer.from(bytes));
  }

  let start = 0;
  while (start < value.byteLength - 1 && value[start] === 0 && ((value[start + 1] ?? 0) & 0x80) === 0) start += 1;
  const trimmed = value.subarray(start);
  const leading = trimmed[0] ?? 0;
  return (leading & 0x80) !== 0 ? tlv(0x02, Buffer.from([0]), trimmed) : tlv(0x02, trimmed);
}

/**
 * An object identifier. The first two arcs share one byte as `40a + b`, and
 * every arc after that is base-128 with the top bit set on all but its last
 * byte.
 */
export function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map((part) => Number.parseInt(part, 10));
  if (arcs.length < 2 || arcs.some((arc) => !Number.isInteger(arc) || arc < 0)) {
    throw new Error(`${dotted} is not an object identifier.`);
  }

  const bytes: number[] = [40 * (arcs[0] ?? 0) + (arcs[1] ?? 0)];
  for (const arc of arcs.slice(2)) {
    const group = [arc % 128];
    for (let rest = Math.floor(arc / 128); rest > 0; rest = Math.floor(rest / 128)) group.unshift(0x80 | (rest % 128));
    bytes.push(...group);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/**
 * UTCTime, `YYMMDDHHMMSSZ`. X.509 requires it rather than GeneralizedTime for
 * years before 2050, which is every certificate this mints.
 */
export function utcTime(when: Date): Buffer {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const text =
    `${pad(when.getUTCFullYear() % 100)}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}` +
    `${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, "latin1"));
}

export interface DerHeader {
  readonly tag: number;
  /** First byte of the content. */
  readonly start: number;
  /** One past its last byte. */
  readonly end: number;
}

/** Reads the one tag-length header beginning at `offset`. */
export function header(buffer: Buffer, offset: number): DerHeader {
  const tag = buffer[offset];
  const first = buffer[offset + 1];
  if (tag === undefined || first === undefined) throw new Error("DER ended inside a header.");
  if (first < 0x80) return { tag, start: offset + 2, end: offset + 2 + first };

  const count = first & 0x7f;
  let size = 0;
  for (let index = 0; index < count; index += 1) {
    const byte = buffer[offset + 2 + index];
    if (byte === undefined) throw new Error("DER ended inside a length.");
    size = size * 256 + byte;
  }
  return { tag, start: offset + 2 + count, end: offset + 2 + count + size };
}

/**
 * The bytes a key identifier is a hash of. SubjectPublicKeyInfo is
 * `SEQUENCE { algorithm, subjectPublicKey BIT STRING }`, and RFC 5280 hashes
 * the BIT STRING's contents rather than the structure around them.
 */
export function publicKeyBits(spki: Buffer): Buffer {
  const outer = header(spki, 0);
  const algorithm = header(spki, outer.start);
  const key = header(spki, algorithm.end);
  if (key.tag !== 0x03) throw new Error("That is not a SubjectPublicKeyInfo.");
  // Past the unused-bit count, which is zero for a key.
  return spki.subarray(key.start + 1, key.end);
}
