import { isMac, isWindows } from "@/lib/utils";

/** The TeX distributions someone on this platform might have installed, for
 * copy that names what Oleafly looked for. MacTeX only exists on macOS and
 * MiKTeX is a Windows distribution in practice. */
export function texDistributionNames(mac = isMac, windows = isWindows): string[] {
  if (mac) return ["MacTeX", "TeX Live", "TinyTeX"];
  if (windows) return ["TeX Live", "MiKTeX", "TinyTeX"];
  return ["TeX Live", "TinyTeX"];
}
