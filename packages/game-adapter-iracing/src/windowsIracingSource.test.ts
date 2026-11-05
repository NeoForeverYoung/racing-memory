import { describe, expect, it } from "vitest";
import { WindowsIracingSource } from "./windowsIracingSource";

describe("WindowsIracingSource", () => {
  it.skipIf(process.platform === "win32")("fails clearly before loading FFI on non-Windows hosts", async () => {
    const iterator = new WindowsIracingSource().events()[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow("only on Windows");
  });
});
