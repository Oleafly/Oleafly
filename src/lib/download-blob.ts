export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

export function downloadBytes(bytes: Uint8Array, mimeType: string, filename: string): void {
  downloadBlob(new Blob([bytes.slice().buffer], { type: mimeType }), filename);
}
