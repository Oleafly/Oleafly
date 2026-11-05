import {
  IMPORT_COMPAT_CATALOG,
  type ImportCompatFinding,
  type ImportCompatFindingId,
} from "@oleafly/latex";
import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";

function catalogEntry(finding: ImportCompatFinding) {
  return finding.id in IMPORT_COMPAT_CATALOG
    ? IMPORT_COMPAT_CATALOG[finding.id as ImportCompatFindingId]
    : null;
}

export function engineFindingTitle(finding: ImportCompatFinding): string {
  const entry = catalogEntry(finding);
  if (entry?.title !== finding.title) return finding.title;
  const id = finding.id as ImportCompatFindingId;
  return i18n.t(($) => $.shell.enginePicker.findings[id].title, { defaultValue: finding.title });
}

function findingNote(finding: ImportCompatFinding): string {
  const { file, missing, status } = finding.params ?? {};
  if (file) return i18n.t(($) => $.shell.enginePicker.findingNotes.epsFile, { file });
  if (missing && missing.length > 0) {
    return i18n.t(($) => $.shell.enginePicker.findingNotes.missingFiles, { files: formatList(missing) });
  }
  if (status) return i18n.t(($) => $.shell.enginePicker.findingNotes.mirrorStatus, { status });
  return "";
}

export function engineFindingDetail(finding: ImportCompatFinding): string {
  const entry = catalogEntry(finding);
  if (!entry || !finding.detail.startsWith(entry.detail)) return finding.detail;
  const id = finding.id as ImportCompatFindingId;
  const detail = i18n.t(($) => $.shell.enginePicker.findings[id].detail, { defaultValue: entry.detail });
  const note = findingNote(finding);
  return note ? `${detail} ${note}` : detail;
}
