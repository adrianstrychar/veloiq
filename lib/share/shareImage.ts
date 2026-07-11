// Udostępnienie obrazu: Web Share API z plikiem (iPhone → share sheet z Instagramem),
// fallback = pobranie pliku przez <a download> (desktop / brak wsparcia share z files).

export async function shareImage(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      // AbortError = user zamknął share sheet — to nie błąd, cicho kończymy.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Inny błąd share (np. polityka przeglądarki) → spadnij do pobrania.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke po ticku — Safari potrafi anulować pobranie przy natychmiastowym revoke.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
