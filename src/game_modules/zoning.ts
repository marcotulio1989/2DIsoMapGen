import { Noise } from 'noisejs';
import type { Point } from '../generic_modules/math';
import type { ZoneName } from './mapgen';

export type ZoningParams = {
  baseScale: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  thresholds: { r1: number; r2: number; r3: number; r4: number };
};

function fbm(noise: Noise, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let freq = 1, amp = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise.perlin2(x * freq, y * freq) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return (sum / (norm || 1)) * 0.5 + 0.5;
}

const Zoning = new (class {
  private _noise: Noise | null = null;
  private _seed: number | null = null;
  private _params: ZoningParams = {
    baseScale: 1 / 350,
    octaves: 5,
    lacunarity: 2.1,
    gain: 0.55,
    thresholds: { r1: 0.2, r2: 0.45, r3: 0.65, r4: 0.85 },
  };
  // Cache simples de zonas por coordenadas quantizadas (no domínio do ruído)
  private _cache: Map<string, ZoneName> = new Map();
  private _cacheMax = 200000; // limite para evitar crescimento indefinido

  private _clearCache() { this._cache.clear(); }
  private _maybeEvict() {
    if (this._cache.size > this._cacheMax) {
      // Estratégia simples: limpar tudo quando estourar limite
      this._cache.clear();
    }
  }

  init(seed: number, params?: Partial<ZoningParams>) {
    this._seed = seed;
    this._noise = new Noise(seed);
    if (params) this.setParams(params);
  this._clearCache();
  }

  setParams(p: Partial<ZoningParams>) {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const cur = this._params;
    const thresholds = { ...cur.thresholds, ...(p.thresholds || {}) };
    let r1 = clamp01(thresholds.r1);
    let r2 = clamp01(Math.max(thresholds.r2, r1 + 1e-3));
    let r3 = clamp01(Math.max(thresholds.r3, r2 + 1e-3));
    let r4 = clamp01(Math.max(thresholds.r4, r3 + 1e-3));
    this._params = {
      baseScale: p.baseScale ?? cur.baseScale,
      octaves: p.octaves ?? cur.octaves,
      lacunarity: p.lacunarity ?? cur.lacunarity,
      gain: p.gain ?? cur.gain,
      thresholds: { r1, r2, r3, r4 },
    };
  this._clearCache();
  }

  getParams(): ZoningParams { return this._params; }
  getNoise(): Noise | null { return this._noise; }
  getSeed(): number | null { return this._seed; }

  zoneAt(p: Point | { x: number; y: number }): ZoneName {
    if (!this._noise) return 'residential';
  const { baseScale, octaves, lacunarity, gain, thresholds } = this._params;
  // Quantizar no domínio do ruído para aumentar cache hits
  const q = 512; // resolução da grade no domínio do ruído
  const qx = Math.floor(p.x * baseScale * q);
  const qy = Math.floor(p.y * baseScale * q);
  const key = `${qx}:${qy}`;
  const cached = this._cache.get(key);
  if (cached) return cached;
  const n = fbm(this._noise, qx / q, qy / q, octaves, lacunarity, gain);
    if (n < thresholds.r1) return 'rural';
  if (n < thresholds.r2) { const z: ZoneName = 'residential'; this._cache.set(key, z); this._maybeEvict(); return z; }
  if (n < thresholds.r3) { const z: ZoneName = 'commercial'; this._cache.set(key, z); this._maybeEvict(); return z; }
  if (n < thresholds.r4) { const z: ZoneName = 'industrial'; this._cache.set(key, z); this._maybeEvict(); return z; }
  const z: ZoneName = 'downtown'; this._cache.set(key, z); this._maybeEvict(); return z;
  }
})();

export default Zoning;