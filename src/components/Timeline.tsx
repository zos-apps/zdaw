/**
 * Timeline - Arrangement view for zDAW
 *
 * Multi-track timeline with:
 * - Track list with add/delete
 * - Audio/MIDI clip display
 * - Clip drag, resize, selection
 * - Zoom and scroll
 * - Transport position indicator
 * - Grid and loop markers
 */

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
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
  LoopRegion,
  TransportState,
} from '../types';
import { generateId, randomTrackColor, quantize } from '../types';

interface TimelineProps {
  tracks: Track[];
  position: Beats;
  bpm: number;
  loop: LoopRegion;
  transportState: TransportState;
  gridSnap: Beats;
  zoom: number;
  selectedClips: string[];
  onTracksChange: (tracks: Track[]) => void;
  onSeek: (position: Beats) => void;
  onLoopChange: (loop: LoopRegion) => void;
  onClipSelect: (clipIds: string[]) => void;
  onClipDoubleClick: (trackId: string, clipId: string) => void;
  onZoomChange: (zoom: number) => void;
}

const TRACK_HEIGHT = 80;
const HEADER_HEIGHT = 40;
const TRACK_LIST_WIDTH = 200;
const BEAT_WIDTH_BASE = 40;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

export const Timeline: React.FC<TimelineProps> = ({
  tracks,
  position,
  bpm,
  loop,
  transportState,
  gridSnap,
  zoom,
  selectedClips,
  onTracksChange,
  onSeek,
  onLoopChange,
  onClipSelect,
  onClipDoubleClick,
  onZoomChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [dragging, setDragging] = useState<{
    type: 'clip' | 'resize' | 'select' | 'seek';
    clipId?: string;
    trackId?: string;
    startX: number;
    startY: number;
    startBeat?: Beats;
    edge?: 'left' | 'right';
  } | null>(null);

  const beatWidth = BEAT_WIDTH_BASE * zoom;
  const totalBeats = 128;
  const totalWidth = totalBeats * beatWidth;
  const totalHeight = tracks.length * TRACK_HEIGHT;

  // Convert x position to beats
  const xToBeats = useCallback(
    (x: number): Beats => {
      return (x + scrollX) / beatWidth;
    },
    [scrollX, beatWidth]
  );

  // Convert beats to x position
  const beatsToX = useCallback(
    (beats: Beats): number => {
      return beats * beatWidth - scrollX;
    },
    [scrollX, beatWidth]
  );

  // Handle wheel for zoom and scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * delta));
        onZoomChange(newZoom);
      } else if (e.shiftKey) {
        // Horizontal scroll
        setScrollX((prev) => Math.max(0, Math.min(totalWidth - 800, prev + e.deltaY)));
      } else {
        // Vertical scroll
        setScrollY((prev) => Math.max(0, Math.min(totalHeight - 400, prev + e.deltaY)));
      }
    },
    [zoom, onZoomChange, totalWidth, totalHeight]
  );

  // Handle mouse down on timeline
  const handleTimelineMouseDown = useCallback(
    (e: MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on header (ruler) for seeking
      if (y < HEADER_HEIGHT) {
        const beat = xToBeats(x);
        onSeek(quantize(beat, gridSnap));
        setDragging({
          type: 'seek',
          startX: x,
          startY: y,
        });
        return;
      }

      // Check if clicking on a clip
      const trackIndex = Math.floor((y - HEADER_HEIGHT + scrollY) / TRACK_HEIGHT);
      if (trackIndex >= 0 && trackIndex < tracks.length) {
        const track = tracks[trackIndex];
        const beat = xToBeats(x);

        if (track.type === 'audio' || track.type === 'midi') {
          const clips = (track as AudioTrack | MIDITrack).clips;

          for (const clip of clips) {
            if (beat >= clip.start && beat <= clip.start + clip.duration) {
              // Check if near edge for resize
              const clipStartX = beatsToX(clip.start);
              const clipEndX = beatsToX(clip.start + clip.duration);

              if (Math.abs(x - clipStartX) < 8) {
                setDragging({
                  type: 'resize',
                  clipId: clip.id,
                  trackId: track.id,
                  startX: x,
                  startY: y,
                  startBeat: clip.start,
                  edge: 'left',
                });
              } else if (Math.abs(x - clipEndX) < 8) {
                setDragging({
                  type: 'resize',
                  clipId: clip.id,
                  trackId: track.id,
                  startX: x,
                  startY: y,
                  startBeat: clip.start + clip.duration,
                  edge: 'right',
                });
              } else {
                // Clip move
                setDragging({
                  type: 'clip',
                  clipId: clip.id,
                  trackId: track.id,
                  startX: x,
                  startY: y,
                  startBeat: clip.start,
                });

                // Select clip
                if (!e.shiftKey) {
                  onClipSelect([clip.id]);
                } else {
                  onClipSelect([...selectedClips, clip.id]);
                }
              }
              return;
            }
          }
        }
      }

      // Clear selection if clicking empty space
      if (!e.shiftKey) {
        onClipSelect([]);
      }
    },
    [tracks, scrollY, xToBeats, beatsToX, gridSnap, onSeek, onClipSelect, selectedClips]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const deltaX = x - dragging.startX;
      const deltaBeat = deltaX / beatWidth;

      if (dragging.type === 'seek') {
        const beat = xToBeats(x);
        onSeek(quantize(Math.max(0, beat), gridSnap));
        return;
      }

      if (dragging.type === 'clip' && dragging.trackId && dragging.clipId) {
        const newStart = quantize(
          Math.max(0, dragging.startBeat! + deltaBeat),
          gridSnap
        );

        const newTracks = tracks.map((track) => {
          if (track.id !== dragging.trackId) return track;
          if (track.type !== 'audio' && track.type !== 'midi') return track;

          const t = track as AudioTrack | MIDITrack;
          return {
            ...t,
            clips: t.clips.map((clip) =>
              clip.id === dragging.clipId ? { ...clip, start: newStart } : clip
            ),
          };
        });

        onTracksChange(newTracks);
      }

      if (dragging.type === 'resize' && dragging.trackId && dragging.clipId) {
        const newTracks = tracks.map((track) => {
          if (track.id !== dragging.trackId) return track;
          if (track.type !== 'audio' && track.type !== 'midi') return track;

          const t = track as AudioTrack | MIDITrack;
          return {
            ...t,
            clips: t.clips.map((clip) => {
              if (clip.id !== dragging.clipId) return clip;

              if (dragging.edge === 'left') {
                const newStart = quantize(
                  Math.max(0, dragging.startBeat! + deltaBeat),
                  gridSnap
                );
                const newDuration = clip.start + clip.duration - newStart;
                if (newDuration > gridSnap) {
                  return { ...clip, start: newStart, duration: newDuration };
                }
              } else {
                const newEnd = quantize(
                  dragging.startBeat! + deltaBeat,
                  gridSnap
                );
                const newDuration = newEnd - clip.start;
                if (newDuration > gridSnap) {
                  return { ...clip, duration: newDuration };
                }
              }
              return clip;
            }),
          };
        });

        onTracksChange(newTracks);
      }
    },
    [dragging, tracks, beatWidth, xToBeats, gridSnap, onTracksChange, onSeek]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  // Add track
  const addTrack = useCallback(
    (type: 'audio' | 'midi') => {
      const newTrack: Track = type === 'audio'
        ? {
            id: generateId(),
            name: `Audio ${tracks.length + 1}`,
            type: 'audio',
            color: randomTrackColor(),
            volume: 0,
            pan: 0,
            muted: false,
            solo: false,
            armed: false,
            height: TRACK_HEIGHT,
            collapsed: false,
            monitoring: false,
            clips: [],
            effects: [],
            routing: { output: 'master', sends: [] },
          }
        : {
            id: generateId(),
            name: `MIDI ${tracks.length + 1}`,
            type: 'midi',
            color: randomTrackColor(),
            volume: 0,
            pan: 0,
            muted: false,
            solo: false,
            armed: false,
            height: TRACK_HEIGHT,
            collapsed: false,
            midiChannel: 0,
            clips: [],
            effects: [],
            routing: { output: 'master', sends: [] },
          };

      onTracksChange([...tracks, newTrack]);
    },
    [tracks, onTracksChange]
  );

  // Delete track
  const deleteTrack = useCallback(
    (trackId: string) => {
      onTracksChange(tracks.filter((t) => t.id !== trackId));
    },
    [tracks, onTracksChange]
  );

  // Toggle track properties
  const toggleTrackMute = useCallback(
    (trackId: string) => {
      onTracksChange(
        tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t))
      );
    },
    [tracks, onTracksChange]
  );

  const toggleTrackSolo = useCallback(
    (trackId: string) => {
      onTracksChange(
        tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t))
      );
    },
    [tracks, onTracksChange]
  );

  const toggleTrackArmed = useCallback(
    (trackId: string) => {
      onTracksChange(
        tracks.map((t) => (t.id === trackId ? { ...t, armed: !t.armed } : t))
      );
    },
    [tracks, onTracksChange]
  );

  // Render ruler
  const renderRuler = () => {
    const bars: JSX.Element[] = [];
    const beatsPerBar = 4;
    const startBar = Math.floor(scrollX / beatWidth / beatsPerBar);
    const endBar = Math.ceil((scrollX + 1000) / beatWidth / beatsPerBar);

    for (let bar = startBar; bar <= endBar; bar++) {
      const x = bar * beatsPerBar * beatWidth - scrollX;
      bars.push(
        <g key={bar}>
          <line
            x1={x}
            y1={0}
            x2={x}
            y2={HEADER_HEIGHT}
            stroke="#555"
            strokeWidth={1}
          />
          <text x={x + 4} y={16} fill="#888" fontSize={11}>
            {bar + 1}
          </text>
          {/* Beat divisions */}
          {zoom > 0.5 &&
            [1, 2, 3].map((beat) => (
              <line
                key={beat}
                x1={x + beat * beatWidth}
                y1={HEADER_HEIGHT - 8}
                x2={x + beat * beatWidth}
                y2={HEADER_HEIGHT}
                stroke="#444"
                strokeWidth={1}
              />
            ))}
        </g>
      );
    }

    return bars;
  };

  // Render grid
  const renderGrid = () => {
    const lines: JSX.Element[] = [];
    const beatsPerBar = 4;
    const startBeat = Math.floor(scrollX / beatWidth);
    const endBeat = Math.ceil((scrollX + 1000) / beatWidth);

    for (let beat = startBeat; beat <= endBeat; beat++) {
      const x = beat * beatWidth - scrollX;
      const isBar = beat % beatsPerBar === 0;
      lines.push(
        <line
          key={`v-${beat}`}
          x1={x}
          y1={0}
          x2={x}
          y2={totalHeight}
          stroke={isBar ? '#333' : '#222'}
          strokeWidth={isBar ? 1 : 0.5}
        />
      );
    }

    // Horizontal track dividers
    for (let i = 0; i <= tracks.length; i++) {
      const y = i * TRACK_HEIGHT - scrollY;
      lines.push(
        <line
          key={`h-${i}`}
          x1={0}
          y1={y}
          x2={totalWidth}
          y2={y}
          stroke="#333"
          strokeWidth={1}
        />
      );
    }

    return lines;
  };

  // Render clips
  const renderClips = () => {
    const clipElements: JSX.Element[] = [];

    tracks.forEach((track, trackIndex) => {
      if (track.type !== 'audio' && track.type !== 'midi') return;

      const t = track as AudioTrack | MIDITrack;
      const y = trackIndex * TRACK_HEIGHT - scrollY;

      t.clips.forEach((clip) => {
        const x = beatsToX(clip.start);
        const width = clip.duration * beatWidth;
        const isSelected = selectedClips.includes(clip.id);

        clipElements.push(
          <g
            key={clip.id}
            onDoubleClick={() => onClipDoubleClick(track.id, clip.id)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={x}
              y={y + 2}
              width={width}
              height={TRACK_HEIGHT - 4}
              fill={clip.muted ? '#333' : clip.color}
              opacity={clip.muted ? 0.4 : 0.8}
              rx={4}
              stroke={isSelected ? '#fff' : 'transparent'}
              strokeWidth={2}
            />
            <text
              x={x + 6}
              y={y + 18}
              fill="#fff"
              fontSize={11}
              fontWeight={500}
            >
              {clip.name}
            </text>

            {/* MIDI note preview */}
            {clip.type === 'midi' && (
              <g>
                {(clip as MIDIClip).notes.slice(0, 50).map((note, i) => {
                  const noteX = x + (note.start / clip.duration) * width;
                  const noteWidth = (note.duration / clip.duration) * width;
                  const noteY = y + TRACK_HEIGHT - 8 - ((note.note - 36) / 60) * (TRACK_HEIGHT - 30);
                  return (
                    <rect
                      key={i}
                      x={noteX}
                      y={Math.max(y + 24, Math.min(y + TRACK_HEIGHT - 8, noteY))}
                      width={Math.max(2, noteWidth)}
                      height={3}
                      fill="#fff"
                      opacity={0.7}
                    />
                  );
                })}
              </g>
            )}

            {/* Audio waveform preview placeholder */}
            {clip.type === 'audio' && (
              <path
                d={`M ${x + 6} ${y + TRACK_HEIGHT / 2} ${
                  Array(Math.floor(width / 4))
                    .fill(0)
                    .map((_, i) => {
                      const px = x + 6 + i * 4;
                      const h = Math.random() * 15 + 5;
                      return `L ${px} ${y + TRACK_HEIGHT / 2 - h} L ${px} ${y + TRACK_HEIGHT / 2 + h}`;
                    })
                    .join(' ')
                }`}
                stroke="#fff"
                strokeWidth={1}
                fill="none"
                opacity={0.5}
              />
            )}
          </g>
        );
      });
    });

    return clipElements;
  };

  // Render loop region
  const renderLoop = () => {
    if (!loop.enabled) return null;

    const x1 = beatsToX(loop.start);
    const x2 = beatsToX(loop.end);

    return (
      <g>
        <rect
          x={x1}
          y={0}
          width={x2 - x1}
          height={HEADER_HEIGHT}
          fill="#3b82f6"
          opacity={0.3}
        />
        <line x1={x1} y1={0} x2={x1} y2={HEADER_HEIGHT} stroke="#3b82f6" strokeWidth={2} />
        <line x1={x2} y1={0} x2={x2} y2={HEADER_HEIGHT} stroke="#3b82f6" strokeWidth={2} />
      </g>
    );
  };

  // Render playhead
  const renderPlayhead = () => {
    const x = beatsToX(position);
    if (x < 0 || x > 1200) return null;

    return (
      <g>
        {/* Ruler marker */}
        <polygon
          points={`${x - 6},0 ${x + 6},0 ${x},10`}
          fill="#22c55e"
        />
        {/* Line */}
        <line
          x1={x}
          y1={0}
          x2={x}
          y2={totalHeight + HEADER_HEIGHT}
          stroke="#22c55e"
          strokeWidth={1}
        />
      </g>
    );
  };

  return (
    <div className="flex h-full bg-[#1a1a1a]">
      {/* Track List */}
      <div
        className="flex-shrink-0 bg-[#252525] border-r border-black"
        style={{ width: TRACK_LIST_WIDTH }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 border-b border-black"
          style={{ height: HEADER_HEIGHT }}
        >
          <span className="text-xs text-white/50">Tracks</span>
          <div className="flex gap-1">
            <button
              onClick={() => addTrack('audio')}
              className="px-2 py-1 text-xs bg-white/10 rounded hover:bg-white/20"
              title="Add Audio Track"
            >
              +A
            </button>
            <button
              onClick={() => addTrack('midi')}
              className="px-2 py-1 text-xs bg-white/10 rounded hover:bg-white/20"
              title="Add MIDI Track"
            >
              +M
            </button>
          </div>
        </div>

        {/* Track entries */}
        <div
          className="overflow-y-auto"
          style={{
            height: `calc(100% - ${HEADER_HEIGHT}px)`,
            marginTop: -scrollY,
          }}
        >
          {tracks.map((track) => (
            <div
              key={track.id}
              className="border-b border-black/50 px-2 py-1"
              style={{
                height: TRACK_HEIGHT,
                backgroundColor: track.color + '20',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: track.color }}
                  />
                  <span className="text-xs font-medium truncate max-w-[100px]">
                    {track.name}
                  </span>
                </div>
                <button
                  onClick={() => deleteTrack(track.id)}
                  className="text-white/30 hover:text-white/60 text-xs"
                >
                  x
                </button>
              </div>

              <div className="flex gap-1 mt-2">
                <button
                  onClick={() => toggleTrackMute(track.id)}
                  className={`w-6 h-5 rounded text-[10px] font-bold ${
                    track.muted ? 'bg-yellow-600' : 'bg-white/10'
                  }`}
                >
                  M
                </button>
                <button
                  onClick={() => toggleTrackSolo(track.id)}
                  className={`w-6 h-5 rounded text-[10px] font-bold ${
                    track.solo ? 'bg-blue-600' : 'bg-white/10'
                  }`}
                >
                  S
                </button>
                {(track.type === 'audio' || track.type === 'midi') && (
                  <button
                    onClick={() => toggleTrackArmed(track.id)}
                    className={`w-6 h-5 rounded text-[10px] font-bold ${
                      (track as AudioTrack | MIDITrack).armed
                        ? 'bg-red-600'
                        : 'bg-white/10'
                    }`}
                  >
                    R
                  </button>
                )}
              </div>
            </div>
          ))}

          {tracks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-white/30 text-xs">
              <div className="mb-2">No tracks</div>
              <div>Click +A or +M to add</div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleTimelineMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width="100%" height="100%" className="block">
          {/* Ruler area */}
          <g>
            <rect x={0} y={0} width="100%" height={HEADER_HEIGHT} fill="#222" />
            {renderRuler()}
            {renderLoop()}
          </g>

          {/* Grid and content area */}
          <g transform={`translate(0, ${HEADER_HEIGHT})`}>
            <rect x={0} y={0} width="100%" height={`calc(100% - ${HEADER_HEIGHT}px)`} fill="#1a1a1a" />
            {renderGrid()}
            {renderClips()}
          </g>

          {/* Playhead (on top) */}
          {renderPlayhead()}
        </svg>
      </div>
    </div>
  );
};
