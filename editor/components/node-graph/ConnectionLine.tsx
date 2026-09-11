
import React, { memo } from 'react';
import { GraphConnection, GraphNode } from '@/types';
import { NodeRegistry, getTypeColor } from '@/engine/NodeRegistry';
import { GraphUtils } from './GraphUtils';
import { LayoutConfig } from './GraphConfig';

interface ConnectionLineProps {
    connection: GraphConnection;
    fromNode: GraphNode | undefined;
    toNode: GraphNode | undefined;
}

export const ConnectionLine = memo(({ connection, fromNode, toNode }: ConnectionLineProps) => {
    if (!fromNode || !toNode) return null;

    const p1 = GraphUtils.getPinPosition(fromNode, connection.fromPin, 'output');
    const p2 = GraphUtils.getPinPosition(toNode, connection.toPin, 'input');
    
    p1.x += LayoutConfig.WIRE_GAP;
    p2.x -= LayoutConfig.WIRE_GAP;

    const d = GraphUtils.calculateCurve(p1.x, p1.y, p2.x, p2.y);
    
    const def = NodeRegistry[fromNode.type];
    const port = def?.outputs.find(p => p.id === connection.fromPin);
    const color = port?.color || getTypeColor(port?.type || 'any');

    return <path d={d} stroke={color} strokeWidth="3" fill="none" className="drop-shadow-md opacity-80 hover:opacity-100 hover:stroke-[4px] transition-[opacity,stroke-width] cursor-pointer" />;
});
