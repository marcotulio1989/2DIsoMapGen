import * as _ from 'lodash';
import { Noise } from 'noisejs';
import Quadtree from '../lib/quadtree';
import seedrandom from 'seedrandom';

import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import { CollisionObject, CollisionObjectType } from '../generic_modules/collision';
import { config, roadWidthM, highwayWidthM } from './config';
import Zoning from './zoning';
import { Point } from '../generic_modules/math';

export enum SegmentEnd {
    START = "start",
    END = "end"
}

interface SegmentRoad {
    start: Point;
    end: Point;
    setStart: (val: Point) => void;
    setEnd: (val: Point) => void;
}

interface SegmentMeta {
    highway?: boolean;
    color?: number;
    severed?: boolean;
}

export class Segment {
    width: number;
    collider: CollisionObject;

    roadRevision = 0;
    dirRevision: number | undefined = undefined;
    lengthRevision: number | undefined = undefined;

    cachedDir: number | undefined = undefined;
    cachedLength: number | undefined = undefined;

    r: SegmentRoad;
    links: { b: Segment[]; f: Segment[] } = { b: [], f: [] };
    users: any[] = [];
    maxSpeed: number;
    capacity: number;
    id?: number;
    setupBranchLinks?: () => void;

    constructor(
        start: Point,
        end: Point,
        public t: number = 0,
        public q: SegmentMeta = {}
    ) {
        start = _.cloneDeep(start);
        end = _.cloneDeep(end);

    // Largura em metros, escalada a partir da altura do personagem
    this.width = q.highway ? highwayWidthM() : roadWidthM();
        this.collider = new CollisionObject(this, CollisionObjectType.LINE, { start, end, width: this.width });

        this.r = {
            start: start,
            end: end,
            setStart: (val: Point) => {
                this.r.start = val;
                this.collider.updateCollisionProperties({ start: this.r.start });
                this.roadRevision++;
            },
            setEnd: (val: Point) => {
                this.r.end = val;
                this.collider.updateCollisionProperties({ end: this.r.end });
                this.roadRevision++;
            }
        };

        [this.maxSpeed, this.capacity] = q.highway ? [1200, 12] : [800, 6];
    }

    currentSpeed(): number {
        return Math.max(config.gameLogic.MIN_SPEED_PROPORTION, 1 - Math.max(0, this.users.length - 1) / this.capacity) * this.maxSpeed;
    }

    dir(): number {
        if (this.dirRevision !== this.roadRevision) {
            this.dirRevision = this.roadRevision;
            const vector = math.subtractPoints(this.r.end, this.r.start);
            this.cachedDir = -1 * math.sign(math.crossProduct({ x: 0, y: 1 }, vector)) * math.angleBetween({ x: 0, y: 1 }, vector);
        }
        return this.cachedDir!;
    }

    length(): number {
        if (this.lengthRevision !== this.roadRevision) {
            this.lengthRevision = this.roadRevision;
            this.cachedLength = math.length(this.r.start, this.r.end);
        }
        return this.cachedLength!;
    }

    debugLinks(): void {
        this.q.color = 0x00FF00;
        this.links.b.forEach(backwards => {
            backwards.q.color = 0xFF0000;
        });
        this.links.f.forEach(forwards => {
            forwards.q.color = 0x0000FF;
        });
    }

    startIsBackwards(): boolean {
        if (this.links.b.length > 0) {
            return math.equalV(this.links.b[0].r.start, this.r.start) ||
                   math.equalV(this.links.b[0].r.end, this.r.start);
        } else {
             return math.equalV(this.links.f[0].r.start, this.r.end) ||
                   math.equalV(this.links.f[0].r.end, this.r.end);
        }
    }

    cost(): number {
        return this.length() / this.currentSpeed();
    }

    costTo(other: Segment, fromFraction?: number): number {
        const segmentEnd = this.endContaining(other);
        let multiplier = 0.5;
        if (fromFraction !== undefined) {
            switch (segmentEnd) {
                case SegmentEnd.START: multiplier = fromFraction; break;
                case SegmentEnd.END: multiplier = (1 - fromFraction); break;
            }
        }
        return this.cost() * multiplier;
    }

    neighbours(): Segment[] {
        return this.links.f.concat(this.links.b);
    }

    endContaining(segment: Segment): SegmentEnd | undefined {
        const startBackwards = this.startIsBackwards();
        if (this.links.b.includes(segment)) {
            return startBackwards ? SegmentEnd.START : SegmentEnd.END;
        } else if (this.links.f.includes(segment)) {
            return startBackwards ? SegmentEnd.END : SegmentEnd.START;
        }
        return undefined;
    }

    linksForEndContaining(segment: Segment): Segment[] | undefined {
        if (this.links.b.includes(segment)) {
            return this.links.b;
        } else if (this.links.f.includes(segment)) {
            return this.links.f;
        }
        return undefined;
    }

    split(point: Point, segment: Segment, segmentList: Segment[], qTree: Quadtree): void {
        const startIsBackwards = this.startIsBackwards();

        const splitPart = segmentFactory.fromExisting(this);
        addSegment(splitPart, segmentList, qTree);
        splitPart.r.setEnd(point);
        this.r.setStart(point);

        splitPart.links.b = this.links.b.slice(0);
        splitPart.links.f = this.links.f.slice(0);
        
        const [firstSplit, secondSplit, fixLinks] = startIsBackwards
            ? [splitPart, this, splitPart.links.b]
            : [this, splitPart, splitPart.links.f];

        fixLinks.forEach(link => {
            let index = link.links.b.indexOf(this);
            if (index !== -1) {
                link.links.b[index] = splitPart;
            } else {
                index = link.links.f.indexOf(this);
                if (index !== -1) {
                    link.links.f[index] = splitPart;
                }
            }
        });

        firstSplit.links.f = [segment, secondSplit];
        secondSplit.links.b = [segment, firstSplit];
        segment.links.f.push(firstSplit, secondSplit);
    }
}

const segmentFactory = {
    fromExisting(segment: Segment, t?: number, r?: SegmentRoad, q?: SegmentMeta): Segment {
        t = util.defaultFor(t, segment.t);
        r = util.defaultFor(r, segment.r);
        q = util.defaultFor(q, segment.q);
        return new Segment(r.start, r.end, t, q);
    },

    usingDirection(start: Point, dir?: number, length?: number, t?: number, q?: SegmentMeta): Segment {
        dir = util.defaultFor(dir, 90);
        length = util.defaultFor(length, config.mapGeneration.DEFAULT_SEGMENT_LENGTH);

        const end = {
            x: start.x + length * math.sinDegrees(dir),
            y: start.y + length * math.cosDegrees(dir)
        };
    return new Segment(start, end, t, q);
    }
};

let noise: Noise;

export type ZoneName = 'downtown' | 'residential' | 'commercial' | 'industrial' | 'rural';

export function getZoneAt(p: Point | { x: number; y: number }): ZoneName {
    // Zonas puramente por Perlin/fBm (independente das ruas)
    return Zoning.zoneAt(p);
}

export const heatmap = {
    popOnRoad(r: { start: Point, end: Point }): number {
        return (this.populationAt(r.start.x, r.start.y) + this.populationAt(r.end.x, r.end.y)) / 2;
    },
    populationAt(x: number, y: number): number {
        const value1 = (noise.simplex2(x / 10000, y / 10000) + 1) / 2;
        const value2 = (noise.simplex2(x / 20000 + 500, y / 20000 + 500) + 1) / 2;
        const value3 = (noise.simplex2(x / 20000 + 1000, y / 20000 + 1000) + 1) / 2;
        return Math.pow((value1 * value2 + value3) / 2, 2);
    }
};

function doRoadSegmentsIntersect(r1: { start: Point, end: Point }, r2: { start: Point, end: Point }): ReturnType<typeof math.doLineSegmentsIntersect> {
    return math.doLineSegmentsIntersect(r1.start, r1.end, r2.start, r2.end, true);
}

function localConstraints(segment: Segment, segments: Segment[], qTree: Quadtree, debugData: any): boolean {
    let action = { priority: 0, func: undefined as (() => boolean) | undefined, q: {} as any };

    const matches = qTree.retrieve(segment.collider.limits()) as {o: Segment}[];
    for (const match of matches) {
        const other = match.o;
        if (other === segment) continue;

        if (action.priority <= 4) {
            const intersection = doRoadSegmentsIntersect(segment.r, other.r);
            if (intersection) {
                if (!action.q.t || intersection.t < action.q.t) {
                    action.q.t = intersection.t;
                    action.priority = 4;
                    action.func = () => {
                        if (util.minDegreeDifference(other.dir(), segment.dir()) < config.mapGeneration.MINIMUM_INTERSECTION_DEVIATION) {
                            return false;
                        }
                        other.split(intersection, segment, segments, qTree);
                        segment.r.setEnd(intersection);
                        segment.q.severed = true;
                        if (debugData) {
                            debugData.intersections = debugData.intersections || [];
                            debugData.intersections.push({ x: intersection.x, y: intersection.y });
                        }
                        return true;
                    };
                }
            }
        }
        
        if (action.priority <= 3) {
            if (math.length(segment.r.end, other.r.end) <= config.mapGeneration.ROAD_SNAP_DISTANCE) {
                const point = other.r.end;
                action.priority = 3;
                action.func = () => {
                    segment.r.setEnd(point);
                    segment.q.severed = true;

                    const links = other.startIsBackwards() ? other.links.f : other.links.b;
                    if (_.some(links, link =>
                        (math.equalV(link.r.start, segment.r.end) && math.equalV(link.r.end, segment.r.start)) ||
                        (math.equalV(link.r.start, segment.r.start) && math.equalV(link.r.end, segment.r.end))
                    )) {
                        return false;
                    }

                    links.forEach(link => {
                        link.linksForEndContaining(other)?.push(segment);
                        segment.links.f.push(link);
                    });

                    links.push(segment);
                    segment.links.f.push(other);
                    
                    if (debugData) {
                        debugData.snaps = debugData.snaps || [];
                        debugData.snaps.push({ x: point.x, y: point.y });
                    }
                    return true;
                };
            }
        }

        if (action.priority <= 2) {
            const { distance2, pointOnLine, lineProj2, length2 } = math.distanceToLine(segment.r.end, other.r.start, other.r.end);
            if (distance2 < config.mapGeneration.ROAD_SNAP_DISTANCE * config.mapGeneration.ROAD_SNAP_DISTANCE &&
                lineProj2 >= 0 && lineProj2 <= length2) {
                
                const point = pointOnLine;
                action.priority = 2;
                action.func = () => {
                    segment.r.setEnd(point);
                    segment.q.severed = true;

                    if (util.minDegreeDifference(other.dir(), segment.dir()) < config.mapGeneration.MINIMUM_INTERSECTION_DEVIATION) {
                        return false;
                    }

                    other.split(point, segment, segments, qTree);

                    if (debugData) {
                        debugData.intersectionsRadius = debugData.intersectionsRadius || [];
                        debugData.intersectionsRadius.push({ x: point.x, y: point.y });
                    }
                    return true;
                };
            }
        }
    }
    
    return action.func ? action.func() : true;
}

const globalGoals = {
    generate(previousSegment: Segment): Segment[] {
        const newBranches: Segment[] = [];
        if (!previousSegment.q.severed) {
            const template = (direction: number, length: number, t: number, q: SegmentMeta) =>
                segmentFactory.usingDirection(previousSegment.r.end, direction, length, t, q);

            const templateContinue = (direction: number) => template(direction, previousSegment.length(), 0, previousSegment.q);
            const localZone = getZoneAt(previousSegment.r.end);
            const zoneBlockLen = (config as any).zones?.[localZone]?.blockLengthM || config.mapGeneration.DEFAULT_SEGMENT_LENGTH;
            const templateBranch = (direction: number) => template(direction, zoneBlockLen, previousSegment.q.highway ? config.mapGeneration.NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY : 0, {});

            const continueStraight = templateContinue(previousSegment.dir());
            const straightPop = heatmap.popOnRoad(continueStraight.r);

            if (previousSegment.q.highway) {
                const randomStraight = templateContinue(previousSegment.dir() + config.mapGeneration.RANDOM_STRAIGHT_ANGLE());
                const randomPop = heatmap.popOnRoad(randomStraight.r);
                
                let roadPop;
                if (randomPop > straightPop) {
                    newBranches.push(randomStraight);
                    roadPop = randomPop;
                } else {
                    newBranches.push(continueStraight);
                    roadPop = straightPop;
                }
                if (roadPop > config.mapGeneration.HIGHWAY_BRANCH_POPULATION_THRESHOLD) {
                    if (Math.random() < config.mapGeneration.HIGHWAY_BRANCH_PROBABILITY) {
                        newBranches.push(templateContinue(previousSegment.dir() - 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                    } else if (Math.random() < config.mapGeneration.HIGHWAY_BRANCH_PROBABILITY) {
                        newBranches.push(templateContinue(previousSegment.dir() + 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                    }
                }
            } else if (straightPop > config.mapGeneration.NORMAL_BRANCH_POPULATION_THRESHOLD) {
                newBranches.push(continueStraight);
            }

            if (straightPop > config.mapGeneration.NORMAL_BRANCH_POPULATION_THRESHOLD) {
                if (Math.random() < config.mapGeneration.DEFAULT_BRANCH_PROBABILITY) {
                    newBranches.push(templateBranch(previousSegment.dir() - 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                } else if (Math.random() < config.mapGeneration.DEFAULT_BRANCH_PROBABILITY) {
                    newBranches.push(templateBranch(previousSegment.dir() + 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                }
            }
        }

        newBranches.forEach(branch => {
            branch.setupBranchLinks = function() {
                previousSegment.links.f.forEach(link => {
                    this.links.b.push(link);
                    link.linksForEndContaining(previousSegment)?.push(this);
                });
                previousSegment.links.f.push(this);
                this.links.b.push(previousSegment);
            };
        });

        return newBranches;
    }
};

function addSegment(segment: Segment, segmentList: Segment[], qTree: Quadtree): void {
    segmentList.push(segment);
    qTree.insert(segment.collider.limits());
}

export interface MapGenerationResult {
    segments: Segment[];
    qTree: Quadtree;
    heatmap: typeof heatmap;
    debugData: any;
}

export function generate(seed: string | number): MapGenerationResult {
    const debugData = {};

    seedrandom(seed.toString(), { global: true });
    // Seeded noise instance for deterministic generation
    const noiseSeed = Math.floor(Math.random() * 65536);
    noise = new Noise(noiseSeed);
    // Inicializar Zoning com perlin fBm antes da criação das ruas
    Zoning.init(noiseSeed);

    const priorityQ = new util.PriorityQueue<Segment>();

    const rootLen = config.mapGeneration.HIGHWAY_SEGMENT_LENGTH;
    const rootSegment = new Segment({ x: 0, y: 0 }, { x: rootLen, y: 0 }, 0, { highway: true });
    const oppositeDirection = segmentFactory.fromExisting(rootSegment);
    const newEnd = { x: rootSegment.r.start.x - rootLen, y: oppositeDirection.r.end.y };
    oppositeDirection.r.setEnd(newEnd);
    oppositeDirection.links.b.push(rootSegment);
    rootSegment.links.b.push(oppositeDirection);
    priorityQ.put(rootSegment, rootSegment.t);
    priorityQ.put(oppositeDirection, oppositeDirection.t);

    const segments: Segment[] = [];
    const qTree = new Quadtree(config.mapGeneration.QUADTREE_PARAMS, config.mapGeneration.QUADTREE_MAX_OBJECTS, config.mapGeneration.QUADTREE_MAX_LEVELS);

    while (priorityQ.length() > 0 && segments.length < config.mapGeneration.SEGMENT_COUNT_LIMIT) {
        const minSegment = priorityQ.get()!;

        const accepted = localConstraints(minSegment, segments, qTree, debugData);
        if (accepted) {
            minSegment.setupBranchLinks?.();
            addSegment(minSegment, segments, qTree);
            globalGoals.generate(minSegment).forEach(newSegment => {
                newSegment.t += minSegment.t + 1;
                // Ajustar largura por zona (apenas não-highway)
                if (!newSegment.q.highway) {
                    const zone = getZoneAt(newSegment.r.end) as any;
                    const mult = (config as any).zones?.[zone]?.streetWidthMultiplier ?? 1.0;
                    newSegment.width = roadWidthM() * mult;
                    newSegment.collider.updateCollisionProperties({ width: newSegment.width });
                }
                priorityQ.put(newSegment, newSegment.t);
            });
        }
    }

    segments.forEach((segment, i) => segment.id = i);
    console.log(`${segments.length} segments generated.`);

    return { segments, qTree, heatmap, debugData };
}