/**
 * zDAW Types
 *
 * Core type definitions for the digital audio workstation.
 * Follows Web Audio API conventions where applicable.
 */

// ============================================================================
// Time & Position
// ============================================================================

/** Time in seconds */
export type Seconds = number;

/** Time in beats */
export type Beats = number;

/** Time in samples */
export type Samples = number;

/** Bar:Beat:Tick position */
export interface BBT {
  bar: number;
  beat: number;
  tick: number;
}

/** Transport state */
export type TransportState = 'stopped' | 'playing' | 'recording' | 'paused';

/** Loop region */
export interface LoopRegion {
  enabled: boolean;
  start: Beats;
  end: Beats;
}

// ============================================================================
// MIDI
// ============================================================================

/** MIDI note number (0-127) */
export type MIDINote = number;

/** MIDI velocity (0-127) */
export type MIDIVelocity = number;

/** MIDI channel (0-15) */
export type MIDIChannel = number;

/** MIDI note event */
export interface MIDINoteEvent {
  type: 'noteOn' | 'noteOff';
  note: MIDINote;
  velocity: MIDIVelocity;
  channel: MIDIChannel;
  time: Beats;
}

/** MIDI note with duration */
export interface MIDINoteData {
  id: string;
  note: MIDINote;
  velocity: MIDIVelocity;
  start: Beats;
  duration: Beats;
  selected?: boolean;
}

/** MIDI CC event */
export interface MIDICCEvent {
  type: 'cc';
  controller: number;
  value: number;
  channel: MIDIChannel;
  time: Beats;
}

/** All MIDI events */
export type MIDIEvent = MIDINoteEvent | MIDICCEvent;

/** MIDI device info */
export interface MIDIDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  type: 'input' | 'output';
  connected: boolean;
}

// ============================================================================
// Audio
// ============================================================================

/** Audio buffer with metadata */
export interface AudioSample {
  id: string;
  name: string;
  buffer: AudioBuffer;
  duration: Seconds;
  sampleRate: number;
  channels: number;
  waveform?: Float32Array;
}

/** Audio region in a clip */
export interface AudioRegion {
  id: string;
  sampleId: string;
  start: Beats;
  duration: Beats;
  offset: Seconds;
  gain: number;
  fadeIn: Seconds;
  fadeOut: Seconds;
}

// ============================================================================
// Warp Modes (Version 2)
// ============================================================================

/** Warp mode for time-stretching */
export type WarpMode = 'beats' | 'tones' | 'texture' | 'complex' | 'repitch' | 'off';

/** Warp marker for audio alignment */
export interface WarpMarker {
  id: string;
  sampleTime: Seconds;
  beatTime: Beats;
}

/** Audio warp settings */
export interface WarpSettings {
  enabled: boolean;
  mode: WarpMode;
  originalBPM: number;
  markers: WarpMarker[];
  transientSensitivity: number; // 0-1
  grainSize: number; // ms
  preservePitch: boolean;
}

// ============================================================================
// Clip Envelopes (Version 2)
// ============================================================================

/** Envelope point */
export interface EnvelopePoint {
  time: Beats;
  value: number;
  curve: 'linear' | 'hold' | 'smooth';
}

/** Clip envelope */
export interface ClipEnvelope {
  id: string;
  parameter: 'volume' | 'pan' | 'transpose' | 'device';
  deviceId?: string;
  paramId?: string;
  points: EnvelopePoint[];
  enabled: boolean;
}

// ============================================================================
// Follow Actions (Version 2)
// ============================================================================

/** Follow action type */
export type FollowActionType =
  | 'none'
  | 'stop'
  | 'play-again'
  | 'previous'
  | 'next'
  | 'first'
  | 'last'
  | 'any'
  | 'other'
  | 'jump';

/** Follow action definition */
export interface FollowAction {
  action: FollowActionType;
  chance: number; // 0-1
  jumpTarget?: string; // clip ID for 'jump' action
}

/** Follow action pair */
export interface FollowActionPair {
  actionA: FollowAction;
  actionB: FollowAction;
  time: Beats; // time after clip start
  linked: boolean; // use global quantization
}

// ============================================================================
// Launch Quantization (Version 2)
// ============================================================================

/** Launch quantization options */
export type LaunchQuantization =
  | 'none'
  | '1/32'
  | '1/16'
  | '1/8'
  | '1/4'
  | '1/2'
  | '1-bar'
  | '2-bars'
  | '4-bars'
  | '8-bars'
  | 'global';

/** Legato mode for overlapping clips */
export type LegatoMode = 'off' | 'legato' | 'immediate';

// ============================================================================
// Session Clips (Version 2)
// ============================================================================

/** Session clip state */
export type ClipState = 'stopped' | 'playing' | 'recording' | 'triggered' | 'stopping';

/** Base clip properties */
interface ClipBase {
  id: string;
  name: string;
  color: string;
  start: Beats;
  duration: Beats;
  selected?: boolean;
  muted?: boolean;
  // Session clip properties
  state?: ClipState;
  loopEnabled?: boolean;
  loopStart?: Beats;
  loopEnd?: Beats;
  launchQuantization?: LaunchQuantization;
  legato?: LegatoMode;
  followAction?: FollowActionPair;
  envelopes?: ClipEnvelope[];
}

/** Audio clip */
export interface AudioClip extends ClipBase {
  type: 'audio';
  regions: AudioRegion[];
  warp?: WarpSettings;
}

/** MIDI clip */
export interface MIDIClip extends ClipBase {
  type: 'midi';
  notes: MIDINoteData[];
}

/** Union of all clip types */
export type Clip = AudioClip | MIDIClip;

// ============================================================================
// Session View (Version 2)
// ============================================================================

/** Session slot - can be empty or contain a clip */
export interface SessionSlot {
  id: string;
  clipId: string | null;
  hasStopButton: boolean;
  state: ClipState;
}

/** Scene - horizontal row of clips that can be launched together */
export interface Scene {
  id: string;
  name: string;
  color: string;
  tempo?: number; // scene-specific tempo
  timeSignature?: TimeSignature;
  slots: SessionSlot[];
}

/** Session view state */
export interface SessionViewState {
  scenes: Scene[];
  globalQuantization: LaunchQuantization;
  recordQuantization: LaunchQuantization;
  followActionEnabled: boolean;
  tempoFollower: {
    enabled: boolean;
    sensitivity: number; // 0-1
    range: { min: number; max: number };
  };
}

// ============================================================================
// Capture MIDI (Version 2)
// ============================================================================

/** Captured MIDI buffer */
export interface CapturedMIDI {
  notes: MIDINoteData[];
  startTime: number;
  duration: Beats;
  tempo: number;
}

// ============================================================================
// Plugins & Effects
// ============================================================================

/** Parameter range */
export interface ParameterRange {
  min: number;
  max: number;
  default: number;
  step?: number;
}

/** Plugin parameter */
export interface PluginParameter {
  id: string;
  name: string;
  value: number;
  range: ParameterRange;
  unit?: string;
  automatable?: boolean;
}

/** Plugin preset */
export interface PluginPreset {
  id: string;
  name: string;
  parameters: Record<string, number>;
}

/** Plugin types */
export type PluginType =
  | 'eq'
  | 'compressor'
  | 'reverb'
  | 'delay'
  | 'filter'
  | 'gain'
  | 'limiter'
  | 'chorus'
  | 'distortion'
  | 'phaser'
  | 'flanger'
  | 'gate'
  | 'saturator'
  | 'autofilter'
  | 'synth'
  | 'sampler'
  | 'wavetable'
  | 'drumrack'
  | 'simpler';

/** Plugin definition */
export interface PluginDefinition {
  id: string;
  name: string;
  type: PluginType;
  category: 'effect' | 'instrument' | 'midi-effect';
  parameters: PluginParameter[];
  presets?: PluginPreset[];
}

/** Plugin instance on a track */
export interface PluginInstance {
  id: string;
  pluginId: string;
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
}

// ============================================================================
// Instruments
// ============================================================================

/** Oscillator type */
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** ADSR envelope */
export interface ADSREnvelope {
  attack: Seconds;
  decay: Seconds;
  sustain: number;
  release: Seconds;
}

/** Filter type */
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/** Synth voice config */
export interface SynthVoice {
  oscillator: OscillatorType;
  detune: number;
  envelope: ADSREnvelope;
  filter: {
    type: FilterType;
    frequency: number;
    resonance: number;
    envelope: ADSREnvelope;
    envelopeAmount: number;
  };
  gain: number;
}

/** Synth patch (multi-oscillator) */
export interface SynthPatch {
  id: string;
  name: string;
  voices: SynthVoice[];
  polyphony: number;
  portamento: Seconds;
}

/** Sample zone for sampler */
export interface SampleZone {
  id: string;
  sampleId: string;
  rootNote: MIDINote;
  lowNote: MIDINote;
  highNote: MIDINote;
  lowVelocity: MIDIVelocity;
  highVelocity: MIDIVelocity;
  tune: number;
  pan: number;
  gain: number;
  envelope: ADSREnvelope;
  loop?: {
    enabled: boolean;
    start: Samples;
    end: Samples;
  };
}

/** Sampler instrument */
export interface SamplerInstrument {
  id: string;
  name: string;
  zones: SampleZone[];
  polyphony: number;
}

// ============================================================================
// Tracks
// ============================================================================

/** Track type */
export type TrackType = 'audio' | 'midi' | 'master' | 'bus' | 'return';

/** Track routing */
export interface TrackRouting {
  input?: string;
  output: string;
  sends: Array<{
    busId: string;
    gain: number;
    preFader: boolean;
  }>;
}

/** Base track properties */
interface TrackBase {
  id: string;
  name: string;
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  height: number;
  collapsed: boolean;
  routing: TrackRouting;
  effects: PluginInstance[];
  // Session view properties (Version 2)
  sessionSlots?: SessionSlot[];
  clipSlots?: (Clip | null)[];
}

/** Audio track */
export interface AudioTrack extends TrackBase {
  type: 'audio';
  clips: AudioClip[];
  monitoring: boolean;
}

/** MIDI track with instrument */
export interface MIDITrack extends TrackBase {
  type: 'midi';
  clips: MIDIClip[];
  instrument?: PluginInstance;
  midiChannel: MIDIChannel;
}

/** Master track */
export interface MasterTrack extends Omit<TrackBase, 'armed' | 'routing'> {
  type: 'master';
}

/** Bus/return track */
export interface BusTrack extends Omit<TrackBase, 'armed'> {
  type: 'bus';
}

/** All track types */
export type Track = AudioTrack | MIDITrack | MasterTrack | BusTrack;

// ============================================================================
// Project
// ============================================================================

/** Project tempo automation point */
export interface TempoPoint {
  time: Beats;
  bpm: number;
}

/** Time signature */
export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** Project settings */
export interface ProjectSettings {
  sampleRate: number;
  bufferSize: number;
  bitDepth: number;
}

/** Project state */
export interface Project {
  id: string;
  name: string;
  bpm: number;
  timeSignature: TimeSignature;
  tempo: TempoPoint[];
  tracks: Track[];
  masterTrack: MasterTrack;
  buses: BusTrack[];
  samples: Map<string, AudioSample>;
  settings: ProjectSettings;
  createdAt: number;
  modifiedAt: number;
  // Session view (Version 2)
  sessionView?: SessionViewState;
}

// ============================================================================
// DAW State
// ============================================================================

/** Current selection */
export interface Selection {
  tracks: string[];
  clips: string[];
  notes: string[];
}

/** View state */
export interface ViewState {
  mode: 'arrangement' | 'session' | 'mixer' | 'piano';
  zoom: {
    horizontal: number;
    vertical: number;
  };
  scroll: {
    x: number;
    y: number;
  };
  gridSnap: Beats;
  showGrid: boolean;
  showAutomation: boolean;
  pianoRoll: {
    trackId: string | null;
    clipId: string | null;
  };
}

/** Full DAW state */
export interface DAWState {
  project: Project;
  transport: {
    state: TransportState;
    position: Beats;
    loop: LoopRegion;
  };
  selection: Selection;
  view: ViewState;
  midi: {
    inputs: MIDIDeviceInfo[];
    outputs: MIDIDeviceInfo[];
    activeInput: string | null;
  };
  // Version 2
  capturedMIDI?: CapturedMIDI;
}

// ============================================================================
// Actions / Events
// ============================================================================

/** User action types */
export type DAWAction =
  | { type: 'PLAY' }
  | { type: 'STOP' }
  | { type: 'RECORD' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; position: Beats }
  | { type: 'SET_BPM'; bpm: number }
  | { type: 'SET_LOOP'; loop: LoopRegion }
  | { type: 'ADD_TRACK'; trackType: TrackType }
  | { type: 'REMOVE_TRACK'; trackId: string }
  | { type: 'UPDATE_TRACK'; trackId: string; updates: Partial<Track> }
  | { type: 'ADD_CLIP'; trackId: string; clip: Clip }
  | { type: 'UPDATE_CLIP'; trackId: string; clipId: string; updates: Partial<Clip> }
  | { type: 'REMOVE_CLIP'; trackId: string; clipId: string }
  | { type: 'ADD_NOTE'; trackId: string; clipId: string; note: MIDINoteData }
  | { type: 'UPDATE_NOTE'; trackId: string; clipId: string; noteId: string; updates: Partial<MIDINoteData> }
  | { type: 'REMOVE_NOTE'; trackId: string; clipId: string; noteId: string }
  | { type: 'ADD_EFFECT'; trackId: string; effect: PluginInstance }
  | { type: 'REMOVE_EFFECT'; trackId: string; effectId: string }
  | { type: 'UPDATE_EFFECT_PARAM'; trackId: string; effectId: string; paramId: string; value: number }
  | { type: 'SET_SELECTION'; selection: Selection }
  | { type: 'SET_VIEW'; view: Partial<ViewState> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // Version 2 - Session actions
  | { type: 'LAUNCH_CLIP'; trackId: string; slotIndex: number }
  | { type: 'STOP_CLIP'; trackId: string; slotIndex: number }
  | { type: 'LAUNCH_SCENE'; sceneIndex: number }
  | { type: 'STOP_ALL_CLIPS' }
  | { type: 'CAPTURE_MIDI' }
  | { type: 'SET_GLOBAL_QUANTIZATION'; quantization: LaunchQuantization };

// ============================================================================
// Utility types
// ============================================================================

/** Generate unique ID */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Convert beats to seconds */
export function beatsToSeconds(beats: Beats, bpm: number): Seconds {
  return (beats / bpm) * 60;
}

/** Convert seconds to beats */
export function secondsToBeats(seconds: Seconds, bpm: number): Beats {
  return (seconds / 60) * bpm;
}

/** MIDI note to frequency */
export function noteToFrequency(note: MIDINote): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** MIDI note to name */
export function noteToName(note: MIDINote): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}

/** Decibels to linear gain */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear gain to decibels */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 0.0001));
}

/** Quantize beat to grid */
export function quantize(beat: Beats, grid: Beats): Beats {
  return Math.round(beat / grid) * grid;
}

/** Convert launch quantization to beats */
export function launchQuantizationToBeats(q: LaunchQuantization, bpm: number): Beats {
  switch (q) {
    case 'none': return 0;
    case '1/32': return 0.125;
    case '1/16': return 0.25;
    case '1/8': return 0.5;
    case '1/4': return 1;
    case '1/2': return 2;
    case '1-bar': return 4;
    case '2-bars': return 8;
    case '4-bars': return 16;
    case '8-bars': return 32;
    case 'global': return 4; // default to 1 bar
    default: return 0;
  }
}

/** Get next quantized beat */
export function getNextQuantizedBeat(currentBeat: Beats, quantization: LaunchQuantization, bpm: number): Beats {
  const q = launchQuantizationToBeats(quantization, bpm);
  if (q === 0) return currentBeat;
  return Math.ceil(currentBeat / q) * q;
}

/** Default track colors */
export const TRACK_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

/** Get random track color */
export function randomTrackColor(): string {
  return TRACK_COLORS[Math.floor(Math.random() * TRACK_COLORS.length)];
}
