import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import * as _ from 'lodash';
import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import * as astar from '../generic_modules/astar';
import { buildingFactory, Building } from '../game_modules/build';
import { getZoneAt } from '../game_modules/mapgen';
import { config, scale } from '../game_modules/config';
import { Segment, MapGenerationResult } from '../game_modules/mapgen';
import { MapActions } from '../actions/MapActions';
import MapStore from '../stores/MapStore';
import type { Point } from '../generic_modules/math';

import NoiseZoning from '../overlays/NoiseZoning';
import Quadtree from '../lib/quadtree';

const GameCanvas: React.FC = () => {
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const pixiRenderer = useRef<PIXI.IRenderer<PIXI.ICanvas> | null>(null);
    const stage = useRef<PIXI.Container | null>(null);
    const zoomContainer = useRef<PIXI.Container | null>(null);
    const drawables = useRef<PIXI.Container | null>(null);
    const dynamicDrawables = useRef<PIXI.Container | null>(null);
    const heatmaps = useRef<PIXI.Container | null>(null);
    const debugDrawables = useRef<PIXI.Container | null>(null);
    const debugSegments = useRef<PIXI.Container | null>(null);
    const debugMapData = useRef<PIXI.Container | null>(null);
    const characters = useRef<PIXI.Container | null>(null);
    
    // Mutable state that doesn't trigger re-renders
    const state = useRef({
        segments: [] as Segment[],
    qTree: null as Quadtree | null,
        heatmap: null as MapGenerationResult['heatmap'] | null,
        initialised: false,
        dt: 0,
        time: null as number | null,
        touchDown: false,
        prevX: null as number | null,
        prevY: null as number | null,
        cumulDiff: { x: 0, y: 0 },
        zoom: 0.01 * window.devicePixelRatio,
        debugDrawablesAdded: false,
        populationHeatMap: null as PIXI.Graphics | null,
        pathGraphics: null as PIXI.Graphics | null,
        camera: { x: 0, y: 0, vx: 0, vy: 0 },
        routePartialSelectionMode: true,
        firstSelection: true,
        pathSelectionStart: null as astar.PathLocation | null,
        debugSegmentI: 0,
        character: {
            pos: { x: 0, y: 0 } as Point,
        },
        characterGraphics: null as PIXI.Graphics | null,
    }).current;

    const worldToIso = (p: Point): Point => {
        if (config.render.mode !== 'isometric') return p;
        const { isoA, isoB, isoC, isoD } = config.render;
        return {
            x: isoA * p.x + isoC * p.y,
            y: isoB * p.x + isoD * p.y,
        };
    };

    const drawSegment = (segment: Segment, color?: number, width?: number, trimStart = 0, trimEnd = 0) => {
        color = util.defaultFor(color, segment.q.color);
        width = util.defaultFor(width, segment.width);

        // aplicar cortes (trim) nos extremos do segmento em direção ao centro
        const sW0 = segment.r.start;
        const eW0 = segment.r.end;
        const vx0 = eW0.x - sW0.x;
        const vy0 = eW0.y - sW0.y;
        const len0 = Math.hypot(vx0, vy0) || 1;
        const ux = vx0 / len0, uy = vy0 / len0;
        const sW = { x: sW0.x + ux * trimStart, y: sW0.y + uy * trimStart };
        const eW = { x: eW0.x - ux * trimEnd, y: eW0.y - uy * trimEnd };
        const vx = eW.x - sW.x;
        const vy = eW.y - sW.y;
        const len = Math.sqrt(vx * vx + vy * vy) || 1;
        const hx = (-vy / len) * (width / 2);
        const hy = (vx / len) * (width / 2);

        // cantos no espaço do mundo
        const p1 = { x: sW.x + hx, y: sW.y + hy };
        const p2 = { x: sW.x - hx, y: sW.y - hy };
        const p3 = { x: eW.x - hx, y: eW.y - hy };
        const p4 = { x: eW.x + hx, y: eW.y + hy };

        // projetar para tela (isométrico/topdown)
        const P1 = worldToIso(p1);
        const P2 = worldToIso(p2);
        const P3 = worldToIso(p3);
        const P4 = worldToIso(p4);

        const g = new PIXI.Graphics();
        g.beginFill(color ?? 0xA1AFA9, 1.0);
        g.moveTo(P1.x, P1.y);
        g.lineTo(P2.x, P2.y);
        g.lineTo(P3.x, P3.y);
        g.lineTo(P4.x, P4.y);
        g.closePath();
        g.endFill();
        return g;
    };

    // Desenha uma "cápsula" arredondada (retângulo + semicículos nas extremidades) em coordenadas do mundo
    type CapStyle = 'round' | 'butt';
    const drawRoundedSegment = (segment: Segment, color?: number, width?: number, trimStart = 0, trimEnd = 0, capStart: CapStyle = 'round', capEnd: CapStyle = 'round') => {
        color = util.defaultFor(color, segment.q.color);
        width = util.defaultFor(width, segment.width);
        // aplicar trims ao longo do eixo da via
        const sW0 = segment.r.start;
        const eW0 = segment.r.end;
        const vx0 = eW0.x - sW0.x;
        const vy0 = eW0.y - sW0.y;
        const len0 = Math.hypot(vx0, vy0) || 1;
        const ux0 = vx0 / len0, uy0 = vy0 / len0;
        const sW = { x: sW0.x + ux0 * trimStart, y: sW0.y + uy0 * trimStart };
        const eW = { x: eW0.x - ux0 * trimEnd, y: eW0.y - uy0 * trimEnd };
        const vx = eW.x - sW.x;
        const vy = eW.y - sW.y;
        const len = Math.hypot(vx, vy) || 1;
        const nx = -(vy / len), ny = (vx / len); // normal à esquerda
        const r = width / 2;

        // Bordas do retângulo central
        const a = { x: sW.x + nx * r, y: sW.y + ny * r };
        const b = { x: sW.x - nx * r, y: sW.y - ny * r };
        const c = { x: eW.x - nx * r, y: eW.y - ny * r };
        const d = { x: eW.x + nx * r, y: eW.y + ny * r };

        // Amostrar semicículos nas pontas (mundo -> tela)
        const steps = Math.max(12, Math.min(48, Math.ceil((Math.PI * r) / 12))); // adaptativo
        const startAngle = Math.atan2(ny, nx); // normal como direção para “fora” do start
        const endAngle = Math.atan2(-ny, -nx); // normal oposta para o end

        const g = new PIXI.Graphics();
        g.beginFill(color ?? 0xA1AFA9, 1.0);

    // flags: arredondar apenas extremidades não aparadas e quando o estilo pedir
    const roundStart = trimStart <= 1e-6 && capStart === 'round';
    const roundEnd = trimEnd <= 1e-6 && capEnd === 'round';

        // Começa no lado externo próximo ao start (ponto a)
        let p = worldToIso(a);
        g.moveTo(p.x, p.y);

        if (roundStart) {
            // Semicírculo na ponta start: de +n até -n passando pelo sentido da direção -u
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const ang = startAngle + Math.PI * t;
                const wx = sW.x + Math.cos(ang) * r;
                const wy = sW.y + Math.sin(ang) * r;
                const sp = worldToIso({ x: wx, y: wy });
                g.lineTo(sp.x, sp.y);
            }
        } else {
            // Sem arco: fechar reto até o lado interno
            p = worldToIso(b); g.lineTo(p.x, p.y);
        }

        // lado interno (b -> c)
        if (roundStart) { p = worldToIso(b); g.lineTo(p.x, p.y); }
        p = worldToIso(c); g.lineTo(p.x, p.y);

        if (roundEnd) {
            // Semicírculo na ponta end: de -n até +n passando pelo sentido da direção +u
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const ang = endAngle + Math.PI * t;
                const wx = eW.x + Math.cos(ang) * r;
                const wy = eW.y + Math.sin(ang) * r;
                const sp = worldToIso({ x: wx, y: wy });
                g.lineTo(sp.x, sp.y);
            }
        } else {
            // Sem arco na ponta: lado externo direto
            p = worldToIso(d); g.lineTo(p.x, p.y);
        }

        // lado externo (d -> a)
        if (roundEnd) { p = worldToIso(d); g.lineTo(p.x, p.y); }
        p = worldToIso(a); g.lineTo(p.x, p.y);

        g.closePath();
        g.endFill();
        return g;
    };

    const onMapChange = () => {
        if (!dynamicDrawables.current || !debugMapData.current || !debugSegments.current) return;

        if (state.pathGraphics) state.pathGraphics.clear();
        dynamicDrawables.current.removeChildren();
        debugMapData.current.removeChildren();
        debugSegments.current.removeChildren();
        state.debugSegmentI = 0;

        const segments = MapStore.getSegments();
    const qTree = MapStore.getQTree() || null;
        const heatmap = MapStore.getHeatmap();
        const debugData = MapStore.getDebugData();

    state.segments = segments;
        state.qTree = qTree;
    state.heatmap = heatmap || null;
        
        const R_SMALL = 6; // marcadores discretos
        debugData.snaps?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0x00FF00).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });
        debugData.intersectionsRadius?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0x0000FF).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });
        debugData.intersections?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0xFF0000).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });

        // ==== Calcular trims por nó (antes de desenhar vias) ====
        // Map de trims por segmento
        const trimMap = new Map<Segment, { start: number; end: number }>();
        const ensureTrim = (seg: Segment) => {
            if (!trimMap.has(seg)) trimMap.set(seg, { start: 0, end: 0 });
            return trimMap.get(seg)!;
        };

        // Build nó -> entradas
        const keyOf = (p: Point) => `${Math.round(p.x)}:${Math.round(p.y)}`;
        type NodeEntry = { seg: Segment; atStart: boolean };
        const nodeMapForTrim: Record<string, { P: Point; entries: NodeEntry[] }> = {};
        for (const seg of segments) {
            (nodeMapForTrim[keyOf(seg.r.start)] ||= { P: seg.r.start, entries: [] }).entries.push({ seg, atStart: true });
            (nodeMapForTrim[keyOf(seg.r.end)] ||= { P: seg.r.end, entries: [] }).entries.push({ seg, atStart: false });
        }

        // Nó de grau 1 => rua sem saída. Vamos marcar para definir cap "butt" nessa ponta
        const deadEndCaps = new Map<Segment, { startButt: boolean; endButt: boolean }>();
        Object.values(nodeMapForTrim).forEach(node => {
            const { entries } = node;
            if (entries.length === 1) {
                const e = entries[0];
                const info = deadEndCaps.get(e.seg) || { startButt: false, endButt: false };
                if (e.atStart) info.startButt = true; else info.endButt = true;
                deadEndCaps.set(e.seg, info);
            }
        });

    const EPS = 1e-6;
    const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
    const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
    const mul = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
    const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
    const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
    const norm = (v: Point): Point => { const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; };

        Object.values(nodeMapForTrim).forEach(node => {
            const { P, entries } = node;
            if (entries.length < 2) return;
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const e1 = entries[i], e2 = entries[j];
                    const s1 = e1.seg, s2 = e2.seg;
                    const v1 = norm(e1.atStart ? sub(s1.r.end, s1.r.start) : sub(s1.r.start, s1.r.end));
                    const v2 = norm(e2.atStart ? sub(s2.r.end, s2.r.start) : sub(s2.r.start, s2.r.end));
                    const c = Math.max(-1, Math.min(1, dot(v1, v2)));
                    const alpha = Math.acos(c);
                    if (!(alpha > 2 * Math.PI / 180 && alpha < Math.PI - 2 * Math.PI / 180)) continue;
                    // Só aplicar trims se estivermos usando o patch interno; caso contrário, não aparar para evitar buracos
                    if (config.render.useInnerArcPatch) {
                        const w1 = s1.width, w2 = s2.width;
                        const r_in = Math.min(w1, w2) / 2; // raio interno para tangência nas bordas internas
                        const t_in = r_in / Math.tan(alpha / 2);
                        const tr1 = ensureTrim(s1);
                        const tr2 = ensureTrim(s2);
                        if (e1.atStart) tr1.start = Math.max(tr1.start, t_in); else tr1.end = Math.max(tr1.end, t_in);
                        if (e2.atStart) tr2.start = Math.max(tr2.start, t_in); else tr2.end = Math.max(tr2.end, t_in);
                    }
                }
            }
        });

        let buildings: Building[] = [];
        for (let i = 0; i < segments.length; i += 10) {
            const segment = segments[i];
            const zone = getZoneAt(segment.r.end);
            const dens = (config as any).zones?.[zone];
            const count = zone === 'residential' ? 12 : zone === 'commercial' ? 10 : zone === 'industrial' ? 6 : 4;
            const radius = zone === 'residential' ? 420 : zone === 'commercial' ? 380 : zone === 'industrial' ? 520 : 460;
            const timeNow = new Date().getTime();
            const newBuildings = buildingFactory.aroundSegment(
                () => buildingFactory.fromZone(zone, timeNow),
                segment, count, radius, qTree!, getZoneAt, timeNow
            );
            newBuildings.forEach(b => qTree!.insert(b.collider.limits()));
            buildings = buildings.concat(newBuildings);
        }

    buildings.forEach(building => {
            const colorByType: Record<string, number> = {
                house: 0xE0F7FA,
                residential: 0x90CAF9,
                commercial: 0xFFE082,
                import: 0xCE93D8,
            };
            const fill = colorByType[(building.type as any)] ?? 0x0C161F;
            const g = new PIXI.Graphics().beginFill(fill).lineStyle(5, 0x555555, 0.7);
            const c0 = worldToIso(building.corners[0]);
            g.moveTo(c0.x, c0.y);
            building.corners.slice(1).forEach(c => {
                const p = worldToIso(c);
                g.lineTo(p.x, p.y);
            });
            g.lineTo(c0.x, c0.y);
            dynamicDrawables.current?.addChild(g);
        });

    // Removido overlay de zonas em tiles (agora usamos canvas overlay Perlin)

        // Desenhar cada segmento como cápsula com trims em espaço do mundo (respeita isométrica)
        segments.forEach(segment => {
            const lineColor = segment.q.color ?? 0xA1AFA9;
            const tr = trimMap.get(segment) || { start: 0, end: 0 };
            const caps = deadEndCaps.get(segment) || { startButt: false, endButt: false };
            const capStart = caps.startButt ? 'butt' : 'round';
            const capEnd = caps.endButt ? 'butt' : 'round';
            dynamicDrawables.current?.addChild(drawRoundedSegment(segment, lineColor, segment.width, tr.start, tr.end, capStart, capEnd));
        });

        // === Chanfrar interseções: preenche o vão interno entre duas vias com um triângulo (bevel) ===
        const nodeMapChamfer: Record<string, { P: Point; entries: NodeEntry[] }> = {};
        for (const seg of segments) {
            (nodeMapChamfer[keyOf(seg.r.start)] ||= { P: seg.r.start, entries: [] }).entries.push({ seg, atStart: true });
            (nodeMapChamfer[keyOf(seg.r.end)] ||= { P: seg.r.end, entries: [] }).entries.push({ seg, atStart: false });
        }

        const perpCCW = (v: Point): Point => ({ x: -v.y, y: v.x });

        Object.values(nodeMapChamfer).forEach(node => {
            const { P, entries } = node;
            if (entries.length < 2) return;
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const e1 = entries[i], e2 = entries[j];
                    const s1 = e1.seg, s2 = e2.seg;
                    const d1 = norm(e1.atStart ? sub(s1.r.end, P) : sub(s1.r.start, P));
                    const d2 = norm(e2.atStart ? sub(s2.r.end, P) : sub(s2.r.start, P));
                    const c = Math.max(-1, Math.min(1, dot(d1, d2)));
                    const alpha = Math.acos(c);
                    if (!(alpha > 3 * Math.PI / 180 && alpha < Math.PI - 3 * Math.PI / 180)) continue; // ignora quase colinear

                    const b_in = norm(add(d1, d2));
                    if (!isFinite(b_in.x) || !isFinite(b_in.y) || (Math.abs(b_in.x) < EPS && Math.abs(b_in.y) < EPS)) continue;

                    let n1 = perpCCW(d1); if (dot(n1, b_in) < 0) n1 = { x: -n1.x, y: -n1.y };
                    let n2 = perpCCW(d2); if (dot(n2, b_in) < 0) n2 = { x: -n2.x, y: -n2.y };

                    const w1 = s1.width, w2 = s2.width;
                    const r = Math.min(w1, w2) / 2;
                    const t = r / Math.tan(alpha / 2);
                    if (!isFinite(t) || t < 0) continue;

                    const T1 = add(P, mul(d1, t));
                    const T2 = add(P, mul(d2, t));
                    const I1 = add(T1, mul(n1, w1 / 2));
                    const I2 = add(T2, mul(n2, w2 / 2));

                    // === Pontos de interseção das bordas como RAIOS (primeiro cruzamento) ===
                    const n1out = { x: -n1.x, y: -n1.y };
                    const n2out = { x: -n2.x, y: -n2.y };
                    // bordas externas
                    const A1 = add(P, mul(n1out, w1 / 2));
                    const A2 = add(P, mul(n2out, w2 / 2));
                    // bordas internas
                    const B1 = add(P, mul(n1, w1 / 2));
                    const B2 = add(P, mul(n2, w2 / 2));

                    // usar apenas as direções que saem de P ao longo dos segmentos (primeiro cruzamento)
                    const v1opts = [d1];
                    const v2opts = [d2];

                    const firstRayIntersection = (O1: Point, v1: Point[], O2: Point, v2: Point[]): Point | null => {
                        let best: Point | null = null;
                        let bestCost = Infinity;
                        for (const a of v1) {
                            for (const b of v2) {
                                const den = cross(a, b);
                                if (Math.abs(den) <= EPS) continue;
                                const O21 = sub(O2, O1);
                                const t1 = cross(O21, b) / den;
                                const t2 = cross(O21, a) / den;
                                if (t1 >= 0 && t2 >= 0) {
                                    const cand = add(O1, mul(a, t1));
                                    // custo: menor soma das distâncias ao longo dos raios
                                    const cost = t1 + t2;
                                    if (cost < bestCost) { bestCost = cost; best = cand; }
                                }
                            }
                        }
                        return best;
                    };

                    // Para o patch EXTERNO, preferir o encontro das BORDAS EXTERNAS primeiro
                    let bestQ = firstRayIntersection(A1, v1opts, A2, v2opts);
                    // fallback: usar interseção das bordas internas, se a externa não existir
                    if (!bestQ) bestQ = firstRayIntersection(B1, v1opts, B2, v2opts);
                    // fallback final: linha-linha externa
                    if (!bestQ) {
                        const den = cross(d1, d2);
                        if (Math.abs(den) > EPS) {
                            const tpar = cross(sub(A2, A1), d2) / den;
                            bestQ = add(A1, mul(d1, tpar));
                        }
                    }

                    if (bestQ) {
                        const qS = worldToIso(bestQ);
                        const gq = new PIXI.Graphics();
                        gq.lineStyle(2, 0x000000, 0.9);
                        gq.beginFill(0xFFD200, 1.0).drawCircle(qS.x, qS.y, 7).endFill();
                        debugMapData.current?.addChild(gq);
                    }

                    // Centro do fillet curto na bissetriz interna, raio r (tangente às bordas internas)
                    const Cdist = r / Math.sin(alpha / 2);
                    const C = add(P, mul(b_in, Cdist));

                    const wrap = (x: number) => {
                        x = (x + Math.PI) % (2 * Math.PI);
                        if (x < 0) x += 2 * Math.PI;
                        return x - Math.PI;
                    };
                    let th1 = Math.atan2(I1.y - C.y, I1.x - C.x);
                    let th2 = Math.atan2(I2.y - C.y, I2.x - C.x);
                    let dth = wrap(th2 - th1); // arco mais curto

                    if (config.render.useInnerArcPatch) {
                        const stepsBase = 64;
                        const steps = Math.max(10, Math.ceil(Math.abs(dth) * stepsBase / Math.PI));

                        // Polígono: arco de I1->I2 + corda I2->I1 (segmento circular curto)
                        const poly: Point[] = [];
                        for (let i = 0; i <= steps; i++) {
                            const u = i / steps;
                            const ang = th1 + dth * u;
                            poly.push({ x: C.x + Math.cos(ang) * r, y: C.y + Math.sin(ang) * r });
                        }
                        poly.push(I1); // fecha com a corda (I2 já é o último do arco)

                        const color = s1.q.color ?? 0xA1AFA9; // cor da primeira via (suficiente)
                        const g = new PIXI.Graphics();
                        g.beginFill(color, 1.0);
                        poly.forEach((wp, idx) => {
                            const sp = worldToIso(wp);
                            if (idx === 0) g.moveTo(sp.x, sp.y); else g.lineTo(sp.x, sp.y);
                        });
                        g.closePath();
                        g.endFill();
                        dynamicDrawables.current?.addChild(g);
                    }

                    // === Curva Bézier cúbica aproximando o mesmo arco (debug, lado INTERNO) ===
                    const sgn = dth >= 0 ? 1 : -1;
                    const kappa = (4 / 3) * Math.tan(Math.abs(dth) / 4);
                    const h = kappa * r;
                    // unit tangents ao longo do arco (derivada do ângulo)
                    const t1v = { x: -Math.sin(th1) * sgn, y: Math.cos(th1) * sgn };
                    const t2v = { x: -Math.sin(th2) * sgn, y: Math.cos(th2) * sgn };
                    const B1c = add(I1, mul(t1v, h)); // primeiro controle
                    const B2c = add(I2, mul(t2v, -h)); // segundo controle

                    const i1s = worldToIso(I1);
                    const i2s = worldToIso(I2);
                    const b1s = worldToIso(B1c);
                    const b2s = worldToIso(B2c);
                    const gb = new PIXI.Graphics();
                    gb.lineStyle(3, 0x00FF66, 1.0);
                    gb.moveTo(i1s.x, i1s.y);
                    gb.bezierCurveTo(b1s.x, b1s.y, b2s.x, b2s.y, i2s.x, i2s.y);
                    debugMapData.current?.addChild(gb);

                    // === Arco circular simples no lado EXTERNO (mais estável e sem inflexão) ===
                    if (bestQ) {
                        // raio absoluto em metros, com pequeno overlap para evitar gaps por AA
                        const rAbs = Math.max(config.render.outerCornerRadiusRangeM.min, Math.min(config.render.outerCornerRadiusRangeM.max, config.render.outerCornerRadiusM));
                        const rOut = rAbs * 1.02;
                        const tOut = rOut / Math.tan(alpha / 2);
                        const T1o = add(bestQ, mul(d1, tOut));
                        const T2o = add(bestQ, mul(d2, tOut));
                        // centro do arco na bissetriz do ângulo no vértice bestQ
                        const bWedge = norm(add(d1, d2));
                        const CdistOut = rOut / Math.sin(alpha / 2);
                        const Cout = add(bestQ, mul(bWedge, CdistOut));

                        const wrap = (x: number) => { let y = (x + Math.PI) % (2 * Math.PI); if (y < 0) y += 2 * Math.PI; return y - Math.PI; };
                        let th1o = Math.atan2(T1o.y - Cout.y, T1o.x - Cout.x);
                        let th2o = Math.atan2(T2o.y - Cout.y, T2o.x - Cout.x);
                        let dtho = wrap(th2o - th1o);

                        if (config.render.useOuterBezierPatch) {
                            const stepsBase = 64;
                            const steps = Math.max(16, Math.ceil(Math.abs(dtho) * stepsBase / Math.PI));
                            const poly: Point[] = [];
                            for (let i = 0; i <= steps; i++) {
                                const u = i / steps;
                                const ang = th1o + dtho * u;
                                poly.push({ x: Cout.x + Math.cos(ang) * rOut, y: Cout.y + Math.sin(ang) * rOut });
                            }
                            // fecha com um pequeno leque ao redor de Q (recuando levemente em direção a P)
                            // isso evita fendas entre o arco e as bordas externas das vias
                            const epsQ = Math.max(1.0, Math.min(6.0, rOut * 0.12));
                            const Q2 = add(bestQ, mul(d2, -epsQ));
                            const Q1 = add(bestQ, mul(d1, -epsQ));
                            poly.push(Q2);
                            poly.push(bestQ);
                            poly.push(Q1);
                            const gpatch = new PIXI.Graphics();
                            gpatch.beginFill(s1.q.color ?? 0xA1AFA9, 1.0);
                            poly.forEach((wp, idx) => {
                                const sp = worldToIso(wp);
                                if (idx === 0) gpatch.moveTo(sp.x, sp.y); else gpatch.lineTo(sp.x, sp.y);
                            });
                            gpatch.closePath();
                            gpatch.endFill();
                            dynamicDrawables.current?.addChild(gpatch);
                        } else {
                            // backup minimalista
                            const gt = new PIXI.Graphics();
                            gt.beginFill(s1.q.color ?? 0xA1AFA9, 1.0);
                            const t1 = worldToIso(T1o);
                            const t2 = worldToIso(T2o);
                            const q = worldToIso(bestQ);
                            gt.moveTo(t1.x, t1.y);
                            gt.lineTo(t2.x, t2.y);
                            gt.lineTo(q.x, q.y);
                            gt.closePath();
                            gt.endFill();
                            dynamicDrawables.current?.addChild(gt);
                        }
                    }
                }
            }
        });

        // Fillets par-a-par considerando grossura de cada via (desativado para priorizar chanfro limpo)
        const enableOldFillets = false;
        if (enableOldFillets) {
    const nodeMap: Record<string, { P: Point; entries: NodeEntry[] }> = nodeMapForTrim;

        const drawPairFillet = (P: Point, v1: Point, w1: number, color1: number, v2: Point, w2: number, color2: number) => {
            const d1 = norm(v1);
            const d2 = norm(v2);
            const c = Math.max(-1, Math.min(1, dot(d1, d2)));
            const alpha = Math.acos(c);
            if (!(alpha > 2 * Math.PI / 180 && alpha < Math.PI - 2 * Math.PI / 180)) return; // ignora quase colinear

            // Centro do fillet na bissetriz interna com raio base r (no eixo central)
            const s = add(d1, d2);
            const sL = Math.hypot(s.x, s.y);
            if (sL < EPS) return;
            const b_in = { x: s.x / sL, y: s.y / sL };
            const r = Math.max(Math.min(w1, w2) / 2, 1e-3); // raio no eixo central
            const Cdist = r / Math.sin(alpha / 2);
            const Cc = add(P, mul(b_in, Cdist));

            const wrap = (x: number) => {
                x = (x + Math.PI) % (2 * Math.PI);
                if (x < 0) x += 2 * Math.PI;
                return x - Math.PI;
            };

            const buildFilletPatchForRoad = (w: number, color: number) => {
                // Round cap na BORDA externa da via com raio w/2 e centro específico dessa borda
                const r_out = (w / 2) * 1.02; // leve overlap
                const t_out = r_out / Math.tan(alpha / 2);
                const T1o = add(P, mul(d1, t_out));
                const T2o = add(P, mul(d2, t_out));
                const Cdist_out = r_out / Math.sin(alpha / 2);
                const C_out = add(P, mul(b_in, Cdist_out));

                let th1o = Math.atan2(T1o.y - C_out.y, T1o.x - C_out.x);
                let th2o = Math.atan2(T2o.y - C_out.y, T2o.x - C_out.x);
                let dtho = wrap(th2o - th1o);
                if (Math.abs(dtho) > Math.PI) dtho = dtho > 0 ? dtho - 2 * Math.PI : dtho + 2 * Math.PI;

                const stepsBase = 64;
                const steps = Math.max(24, Math.ceil(Math.abs(dtho) * stepsBase / Math.PI));
                const poly: Point[] = [];
                // arco externo
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const ang = th1o + dtho * t;
                    poly.push({ x: C_out.x + Math.cos(ang) * r_out, y: C_out.y + Math.sin(ang) * r_out });
                }
                // fechar até o nó e voltar ao início (setor)
                poly.push(P);

                const g = new PIXI.Graphics();
                g.beginFill(color, 1.0);
                poly.forEach((wp, idx) => {
                    const p = worldToIso(wp);
                    if (idx === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
                });
                g.closePath();
                g.endFill();
                dynamicDrawables.current?.addChild(g);
            };

            if (w1 <= w2 * 0.9) {
                buildFilletPatchForRoad(w1, color1);
            } else if (w2 <= w1 * 0.9) {
                buildFilletPatchForRoad(w2, color2);
            } else {
                // larguras similares: um patch com a mesma largura
                buildFilletPatchForRoad(w1, color1);
            }
        };

        // Para cada nó, desenhar fillet para cada par de segmentos
        Object.values(nodeMap).forEach(node => {
            const { P, entries } = node;
            if (entries.length < 2) return;
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const e1 = entries[i], e2 = entries[j];
                    const s1 = e1.seg, s2 = e2.seg;
                    const v1 = e1.atStart ? sub(s1.r.end, s1.r.start) : sub(s1.r.start, s1.r.end);
                    const v2 = e2.atStart ? sub(s2.r.end, s2.r.start) : sub(s2.r.start, s2.r.end);
                    const w1 = s1.width, w2 = s2.width;
                    const c1 = s1.q.color ?? 0xA1AFA9;
                    const c2 = s2.q.color ?? 0xA1AFA9;
                    drawPairFillet(P, v1, w1, c1, v2, w2, c2);
                }
            }
        });
        }


        state.initialised = true;
    };

    useEffect(() => {
        MapStore.addChangeListener(onMapChange);
        const seed = new Date().getTime();
        console.log(`seed: ${seed.toString()}`);
        MapActions.generate(seed);


    const canvasEl = document.createElement('canvas');
    canvasContainerRef.current?.appendChild(canvasEl);
    canvasEl.tabIndex = 0;
    canvasEl.focus();

    // Integrar NoiseZoning ao canvas
    NoiseZoning.attach(canvasEl);

        const handleResize = () => {
            if (!canvasContainerRef.current) return;
            const { offsetWidth, offsetHeight } = canvasContainerRef.current;
            canvasEl.style.width = `${offsetWidth}px`;
            canvasEl.style.height = `${offsetHeight}px`;
            const rendererWidth = offsetWidth * window.devicePixelRatio;
            const rendererHeight = offsetHeight * window.devicePixelRatio;
            if (pixiRenderer.current) {
                pixiRenderer.current.resize(rendererWidth, rendererHeight);
            }
            if (zoomContainer.current) {
                zoomContainer.current.x = rendererWidth / 2;
                zoomContainer.current.y = rendererHeight / 2;
            }
        };

        const { offsetWidth, offsetHeight } = canvasContainerRef.current!;
        pixiRenderer.current = PIXI.autoDetectRenderer({
            width: offsetWidth * window.devicePixelRatio,
            height: offsetHeight * window.devicePixelRatio,
            view: canvasEl,
            antialias: true,
            backgroundAlpha: 1,
            backgroundColor: 0x2e7d32
        });

        stage.current = new PIXI.Container();
        heatmaps.current = new PIXI.Container();
    debugDrawables.current = new PIXI.Container();
        debugSegments.current = new PIXI.Container();
        debugMapData.current = new PIXI.Container();
        zoomContainer.current = new PIXI.Container();
        drawables.current = new PIXI.Container();
        dynamicDrawables.current = new PIXI.Container();
    characters.current = new PIXI.Container();

    stage.current.addChild(heatmaps.current);
    debugDrawables.current.addChild(debugSegments.current);
    debugDrawables.current.addChild(debugMapData.current);
    // visibilidade inicial dos marcadores/junções
    debugMapData.current.visible = config.render.showJunctionMarkers;
    drawables.current.addChild(dynamicDrawables.current);
    drawables.current.addChild(characters.current);
    // Colocar o debug DENTRO de drawables para herdar o offset de câmera
    drawables.current.addChild(debugDrawables.current);
    zoomContainer.current.addChild(drawables.current);
    stage.current.addChild(zoomContainer.current);

    // character graphics setup
    state.characterGraphics = new PIXI.Graphics();
    characters.current.addChild(state.characterGraphics);

    handleResize();
    // Redesenhar overlay ao redimensionar
    const onResizeOverlay = () => NoiseZoning.redraw();
    window.addEventListener('resize', onResizeOverlay);
        window.addEventListener('resize', handleResize);

        // Keyboard controls
        const keys: Record<string, boolean> = {};
        const onKeyDown = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' || k === ' ' || k === 'w' || k === 'a' || k === 's' || k === 'd') {
                e.preventDefault();
            }
            if (k === 'n') {
                // Toggle overlay via teclado
                NoiseZoning.setEnabled?.(!NoiseZoning.enabled);
            }
            keys[e.key] = true;
            keys[k] = true;
        };
        const onKeyUp = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            keys[e.key] = false;
            keys[k] = false;
        };
        window.addEventListener('keydown', onKeyDown, { passive: false });
        window.addEventListener('keyup', onKeyUp, { passive: true });

        // Criação do sprite do personagem
        const buildCharacterSprite = () => {
            if (!pixiRenderer.current) return;
            const h = scale.characterHeightM;
            const d = scale.characterDiameterM;
            const r = d / 2;
            const g = new PIXI.Graphics();
            // corpo
            g.beginFill(0x3399FF, 0.9);
            g.drawRoundedRect(-r, 0, d, h, r * 0.6);
            g.endFill();
            // cabeça
            g.beginFill(0xFFD166, 1.0);
            g.drawCircle(0, h + r * 0.9, r);
            g.endFill();
            const tex = pixiRenderer.current.generateTexture(g);
            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5, 0); // base no pé (y=0)
            state.characterGraphics?.destroy();
            state.characterGraphics = null;
            return sprite;
        };

        // Animation loop
    let lastOverlayRedraw = 0;
    const animate = () => {
            if (state.initialised && stage.current && pixiRenderer.current) {
                // ... animation logic from original file ...
                // This would be a direct translation of the original 'animate' function
                // using the 'state' ref object for mutable state.
                const now = new Date().getTime();
                state.dt = now - (state.time || now);
                state.time = now;
                
                state.zoom = (state.zoom + MapStore.getTargetZoom()) / 2.0;

                // mover personagem (WASD / setas) em eixos de tela; converte para mundo
                let speed = config.controls.characterSpeedMps; // m/s
                if (keys['shift'] || keys['shiftleft'] || keys['shiftright']) {
                    speed *= config.controls.sprintMultiplier;
                }
                const dtSec = state.dt / 1000;
                let sdx = 0, sdy = 0; // deltas em eixos da tela (esquerda/direita, baixo/cima)
                if (keys['w'] || keys['arrowup']) sdy -= speed * dtSec; // cima
                if (keys['s'] || keys['arrowdown']) sdy += speed * dtSec; // baixo
                if (keys['a'] || keys['arrowleft']) sdx -= speed * dtSec; // esquerda
                if (keys['d'] || keys['arrowright']) sdx += speed * dtSec; // direita
                if (sdx !== 0 && sdy !== 0) { const m = Math.SQRT1_2; sdx *= m; sdy *= m; }

                let dx = sdx, dy = sdy; // topdown padrão
                if (config.render.mode === 'isometric') {
                    const { isoA: A, isoB: B, isoC: C, isoD: D } = config.render;
                    // inversa de [[A, C],[B, D]] com det presumido != 0; para matriz padrão det=1
                    const det = A * D - B * C || 1;
                    const inv00 = D / det, inv01 = -C / det, inv10 = -B / det, inv11 = A / det;
                    const wx = inv00 * sdx + inv01 * sdy;
                    const wy = inv10 * sdx + inv11 * sdy;
                    dx = wx; dy = wy;
                }

                state.character.pos.x += dx;
                state.character.pos.y += dy;

                zoomContainer.current!.scale.x = state.zoom;
                zoomContainer.current!.scale.y = state.zoom;
                // sincronizar visibilidade dos marcadores com config
                if (debugMapData.current) {
                    debugMapData.current.visible = config.render.showJunctionMarkers;
                }
                
                // Atualizar personagem e câmera
                const charH = scale.characterHeightM;
                const charD = scale.characterDiameterM;
                const charR = charD / 2;
                const base = worldToIso(state.character.pos);
                const top = worldToIso({ x: state.character.pos.x, y: state.character.pos.y + charH });
                const circleC = worldToIso({ x: state.character.pos.x, y: state.character.pos.y + charR });

                // garantir sprite do personagem
                if (!(state as any).characterSprite && pixiRenderer.current) {
                    (state as any).characterSprite = buildCharacterSprite();
                    if ((state as any).characterSprite) {
                        characters.current!.addChild((state as any).characterSprite);
                    }
                }
                const sprite: PIXI.Sprite | undefined = (state as any).characterSprite || undefined;
                if (sprite) {
                    sprite.position.set(base.x, base.y);
                }

                // câmera segue o personagem (projetado) se habilitado
                if (config.render.cameraFollow) {
                    const targetCamX = circleC.x;
                    const targetCamY = circleC.y;
                    const follow = 0.2; // suavização
                    state.camera.x += (targetCamX - state.camera.x) * follow;
                    state.camera.y += (targetCamY - state.camera.y) * follow;
                }

                drawables.current!.x = -state.camera.x;
                drawables.current!.y = -state.camera.y;

                // Atualizar view do overlay (pan/zoom) e redesenhar com throttling
                if (NoiseZoning.setView) {
                    NoiseZoning.setView({ cameraX: state.camera.x, cameraY: state.camera.y, zoom: state.zoom });
                    const nowT = now;
                    if (nowT - lastOverlayRedraw > 120) { // ~8fps para overlay
                        NoiseZoning.redraw();
                        lastOverlayRedraw = nowT;
                    }
                }

                pixiRenderer.current.render(stage.current);
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('resize', onResizeOverlay);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            MapStore.removeChangeListener(onMapChange);
            pixiRenderer.current?.destroy();
            canvasContainerRef.current?.removeChild(canvasEl);
            if (NoiseZoning.detach) NoiseZoning.detach();
        };
    }, []);

    return <div id="canvas-container" ref={canvasContainerRef} style={{ position: 'relative' }} />;
};

export default GameCanvas;