import { randomRange } from '../generic_modules/math';

const branchAngleDev = 3;
const forwardAngleDev = 15;

const randomAngle = (limit: number): number => {
    // non-linear distribution
    const nonUniformNorm = Math.pow(Math.abs(limit), 3);
    let val = 0;
    while (val === 0 || Math.random() < Math.pow(Math.abs(val), 3) / nonUniformNorm) {
        val = randomRange(-limit, +limit);
    }
    return val;
};

// Escala e unidades
export const units = {
    world: 'meters', // 1 unidade do mundo = 1 metro
};

export const scale = {
    // Altura do personagem em metros (175 cm)
    characterHeightM: 1.75,
    // Aproximação: diâmetro (largura) ~ 1/4 da altura (ombros ~ 44cm)
    get characterDiameterM() { return this.characterHeightM / 4; },
    // Multiplicadores relativos ao personagem
    multipliers: {
        // Dobrando as larguras atuais:
        // Ruas: 20x -> 40x o diâmetro do personagem
        // Rodovias: 30x -> 60x o diâmetro do personagem
        streetVsCharacter: 40,
        highwayVsCharacter: 60,
    }
};

// Larguras baseadas no diâmetro do personagem (ombros), garantindo proporcionalidade perceptível
export const roadWidthM = () => scale.characterDiameterM * scale.multipliers.streetVsCharacter;
export const highwayWidthM = () => scale.characterDiameterM * scale.multipliers.highwayVsCharacter;

export const config = {
    mapGeneration: {
        BUILDING_PLACEMENT_LOOP_LIMIT: 3,
        // Comprimentos continuam em metros (unidades do mundo)
    DEFAULT_SEGMENT_LENGTH: 90, // quadra mais curta para reforçar malha densa
    HIGHWAY_SEGMENT_LENGTH: 260,
        // Larguras derivadas da escala; manter os campos para retrocompat, mas não usar diretamente
        DEFAULT_SEGMENT_WIDTH: 0, // ignorado (usamos roadWidthM())
        HIGHWAY_SEGMENT_WIDTH: 0, // ignorado (usamos highwayWidthM())
        RANDOM_BRANCH_ANGLE: () => randomAngle(branchAngleDev),
        RANDOM_STRAIGHT_ANGLE: () => randomAngle(forwardAngleDev),
    DEFAULT_BRANCH_PROBABILITY: 0.55,
    HIGHWAY_BRANCH_PROBABILITY: 0.08,
        HIGHWAY_BRANCH_POPULATION_THRESHOLD: 0.1,
        NORMAL_BRANCH_POPULATION_THRESHOLD: 0.1,
        NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY: 5,
        MINIMUM_INTERSECTION_DEVIATION: 30, // degrees
        SEGMENT_COUNT_LIMIT: 2000,
        DEBUG_DELAY: 0, // ms
    ROAD_SNAP_DISTANCE: 55,
    HEAT_MAP_PIXEL_DIM: 50, // px
        DRAW_HEATMAP: false,
        QUADTREE_PARAMS: {
            x: -20000,
            y: -20000,
            width: 40000,
            height: 40000,
        },
        QUADTREE_MAX_OBJECTS: 10,
        QUADTREE_MAX_LEVELS: 10,
        DEBUG: false,
    },
    buildings: {
        // Fator de área dos prédios (1.0 = original). 0.5 => metade da área
    areaScale: 1.0,
        // Dimensões reais aproximadas (em metros) para footprint (largura x profundidade)
        dimensions: {
            house: { width: 8, depth: 12 },           // casa térrea média ~ 96 m²
            residential: { width: 18, depth: 30 },    // edifício residencial footprint
            commercial: { width: 22, depth: 35 },     // loja/prédio comercial base
            import: { width: 40, depth: 60 },         // galpão/armazém (industrial)
        }
    },
    render: {
        // 'isometric' para visão isométrica, 'topdown' para ortográfica
        mode: 'isometric' as 'isometric' | 'topdown',
        // Fatores da projeção isométrica clássica (2:1):
        // x' = isoA * x + isoC * y; y' = isoB * x + isoD * y
        isoA: 1,
        isoB: 0.5,
        isoC: -1,
        isoD: 0.5,
        cameraFollow: true,
    // Mostrar/ocultar marcadores de junção/interseção (debug)
    showJunctionMarkers: false,
    // Usar patch Bézier para suavizar a QUINA EXTERNA das junções
    useOuterBezierPatch: true,
    // Usar arco interno para preencher o vão (padrão: ligado para arredondar quadras)
    useInnerArcPatch: true,
    // Resolução do patch Bézier externo (nº de amostras)
    outerBezierSampleCount: 32,
    // Raio absoluto das curvas externas em metros e sua faixa permitida
    outerCornerRadiusRangeM: { min: 3.0, max: 4.5 },
    outerCornerRadiusM: 3.5,
    // Overlay de zonas (debug visual)
    showZoneOverlay: false,
    zoneOverlayAlpha: 0.12,
    zoneOverlayTileM: 250,
    blockCorner: {
        outlineEnabled: true,
        outlineColor: 0x1B5E20,
        outlineAlpha: 0.55,
        outlineWidth: 3,
    },
    zoneColors: {
    downtown: 0xFF8A65,
        residential: 0x4FC3F7,
        commercial: 0xFFB74D,
        industrial: 0xBA68C8,
        rural: 0x81C784,
    },
    },
    gameLogic: {
        SELECT_PAN_THRESHOLD: 50, // px
        SELECTION_RANGE: 50, // px
        DEFAULT_PICKUP_RANGE: 150, // world units
        DEFAULT_CARGO_CAPACITY: 1,
        MIN_SPEED_PROPORTION: 0.1,
    },
    controls: {
    characterSpeedMps: 25, // velocidade base em m/s (ajustável na UI)
    sprintMultiplier: 3,   // multiplicador ao segurar Shift
    },
    zones: {
        // Parâmetros por zona: comprimento típico de quadra e mix de tipos de prédio
        downtown: {
            blockLengthM: 75,
            buildingMix: { commercial: 0.5, residential: 0.4, house: 0.05, import: 0.05 },
            streetWidthMultiplier: 1.1,
        },
        residential: {
            blockLengthM: 95,
            buildingMix: { house: 0.6, residential: 0.35, commercial: 0.04, import: 0.01 },
            streetWidthMultiplier: 0.9,
        },
        commercial: {
            blockLengthM: 80,
            buildingMix: { commercial: 0.6, residential: 0.3, house: 0.08, import: 0.02 },
            streetWidthMultiplier: 1.05,
        },
        industrial: {
            blockLengthM: 130,
            buildingMix: { import: 0.7, commercial: 0.2, residential: 0.08, house: 0.02 },
            streetWidthMultiplier: 1.2,
        },
        rural: {
            blockLengthM: 170,
            buildingMix: { house: 0.8, residential: 0.15, import: 0.04, commercial: 0.01 },
            streetWidthMultiplier: 0.8,
        }
    }
};