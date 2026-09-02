import { describe, expect, it } from "vitest";
import { parseProcessIds } from "../src/native/process.js";

describe("parseProcessIds", () => {
  it("reads the ids PowerShell prints, one per line", () => {
    expect(parseProcessIds("1234\r\n5678\r\n")).toEqual([1234, 5678]);
  });

  it("ignores blank lines and stray whitespace", () => {
    expect(parseProcessIds("\n  4242  \n\n")).toEqual([4242]);
  });

  it("ignores anything that is not a process id", () => {
    expect(parseProcessIds("ProcessId\n-----\n99\n0\n-3\n")).toEqual([99]);
  });

  it("returns nothing for empty output", () => {
    expect(parseProcessIds("")).toEqual([]);
  });

  // Regression: the update guardian runs the Antigravity binary as a plain Node
  // process, so it showed up as the very application it was waiting on and
  // would have waited for itself forever.
  it("excludes the ids it is told to ignore", () => {
    expect(parseProcessIds("111\n222\n333\n", [222])).toEqual([111, 333]);
  });

  it("can exclude every match", () => {
    expect(parseProcessIds("111\n", [111])).toEqual([]);
  });
});
