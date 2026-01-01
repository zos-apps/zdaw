/**
 * Browser - File/Instrument/Effect browser for zDAW
 *
 * Features:
 * - Instrument list with presets
 * - Effect list
 * - Sample browser
 * - Drag and drop support
 */

import React, { useState, useCallback } from 'react';
import type { PluginDefinition } from '../types';
import { BUILTIN_PLUGINS } from '../audio/VSTHost';
import { SYNTH_PRESETS } from '../audio/Synth';

interface BrowserProps {
  onInstrumentSelect?: (instrumentId: string, presetId?: string) => void;
  onEffectSelect?: (effectId: string) => void;
  onSampleSelect?: (samplePath: string) => void;
  onDragStart?: (type: 'instrument' | 'effect' | 'sample', id: string) => void;
}

type BrowserSection = 'instruments' | 'effects' | 'samples';

interface TreeNode {
  id: string;
  name: string;
  type: 'folder' | 'item';
  children?: TreeNode[];
  data?: unknown;
}

export const Browser: React.FC<BrowserProps> = ({
  onInstrumentSelect,
  onEffectSelect,
  onSampleSelect,
  onDragStart,
}) => {
  const [activeSection, setActiveSection] = useState<BrowserSection>('instruments');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['synth', 'effects']));
  const [searchQuery, setSearchQuery] = useState('');

  // Build instrument tree
  const instrumentTree: TreeNode[] = [
    {
      id: 'synth',
      name: 'Synthesizer',
      type: 'folder',
      children: SYNTH_PRESETS.map((preset) => ({
        id: `synth:${preset.id}`,
        name: preset.name,
        type: 'item',
        data: preset,
      })),
    },
    {
      id: 'sampler',
      name: 'Sampler',
      type: 'folder',
      children: [
        { id: 'sampler:piano', name: 'Grand Piano', type: 'item' },
        { id: 'sampler:strings', name: 'String Ensemble', type: 'item' },
        { id: 'sampler:drums', name: 'Drum Kit', type: 'item' },
      ],
    },
  ];

  // Build effect tree
  const effectTree: TreeNode[] = [
    {
      id: 'dynamics',
      name: 'Dynamics',
      type: 'folder',
      children: BUILTIN_PLUGINS.filter((p) =>
        ['compressor', 'limiter', 'gain'].includes(p.type)
      ).map((p) => ({
        id: `effect:${p.id}`,
        name: p.name,
        type: 'item',
        data: p,
      })),
    },
    {
      id: 'eq-filter',
      name: 'EQ & Filter',
      type: 'folder',
      children: BUILTIN_PLUGINS.filter((p) =>
        ['eq', 'filter'].includes(p.type)
      ).map((p) => ({
        id: `effect:${p.id}`,
        name: p.name,
        type: 'item',
        data: p,
      })),
    },
    {
      id: 'time-based',
      name: 'Time-Based',
      type: 'folder',
      children: BUILTIN_PLUGINS.filter((p) =>
        ['reverb', 'delay', 'chorus'].includes(p.type)
      ).map((p) => ({
        id: `effect:${p.id}`,
        name: p.name,
        type: 'item',
        data: p,
      })),
    },
    {
      id: 'distortion',
      name: 'Distortion',
      type: 'folder',
      children: BUILTIN_PLUGINS.filter((p) =>
        ['distortion'].includes(p.type)
      ).map((p) => ({
        id: `effect:${p.id}`,
        name: p.name,
        type: 'item',
        data: p,
      })),
    },
  ];

  // Sample tree (placeholder)
  const sampleTree: TreeNode[] = [
    {
      id: 'drums',
      name: 'Drums',
      type: 'folder',
      children: [
        { id: 'sample:kick-01', name: 'Kick 01', type: 'item' },
        { id: 'sample:kick-02', name: 'Kick 02', type: 'item' },
        { id: 'sample:snare-01', name: 'Snare 01', type: 'item' },
        { id: 'sample:snare-02', name: 'Snare 02', type: 'item' },
        { id: 'sample:hihat-closed', name: 'Hi-Hat Closed', type: 'item' },
        { id: 'sample:hihat-open', name: 'Hi-Hat Open', type: 'item' },
        { id: 'sample:clap', name: 'Clap', type: 'item' },
        { id: 'sample:rim', name: 'Rim', type: 'item' },
      ],
    },
    {
      id: 'bass',
      name: 'Bass',
      type: 'folder',
      children: [
        { id: 'sample:bass-808', name: '808 Bass', type: 'item' },
        { id: 'sample:bass-sub', name: 'Sub Bass', type: 'item' },
      ],
    },
    {
      id: 'fx',
      name: 'FX',
      type: 'folder',
      children: [
        { id: 'sample:riser', name: 'Riser', type: 'item' },
        { id: 'sample:impact', name: 'Impact', type: 'item' },
        { id: 'sample:sweep', name: 'Sweep', type: 'item' },
      ],
    },
    {
      id: 'loops',
      name: 'Loops',
      type: 'folder',
      children: [
        { id: 'sample:loop-drum-01', name: 'Drum Loop 01', type: 'item' },
        { id: 'sample:loop-drum-02', name: 'Drum Loop 02', type: 'item' },
        { id: 'sample:loop-synth', name: 'Synth Loop', type: 'item' },
      ],
    },
  ];

  // Toggle folder expansion
  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // Handle item click
  const handleItemClick = useCallback(
    (node: TreeNode) => {
      const [type, id] = node.id.split(':');

      if (type === 'synth') {
        onInstrumentSelect?.('synth', id);
      } else if (type === 'sampler') {
        onInstrumentSelect?.(id);
      } else if (type === 'effect') {
        onEffectSelect?.(id);
      } else if (type === 'sample') {
        onSampleSelect?.(id);
      }
    },
    [onInstrumentSelect, onEffectSelect, onSampleSelect]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.DragEvent, node: TreeNode) => {
      const [type, id] = node.id.split(':');
      e.dataTransfer.setData('application/zdaw', JSON.stringify({ type, id }));
      e.dataTransfer.effectAllowed = 'copy';

      if (type === 'synth' || type === 'sampler') {
        onDragStart?.('instrument', id);
      } else if (type === 'effect') {
        onDragStart?.('effect', id);
      } else if (type === 'sample') {
        onDragStart?.('sample', id);
      }
    },
    [onDragStart]
  );

  // Filter tree based on search
  const filterTree = useCallback(
    (nodes: TreeNode[]): TreeNode[] => {
      if (!searchQuery) return nodes;

      const query = searchQuery.toLowerCase();
      return nodes
        .map((node) => {
          if (node.type === 'folder') {
            const filteredChildren = filterTree(node.children || []);
            if (filteredChildren.length > 0) {
              return { ...node, children: filteredChildren };
            }
            return null;
          }
          return node.name.toLowerCase().includes(query) ? node : null;
        })
        .filter(Boolean) as TreeNode[];
    },
    [searchQuery]
  );

  // Render tree node
  const renderNode = (node: TreeNode, depth: number = 0): JSX.Element => {
    const isExpanded = expandedFolders.has(node.id);
    const indent = depth * 12;

    if (node.type === 'folder') {
      return (
        <div key={node.id}>
          <div
            className="flex items-center gap-1 py-1 px-2 hover:bg-white/5 cursor-pointer"
            style={{ paddingLeft: 8 + indent }}
            onClick={() => toggleFolder(node.id)}
          >
            <span className="text-white/50 text-xs w-3">
              {isExpanded ? 'v' : '>'}
            </span>
            <span className="text-white/50 text-xs">
              {isExpanded ? '[ ]' : '[+]'}
            </span>
            <span className="text-xs text-white/70">{node.name}</span>
          </div>
          {isExpanded &&
            node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    return (
      <div
        key={node.id}
        className="flex items-center gap-2 py-1 px-2 hover:bg-white/10 cursor-pointer"
        style={{ paddingLeft: 24 + indent }}
        onClick={() => handleItemClick(node)}
        draggable
        onDragStart={(e) => handleDragStart(e, node)}
      >
        <span className="text-xs">
          {node.id.startsWith('synth:') && '~'}
          {node.id.startsWith('sampler:') && '#'}
          {node.id.startsWith('effect:') && '*'}
          {node.id.startsWith('sample:') && '>'}
        </span>
        <span className="text-xs text-white/90">{node.name}</span>
      </div>
    );
  };

  // Get current tree based on section
  const getCurrentTree = (): TreeNode[] => {
    switch (activeSection) {
      case 'instruments':
        return filterTree(instrumentTree);
      case 'effects':
        return filterTree(effectTree);
      case 'samples':
        return filterTree(sampleTree);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#252525]">
      {/* Header */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-black">
        <span className="text-xs text-white/50">Browser</span>
      </div>

      {/* Section tabs */}
      <div className="flex border-b border-black">
        {(['instruments', 'effects', 'samples'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`flex-1 py-1.5 text-xs capitalize ${
              activeSection === section
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:bg-white/5'
            }`}
          >
            {section}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-2 border-b border-black/50">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-2 py-1 text-xs bg-black/30 rounded border border-white/10 focus:border-white/30 outline-none"
        />
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto">
        {getCurrentTree().map((node) => renderNode(node))}

        {getCurrentTree().length === 0 && (
          <div className="p-4 text-center text-xs text-white/30">
            No items found
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="h-8 flex items-center px-2 border-t border-black text-[10px] text-white/30">
        {activeSection === 'instruments' && 'Drag to MIDI track'}
        {activeSection === 'effects' && 'Drag to track FX slot'}
        {activeSection === 'samples' && 'Drag to arrangement'}
      </div>
    </div>
  );
};
