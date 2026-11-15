/**
 * Export delivery on iOS (REQ-050): Web Share with files first, then <a download>, then a
 * new window. Must be called directly inside a tap handler (user activation). Browser only.
 */

/**
 * @param {File} file
 * @param {string} [title]
 * @returns {Promise<'shared'|'downloaded'|'opened'|'cancelled'>}
 */
export async function deliverFile(file, title) {
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title || file.name });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const a = document.createElement('a');
  if ('download' in a && !isStandaloneIOS()) {
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'downloaded';
  }
  window.open(url, '_blank');
  return 'opened';
}

/** In an installed iOS web app `<a download>` silently fails (WebKit bug 275288). */
function isStandaloneIOS() {
  return navigator.standalone === true;
}
