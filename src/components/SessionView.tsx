/**
 * SessionView - Ableton-style clip launcher grid for zDAW
 *
 * Features:
 * - Clip launcher grid (tracks x scenes)
 * - Scene launching
 * - Clip launch with quantization
 * - Follow actions
 * - Visual feedback for playing/triggered clips
 * - Stop buttons per track and global
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  MouseEvent,
} from 'react';
import type {
  Track,
  AudioTrack,
  MIDITrack,
  Clip,
  AudioClip,
  MIDIClip,
  Beats,
  TransportState,
  LaunchQuantization,
  ClipState,
  Scene,
  SessionSlot,
  FollowActionPair,
} from '../types';
import {
  generateId,
  randomTrackColor,
  getNextQuantizedBeat,
  launchQuantizationToBeats,
} from '../types';

// ============================================================================
// Types
// ============================================================================

interface SessionViewProps {
  tracks: Track[];
  position: Beats;
  bpm: number;
  transportState: TransportState;
  globalQuantization: LaunchQuantization;
  onTracksChange: (tracks: Track[]) => void;
  onClipLaunch: (trackId: string, slotIndex: number) => void;
  onClipStop: (trackId: string, slotIndex: number) => void;
  onSceneLaunch: (sceneIndex: number) => void;
  onStopAllClips: () => void;
  onClipDoubleClick: (trackId: string, clipId: string) => void;
  onQuantizationChange: (q: LaunchQuantization) => void;
}

// ============================================================================
// Constants
// ============================================================================

const SLOT_WIDTH = 120;
const SLOT_HEIGHT = 48;
const TRACK_HEADER_HEIGHT = 60;
const SCENE_COLUMN_WIDTH = 80;
const MAX_SCENES = 8;

// ============================================================================
// Clip Slot Component
// ============================================================================

interface ClipSlotProps {
  clip: Clip | null;
  state: ClipState;
  selected: boolean;
  trackColor: string;
  onLaunch: () => void;
  onStop: () => void;
  onDoubleClick: () => void;
  onSelect: () => void;
}

const ClipSlot: React.FC<ClipSlotProps> = ({
  clip,
  state,
  selected,
  trackColor,
  onLaunch,
  onStop,
  onDoubleClick,
  onSelect,
}) => {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      if (clip) {
        if (state === 'playing') {
          onStop();
        } else {
          onLaunch();
        }
      }
      onSelect();
    },
    [clip, state, onLaunch, onStop, onSelect]
  );

  // State-based styling
  const getStateStyle = (): string => {
    switch (state) {
      case 'playing':
        return 'ring-2 ring-green-500 bg-green-500/20';
      case 'triggered':
        return 'ring-2 ring-yellow-500 animate-pulse';
      case 'stopping':
        return 'ring-2 ring-red-500 animate-pulse';
      case 'recording':
        return 'ring-2 ring-red-600 bg-red-500/20 animate-pulse';
      default:
        return '';
    }
  };

  return (
    <div
      className={`relative w-full h-full border border-white/10 cursor-pointer transition-all
        ${selected ? 'ring-2 ring-blue-500' : ''}
        ${getStateStyle()}
        ${clip ? 'hover:brightness-110' : 'hover:bg-white/5'}
      `}
      style={{
        width: SLOT_WIDTH,
        height: SLOT_HEIGHT,
      }}
      onClick={handleClick}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (clip) onDoubleClick();
      }}
    >
      {clip ? (
        <>
          {/* Clip background */}
          <div
            className="absolute inset-0.5 rounded"
            style={{ backgroundColor: clip.color + 'cc' }}
          />

          {/* Clip name */}
          <div className="absolute inset-0 flex items-center justify-center px-2">
            <span className="text-xs font-medium text-white truncate drop-shadow">
              {clip.name}
            </span>
          </div>

          {/* MIDI note preview */}
          {clip.type === 'midi' && (
            <div className="absolute bottom-1 left-1 right-1 h-2 flex gap-px">
              {(clip as MIDIClip).notes.slice(0, 20).map((note, i) => (
                <div
                  key={i}
                  className="flex-1 bg-white/50 rounded-sm"
                  style={{
                    height: `${(note.velocity / 127) * 100}%`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Play/Stop indicator */}
          <div className="absolute top-1 left-1">
            {state === 'playing' && (
              <div className="w-2 h-2 bg-green-500 rounded-full" />
            )}
            {state === 'triggered' && (
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
            )}
          </div>

          {/* Loop indicator */}
          {clip.loopEnabled && (
            <div className="absolute top-1 right-1 text-[8px] text-white/70">
              L
            </div>
          )}
        </>
      ) : (
        // Empty slot
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border border-white/20 rounded-sm" />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Track Header Component
// ============================================================================

interface TrackHeaderProps {
  track: Track;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onArmToggle: () => void;
  onStopClip: () => void;
}

const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  onMuteToggle,
  onSoloToggle,
  onArmToggle,
  onStopClip,
}) => {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 border-b border-black/50"
      style={{
        width: SLOT_WIDTH,
        height: TRACK_HEADER_HEIGHT,
        backgroundColor: track.color + '30',
      }}
    >
      {/* Track name */}
      <div className="text-xs font-medium text-white truncate max-w-[100px]">
        {track.name}
      </div>

      {/* Control buttons */}
      <div className="flex gap-1">
        {/* Stop clip button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStopClip();
          }}
          className="w-5 h-4 bg-white/10 rounded text-[8px] hover:bg-white/20"
          title="Stop clips on track"
        >
          ■
        </button>

        {/* Arm */}
        {(track.type === 'audio' || track.type === 'midi') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArmToggle();
            }}
            className={`w-5 h-4 rounded text-[8px] ${
              (track as AudioTrack | MIDITrack).armed
                ? 'bg-red-600 text-white'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            R
          </button>
        )}

        {/* Mute */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMuteToggle();
          }}
          className={`w-5 h-4 rounded text-[8px] ${
            track.muted ? 'bg-yellow-600' : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          M
        </button>

        {/* Solo */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSoloToggle();
          }}
          className={`w-5 h-4 rounded text-[8px] ${
            track.solo ? 'bg-blue-600' : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          S
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Scene Row Component
// ============================================================================

interface SceneRowProps {
  sceneIndex: number;
  sceneName: string;
  onLaunch: () => void;
}

const SceneRow: React.FC<SceneRowProps> = ({
  sceneIndex,
  sceneName,
  onLaunch,
}) => {
  return (
    <div
      className="flex items-center justify-center border border-white/10 hover:bg-white/10 cursor-pointer transition-all"
      style={{
        width: SCENE_COLUMN_WIDTH,
        height: SLOT_HEIGHT,
      }}
      onClick={onLaunch}
      title={`Launch scene ${sceneIndex + 1}`}
    >
      <div className="flex items-center gap-2">
        <div className="w-0 h-0 border-l-[8px] border-l-green-500 border-y-[6px] border-y-transparent" />
        <span className="text-xs text-white/70">{sceneName}</span>
      </div>
    </div>
  );
};

// ============================================================================
// Main Session View Component
// ============================================================================

export const SessionView: React.FC<SessionViewProps> = ({
  tracks,
  position,
  bpm,
  transportState,
  globalQuantization,
  onTracksChange,
  onClipLaunch,
  onClipStop,
  onSceneLaunch,
  onStopAllClips,
  onClipDoubleClick,
  onQuantizationChange,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<{
    trackId: string;
    slotIndex: number;
  } | null>(null);
  const [clipStates, setClipStates] = useState<
    Map<string, ClipState>
  >(new Map());

  // Filter to audio and MIDI tracks only
  const sessionTracks = tracks.filter(
    (t) => t.type === 'audio' || t.type === 'midi'
  ) as (AudioTrack | MIDITrack)[];

  // Get clip for a slot
  const getClipForSlot = (
    track: AudioTrack | MIDITrack,
    slotIndex: number
  ): Clip | null => {
    if (track.clipSlots && track.clipSlots[slotIndex]) {
      return track.clipSlots[slotIndex];
    }
    // Fall back to arrangement clips if no session slots
    return track.clips[slotIndex] || null;
  };

  // Get clip state
  const getClipState = (trackId: string, slotIndex: number): ClipState => {
    const key = `${trackId}-${slotIndex}`;
    return clipStates.get(key) || 'stopped';
  };

  // Handle track property updates
  const updateTrack = useCallback(
    (trackId: string, updates: Partial<Track>) => {
      onTracksChange(
        tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t))
      );
    },
    [tracks, onTracksChange]
  );

  // Handle clip launch with quantization
  const handleClipLaunch = useCallback(
    (trackId: string, slotIndex: number) => {
      const key = `${trackId}-${slotIndex}`;

      // Set to triggered state
      setClipStates((prev) => {
        const next = new Map(prev);

        // Stop any currently playing clip on this track
        for (const [k, state] of next.entries()) {
          if (k.startsWith(trackId) && state === 'playing') {
            next.set(k, 'stopping');
          }
        }

        next.set(key, 'triggered');
        return next;
      });

      // Calculate quantized launch time
      const quantBeats = launchQuantizationToBeats(globalQuantization, bpm);
      const launchBeat = getNextQuantizedBeat(position, globalQuantization, bpm);

      // Schedule state change (in real impl, this would be sample-accurate)
      if (quantBeats > 0) {
        const delayMs = ((launchBeat - position) / bpm) * 60 * 1000;
        setTimeout(() => {
          setClipStates((prev) => {
            const next = new Map(prev);

            // Stop all other clips on track
            for (const [k, state] of next.entries()) {
              if (k.startsWith(trackId) && k !== key) {
                next.delete(k);
              }
            }

            next.set(key, 'playing');
            return next;
          });
        }, Math.max(0, delayMs));
      } else {
        setClipStates((prev) => {
          const next = new Map(prev);
          next.set(key, 'playing');
          return next;
        });
      }

      onClipLaunch(trackId, slotIndex);
    },
    [position, bpm, globalQuantization, onClipLaunch]
  );

  // Handle clip stop
  const handleClipStop = useCallback(
    (trackId: string, slotIndex: number) => {
      const key = `${trackId}-${slotIndex}`;

      setClipStates((prev) => {
        const next = new Map(prev);
        const quantBeats = launchQuantizationToBeats(globalQuantization, bpm);

        if (quantBeats > 0) {
          next.set(key, 'stopping');
          // Schedule actual stop
          const launchBeat = getNextQuantizedBeat(position, globalQuantization, bpm);
          const delayMs = ((launchBeat - position) / bpm) * 60 * 1000;
          setTimeout(() => {
            setClipStates((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
          }, Math.max(0, delayMs));
        } else {
          next.delete(key);
        }
        return next;
      });

      onClipStop(trackId, slotIndex);
    },
    [position, bpm, globalQuantization, onClipStop]
  );

  // Handle scene launch
  const handleSceneLaunch = useCallback(
    (sceneIndex: number) => {
      // Launch clips in all tracks at this scene index
      sessionTracks.forEach((track) => {
        const clip = getClipForSlot(track, sceneIndex);
        if (clip) {
          handleClipLaunch(track.id, sceneIndex);
        }
      });
      onSceneLaunch(sceneIndex);
    },
    [sessionTracks, handleClipLaunch, onSceneLaunch]
  );

  // Handle stop track clips
  const handleStopTrackClips = useCallback(
    (trackId: string) => {
      setClipStates((prev) => {
        const next = new Map(prev);
        for (const [k, _] of next.entries()) {
          if (k.startsWith(trackId)) {
            next.delete(k);
          }
        }
        return next;
      });
    },
    []
  );

  // Handle stop all
  const handleStopAll = useCallback(() => {
    setClipStates(new Map());
    onStopAllClips();
  }, [onStopAllClips]);

  // Generate scene names
  const sceneNames = Array.from({ length: MAX_SCENES }, (_, i) => `${i + 1}`);

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      {/* Toolbar */}
      <div className="h-10 flex items-center gap-4 px-4 bg-[#252525] border-b border-black">
        <span className="text-xs text-white/50">Session View</span>

        <div className="h-5 w-px bg-white/20" />

        {/* Global quantization */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">Quantize:</span>
          <select
            value={globalQuantization}
            onChange={(e) =>
              onQuantizationChange(e.target.value as LaunchQuantization)
            }
            className="px-2 py-1 text-xs bg-black/30 rounded border border-white/10"
          >
            <option value="none">None</option>
            <option value="1/16">1/16</option>
            <option value="1/8">1/8</option>
            <option value="1/4">1/4</option>
            <option value="1/2">1/2</option>
            <option value="1-bar">1 Bar</option>
            <option value="2-bars">2 Bars</option>
            <option value="4-bars">4 Bars</option>
          </select>
        </div>

        <div className="flex-1" />

        {/* Stop all button */}
        <button
          onClick={handleStopAll}
          className="px-3 py-1 text-xs bg-red-600/80 rounded hover:bg-red-600"
        >
          Stop All
        </button>
      </div>

      {/* Main grid area */}
      <div className="flex-1 flex overflow-auto">
        {/* Track columns */}
        <div className="flex">
          {sessionTracks.map((track) => (
            <div key={track.id} className="flex flex-col">
              {/* Track header */}
              <TrackHeader
                track={track}
                onMuteToggle={() => updateTrack(track.id, { muted: !track.muted })}
                onSoloToggle={() => updateTrack(track.id, { solo: !track.solo })}
                onArmToggle={() =>
                  updateTrack(track.id, { armed: !track.armed })
                }
                onStopClip={() => handleStopTrackClips(track.id)}
              />

              {/* Clip slots */}
              {Array.from({ length: MAX_SCENES }, (_, slotIndex) => {
                const clip = getClipForSlot(track, slotIndex);
                const state = getClipState(track.id, slotIndex);
                const isSelected =
                  selectedSlot?.trackId === track.id &&
                  selectedSlot?.slotIndex === slotIndex;

                return (
                  <ClipSlot
                    key={slotIndex}
                    clip={clip}
                    state={state}
                    selected={isSelected}
                    trackColor={track.color}
                    onLaunch={() => handleClipLaunch(track.id, slotIndex)}
                    onStop={() => handleClipStop(track.id, slotIndex)}
                    onDoubleClick={() => {
                      if (clip) onClipDoubleClick(track.id, clip.id);
                    }}
                    onSelect={() =>
                      setSelectedSlot({ trackId: track.id, slotIndex })
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Scene column */}
        <div className="flex flex-col border-l border-white/10">
          {/* Scene header */}
          <div
            className="flex items-center justify-center bg-[#333] border-b border-black/50"
            style={{ width: SCENE_COLUMN_WIDTH, height: TRACK_HEADER_HEIGHT }}
          >
            <span className="text-xs text-white/50">Scenes</span>
          </div>

          {/* Scene launchers */}
          {sceneNames.map((name, index) => (
            <SceneRow
              key={index}
              sceneIndex={index}
              sceneName={name}
              onLaunch={() => handleSceneLaunch(index)}
            />
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 flex items-center justify-between px-4 bg-[#252525] border-t border-black text-xs text-white/50">
        <div className="flex gap-4">
          <span>{sessionTracks.length} tracks</span>
          <span>{MAX_SCENES} scenes</span>
        </div>
        <div>
          {selectedSlot && (
            <span>
              Track {selectedSlot.trackId.slice(-4)}, Slot {selectedSlot.slotIndex + 1}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
