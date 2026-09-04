/**
 * The certificate the Gemini translator serves, and the trust that makes
 * Antigravity's language server accept it.
 *
 * The language server is a Go binary with no flag for skipping verification
 * (its whole argument surface was read looking for one), so pointing it at a
 * loopback endpoint means presenting a certificate Windows trusts. That is done
 * with a small authority of our own, minted once, installed into the current
 * user's store — no administrator rights, nothing outside this account — and
 * used to sign a short-lived leaf for `127.0.0.1`.
 *
 * The authority is never re-minted, because trust is recorded against its
 * thumbprint and a new one would leave the old entry behind for nothing. The
 * leaf is re-minted as it ages.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import type { KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bitString, bool, explicit, header, implicit, integer, octetString, oid, publicKeyBits, sequence, set, utcTime, utf8String } from "./der.js";

const OID = {
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extendedKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  subjectKeyIdentifier: "2.5.29.14",
  authorityKeyIdentifier: "2.5.29.35",
  serverAuth: "1.3.6.1.5.5.7.3.1"
} as const;

/** RFC 5758: ECDSA-with-SHA256 carries no parameters, not even a NULL. */
const SIGNATURE_ALGORITHM = sequence(oid(OID.ecdsaWithSha256));

const AUTHORITY_NAME = "BetterGravity Local Authority";
const LEAF_NAME = "BetterGravity Gemini Translator";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A day of slack, so a clock running slightly behind still accepts the leaf. */
const BACKDATE_MS = DAY_MS;
const AUTHORITY_DAYS = 3650;
const LEAF_DAYS = 365;
/** Re-mint the leaf well before it expires rather than on the day. */
const LEAF_REFRESH_DAYS = 300;

/**
 * Names the leaf answers to. `127.0.0.1` is the one that matters, since that is
 * what the endpoint argument is rewritten to; the Google hosts are there so a
 * request that still carries the name it was compiled against also verifies.
 */
const LEAF_HOSTS = ["localhost", "generativelanguage.googleapis.com", "daily-cloudcode-pa.googleapis.com"] as const;
const LEAF_ADDRESSES = ["127.0.0.1"] as const;

/** `O=BetterGravity, CN=<what>`, which is all a local certificate needs. */
function distinguishedName(commonName: string): Buffer {
  const attribute = (type: string, value: string): Buffer => set(sequence(oid(type), utf8String(value)));
  return sequence(attribute(OID.organization, "BetterGravity"), attribute(OID.commonName, commonName));
}

function extension(type: string, critical: boolean, value: Buffer): Buffer {
  return critical
    ? sequence(oid(type), bool(true), octetString(value))
    : sequence(oid(type), octetString(value));
}

function validity(from: Date, days: number): Buffer {
  return sequence(utcTime(new Date(from.getTime() - BACKDATE_MS)), utcTime(new Date(from.getTime() + days * DAY_MS)));
}

/** RFC 5280's key identifier: SHA-1 over the public key's bits. */
function keyIdentifier(spki: Buffer): Buffer {
  return crypto.createHash("sha1").update(publicKeyBits(spki)).digest();
}

/**
 * A serial number that is positive and stays inside the twenty octets X.509
 * allows, whatever the random bytes happen to be.
 */
function serialNumber(): Buffer {
  const bytes = crypto.randomBytes(16);
  bytes[0] = (bytes[0] ?? 1) & 0x7f;
  return bytes;
}

/**
 * dNSName is `[2]` holding the name's bytes; iPAddress is `[7]` holding the
 * address itself, four bytes for IPv4.
 */
function subjectAltName(hosts: readonly string[], addresses: readonly string[]): Buffer {
  return sequence(
    ...hosts.map((host) => implicit(2, Buffer.from(host, "latin1"))),
    ...addresses.map((address) => implicit(7, Buffer.from(address.split(".").map((part) => Number(part) & 0xff))))
  );
}

function signCertificate(tbs: Buffer, key: KeyObject): Buffer {
  // For an EC key `sign` already produces the DER `SEQUENCE { r, s }` that
  // X.509 wants inside the BIT STRING, so nothing has to be repacked.
  return sequence(tbs, SIGNATURE_ALGORITHM, bitString(crypto.createSign("SHA256").update(tbs).sign(key)));
}

function toPem(label: string, body: Buffer): string {
  const wrapped = body.toString("base64").replace(/.{1,64}/g, "$&\n");
  return `-----BEGIN ${label}-----\n${wrapped}-----END ${label}-----\n`;
}

/** One element and where the next one starts, for walking a certificate. */
function element(buffer: Buffer, offset: number): { readonly bytes: Buffer; readonly next: number } {
  const { end } = header(buffer, offset);
  return { bytes: buffer.subarray(offset, end), next: end };
}

/**
 * The authority's subject, read back out of its own bytes rather than rebuilt,
 * so a leaf's issuer matches it exactly however the encoder changes later.
 */
function subjectOf(certificate: Buffer): Buffer {
  const outer = header(certificate, 0);
  const tbs = header(certificate, outer.start);
  let cursor = tbs.start;
  // [0] version is optional in the grammar; ours always writes it.
  if (header(certificate, cursor).tag === 0xa0) cursor = element(certificate, cursor).next;
  cursor = element(certificate, cursor).next; // serialNumber
  cursor = element(certificate, cursor).next; // signature
  cursor = element(certificate, cursor).next; // issuer
  cursor = element(certificate, cursor).next; // validity
  return element(certificate, cursor).bytes; // subject
}

export interface Issued {
  /** DER of the certificate. */
  readonly certificate: Buffer;
  /** PKCS#8 PEM of the key it belongs to. */
  readonly privateKeyPem: string;
}

/** The authority: self-signed, and allowed to sign certificates, nothing else. */
export function mintAuthority(now: Date = new Date()): Issued {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const subject = distinguishedName(AUTHORITY_NAME);

  const tbs = sequence(
    explicit(0, integer(2)),
    integer(serialNumber()),
    SIGNATURE_ALGORITHM,
    subject,
    validity(now, AUTHORITY_DAYS),
    subject,
    spki,
    explicit(
      3,
      sequence(
        extension(OID.basicConstraints, true, sequence(bool(true))),
        // keyCertSign and cRLSign, with the byte's last bit unused.
        extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)),
        extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(spki)))
      )
    )
  );

  return {
    certificate: signCertificate(tbs, privateKey),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

/** The server certificate, signed by the authority above. */
export function mintLeaf(authority: Buffer, authorityKeyPem: string, now: Date = new Date()): Issued {
  const authorityKey = crypto.createPrivateKey(authorityKeyPem);
  const authoritySpki = crypto.createPublicKey(authorityKey).export({ type: "spki", format: "der" });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });

  const tbs = sequence(
    explicit(0, integer(2)),
    integer(serialNumber()),
    SIGNATURE_ALGORITHM,
    subjectOf(authority),
    validity(now, LEAF_DAYS),
    distinguishedName(LEAF_NAME),
    spki,
    explicit(
      3,
      sequence(
        // Not an authority, so nothing can be signed with it in turn.
        extension(OID.basicConstraints, true, sequence()),
        // digitalSignature, which is what an ECDSA server key is used for.
        extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)),
        extension(OID.extendedKeyUsage, false, sequence(oid(OID.serverAuth))),
        // Go has not accepted a common name in place of this since 1.15.
        extension(OID.subjectAltName, false, subjectAltName([...LEAF_HOSTS], [...LEAF_ADDRESSES])),
        extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(spki))),
        extension(OID.authorityKeyIdentifier, false, sequence(implicit(0, keyIdentifier(authoritySpki))))
      )
    )
  );

  return {
    certificate: signCertificate(tbs, authorityKey),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

export interface CertificateFiles {
  readonly directory: string;
  readonly authorityCer: string;
  readonly authorityKey: string;
  readonly leafPem: string;
  readonly leafKey: string;
  readonly trustFile: string;
}

/**
 * All of it lives under the runtime directory in `%APPDATA%`, never in the
 * repository and never inside Antigravity's installation.
 */
export function certificateFiles(directory: string): CertificateFiles {
  return {
    directory,
    authorityCer: path.join(directory, "ca.cer"),
    authorityKey: path.join(directory, "ca.key.pem"),
    leafPem: path.join(directory, "leaf.pem"),
    leafKey: path.join(directory, "leaf.key.pem"),
    trustFile: path.join(directory, "trust.json")
  };
}

export interface CertificateMaterial {
  /** Leaf then authority, which is the chain a TLS server presents. */
  readonly chainPem: string;
  readonly keyPem: string;
  /** DER of the authority: the file the trust store is given. */
  readonly authority: Buffer;
  /** Uppercase hex SHA-1 of that DER, which is how Windows names it. */
  readonly thumbprint: string;
  readonly files: CertificateFiles;
}

export function thumbprintOf(authority: Buffer): string {
  return crypto.createHash("sha1").update(authority).digest("hex").toUpperCase();
}

function readAuthority(files: CertificateFiles): { certificate: Buffer; privateKeyPem: string } | undefined {
  try {
    const certificate = fs.readFileSync(files.authorityCer);
    const privateKeyPem = fs.readFileSync(files.authorityKey, "utf8");
    // Prove both halves are usable before anything is signed with them; a
    // half-written authority is worth replacing rather than failing over.
    crypto.createPrivateKey(privateKeyPem);
    subjectOf(certificate);
    return { certificate, privateKeyPem };
  } catch {
    return undefined;
  }
}

function readLeaf(files: CertificateFiles, now: Date): { chainPem: string; keyPem: string } | undefined {
  try {
    if (now.getTime() - fs.statSync(files.leafPem).mtimeMs >= LEAF_REFRESH_DAYS * DAY_MS) return undefined;
    return {
      chainPem: fs.readFileSync(files.leafPem, "utf8"),
      keyPem: fs.readFileSync(files.leafKey, "utf8")
    };
  } catch {
    return undefined;
  }
}

/**
 * Reads the material, minting whatever is missing or stale. The authority
 * survives every call, because trust is recorded against its thumbprint and
 * replacing it would silently leave the installed entry useless.
 */
export function loadOrMint(files: CertificateFiles, now: Date = new Date()): CertificateMaterial {
  fs.mkdirSync(files.directory, { recursive: true });

  let stored = readAuthority(files);
  if (!stored) {
    const issued = mintAuthority(now);
    stored = { certificate: issued.certificate, privateKeyPem: issued.privateKeyPem };
    fs.writeFileSync(files.authorityCer, issued.certificate, { mode: 0o600 });
    fs.writeFileSync(files.authorityKey, issued.privateKeyPem, { mode: 0o600 });
    // A new authority is not the one that was trusted before it.
    try {
      fs.rmSync(files.trustFile, { force: true });
    } catch {
      // Only a cache; the live check below is what decides.
    }
  }

  let leaf = readLeaf(files, now);
  if (!leaf) {
    const issued = mintLeaf(stored.certificate, stored.privateKeyPem, now);
    leaf = {
      chainPem: `${toPem("CERTIFICATE", issued.certificate)}${toPem("CERTIFICATE", stored.certificate)}`,
      keyPem: issued.privateKeyPem
    };
    fs.writeFileSync(files.leafPem, leaf.chainPem, { mode: 0o600 });
    fs.writeFileSync(files.leafKey, leaf.keyPem, { mode: 0o600 });
  }

  return {
    chainPem: leaf.chainPem,
    keyPem: leaf.keyPem,
    authority: stored.certificate,
    thumbprint: thumbprintOf(stored.certificate),
    files
  };
}

export interface TrustRecord {
  readonly thumbprint: string;
  readonly installedAt: number;
}

/**
 * What was trusted last time. Remembered so a launch can route the language
 * server straight away instead of waiting on a PowerShell probe; the live check
 * runs anyway and corrects this if it is wrong.
 */
export function readTrustRecord(files: CertificateFiles): TrustRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(files.trustFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const thumbprint = record["thumbprint"];
    if (typeof thumbprint !== "string" || thumbprint.length === 0) return undefined;
    const installedAt = record["installedAt"];
    return { thumbprint, installedAt: typeof installedAt === "number" ? installedAt : 0 };
  } catch {
    return undefined;
  }
}

export function writeTrustRecord(files: CertificateFiles, thumbprint: string, now: Date = new Date()): void {
  try {
    const record = { thumbprint, installedAt: now.getTime() };
    fs.writeFileSync(files.trustFile, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Losing the cache costs one probe on the next launch and nothing else.
  }
}

export function forgetTrustRecord(files: CertificateFiles): void {
  try {
    fs.rmSync(files.trustFile, { force: true });
  } catch {
    // As above: advisory only.
  }
}

/** PowerShell single quoting, where a quote is escaped by doubling it. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0) ?? text;
  return line.trim().slice(0, 200);
}

const POWERSHELL_TIMEOUT_MS = 30_000;

function powershell(script: string): Promise<{ readonly ok: boolean; readonly output: string }> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout}\n${stderr}`.trim() })
    );
  });
}

export type TrustState = "trusted" | "untrusted" | "unsupported";

export interface TrustOutcome {
  readonly state: TrustState;
  readonly message: string;
}

/**
 * Whether the authority is in this account's root store. Windows only: Go reads
 * the platform store there, and Antigravity ships nowhere else.
 */
export async function checkTrust(thumbprint: string, platform: string = process.platform): Promise<TrustState> {
  if (platform !== "win32") return "unsupported";
  const { output } = await powershell(`Test-Path -LiteralPath ${quote(`Cert:\\CurrentUser\\Root\\${thumbprint}`)}`);
  return /^true$/im.test(output) ? "trusted" : "untrusted";
}

/**
 * Adds the authority to `Cert:\CurrentUser\Root`. This is the one moment the
 * feature changes anything outside its own directory, and it follows the plugin
 * being switched on — the runtime installs the authority while something asks for
 * the translator and calls {@link removeTrust} when nothing does.
 *
 * The outcome is read back from the store rather than taken from the exit code,
 * so what the panel reports is what is actually installed.
 */
export async function installTrust(
  files: CertificateFiles,
  thumbprint: string,
  platform: string = process.platform
): Promise<TrustOutcome> {
  if (platform !== "win32") {
    return { state: "unsupported", message: "The certificate can only be installed on Windows." };
  }

  const target = quote(files.authorityCer);
  // Import-Certificate is the ordinary route; the store API is the fallback for
  // an installation whose PKI module is unavailable.
  const attempt = await powershell(
    "$ErrorActionPreference='Stop'; " +
      `try { Import-Certificate -FilePath ${target} -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null } ` +
      "catch { $store=New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser'); " +
      "$store.Open('ReadWrite'); " +
      `$store.Add((New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(${target}))); ` +
      "$store.Close() }"
  );

  const state = await checkTrust(thumbprint, platform);
  if (state === "trusted") {
    writeTrustRecord(files, thumbprint);
    return { state, message: "The certificate is trusted for your account." };
  }

  forgetTrustRecord(files);
  return { state, message: attempt.output ? firstLine(attempt.output) : "Windows did not accept the certificate." };
}

/** Takes it back out again, so switching the plugin off undoes what it added. */
export async function removeTrust(
  files: CertificateFiles,
  thumbprint: string,
  platform: string = process.platform
): Promise<TrustOutcome> {
  if (platform !== "win32") {
    return { state: "unsupported", message: "There is nothing to remove on this platform." };
  }

  await powershell(
    `Remove-Item -LiteralPath ${quote(`Cert:\\CurrentUser\\Root\\${thumbprint}`)} -Force -ErrorAction SilentlyContinue`
  );
  forgetTrustRecord(files);
  const state = await checkTrust(thumbprint, platform);
  return state === "trusted"
    ? { state, message: "Windows would not remove the certificate." }
    : { state, message: "The certificate is no longer trusted." };
}
