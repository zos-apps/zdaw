/**
 * zDAW - Digital Audio Workstation
 *
 * A professional DAW inspired by Ableton Live, built on Web Audio API.
 *
 * Features:
 * - Multi-track timeline arrangement
 * - Channel strip mixer with effects
 * - Piano roll MIDI editor
 * - Browser for instruments, effects, samples
 * - Real-time audio/MIDI recording
 * - Transport controls with loop
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Track,
  AudioTrack,
  MIDITrack,
  MasterTrack,
  Clip,
  MIDIClip,
  MIDINoteData,
  MIDINote,
  Beats,
  TransportState,
  LoopRegion,
  TimeSignature,
  ViewState,
  PluginInstance,
} from './types';
import { generateId, randomTrackColor, beatsToSeconds } from './types';
import { AudioEngine } from './audio/AudioEngine';
import { MIDIEngine } from './audio/MidiEngine';
import { Synth, SYNTH_PRESETS } from './audio/Synth';
import { Timeline } from './components/Timeline';
import { Mixer } from './components/Mixer';
import { PianoRoll } from './components/Piano';
import { Browser } from './components/Browser';

// ============================================================================
// Types
// ============================================================================

type ViewMode = 'arrangement' | 'mixer' | 'piano';

interface PianoRollState {
  trackId: string | null;
  clipId: string | null;
}

// ============================================================================
// Toolbar Component
// ============================================================================

interface ToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  timeSignature: TimeSignature;
  onTimeSignatureChange: (sig: TimeSignature) => void;
  gridSnap: Beats;
  onGridSnapChange: (snap: Beats) => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  viewMode,
  onViewModeChange,
  bpm,
  onBpmChange,
  timeSignature,
  onTimeSignatureChange,
  gridSnap,
  onGridSnapChange,
}) => {
  return (
    <div className="h-10 flex items-center gap-4 px-4 bg-[#252525] border-b border-black">
      {/* View mode buttons */}
      <div className="flex gap-1">
        {(['arrangement', 'mixer', 'piano'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            className={`px-3 py-1 text-xs rounded capitalize ${
              viewMode === mode
                ? 'bg-blue-600 text-white'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-white/20" />

      {/* BPM */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/50">BPM</span>
        <input
          type="number"
          value={bpm}
          onChange={(e) => onBpmChange(Math.max(20, Math.min(999, parseInt(e.target.value) || 120)))}
          className="w-14 px-2 py-1 text-xs text-center bg-black/30 rounded border border-white/10 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Time Signature */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-white/50">Time</span>
        <select
          value={`${timeSignature.numerator}/${timeSignature.denominator}`}
          onChange={(e) => {
            const [num, denom] = e.target.value.split('/').map(Number);
            onTimeSignatureChange({ numerator: num, denominator: denom });
          }}
          className="px-2 py-1 text-xs bg-black/30 rounded border border-white/10 focus:border-blue-500 outline-none"
        >
          <option value="4/4">4/4</option>
          <option value="3/4">3/4</option>
          <option value="6/8">6/8</option>
          <option value="2/4">2/4</option>
          <option value="5/4">5/4</option>
        </select>
      </div>

      <div className="h-5 w-px bg-white/20" />

      {/* Grid snap */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/50">Grid</span>
        <select
          value={gridSnap}
          onChange={(e) => onGridSnapChange(parseFloat(e.target.value))}
          className="px-2 py-1 text-xs bg-black/30 rounded border border-white/10 focus:border-blue-500 outline-none"
        >
          <option value="0.25">1/16</option>
          <option value="0.5">1/8</option>
          <option value="1">1/4</option>
          <option value="2">1/2</option>
          <option value="4">1 Bar</option>
        </select>
      </div>
    </div>
  );
};

// ============================================================================
// Transport Bar Component
// ============================================================================

interface TransportBarProps {
  transportState: TransportState;
  position: Beats;
  bpm: number;
  loop: LoopRegion;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRecord: () => void;
  onSeek: (position: Beats) => void;
  onLoopToggle: () => void;
}

const TransportBar: React.FC<TransportBarProps> = ({
  transportState,
  position,
  bpm,
  loop,
  onPlay,
  onPause,
  onStop,
  onRecord,
  onSeek,
  onLoopToggle,
}) => {
  // Format position as bar:beat:tick
  const formatPosition = (beats: Beats): string => {
    const bar = Math.floor(beats / 4) + 1;
    const beat = Math.floor(beats % 4) + 1;
    const tick = Math.floor((beats % 1) * 100);
    return `${bar.toString().padStart(3, '0')}:${beat}:${tick.toString().padStart(2, '0')}`;
  };

  // Format time as mm:ss:ms
  const formatTime = (beats: Beats): string => {
    const seconds = beatsToSeconds(beats, bpm);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-12 flex items-center justify-center gap-6 bg-[#1a1a1a] border-b border-black">
      {/* Position display */}
      <div className="flex gap-4 font-mono">
        <div className="text-xl text-white tracking-wide">
          {formatPosition(position)}
        </div>
        <div className="text-lg text-white/50">
          {formatTime(position)}
        </div>
      </div>

      {/* Transport buttons */}
      <div className="flex items-center gap-2">
        {/* Stop */}
        <button
          onClick={onStop}
          className={`w-8 h-8 flex items-center justify-center rounded ${
            transportState === 'stopped'
              ? 'bg-white/20 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title="Stop (Space)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1" y="1" width="10" height="10" rx="1" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={transportState === 'playing' ? onPause : onPlay}
          className={`w-10 h-10 flex items-center justify-center rounded ${
            transportState === 'playing'
              ? 'bg-green-600 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title="Play/Pause (Space)"
        >
          {transportState === 'playing' ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="1" width="4" height="12" rx="1" />
              <rect x="8" y="1" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M2 1 L12 7 L2 13 Z" />
            </svg>
          )}
        </button>

        {/* Record */}
        <button
          onClick={onRecord}
          className={`w-8 h-8 flex items-center justify-center rounded ${
            transportState === 'recording'
              ? 'bg-red-600 text-white animate-pulse'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title="Record (R)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <circle cx="6" cy="6" r="5" />
          </svg>
        </button>

        <div className="w-px h-6 bg-white/20" />

        {/* Loop toggle */}
        <button
          onClick={onLoopToggle}
          className={`w-8 h-8 flex items-center justify-center rounded ${
            loop.enabled
              ? 'bg-blue-600 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
          title="Loop (L)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 5 C1 3 3 1 7 1 C11 1 13 3 13 5 L13 7" />
            <path d="M13 9 C13 11 11 13 7 13 C3 13 1 11 1 9 L1 7" />
            <polygon points="11,5 13,7 15,5" fill="currentColor" />
            <polygon points="3,9 1,7 -1,9" fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Loop region display */}
      {loop.enabled && (
        <div className="flex items-center gap-2 text-xs text-blue-400">
          <span>Loop:</span>
          <span>{loop.start.toFixed(1)}</span>
          <span>-</span>
          <span>{loop.end.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main App Component
// ============================================================================

export interface ZDAWAppProps {
  className?: string;
}

export function ZDAWApp({ className = '' }: ZDAWAppProps): React.ReactElement {
  // =========================================================================
  // Engine refs
  // =========================================================================
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const midiEngineRef = useRef<MIDIEngine | null>(null);
  const synthRef = useRef<Synth | null>(null);

  // =========================================================================
  // Project state
  // =========================================================================
  const [tracks, setTracks] = useState<Track[]>([]);
  const [masterTrack, setMasterTrack] = useState<MasterTrack>({
    id: 'master',
    name: 'Master',
    type: 'master',
    color: '#888',
    volume: 0,
    pan: 0,
    muted: false,
    solo: false,
    height: 80,
    collapsed: false,
    effects: [],
  });

  // =========================================================================
  // Transport state
  // =========================================================================
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const [position, setPosition] = useState<Beats>(0);
  const [bpm, setBpm] = useState(120);
  const [loop, setLoop] = useState<LoopRegion>({ enabled: false, start: 0, end: 16 });
  const [timeSignature, setTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });

  // =========================================================================
  // View state
  // =========================================================================
  const [viewMode, setViewMode] = useState<ViewMode>('arrangement');
  const [zoom, setZoom] = useState(1);
  const [gridSnap, setGridSnap] = useState<Beats>(0.25);
  const [selectedClips, setSelectedClips] = useState<string[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(true);
  const [pianoRoll, setPianoRoll] = useState<PianoRollState>({ trackId: null, clipId: null });
  const [pianoNotes, setPianoNotes] = useState<MIDINoteData[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);

  // =========================================================================
  // Initialize engines
  // =========================================================================
  useEffect(() => {
    const initEngines = async () => {
      // Audio engine
      const audioEngine = new AudioEngine();
      await audioEngine.initialize();
      audioEngineRef.current = audioEngine;

      // MIDI engine
      const midiEngine = new MIDIEngine();
      await midiEngine.initialize();
      midiEngineRef.current = midiEngine;

      // Synth (for MIDI preview)
      if (audioEngine.getContext()) {
        const synth = new Synth(audioEngine.getContext()!);
        synth.getOutput().connect(audioEngine.getMasterOutput()!);
        synthRef.current = synth;
      }

      // Subscribe to engine state
      audioEngine.subscribe((state) => {
        setTransportState(state.transportState);
        setPosition(state.position);
      });

      // Subscribe to MIDI events for synth
      midiEngine.onNote((event) => {
        if (!synthRef.current) return;
        if (event.type === 'noteOn') {
          synthRef.current.noteOn(event.note, event.velocity);
        } else if (event.type === 'noteOff') {
          synthRef.current.noteOff(event.note);
        }
      });
    };

    initEngines();

    return () => {
      audioEngineRef.current?.shutdown();
      midiEngineRef.current?.shutdown();
      synthRef.current?.destroy();
    };
  }, []);

  // =========================================================================
  // Sync tracks with audio engine
  // =========================================================================
  useEffect(() => {
    if (!audioEngineRef.current) return;

    for (const track of tracks) {
      audioEngineRef.current.addTrack(track);
    }
  }, [tracks]);

  // =========================================================================
  // Transport handlers
  // =========================================================================
  const handlePlay = useCallback(() => {
    audioEngineRef.current?.play(tracks);
  }, [tracks]);

  const handlePause = useCallback(() => {
    audioEngineRef.current?.pause();
  }, []);

  const handleStop = useCallback(() => {
    audioEngineRef.current?.stop();
  }, []);

  const handleRecord = useCallback(() => {
    if (transportState === 'recording') {
      audioEngineRef.current?.stop();
    } else {
      audioEngineRef.current?.record();
      midiEngineRef.current?.startRecording(bpm, position);
    }
  }, [transportState, bpm, position]);

  const handleSeek = useCallback((pos: Beats) => {
    audioEngineRef.current?.seek(pos);
    setPosition(pos);
  }, []);

  const handleLoopToggle = useCallback(() => {
    const newLoop = { ...loop, enabled: !loop.enabled };
    setLoop(newLoop);
    audioEngineRef.current?.setLoop(newLoop);
  }, [loop]);

  const handleLoopChange = useCallback((newLoop: LoopRegion) => {
    setLoop(newLoop);
    audioEngineRef.current?.setLoop(newLoop);
  }, []);

  const handleBpmChange = useCallback((newBpm: number) => {
    setBpm(newBpm);
    audioEngineRef.current?.setBPM(newBpm);
  }, []);

  // =========================================================================
  // Track handlers
  // =========================================================================
  const handleTracksChange = useCallback((newTracks: Track[]) => {
    setTracks(newTracks);
  }, []);

  const handleMasterChange = useCallback((master: MasterTrack) => {
    setMasterTrack(master);
    audioEngineRef.current?.updateTrack('master', master);
  }, []);

  // =========================================================================
  // Clip handlers
  // =========================================================================
  const handleClipDoubleClick = useCallback((trackId: string, clipId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track || track.type !== 'midi') return;

    const midiTrack = track as MIDITrack;
    const clip = midiTrack.clips.find((c) => c.id === clipId);
    if (!clip) return;

    setPianoRoll({ trackId, clipId });
    setPianoNotes(clip.notes);
    setViewMode('piano');
  }, [tracks]);

  // =========================================================================
  // Piano roll handlers
  // =========================================================================
  const handlePianoNotesChange = useCallback((notes: MIDINoteData[]) => {
    setPianoNotes(notes);

    // Update the clip in tracks
    if (!pianoRoll.trackId || !pianoRoll.clipId) return;

    setTracks((prevTracks) =>
      prevTracks.map((track) => {
        if (track.id !== pianoRoll.trackId || track.type !== 'midi') return track;
        const midiTrack = track as MIDITrack;
        return {
          ...midiTrack,
          clips: midiTrack.clips.map((clip) =>
            clip.id === pianoRoll.clipId ? { ...clip, notes } : clip
          ),
        };
      })
    );
  }, [pianoRoll]);

  const handleNotePreview = useCallback((note: MIDINote) => {
    synthRef.current?.noteOn(note, 100);
  }, []);

  const handleNoteRelease = useCallback((note: MIDINote) => {
    synthRef.current?.noteOff(note);
  }, []);

  // =========================================================================
  // Browser handlers
  // =========================================================================
  const handleInstrumentSelect = useCallback((instrumentId: string, presetId?: string) => {
    // Load preset if selecting synth
    if (instrumentId === 'synth' && presetId) {
      const preset = SYNTH_PRESETS.find((p) => p.id === presetId);
      if (preset && synthRef.current) {
        synthRef.current.loadPatch(preset);
      }
    }
  }, []);

  const handleEffectSelect = useCallback((effectId: string) => {
    // Add effect to selected track
    if (!selectedTrack) return;

    setTracks((prevTracks) =>
      prevTracks.map((track) => {
        if (track.id !== selectedTrack) return track;
        const newEffect: PluginInstance = {
          id: generateId(),
          pluginId: effectId,
          name: effectId,
          enabled: true,
          parameters: {},
        };
        return {
          ...track,
          effects: [...(track.effects || []), newEffect],
        };
      })
    );
  }, [selectedTrack]);

  // =========================================================================
  // Meter levels
  // =========================================================================
  const getMeterLevels = useCallback((trackId: string) => {
    return audioEngineRef.current?.getMeterLevels(trackId) || { left: 0, right: 0 };
  }, []);

  // =========================================================================
  // Keyboard shortcuts
  // =========================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // Transport
      if (key === ' ') {
        e.preventDefault();
        if (transportState === 'playing') {
          handlePause();
        } else {
          handlePlay();
        }
      }

      if (key === 'r' && !e.ctrlKey && !e.metaKey) {
        handleRecord();
      }

      if (key === 'l') {
        handleLoopToggle();
      }

      if (key === 'home' || (key === 'enter' && !e.shiftKey)) {
        handleSeek(0);
      }

      // View modes
      if (key === '1' && e.ctrlKey) {
        e.preventDefault();
        setViewMode('arrangement');
      }
      if (key === '2' && e.ctrlKey) {
        e.preventDefault();
        setViewMode('mixer');
      }
      if (key === '3' && e.ctrlKey) {
        e.preventDefault();
        setViewMode('piano');
      }

      // Toggle browser
      if (key === 'b' && e.ctrlKey) {
        e.preventDefault();
        setShowBrowser((v) => !v);
      }

      // Delete selected clips
      if (key === 'delete' || key === 'backspace') {
        if (selectedClips.length > 0 && viewMode === 'arrangement') {
          setTracks((prevTracks) =>
            prevTracks.map((track) => {
              if (track.type !== 'audio' && track.type !== 'midi') return track;
              return {
                ...track,
                clips: (track as MIDITrack).clips.filter(
                  (c) => !selectedClips.includes(c.id)
                ),
              } as Track;
            })
          );
          setSelectedClips([]);
        }
      }

      // Escape to deselect
      if (key === 'escape') {
        setSelectedClips([]);
        setSelectedNotes([]);
        if (viewMode === 'piano') {
          setViewMode('arrangement');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transportState, selectedClips, viewMode, handlePlay, handlePause, handleRecord, handleLoopToggle, handleSeek]);

  // =========================================================================
  // Get current clip for piano roll
  // =========================================================================
  const currentClip = pianoRoll.trackId && pianoRoll.clipId
    ? (tracks.find((t) => t.id === pianoRoll.trackId) as MIDITrack)?.clips.find(
        (c) => c.id === pianoRoll.clipId
      )
    : null;

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className={`flex flex-col h-full bg-[#1a1a1a] text-white ${className}`}>
      {/* Toolbar */}
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        bpm={bpm}
        onBpmChange={handleBpmChange}
        timeSignature={timeSignature}
        onTimeSignatureChange={setTimeSignature}
        gridSnap={gridSnap}
        onGridSnapChange={setGridSnap}
      />

      {/* Transport Bar */}
      <TransportBar
        transportState={transportState}
        position={position}
        bpm={bpm}
        loop={loop}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onRecord={handleRecord}
        onSeek={handleSeek}
        onLoopToggle={handleLoopToggle}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Browser sidebar */}
        {showBrowser && (
          <div className="w-56 border-r border-black flex-shrink-0">
            <Browser
              onInstrumentSelect={handleInstrumentSelect}
              onEffectSelect={handleEffectSelect}
            />
          </div>
        )}

        {/* Main view area */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'arrangement' && (
            <Timeline
              tracks={tracks}
              position={position}
              bpm={bpm}
              loop={loop}
              transportState={transportState}
              gridSnap={gridSnap}
              zoom={zoom}
              selectedClips={selectedClips}
              onTracksChange={handleTracksChange}
              onSeek={handleSeek}
              onLoopChange={handleLoopChange}
              onClipSelect={setSelectedClips}
              onClipDoubleClick={handleClipDoubleClick}
              onZoomChange={setZoom}
            />
          )}

          {viewMode === 'mixer' && (
            <Mixer
              tracks={tracks}
              masterTrack={masterTrack}
              onTracksChange={handleTracksChange}
              onMasterChange={handleMasterChange}
              getMeterLevels={getMeterLevels}
              selectedTrack={selectedTrack}
              onTrackSelect={setSelectedTrack}
            />
          )}

          {viewMode === 'piano' && currentClip && (
            <PianoRoll
              notes={pianoNotes}
              clipDuration={currentClip.duration}
              gridSnap={gridSnap}
              zoom={zoom}
              selectedNotes={selectedNotes}
              onNotesChange={handlePianoNotesChange}
              onNoteSelect={setSelectedNotes}
              onNotePreview={handleNotePreview}
              onNoteRelease={handleNoteRelease}
            />
          )}

          {viewMode === 'piano' && !currentClip && (
            <div className="flex items-center justify-center h-full text-white/30">
              <div className="text-center">
                <div className="text-lg mb-2">No MIDI clip selected</div>
                <div className="text-sm">Double-click a MIDI clip in the timeline to edit</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 flex items-center justify-between px-4 bg-[#252525] border-t border-black text-xs text-white/50">
        <div className="flex gap-4">
          <span>{tracks.length} tracks</span>
          <span>Grid: {gridSnap * 4}/4</span>
        </div>
        <div className="flex gap-4">
          <span>{bpm} BPM</span>
          <span>{timeSignature.numerator}/{timeSignature.denominator}</span>
          <span>Ctrl+1/2/3: views</span>
          <span>Space: play/pause</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// App Icon
// ============================================================================

export function ZDAWIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="zdaw-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#zdaw-grad)" />
      {/* Waveform */}
      <g stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9">
        <path d="M12 32 L12 28 L12 36" />
        <path d="M17 32 L17 22 L17 42" />
        <path d="M22 32 L22 18 L22 46" />
        <path d="M27 32 L27 24 L27 40" />
        <path d="M32 32 L32 14 L32 50" />
        <path d="M37 32 L37 20 L37 44" />
        <path d="M42 32 L42 26 L42 38" />
        <path d="M47 32 L47 16 L47 48" />
        <path d="M52 32 L52 24 L52 40" />
      </g>
      {/* Speaker grill */}
      <g fill="white" opacity="0.3">
        <circle cx="32" cy="54" r="1.5" />
        <circle cx="27" cy="54" r="1" />
        <circle cx="37" cy="54" r="1" />
      </g>
    </svg>
  );
}

// ============================================================================
// Default export for zOS app loader
// ============================================================================

export default ZDAWApp;
