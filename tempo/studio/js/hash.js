// Impronta SHA-256 di un file audio: identifica QUEL file, bit per bit.
// Se il master consegnato non ha l'impronta della versione approvata, non è la stessa.

export async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const HEX = /^[0-9a-f]{8,64}$/;

/** L'impronta `hash` corrisponde al riferimento `ref` (prefisso di almeno 8 cifre)? */
export const matches = (hash, ref) => !!hash && HEX.test(ref || '') && hash.startsWith(ref.toLowerCase());
