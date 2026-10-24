// Class keys: 8 characters from an alphabet with no look-alikes (no 0, O, 1, I, L).
// Shown as XXXX-XXXX. Must match validKey() in firestore.rules.

export const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newKey() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  // 256 % 31 leaves a tiny bias; reject the top of the range to keep keys uniform.
  let out = '';
  for (const b of bytes) {
    if (b >= 248) return newKey();
    out += KEY_ALPHABET[b % KEY_ALPHABET.length];
  }
  return out;
}

// What a student typed -> stored form, or '' if it can't be a key.
export function normaliseKey(text) {
  const k = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(k) ? k : '';
}

export function formatKey(k) {
  return k ? `${k.slice(0, 4)}-${k.slice(4)}` : '';
}
