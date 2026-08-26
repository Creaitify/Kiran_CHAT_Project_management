/**
 * Repairs `packages/i18n/locales`.
 *
 * `src/core/instance.ts` loads translations with a relative dynamic import,
 * `import(`../locales/${language}/${namespace}.json`)`. Bundled to
 * `dist/index.js` that resolves to `packages/i18n/locales`, so the directory
 * has to exist next to `dist/` — in the repository it is a symlink to
 * `src/locales`.
 *
 * Two things destroy it:
 *
 *   1. Checking out on Windows without symlink support, or extracting the tree
 *      from a zip. The link arrives as an 11-byte text file containing the
 *      literal string `src/locales`.
 *   2. `pnpm --filter @plane/i18n clean`, which deletes it outright.
 *
 * Either way the failure is silent and expensive to diagnose: Vite's
 * dynamic-import-vars plugin sees no directory, generates an *empty* glob map,
 * every `t()` returns an empty string, and the whole UI renders with blank
 * buttons, labels and placeholders. No console error, no failed request —
 * nothing is ever asked for. It reads as a CSS or hydration bug.
 *
 * So the build repairs the link rather than assuming it. Run by `build`, and
 * safe to run at any time: it is a no-op when the link is already good.
 */

import { existsSync, lstatSync, readdirSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(packageRoot, "src", "locales");
const link = join(packageRoot, "locales");
const repoRoot = resolve(packageRoot, "..", "..");

/** Windows needs an explicit junction; POSIX takes a plain directory symlink. */
const linkType = process.platform === "win32" ? "junction" : "dir";

const log = (message) => console.log(`[i18n] ${message}`);

/**
 * A link is only good if it actually resolves to locale content. A dangling
 * symlink and the zip-extraction text file both pass `existsSync` on some
 * platforms, so check for a readable directory holding the fallback language.
 */
function linkIsHealthy() {
  try {
    if (!lstatSync(link, { throwIfNoEntry: false })) return false;
    return readdirSync(link).includes("en");
  } catch {
    return false;
  }
}

if (!existsSync(target)) {
  // Nothing to point at. Fail loudly — a silent skip here reproduces the exact
  // blank-UI bug this script exists to prevent.
  console.error(`[i18n] FATAL: ${target} does not exist. The package is incomplete.`);
  process.exit(1);
}

if (linkIsHealthy()) {
  log("locales link is healthy");
  process.exit(0);
}

// Remove whatever is in the way: the text file, a dangling link, or an empty dir.
if (lstatSync(link, { throwIfNoEntry: false })) {
  rmSync(link, { recursive: true, force: true });
  log("removed a broken locales entry");
}

try {
  symlinkSync(target, link, linkType);
  log(`linked locales -> src/locales (${linkType})`);
} catch (error) {
  // Windows without Developer Mode refuses symlinks even for junctions in some
  // sandboxes. A copy is worse — it goes stale when a locale is edited — but a
  // stale translation beats a UI with no text in it at all.
  log(`symlink failed (${error.code ?? error.message}); copying instead`);
  cpSync(target, link, { recursive: true });
  log("copied src/locales -> locales — re-run this script after editing a locale");
}

clearStaleViteCaches();

/**
 * Vite memoises the empty glob map from the broken build. Until that cache is
 * dropped the repaired link changes nothing, which is what makes this bug feel
 * unfixable. Only runs when the link was actually repaired; on a genuinely
 * fresh checkout there is no cache and this is a no-op.
 */
function clearStaleViteCaches() {
  const appsDir = join(repoRoot, "apps");
  let apps;
  try {
    apps = readdirSync(appsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of apps) {
    if (!entry.isDirectory()) continue;
    const cache = join(appsDir, entry.name, "node_modules", ".vite");
    if (!existsSync(cache)) continue;
    rmSync(cache, { recursive: true, force: true });
    log(`cleared stale Vite cache in apps/${entry.name}`);
  }
}
