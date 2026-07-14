export function buildStandaloneDoc(opts: {
  code: string;
  packages?: string[];
  libraries?: string[];
  background?: string;
}): string {
  const packages = ["tikz", ...(opts.packages ?? [])];
  const seen = new Set<string>();
  const uniquePackages = packages.filter((p) => {
    const k = p.trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const libs = [...new Set((opts.libraries ?? []).map((l) => l.trim()).filter(Boolean))];
  const usepackages = uniquePackages.map((p) => `\\usepackage{${p}}`).join("\n");
  const uselibs = libs.length ? `\\usetikzlibrary{${libs.join(",")}}\n` : "";
  // A page background fills the whole cropped image (border included) via
  // \pagecolor; xcolor is required and provided by \usepackage{xcolor}.
  const bgHex = (opts.background ?? "").replace("#", "").toUpperCase();
  const hasBg = /^[0-9A-F]{6}$/.test(bgHex);
  const bgPkg = hasBg ? "\\usepackage{xcolor}\n" : "";
  const bgDef = hasBg ? `\\definecolor{obgcolor}{HTML}{${bgHex}}\n\\pagecolor{obgcolor}\n` : "";
  return (
    `\\documentclass[tikz,border=4pt]{standalone}\n` +
    bgPkg +
    `${usepackages}\n` +
    uselibs +
    `\\begin{document}\n` +
    bgDef +
    `${opts.code}\n` +
    `\\end{document}\n`
  );
}

export function slugifyFigureName(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "figure";
}

// Chunked to avoid a call-stack overflow from spreading a large byte array.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
