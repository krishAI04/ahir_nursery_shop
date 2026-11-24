import { describe, expect, it } from "vitest";
import { parseArgs } from "../import-args";

describe("import args", () => {
  it("defaults to local", () => {
    expect(parseArgs([])).toEqual({ remote: false, dryRun: false, yes: false });
  });
  it("refuses --remote without --yes", () => {
    expect(() => parseArgs(["--remote"])).toThrow(/--yes/);
  });
  it("accepts --remote --yes and --remote --dry-run", () => {
    expect(parseArgs(["--remote", "--yes"]).remote).toBe(true);
    expect(parseArgs(["--remote", "--dry-run"]).dryRun).toBe(true);
  });
});

describe("import args: unknown flags", () => {
  it("rejects an unknown or misspelt flag with the usage line", () => {
    expect(() => parseArgs(["--dryrun"])).toThrow(/Unknown option: --dryrun[\s\S]*Usage: npm run import -- \[--remote\] \[--dry-run\] \[--yes\]/);
    expect(() => parseArgs(["remote"])).toThrow(/Unknown option: remote/);
  });
});
