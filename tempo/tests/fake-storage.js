// Un localStorage finto per Node: misura lo spazio usato e, se serve, finisce lo spazio come Safari.
export class FakeStorage {
  constructor(quota = Infinity) { this.map = new Map(); this.quota = quota; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    const size = this.size() - (this.map.has(k) ? k.length + this.map.get(k).length : 0) + k.length + v.length;
    if (size > this.quota) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    this.map.set(k, v);
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  /** Caratteri usati da tutte le chiavi e i valori. */
  size() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
}
globalThis.localStorage = new FakeStorage();
