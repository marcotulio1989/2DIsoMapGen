import * as _ from 'lodash';
import * as collision from '../generic_modules/collision';
import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import { config } from './config';
import type { Segment, ZoneName } from './mapgen';
import { getZoneAt } from './mapgen';
import type Quadtree from '../lib/quadtree';

export enum BuildingType {
    RESIDENTIAL = "residential",
    IMPORT = "import",
    HOUSE = "house",
    COMMERCIAL = "commercial"
}

export class Building {
    static id_counter = 0;
    id: number;
    aspectDegree: number;
    corners: math.Point[];
    collider: collision.CollisionObject;
    supply: any[] = [];
    demand: any[] = [];

    constructor(
        public center: math.Point,
        public dir: number,
        public diagonal: number,
        public type: BuildingType,
        aspectRatio: number = 1
    ) {
        this.aspectDegree = math.atanDegrees(aspectRatio);
        this.corners = this.generateCorners();
        this.collider = new collision.CollisionObject(this, collision.CollisionObjectType.RECT, { corners: this.corners });
        this.id = Building.id_counter++;
    }

    generateCorners(): math.Point[] {
        return [
            { x: this.center.x + this.diagonal * math.sinDegrees(+this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(+this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(-this.aspectDegree + this.dir),  y: this.center.y + this.diagonal * math.cosDegrees(-this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(180 + this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(180 + this.aspectDegree + this.dir) },
            { x: this.center.x + this.diagonal * math.sinDegrees(180 - this.aspectDegree + this.dir), y: this.center.y + this.diagonal * math.cosDegrees(180 - this.aspectDegree + this.dir) }
        ];
    }

    setCenter(val: math.Point): void {
        this.center = val;
        this.corners = this.generateCorners();
        this.collider.updateCollisionProperties({ corners: this.corners });
    }

    setDir(val: number): void {
        this.dir = val;
        this.corners = this.generateCorners();
        this.collider.updateCollisionProperties({ corners: this.corners });
    }
}

// usar o ZoneName exportado de mapgen (inclui 'downtown')

export const buildingFactory = {
    fromProbability(time: number): Building {
        const r = Math.random();
        if (r < 0.2) return this.byType(BuildingType.IMPORT, time);
        if (r < 0.6) return this.byType(BuildingType.RESIDENTIAL, time);
        return this.byType(BuildingType.HOUSE, time);
    },

    fromZone(zone: ZoneName, time: number): Building {
        const mix = (config as any).zones?.[zone]?.buildingMix || {};
        const order: { t: BuildingType; k: keyof typeof mix }[] = [
            { t: BuildingType.HOUSE, k: 'house' },
            { t: BuildingType.RESIDENTIAL, k: 'residential' },
            { t: BuildingType.COMMERCIAL, k: 'commercial' },
            { t: BuildingType.IMPORT, k: 'import' },
        ];
        let r = Math.random();
        for (const { t, k } of order) {
            const p = (mix as any)[k] ?? 0;
            if (r < p) return this.byType(t, time);
            r -= p;
        }
        return this.byType(BuildingType.HOUSE, time);
    },

    byType(type: BuildingType, time: number): Building {
        let building: Building;
        switch (type) {
            case BuildingType.RESIDENTIAL:
                {
                    const w = config.buildings.dimensions.residential.width;
                    const d = config.buildings.dimensions.residential.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.RESIDENTIAL, ar);
                }
                break;
            case BuildingType.IMPORT:
                {
                    const w = config.buildings.dimensions.import.width;
                    const d = config.buildings.dimensions.import.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.IMPORT, ar);
                }
                break;
            case BuildingType.COMMERCIAL:
                {
                    const w = config.buildings.dimensions.commercial.width;
                    const d = config.buildings.dimensions.commercial.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.95, 1.1);
                    const ar = w / d * math.randomRange(0.95, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.COMMERCIAL, ar);
                }
                break;
            case BuildingType.HOUSE:
                {
                    const w = config.buildings.dimensions.house.width;
                    const d = config.buildings.dimensions.house.depth;
                    const diag = Math.hypot(w, d) / 2 * Math.sqrt(config.buildings.areaScale) * math.randomRange(0.9, 1.1);
                    const ar = w / d * math.randomRange(0.9, 1.1);
                    building = new Building({ x: 0, y: 0 }, 0, diag, BuildingType.HOUSE, ar);
                }
                break;
        }
        return building;
    },

    aroundSegment(buildingTemplate: () => Building, segment: Segment, count: number, radius: number, quadtree: Quadtree, zoneAt: (p: math.Point) => ZoneName = getZoneAt, time: number = Date.now()): Building[] {
        const buildings: Building[] = [];
        for (let i = 0; i < count; i++) {
            const randomAngle = Math.random() * 360;
            const randomRadius = Math.random() * radius;
            const buildingCenter: math.Point = {
                x: 0.5 * (segment.r.start.x + segment.r.end.x) + randomRadius * math.sinDegrees(randomAngle),
                y: 0.5 * (segment.r.start.y + segment.r.end.y) + randomRadius * math.cosDegrees(randomAngle)
            };
            // Selecionar tipo por zona no ponto do prédio
            const zone = zoneAt(buildingCenter);
            const building = buildingFactory.fromZone(zone, time);
            building.setCenter(buildingCenter);
            building.setDir(segment.dir());

            let permitBuilding = false;
            for (let j = 0; j < config.mapGeneration.BUILDING_PLACEMENT_LOOP_LIMIT; j++) {
                let collisionCount = 0;
                
                const queryBounds = building.collider.limits();
                const potentialCollisions: any[] = quadtree.retrieve(queryBounds);
                const localCollisions = buildings.filter(b => {
                    const bLimits = b.collider.limits();
                    return !(bLimits.x + bLimits.width < queryBounds.x || 
                             queryBounds.x + queryBounds.width < bLimits.x ||
                             bLimits.y + bLimits.height < queryBounds.y ||
                             queryBounds.y + queryBounds.height < bLimits.y);
                });


                for (const obj of [...potentialCollisions, ...localCollisions]) {
                    const otherBuilding = obj.o || obj;
                    if (otherBuilding === building) continue;

                    const result = building.collider.collide(otherBuilding.collider);
                    if (result) {
                        collisionCount++;
                        if (j === config.mapGeneration.BUILDING_PLACEMENT_LOOP_LIMIT - 1) {
                            break;
                        }
                        if (typeof result !== "boolean") {
                           building.setCenter(math.addPoints(building.center, result));
                        }
                    }
                }

                if (collisionCount === 0) {
                    permitBuilding = true;
                    break;
                }
            }

            if (permitBuilding) {
                buildings.push(building);
            }
        }
        return buildings;
    }
};