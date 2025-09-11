/*
 * NoiseZoning Overlay
 * Perlin/fBm-only zoning overlay for city generator
 * API: attach(canvas), toggle(), reseed(), redraw()
 * Independent of roads/buildings
 */
import { ZoneName } from '../game_modules/mapgen';
import { config } from '../game_modules/config';
import Zoning from '../game_modules/zoning';
import { Noise } from 'noisejs';

// Simple Perlin noise implementation (can be replaced by external lib)
function fbm(noise: Noise, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let freq = 1;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise.perlin2(x * freq, y * freq) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  // Map from [-norm, norm] to [0,1]
  return (sum / (norm || 1)) * 0.5 + 0.5;
}


export type NoiseZoningAPI = {
  attach: (canvas: HTMLCanvasElement) => void;
  toggle: () => void;
  setEnabled?: (on: boolean) => void;
  reseed: () => void;
  redraw: () => void;
  enabled: boolean;
  detach?: () => void;
  setView?: (view: { cameraX: number; cameraY: number; zoom: number }) => void;
  setParams?: (p: Partial<NoiseZoningParams>) => void;
  getParams?: () => NoiseZoningParams;
};

type InternalNoiseZoning = NoiseZoningAPI & {
  _baseCanvas: HTMLCanvasElement | null;
  _overlayCanvas: HTMLCanvasElement | null;
  _ctx: CanvasRenderingContext2D | null;
  _seed: number;
  _noise: Noise | null;
  _observer: ResizeObserver | null;
  _syncSizeAndRedraw: () => void;
  _view: { cameraX: number; cameraY: number; zoom: number };
  _params: NoiseZoningParams;
  _ensureSize: () => void;
  _pixelCache?: {
    w: number; h: number; cameraX: number; cameraY: number; zoom: number; data: Uint8ClampedArray;
  } | null;
};

export type NoiseZoningParams = {
  baseScale: number; // 1/N, maior => ruído mais fino
  octaves: number;
  lacunarity: number;
  gain: number;
  thresholds: { r1: number; r2: number; r3: number; r4: number }; // 0..1 ascendentes
};

const NoiseZoning: InternalNoiseZoning = {
  enabled: false,
  _baseCanvas: null,
  _overlayCanvas: null,
  _ctx: null,
  _seed: Math.floor(Math.random() * 10000),
  _noise: null,
  _observer: null,
  _view: { cameraX: 0, cameraY: 0, zoom: 1 },
  _params: Zoning.getParams(),
  _pixelCache: null,
  _ensureSize() {
    if (!this._overlayCanvas || !this._baseCanvas) return;
    const parent = this._baseCanvas.parentElement as HTMLElement | null;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? this._baseCanvas.clientWidth;
    const cssH = parent?.clientHeight ?? this._baseCanvas.clientHeight;
    this._overlayCanvas.style.width = `${cssW}px`;
    this._overlayCanvas.style.height = `${cssH}px`;
    const pxW = Math.max(1, Math.floor(cssW * dpr));
    const pxH = Math.max(1, Math.floor(cssH * dpr));
    if (this._overlayCanvas.width !== pxW) this._overlayCanvas.width = pxW;
    if (this._overlayCanvas.height !== pxH) this._overlayCanvas.height = pxH;
  },

  attach(canvas: HTMLCanvasElement) {
    this._baseCanvas = canvas;
    // Criar canvas overlay posicionado acima do canvas base
    const overlay = document.createElement('canvas');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '5';
    // Garantir que o container do canvas tenha position: relative
    const parent = canvas.parentElement;
    if (parent) {
      const cs = window.getComputedStyle(parent);
      if (cs.position === 'static') {
        (parent as HTMLElement).style.position = 'relative';
      }
      parent.appendChild(overlay);
    }
    this._overlayCanvas = overlay;
    this._ctx = overlay.getContext('2d');
    // Sincronizar com Zoning do jogo, se existir
    const zSeed = Zoning.getSeed();
    if (zSeed != null) {
      this._seed = zSeed;
      this._params = Zoning.getParams();
    }
    this._noise = new Noise(this._seed);
    // Sync size with base canvas using ResizeObserver
  const resize = () => this._syncSizeAndRedraw();
    this._observer?.disconnect();
    this._observer = new ResizeObserver(resize);
    if (parent) this._observer.observe(parent);
    resize();
  },

  toggle() {
    this.enabled = !this.enabled;
    // Mostrar/ocultar canvas overlay
    if (this._overlayCanvas) {
      this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    }
    this.redraw();
  },

  reseed() {
  this._seed = Math.floor(Math.random() * 10000);
  this._noise = new Noise(this._seed);
    // Propagar para Zoning para manter consistência com as casas
    Zoning.init(this._seed, this._params);
  this._pixelCache = null;
    this.redraw();
  },

  redraw() {
  if (!this._overlayCanvas || !this._ctx || !this._noise) return;
  // Garantir cobertura total antes de desenhar
  this._ensureSize();
  const w = this._overlayCanvas.width;
  const h = this._overlayCanvas.height;
    const imageData = this._ctx.createImageData(w, h);
    const zoneColors = config.render.zoneColors;
  // Escala do ruído em coordenadas de cena (ajuste conforme necessário)
  const { baseScale, octaves, lacunarity, gain, thresholds } = this._params;
    const cx = w / 2, cy = h / 2;
    const cameraX = this._view.cameraX, cameraY = this._view.cameraY, zoom = this._view.zoom || 1;
    // Cache de pixels: se view for igual, reutiliza
    const alpha = this.enabled ? Math.floor((config.render.zoneOverlayAlpha ?? 0.12) * 255) : 0;
    if (this._pixelCache && this._pixelCache.w === w && this._pixelCache.h === h &&
        this._pixelCache.cameraX === cameraX && this._pixelCache.cameraY === cameraY && this._pixelCache.zoom === zoom) {
      // Só atualiza alpha
      const data = this._pixelCache.data;
      for (let i = 3; i < data.length; i += 4) data[i] = alpha;
      imageData.data.set(data);
      this._ctx.putImageData(imageData, 0, 0);
      return;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Mapear pixel -> coordenadas de cena, seguindo pan/zoom
        const Sx = cameraX + (x - cx) / zoom;
        const Sy = cameraY + (y - cy) / zoom;
        const n = fbm(this._noise, Sx * baseScale, Sy * baseScale, octaves, lacunarity, gain);
        let zone: ZoneName = 'residential';
        if (n < thresholds.r1) zone = 'rural';
        else if (n < thresholds.r2) zone = 'residential';
        else if (n < thresholds.r3) zone = 'commercial';
        else if (n < thresholds.r4) zone = 'industrial';
        else zone = 'downtown';
        const colorInt = zoneColors[zone] || 0xcccccc;
        const rgb = intToRgb(colorInt);
        const idx = (y * w + x) * 4;
        imageData.data[idx] = rgb[0];
        imageData.data[idx + 1] = rgb[1];
        imageData.data[idx + 2] = rgb[2];
    imageData.data[idx + 3] = alpha;
      }
    }
    this._ctx.putImageData(imageData, 0, 0);
    // Armazenar no cache
    this._pixelCache = { w, h, cameraX, cameraY, zoom, data: new Uint8ClampedArray(imageData.data) };
  },
  _syncSizeAndRedraw() {
    if (!this._overlayCanvas || !this._baseCanvas) return;
    const parent = this._baseCanvas.parentElement as HTMLElement | null;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? this._baseCanvas.clientWidth;
    const cssH = parent?.clientHeight ?? this._baseCanvas.clientHeight;
    this._overlayCanvas.style.width = `${cssW}px`;
    this._overlayCanvas.style.height = `${cssH}px`;
    const pxW = Math.max(1, Math.floor(cssW * dpr));
    const pxH = Math.max(1, Math.floor(cssH * dpr));
    if (this._overlayCanvas.width !== pxW || this._overlayCanvas.height !== pxH) {
      this._overlayCanvas.width = pxW;
      this._overlayCanvas.height = pxH;
    }
    if (this._overlayCanvas) this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    this.redraw();
  },
  detach() {
    try { this._observer?.disconnect(); } catch {}
    this._observer = null;
    if (this._overlayCanvas && this._overlayCanvas.parentElement) {
      this._overlayCanvas.parentElement.removeChild(this._overlayCanvas);
    }
    this._overlayCanvas = null;
    this._ctx = null;
    this._noise = null;
    this.enabled = false;
  this._pixelCache = null;
  },
  setView(view: { cameraX: number; cameraY: number; zoom: number }) {
    this._view = view;
  },
  setEnabled(on: boolean) {
    this.enabled = !!on;
    if (this._overlayCanvas) this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    this.redraw();
  },
  setParams(p?: Partial<NoiseZoningParams>) {
    if (!p) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const cur = this._params;
    const thresholds = { ...cur.thresholds, ...(p.thresholds || {}) };
    // Impor ordem ascendente e 0..1
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
  // Propagar para Zoning para manter consistência com a geração
  Zoning.setParams(this._params);
  this._pixelCache = null;
  this.redraw();
  },
  getParams() {
    return JSON.parse(JSON.stringify(this._params)) as NoiseZoningParams;
  },
};


function intToRgb(intColor: number): [number, number, number] {
  return [(intColor >> 16) & 255, (intColor >> 8) & 255, intColor & 255];
}

export default NoiseZoning;
