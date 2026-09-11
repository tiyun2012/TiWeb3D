import React from 'react';
import { EngineModule, ComponentType, InspectorProps, IGameSystem } from '@/types';
import { Select } from '@/editor/components/ui/Select';
import { NumberInput, ColorInput, RangeInput, ModulePropertyPanel } from '@/editor/components/ui/InputControls';

const PaintTextureInspector: React.FC<InspectorProps> = ({ component, onUpdate, onStartUpdate, onCommit }) => {
    return (
        <ModulePropertyPanel title="Paint Texture">
            <div className="flex items-center gap-2 py-1">
               <span className="w-24 text-text-secondary text-[10px]">Brush Type</span>
               <div className="flex-1">
                   <Select value={component.brushType || 'Solid'} options={['Solid', 'Soft', 'Pattern'].map(v => ({ label: v, value: v }))} onChange={(v) => { onStartUpdate(); onUpdate('brushType', v); onCommit(); }} />
               </div>
            </div>
            
            <ColorInput label="Brush Color" value={component.brushColor || '#ff0000'} onChange={(v) => { onStartUpdate(); onUpdate('brushColor', v); onCommit(); }} />
            
            <RangeInput label="Brush Size" value={component.brushSize || 10} min={1} max={100} step={1} onChange={(v) => { onStartUpdate(); onUpdate('brushSize', v); onCommit(); }} />
            
            <RangeInput label="Opacity" value={component.opacity || 1} min={0} max={1} step={0.05} onChange={(v) => { onStartUpdate(); onUpdate('opacity', v); onCommit(); }} />

            <div className="mt-2 p-2 bg-black/20 rounded border border-white/5 text-center text-[10px] text-text-secondary cursor-pointer hover:bg-white/5 transition-colors">
                Apply Paint
            </div>
        </ModulePropertyPanel>
    );
};

// System adapter for Paint Texture logic
const createPaintTextureSystemAdapter = (): IGameSystem => ({
    id: 'PaintTextureSystem',
    update: (dt, ctx) => {
        // Implement paint logic here
        // e.g. Raycast from mouse to mesh, modify texture pixels
    }
});

export const PaintTextureModule: EngineModule = {
    id: 'PAINT_TEXTURE', // Custom component type
    name: 'Paint Texture',
    icon: 'Brush',
    order: 45,
    InspectorComponent: PaintTextureInspector,
    system: createPaintTextureSystemAdapter()
};
