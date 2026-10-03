import { i18n } from "@/i18n";
import type { CompileError } from "@/lib/tauri";

const DOWNLOAD_FAILED = /^failed to download package\b/;
const DOWNLOAD_URL = /\/([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_-]*)-(\d+\.\d+\.\d+)\.tar\.gz/;
const NOT_FOUND = /^package not found \(searched for (@([a-z0-9][a-z0-9_-]*)\/[a-z0-9][a-z0-9_-]*:\d+\.\d+\.\d+)\)/;
const VERSION_MISSING = /^package found, but version (\S+) does not exist(?: \(latest is ([^)\s]+)\))?/;

function downloadExplanation(message: string, offline: boolean): string {
  const url = DOWNLOAD_URL.exec(message);
  const spec = url ? `@${url[1]}/${url[2]}:${url[3]}` : null;
  if (offline) {
    return spec
      ? i18n.t(($) => $.core.compile.typstPackage.offlineNotCached, { spec })
      : i18n.t(($) => $.core.compile.typstPackage.offlineNotCachedUnnamed);
  }
  return spec
    ? i18n.t(($) => $.core.compile.typstPackage.downloadFailed, { spec })
    : i18n.t(($) => $.core.compile.typstPackage.downloadFailedUnnamed);
}

function explanationFor(message: string, offline: boolean): string | null {
  const text = message.trim();
  if (DOWNLOAD_FAILED.test(text)) return downloadExplanation(text, offline);
  const missing = NOT_FOUND.exec(text);
  if (missing) {
    return missing[2] === "preview"
      ? i18n.t(($) => $.core.compile.typstPackage.notFound, { spec: missing[1] })
      : i18n.t(($) => $.core.compile.typstPackage.localNotFound, { spec: missing[1] });
  }
  const version = VERSION_MISSING.exec(text);
  if (version) {
    return version[2]
      ? i18n.t(($) => $.core.compile.typstPackage.versionMissing, {
          version: version[1],
          latest: version[2],
        })
      : i18n.t(($) => $.core.compile.typstPackage.versionMissingNoLatest, { version: version[1] });
  }
  return null;
}

export function explainTypstPackageErrors(
  errors: readonly CompileError[],
  offline: boolean,
): CompileError[] {
  return errors.map((error) => {
    if (error.explanation) return error;
    const explanation = explanationFor(error.message, offline);
    return explanation ? { ...error, explanation } : error;
  });
}
