import { describe, expect, it } from "vitest";

import { decodeInternalTime } from "./texture.ts";

describe("decodeInternalTime", () => {
  it("reads a little-endian double", () => {
    expect(decodeInternalTime(-914663696, 1090025623)).toBeCloseTo(
      100233.4867,
      3,
    );
  });

  it("reads 32.32 fixed-point FTime", () => {
    // High int is whole seconds; the low int is the fraction.
    expect(decodeInternalTime(-746372779, 93888)).toBeCloseTo(93888.826, 3);
  });

  it("treats an unset pair as zero", () => {
    expect(decodeInternalTime(0, 0)).toBe(0);
  });
});
