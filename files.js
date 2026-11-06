// Lesson files: which types can be uploaded and how big. Must match storage.rules.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Extension -> content type. The type is set from the extension because some
// computers report Office files with no type at all.
export const FILE_TYPES = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ggb: 'application/vnd.geogebra.file',
  mp4: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(',');

export function fileExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// Why a file can't be uploaded, in words a teacher can act on, or '' if it's fine.
export function fileProblem(file) {
  if (!FILE_TYPES[fileExt(file.name)]) return `${file.name} isn't a PDF, PowerPoint (.pptx), Word (.docx), Excel (.xlsx), GeoGebra (.ggb), video (.mp4) or picture file.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is over 50 MB. Save a smaller copy and try again.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return '';
}

// A name that is safe as the last part of a storage path.
export function storageName(name) {
  return (name || 'file').replace(/[^\w.\- ()]+/g, '_').slice(-120) || 'file';
}

// Can a student open this file now? (The storage rules make the same check.)
export function isOpen(f, now = Date.now()) {
  return !f.locked || f.unlocked || (f.unlockAt != null && now >= f.unlockAt);
}

export function fileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(name) {
  const e = fileExt(name);
  return { pdf: 'PDF', pptx: 'PPT', docx: 'DOC', xlsx: 'XLS', ggb: 'GGB', mp4: 'VID' }[e] || 'IMG';
}

// Web links on a lesson. A teacher can type "desmos.com/x" and it becomes
// "https://desmos.com/x". Only http and https links are kept, so a link can never
// run script. Returns the tidy link, or '' if it isn't a web address.
export const MAX_LINKS = 30;

export function linkUrl(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return '';
    return u.href.length <= 2000 ? u.href : '';
  } catch {
    return '';
  }
}

// The site's name for a link, e.g. "youtube.com", to show under its title.
export function linkHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
