export type ImportArgs = { remote: boolean; dryRun: boolean; yes: boolean };

export const USAGE = "Usage: npm run import -- [--remote] [--dry-run] [--yes]";
const FLAGS = ["--remote", "--dry-run", "--yes"];

/** A flag the script doesn't know (stop before doing anything). */
export class UsageError extends Error {}

/** Parses CLI flags; throws UsageError for unknown flags, and a readable message when --remote is used without --yes (unless --dry-run). */
export function parseArgs(argv: string[]): ImportArgs {
  const unknown = argv.find((x) => !FLAGS.includes(x));
  if (unknown !== undefined) throw new UsageError(`Unknown option: ${unknown}\n${USAGE}`);
  const a = { remote: argv.includes("--remote"), dryRun: argv.includes("--dry-run"), yes: argv.includes("--yes") };
  if (a.remote && !a.dryRun && !a.yes) {
    throw new Error(
      "--remote writes to the real Cloudflare account (D1 'nature-care', R2 'nature-care-photos').\n" +
        "Check the counts above, then re-run with --yes to confirm: npm run import -- --remote --yes",
    );
  }
  return a;
}
