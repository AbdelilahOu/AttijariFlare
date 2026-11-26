import { describe, expect, test } from "vite-plus/test";

import { isSignupsEnabled } from "./index";

describe("isSignupsEnabled", () => {
  test("is off unless explicitly enabled", () => {
    expect(isSignupsEnabled(undefined)).toBe(false);
    expect(isSignupsEnabled("")).toBe(false);
    expect(isSignupsEnabled("false")).toBe(false);
    expect(isSignupsEnabled("maybe")).toBe(false);
    expect(isSignupsEnabled(false)).toBe(false);
  });

  test("accepts explicit true values", () => {
    expect(isSignupsEnabled("true")).toBe(true);
    expect(isSignupsEnabled(" TRUE ")).toBe(true);
    expect(isSignupsEnabled("1")).toBe(true);
    expect(isSignupsEnabled(true)).toBe(true);
  });
});
