/**
 * Mixer - Channel strip mixer for zDAW
 *
 * Features:
 * - Channel strips with faders
 * - Pan controls
 * - Mute/Solo buttons
 * - Level meters
 * - Effect inserts
 * - Send controls
 * - Master channel
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Track, AudioTrack, MIDITrack, MasterTrack, PluginInstance } from '../types';
import { gainToDb, dbToGain } from '../types';
import { BUILTIN_PLUGINS } from '../audio/VSTHost';

interface MixerProps {
  tracks: Track[];
  masterTrack: MasterTrack;
  onTracksChange: (tracks: Track[]) => void;
  onMasterChange: (master: MasterTrack) => void;
  getMeterLevels?: (trackId: string) => { left: number; right: number };
  selectedTrack: string | null;
  onTrackSelect: (trackId: string | null) => void;
}

interface ChannelStripProps {
  track: Track;
  meterLevels: { left: number; right: number };
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Track>) => void;
  onAddEffect: (effect: PluginInstance) => void;
  onRemoveEffect: (effectId: string) => void;
  isMaster?: boolean;
}

const FADER_HEIGHT = 150;

/**
 * VU Meter component
 */
const VUMeter: React.FC<{ level: number; height: number }> = ({ level, height }) => {
  // Convert to dB and normalize
  const db = level > 0 ? gainToDb(level) : -60;
  const normalized = Math.max(0, Math.min(1, (db + 60) / 66));
  const fillHeight = normalized * height;

  // Color gradient based on level
  const getColor = (db: number): string => {
    if (db > -3) return '#ef4444'; // Red (clip)
    if (db > -6) return '#f97316'; // Orange (hot)
    if (db > -12) return '#eab308'; // Yellow
    return '#22c55e'; // Green
  };

  return (
    <div
      className="relative bg-black/50 rounded overflow-hidden"
      style={{ width: 8, height }}
    >
      <div
        className="absolute bottom-0 w-full transition-all duration-75"
        style={{
          height: fillHeight,
          backgroundColor: getColor(db),
        }}
      />
      {/* Scale marks */}
      {[-6, -12, -24, -48].map((mark) => {
        const y = height - ((mark + 60) / 66) * height;
        return (
          <div
            key={mark}
            className="absolute w-full border-t border-white/20"
            style={{ top: y }}
          />
        );
      })}
    </div>
  );
};

/**
 * Fader component
 */
const Fader: React.FC<{
  value: number; // dB
  onChange: (value: number) => void;
  height: number;
}> = ({ value, onChange, height }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const normalized = 1 - Math.max(0, Math.min(1, y / height));
      // Map 0-1 to -60 to +6 dB
      const db = normalized * 66 - 60;
      onChange(Math.round(db * 10) / 10);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, height, onChange]);

  // Normalize value to position
  const normalized = (value + 60) / 66;
  const thumbY = (1 - normalized) * height;

  return (
    <div
      ref={trackRef}
      className="relative bg-black/30 rounded cursor-pointer"
      style={{ width: 24, height }}
      onMouseDown={handleMouseDown}
    >
      {/* Track */}
      <div className="absolute left-1/2 -translate-x-1/2 w-1 h-full bg-white/10 rounded" />

      {/* Scale marks */}
      {[0, -6, -12, -24, -48].map((db) => {
        const y = (1 - (db + 60) / 66) * height;
        return (
          <div
            key={db}
            className="absolute right-0 w-2 border-t border-white/30"
            style={{ top: y }}
          />
        );
      })}

      {/* Thumb */}
      <div
        className="absolute left-0 w-full h-6 bg-gradient-to-b from-white/90 to-white/70 rounded shadow-md"
        style={{ top: thumbY - 12 }}
      />
    </div>
  );
};

/**
 * Pan knob component
 */
const PanKnob: React.FC<{
  value: number; // -1 to 1
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    startY.current = e.clientY;
    startValue.current = value;
    e.preventDefault();
  }, [value]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = (startY.current - e.clientY) / 100;
      const newValue = Math.max(-1, Math.min(1, startValue.current + delta));
      onChange(Math.round(newValue * 100) / 100);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onChange]);

  // Convert value to angle (-135 to 135 degrees)
  const angle = value * 135;

  return (
    <div
      className="w-8 h-8 rounded-full bg-[#333] border-2 border-white/20 cursor-pointer relative"
      onMouseDown={handleMouseDown}
      onDoubleClick={() => onChange(0)}
    >
      {/* Indicator line */}
      <div
        className="absolute left-1/2 top-1 w-0.5 h-3 bg-white rounded origin-bottom"
        style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
      />
    </div>
  );
};

/**
 * Channel Strip component
 */
const ChannelStrip: React.FC<ChannelStripProps> = ({
  track,
  meterLevels,
  selected,
  onSelect,
  onUpdate,
  onAddEffect,
  onRemoveEffect,
  isMaster = false,
}) => {
  const [showEffects, setShowEffects] = useState(false);

  return (
    <div
      className={`flex flex-col w-20 bg-[#252525] border-r border-black/50 ${
        selected ? 'ring-2 ring-blue-500 ring-inset' : ''
      }`}
      onClick={onSelect}
    >
      {/* Track name */}
      <div
        className="h-8 flex items-center justify-center text-xs font-medium border-b border-black/50 truncate px-1"
        style={{ backgroundColor: track.color + '40' }}
      >
        {track.name}
      </div>

      {/* Effects section */}
      <div className="flex-shrink-0 border-b border-black/50">
        <button
          className="w-full h-6 text-[10px] text-white/50 hover:bg-white/5"
          onClick={(e) => {
            e.stopPropagation();
            setShowEffects(!showEffects);
          }}
        >
          FX ({track.effects?.length || 0})
        </button>
        {showEffects && (
          <div className="bg-black/30 max-h-24 overflow-y-auto">
            {track.effects?.map((effect, i) => (
              <div
                key={effect.id}
                className="flex items-center justify-between px-1 py-0.5 text-[9px] hover:bg-white/10"
              >
                <span className="truncate">{effect.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveEffect(effect.id);
                  }}
                  className="text-white/30 hover:text-white"
                >
                  x
                </button>
              </div>
            ))}
            <select
              className="w-full bg-transparent text-[9px] text-white/50 px-1 py-0.5"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  const plugin = BUILTIN_PLUGINS.find(p => p.id === e.target.value);
                  if (plugin) {
                    const instance: PluginInstance = {
                      id: `${plugin.id}-${Date.now()}`,
                      pluginId: plugin.id,
                      name: plugin.name,
                      enabled: true,
                      parameters: plugin.parameters.reduce((acc, p) => {
                        acc[p.id] = p.value;
                        return acc;
                      }, {} as Record<string, number>),
                    };
                    onAddEffect(instance);
                  }
                }
              }}
            >
              <option value="">+ Add</option>
              {BUILTIN_PLUGINS.filter(p => p.category === 'effect').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pan */}
      <div className="flex flex-col items-center py-2 border-b border-black/50">
        <div className="text-[9px] text-white/50 mb-1">PAN</div>
        <PanKnob
          value={track.pan}
          onChange={(pan) => onUpdate({ pan })}
        />
        <div className="text-[9px] text-white/50 mt-1">
          {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.abs(Math.round(track.pan * 100))}` : `R${Math.round(track.pan * 100)}`}
        </div>
      </div>

      {/* Fader + Meter */}
      <div className="flex-1 flex items-center justify-center gap-2 py-2">
        <VUMeter level={meterLevels.left} height={FADER_HEIGHT} />
        <Fader
          value={track.volume}
          onChange={(volume) => onUpdate({ volume })}
          height={FADER_HEIGHT}
        />
        <VUMeter level={meterLevels.right} height={FADER_HEIGHT} />
      </div>

      {/* dB readout */}
      <div className="text-center text-[10px] text-white/70 font-mono py-1 border-t border-black/50">
        {track.volume.toFixed(1)} dB
      </div>

      {/* M/S buttons */}
      <div className="flex justify-center gap-1 py-2 border-t border-black/50">
        {!isMaster && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ muted: !track.muted });
              }}
              className={`w-6 h-5 rounded text-[10px] font-bold ${
                track.muted ? 'bg-yellow-600' : 'bg-white/10'
              }`}
            >
              M
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ solo: !track.solo });
              }}
              className={`w-6 h-5 rounded text-[10px] font-bold ${
                track.solo ? 'bg-blue-600' : 'bg-white/10'
              }`}
            >
              S
            </button>
          </>
        )}
      </div>

      {/* Track color indicator */}
      <div
        className="h-2"
        style={{ backgroundColor: track.color }}
      />
    </div>
  );
};

/**
 * Main Mixer component
 */
export const Mixer: React.FC<MixerProps> = ({
  tracks,
  masterTrack,
  onTracksChange,
  onMasterChange,
  getMeterLevels,
  selectedTrack,
  onTrackSelect,
}) => {
  // Get meter levels with animation frame
  const [meters, setMeters] = useState<Record<string, { left: number; right: number }>>({});

  useEffect(() => {
    if (!getMeterLevels) return;

    let animationId: number;
    const updateMeters = () => {
      const newMeters: Record<string, { left: number; right: number }> = {};
      for (const track of tracks) {
        newMeters[track.id] = getMeterLevels(track.id);
      }
      newMeters.master = getMeterLevels('master');
      setMeters(newMeters);
      animationId = requestAnimationFrame(updateMeters);
    };

    updateMeters();
    return () => cancelAnimationFrame(animationId);
  }, [tracks, getMeterLevels]);

  const handleTrackUpdate = useCallback(
    (trackId: string, updates: Partial<Track>) => {
      onTracksChange(
        tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t))
      );
    },
    [tracks, onTracksChange]
  );

  const handleAddEffect = useCallback(
    (trackId: string, effect: PluginInstance) => {
      onTracksChange(
        tracks.map((t) =>
          t.id === trackId
            ? { ...t, effects: [...(t.effects || []), effect] }
            : t
        )
      );
    },
    [tracks, onTracksChange]
  );

  const handleRemoveEffect = useCallback(
    (trackId: string, effectId: string) => {
      onTracksChange(
        tracks.map((t) =>
          t.id === trackId
            ? { ...t, effects: (t.effects || []).filter((e) => e.id !== effectId) }
            : t
        )
      );
    },
    [tracks, onTracksChange]
  );

  return (
    <div className="flex h-full bg-[#1a1a1a] overflow-x-auto">
      {/* Track channels */}
      {tracks.map((track) => (
        <ChannelStrip
          key={track.id}
          track={track}
          meterLevels={meters[track.id] || { left: 0, right: 0 }}
          selected={selectedTrack === track.id}
          onSelect={() => onTrackSelect(track.id)}
          onUpdate={(updates) => handleTrackUpdate(track.id, updates)}
          onAddEffect={(effect) => handleAddEffect(track.id, effect)}
          onRemoveEffect={(effectId) => handleRemoveEffect(track.id, effectId)}
        />
      ))}

      {/* Spacer */}
      <div className="flex-1 min-w-4" />

      {/* Master channel */}
      <ChannelStrip
        track={masterTrack}
        meterLevels={meters.master || { left: 0, right: 0 }}
        selected={selectedTrack === 'master'}
        onSelect={() => onTrackSelect('master')}
        onUpdate={(updates) => onMasterChange({ ...masterTrack, ...updates })}
        onAddEffect={(effect) =>
          onMasterChange({
            ...masterTrack,
            effects: [...(masterTrack.effects || []), effect],
          })
        }
        onRemoveEffect={(effectId) =>
          onMasterChange({
            ...masterTrack,
            effects: (masterTrack.effects || []).filter((e) => e.id !== effectId),
          })
        }
        isMaster
      />
    </div>
  );
};
