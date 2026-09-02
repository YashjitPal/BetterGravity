import { describe, expect, it } from "vitest";
import { SUPPORTED_HOST_MAJOR, isSupportedHostVersion } from "../src/index.js";

describe("isSupportedHostVersion", () => {
  it("accepts the supported major line", () => {
    for (const version of ["2.0.0", "2.11.0", "2.12.0", "2.999.1"]) {
      expect(isSupportedHostVersion(version)).toBe(true);
    }
  });

  it("rejects other majors so a reshaped host is never patched blindly", () => {
    for (const version of ["1.9.9", "3.0.0", "10.0.0"]) {
      expect(isSupportedHostVersion(version)).toBe(false);
    }
  });

  it("rejects anything that is not a version string", () => {
    for (const version of [undefined, "", "unknown", "v2.11.0", "two"]) {
      expect(isSupportedHostVersion(version as string | undefined)).toBe(false);
    }
  });

  it("is anchored to the documented major", () => {
    expect(isSupportedHostVersion(`${SUPPORTED_HOST_MAJOR}.0.0`)).toBe(true);
    expect(isSupportedHostVersion(`${SUPPORTED_HOST_MAJOR + 1}.0.0`)).toBe(false);
  });
});
