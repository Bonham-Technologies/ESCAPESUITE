/**
 * Hand a file to the browser as a download (ESCSUITE-293): an object URL for
 * the blob, a temporary `<a download>` clicked and removed, the URL revoked.
 * The export dialog's video and its caption sidecars both go through here.
 * (`headless/renderProject.ts` keeps a private copy — the headless bundle does
 * not import the editor's utilities.)
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
