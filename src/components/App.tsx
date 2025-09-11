import React, { useState } from 'react';
import { config } from '../game_modules/config';
import { MapActions } from '../actions/MapActions';
import GameCanvas from './GameCanvas';
import ToggleButton from './ToggleButton';
import NoiseZoning from '../overlays/NoiseZoning';

const App: React.FC = () => {
    const [segmentCountLimit, setSegmentCountLimit] = useState(config.mapGeneration.SEGMENT_COUNT_LIMIT);
    const [charSpeed, setCharSpeed] = useState(config.controls.characterSpeedMps);
    const [segLen, setSegLen] = useState(config.mapGeneration.DEFAULT_SEGMENT_LENGTH);
    const [nzParams, setNzParams] = useState(NoiseZoning.getParams ? NoiseZoning.getParams() : undefined);
    // raio fixo via config: sem estado

    const onSegmentCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(event.target.value, 10);
        config.mapGeneration.SEGMENT_COUNT_LIMIT = value;
        setSegmentCountLimit(value);
    };

    const regenerateMap = () => {
        const seed = new Date().getTime();
        MapActions.generate(seed);
    };

    const factorTargetZoom = (factor: number) => {
        MapActions.factorTargetZoom(factor);
    };

    const onSpeedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(event.target.value);
        config.controls.characterSpeedMps = value;
        setCharSpeed(value);
    };

    const onSegLenChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(event.target.value);
        config.mapGeneration.DEFAULT_SEGMENT_LENGTH = value;
        config.mapGeneration.HIGHWAY_SEGMENT_LENGTH = Math.max(200, Math.round(value * 1.55));
        setSegLen(value);
    };

    // sem handler: raio fixo via config

    

    return (
        <div id="main-viewport-container">
            <GameCanvas />
            <div id="control-bar">
                <ToggleButton 
                    onText="Hide Debug Drawing" 
                    offText="Show Debug Drawing" 
                    action={() => { config.mapGeneration.DEBUG = !config.mapGeneration.DEBUG; }}
                />
                <ToggleButton 
                    onText="Hide Population Heatmap" 
                    offText="Show Population Heatmap" 
                    action={() => { config.mapGeneration.DRAW_HEATMAP = !config.mapGeneration.DRAW_HEATMAP; }}
                />
                <button onClick={() => factorTargetZoom(3 / 2)}>Zoom in</button>
                <button onClick={() => factorTargetZoom(2 / 3)}>Zoom out</button>
                <button onClick={() => { config.render.mode = (config.render.mode === 'isometric' ? 'topdown' : 'isometric'); }}>Toggle Iso</button>
                <ToggleButton 
                    onText="Camera Follow: ON" 
                    offText="Camera Follow: OFF" 
                    action={() => { config.render.cameraFollow = !config.render.cameraFollow; }}
                />
                <ToggleButton 
                    onText="Hide Junction Markers" 
                    offText="Show Junction Markers" 
                    action={() => { config.render.showJunctionMarkers = !config.render.showJunctionMarkers; }}
                />
                <label htmlFor="char-speed" style={{ marginLeft: 8 }}>Velocidade (m/s): {charSpeed.toFixed(1)}</label>
                <input 
                    id="char-speed"
                    type="range" 
                    min="1" 
                    max="150" 
                    step="0.5" 
                    value={charSpeed}
                    onChange={onSpeedChange}
                    style={{ width: 180 }}
                />
                <label htmlFor="segment-limit">Segment limit:</label>
                <input 
                    id="segment-limit" 
                    onChange={onSegmentCountChange} 
                    type="number" 
                    min="1" 
                    max="5000" 
                    value={segmentCountLimit} 
                />
                <label htmlFor="seg-len" style={{ marginLeft: 8 }}>Comprimento do segmento (m): {segLen.toFixed(0)}</label>
                <input 
                    id="seg-len"
                    type="range"
                    min="80"
                    max="400"
                    step="10"
                    value={segLen}
                    onChange={onSegLenChange}
                    style={{ width: 200 }}
                />
                {/* Raio de curva fixo em config.render.outerCornerRadiusM */}
                
                <button onClick={regenerateMap} style={{ marginLeft: 8 }}>Regenerate</button>
                {/* Overlay Perlin Controls (opcionais) */}
                {nzParams && (
                    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginLeft: 12 }}>
                        <label>
                            Freq:
                            <input
                                type="range"
                                min="0.0005"
                                max="0.01"
                                step="0.0005"
                                value={nzParams.baseScale}
                                onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    NoiseZoning.setParams?.({ baseScale: v });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 120 }}
                            />
                        </label>
                        <label>
                            Octaves: {nzParams.octaves}
                            <input
                                type="range"
                                min="1"
                                max="8"
                                step="1"
                                value={nzParams.octaves}
                                onChange={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    NoiseZoning.setParams?.({ octaves: v });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 100 }}
                            />
                        </label>
                        <label>
                            r1: {(nzParams.thresholds.r1).toFixed(2)}
                            <input
                                type="range"
                                min="0.00"
                                max="0.99"
                                step="0.01"
                                value={nzParams.thresholds.r1}
                                onChange={(e) => {
                                    NoiseZoning.setParams?.({ thresholds: { r1: parseFloat(e.target.value) } as any });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 100 }}
                            />
                        </label>
                        <label>
                            r2: {(nzParams.thresholds.r2).toFixed(2)}
                            <input
                                type="range"
                                min="0.01"
                                max="0.995"
                                step="0.01"
                                value={nzParams.thresholds.r2}
                                onChange={(e) => {
                                    NoiseZoning.setParams?.({ thresholds: { r2: parseFloat(e.target.value) } as any });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 100 }}
                            />
                        </label>
                        <label>
                            r3: {(nzParams.thresholds.r3).toFixed(2)}
                            <input
                                type="range"
                                min="0.02"
                                max="0.999"
                                step="0.01"
                                value={nzParams.thresholds.r3}
                                onChange={(e) => {
                                    NoiseZoning.setParams?.({ thresholds: { r3: parseFloat(e.target.value) } as any });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 100 }}
                            />
                        </label>
                        <label>
                            r4: {(nzParams.thresholds.r4).toFixed(2)}
                            <input
                                type="range"
                                min="0.03"
                                max="1.00"
                                step="0.01"
                                value={nzParams.thresholds.r4}
                                onChange={(e) => {
                                    NoiseZoning.setParams?.({ thresholds: { r4: parseFloat(e.target.value) } as any });
                                    const p = NoiseZoning.getParams?.();
                                    if (p) setNzParams(p);
                                }}
                                style={{ width: 100 }}
                            />
                        </label>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;