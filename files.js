// Lesson files: which types can be uploaded and how big. Must match storage.rules.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Extension -> content type. The type is set from the extension because some
// computers report Office files with no type at all.
export const FILE_TYPES = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
  if (!FILE_TYPES[fileExt(file.name)]) return `${file.name} isn't a PDF, PowerPoint (.pptx), Word (.docx) or picture file.`;
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
  return e === 'pdf' ? 'PDF' : e === 'pptx' ? 'PPT' : e === 'docx' ? 'DOC' : 'IMG';
}
