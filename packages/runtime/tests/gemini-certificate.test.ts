import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { integer, oid, sequence, tlv, utcTime } from "../src/main/gemini/der.js";
import {
  certificateFiles,
  loadOrMint,
  mintAuthority,
  mintLeaf,
  readTrustRecord,
  thumbprintOf,
  writeTrustRecord
} from "../src/main/gemini/certificate.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bettergravity-gemini-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) fs.rmSync(directories.pop()!, { recursive: true, force: true });
});

const pem = (certificate: Buffer): string =>
  `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").replace(/.{1,64}/g, "$&\n")}-----END CERTIFICATE-----\n`;

describe("DER encoding", () => {
  it("writes short lengths in one byte and long ones with a count", () => {
    expect(tlv(0x04, Buffer.alloc(3)).subarray(0, 2)).toEqual(Buffer.from([0x04, 0x03]));
    expect(tlv(0x04, Buffer.alloc(200)).subarray(0, 3)).toEqual(Buffer.from([0x04, 0x81, 0xc8]));
    expect(tlv(0x04, Buffer.alloc(400)).subarray(0, 4)).toEqual(Buffer.from([0x04, 0x82, 0x01, 0x90]));
  });

  it("keeps integers positive and minimal", () => {
    expect(integer(0)).toEqual(Buffer.from([0x02, 0x01, 0x00]));
    expect(integer(2)).toEqual(Buffer.from([0x02, 0x01, 0x02]));
    // 0x80 would read as negative, so a zero byte goes in front of it.
    expect(integer(128)).toEqual(Buffer.from([0x02, 0x02, 0x00, 0x80]));
    expect(integer(Buffer.from([0x00, 0x00, 0x01]))).toEqual(Buffer.from([0x02, 0x01, 0x01]));
    expect(integer(Buffer.from([0xff]))).toEqual(Buffer.from([0x02, 0x02, 0x00, 0xff]));
  });

  it("packs the first two arcs of an object identifier into one byte", () => {
    // ecdsa-with-SHA256, whose encoding is fixed by RFC 5758.
    expect(oid("1.2.840.10045.4.3.2")).toEqual(Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]));
    expect(oid("2.5.29.19")).toEqual(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x13]));
  });

  it("refuses something that is not an object identifier", () => {
    expect(() => oid("nonsense")).toThrow(/object identifier/);
  });

  it("writes UTCTime as two-digit years ending in Z", () => {
    const encoded = utcTime(new Date("2026-09-04T05:06:07Z"));
    expect(encoded.subarray(2).toString("latin1")).toBe("260904050607Z");
  });

  it("nests without the caller tracking lengths", () => {
    const nested = sequence(integer(1), sequence(integer(2)));
    expect(nested).toEqual(Buffer.from([0x30, 0x08, 0x02, 0x01, 0x01, 0x30, 0x03, 0x02, 0x01, 0x02]));
  });
});

describe("minting", () => {
  it("produces an authority a certificate library can read", () => {
    const authority = mintAuthority(new Date("2026-09-04T00:00:00Z"));
    const parsed = new crypto.X509Certificate(authority.certificate);

    expect(parsed.ca).toBe(true);
    expect(parsed.subject).toContain("BetterGravity Local Authority");
    // Self-signed, so it verifies against its own key.
    expect(parsed.verify(parsed.publicKey)).toBe(true);
    // Backdated a day, so a clock running slow still accepts it.
    expect(new Date(parsed.validFrom).toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect(new Date(parsed.validTo).getUTCFullYear()).toBe(2036);
  });

  it("signs a leaf that answers to the loopback address", () => {
    const authority = mintAuthority();
    const leaf = mintLeaf(authority.certificate, authority.privateKeyPem);
    const parsed = new crypto.X509Certificate(leaf.certificate);
    const parent = new crypto.X509Certificate(authority.certificate);

    expect(parsed.ca).toBe(false);
    expect(parsed.verify(parent.publicKey)).toBe(true);
    expect(parsed.issuer).toBe(parent.subject);
    expect(parsed.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(parsed.checkHost("localhost")).toBe("localhost");
    expect(parsed.checkHost("daily-cloudcode-pa.googleapis.com")).toBe("daily-cloudcode-pa.googleapis.com");
    expect(parsed.checkHost("example.com")).toBeUndefined();
    // Server authentication, and nothing else.
    expect(parsed.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  it("belongs to the key it was minted with", () => {
    const authority = mintAuthority();
    const leaf = mintLeaf(authority.certificate, authority.privateKeyPem);
    const parsed = new crypto.X509Certificate(leaf.certificate);
    expect(parsed.checkPrivateKey(crypto.createPrivateKey(leaf.privateKeyPem))).toBe(true);
  });
});

describe("material on disk", () => {
  it("mints once and reuses the authority, because trust is tied to it", () => {
    const files = certificateFiles(temporaryDirectory());
    const first = loadOrMint(files);
    const second = loadOrMint(files);

    expect(first.thumbprint).toBe(second.thumbprint);
    expect(second.chainPem).toBe(first.chainPem);
    expect(fs.existsSync(files.authorityCer)).toBe(true);
    expect(fs.existsSync(files.leafKey)).toBe(true);
    // The chain is the leaf and then the authority, in that order.
    expect(first.chainPem.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
    expect(first.chainPem.endsWith(pem(first.authority))).toBe(true);
  });

  it("replaces an ageing leaf but keeps the authority", () => {
    const files = certificateFiles(temporaryDirectory());
    const first = loadOrMint(files);
    // Age the file rather than waiting most of a year for it.
    const stale = new Date(Date.now() - 320 * 24 * 60 * 60 * 1000);
    fs.utimesSync(files.leafPem, stale, stale);

    const later = loadOrMint(files);
    expect(later.thumbprint).toBe(first.thumbprint);
    expect(later.chainPem).not.toBe(first.chainPem);
  });

  it("mints again when the stored authority is unusable", () => {
    const files = certificateFiles(temporaryDirectory());
    const first = loadOrMint(files);
    fs.writeFileSync(files.authorityKey, "not a key");

    const replaced = loadOrMint(files);
    expect(replaced.thumbprint).not.toBe(first.thumbprint);
  });

  it("names the authority by its SHA-1, the way Windows does", () => {
    const files = certificateFiles(temporaryDirectory());
    const material = loadOrMint(files);
    expect(material.thumbprint).toMatch(/^[0-9A-F]{40}$/);
    expect(material.thumbprint).toBe(crypto.createHash("sha1").update(material.authority).digest("hex").toUpperCase());
    expect(thumbprintOf(material.authority)).toBe(material.thumbprint);
  });

  it("remembers what was trusted, and forgets it when the authority changes", () => {
    const files = certificateFiles(temporaryDirectory());
    const material = loadOrMint(files);
    writeTrustRecord(files, material.thumbprint, new Date("2026-09-04T00:00:00Z"));
    expect(readTrustRecord(files)).toEqual({
      thumbprint: material.thumbprint,
      installedAt: new Date("2026-09-04T00:00:00Z").getTime()
    });

    fs.rmSync(files.authorityCer);
    loadOrMint(files);
    expect(readTrustRecord(files)).toBeUndefined();
  });

  it("ignores a trust record that is not one", () => {
    const files = certificateFiles(temporaryDirectory());
    loadOrMint(files);
    fs.writeFileSync(files.trustFile, "{ not json");
    expect(readTrustRecord(files)).toBeUndefined();
  });
});

describe("serving TLS with it", () => {
  /**
   * The point of the whole file: a client that trusts only this authority
   * completes a handshake against the loopback address. Go's verifier is not
   * Node's, but both want a chain to a trusted root, a matching address in the
   * subject alternative name, and server authentication in the key usage.
   */
  it("is accepted by a client that trusts only the authority", async () => {
    const material = loadOrMint(certificateFiles(temporaryDirectory()));
    const server = https.createServer({ cert: material.chainPem, key: material.keyPem }, (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
    await new Promise<void>((resolve) => void server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const answer = await new Promise<string>((resolve, reject) => {
        const request = https.request(
          { host: "127.0.0.1", port, path: "/", method: "GET", ca: pem(material.authority) },
          (response) => {
            let text = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              text += chunk;
            });
            response.on("end", () => resolve(`${response.statusCode ?? 0} ${text}`));
          }
        );
        request.on("error", reject);
        request.end();
      });
      expect(answer).toBe("200 ok");
    } finally {
      await new Promise<void>((resolve) => void server.close(() => resolve()));
    }
  });
});
