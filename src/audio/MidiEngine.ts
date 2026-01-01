/**
 * MidiEngine - MIDI input/output handling for zDAW
 *
 * Supports Web MIDI API for hardware devices and virtual keyboard input.
 * Handles MIDI recording, playback, and routing.
 */

import type {
  MIDINoteEvent,
  MIDICCEvent,
  MIDIEvent,
  MIDINoteData,
  MIDIDeviceInfo,
  MIDINote,
  MIDIVelocity,
  MIDIChannel,
  Beats,
} from '../types';
import { generateId, secondsToBeats } from '../types';

/** MIDI message types */
const MIDI_NOTE_OFF = 0x80;
const MIDI_NOTE_ON = 0x90;
const MIDI_CONTROL_CHANGE = 0xB0;

/** MIDI engine listener */
type MIDIListener = (event: MIDIEvent) => void;

/** Note on/off tracking for recording */
interface ActiveNote {
  note: MIDINote;
  velocity: MIDIVelocity;
  channel: MIDIChannel;
  startTime: number;
  startBeat: Beats;
}

/** MIDI engine state */
interface MIDIEngineState {
  available: boolean;
  inputs: MIDIDeviceInfo[];
  outputs: MIDIDeviceInfo[];
  activeInput: string | null;
  activeOutput: string | null;
  isRecording: boolean;
}

type MIDIEngineStateListener = (state: MIDIEngineState) => void;

/**
 * MIDI Engine class
 */
export class MIDIEngine {
  private midiAccess: MIDIAccess | null = null;
  private state: MIDIEngineState = {
    available: false,
    inputs: [],
    outputs: [],
    activeInput: null,
    activeOutput: null,
    isRecording: false,
  };

  private noteListeners: Set<MIDIListener> = new Set();
  private stateListeners: Set<MIDIEngineStateListener> = new Set();
  private activeNotes: Map<string, ActiveNote> = new Map();
  private recordedNotes: MIDINoteData[] = [];

  // For beat calculation during recording
  private recordingStartTime: number = 0;
  private recordingBPM: number = 120;
  private recordingStartBeat: Beats = 0;

  // Virtual keyboard state
  private virtualOctave: number = 4;
  private virtualVelocity: MIDIVelocity = 100;

  constructor() {}

  /**
   * Initialize MIDI access
   */
  async initialize(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.log('Web MIDI API not available');
      this.state.available = false;
      this.notifyStateListeners();
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this.state.available = true;

      // Set up state change listener
      this.midiAccess.onstatechange = () => this.updateDevices();

      // Initial device enumeration
      this.updateDevices();

      return true;
    } catch (e) {
      console.error('Failed to get MIDI access:', e);
      this.state.available = false;
      this.notifyStateListeners();
      return false;
    }
  }

  /**
   * Update device lists
   */
  private updateDevices(): void {
    if (!this.midiAccess) return;

    const inputs: MIDIDeviceInfo[] = [];
    const outputs: MIDIDeviceInfo[] = [];

    this.midiAccess.inputs.forEach((input) => {
      inputs.push({
        id: input.id,
        name: input.name || 'Unknown Input',
        manufacturer: input.manufacturer || 'Unknown',
        type: 'input',
        connected: input.state === 'connected',
      });
    });

    this.midiAccess.outputs.forEach((output) => {
      outputs.push({
        id: output.id,
        name: output.name || 'Unknown Output',
        manufacturer: output.manufacturer || 'Unknown',
        type: 'output',
        connected: output.state === 'connected',
      });
    });

    this.state.inputs = inputs;
    this.state.outputs = outputs;

    // Validate active devices still exist
    if (this.state.activeInput && !inputs.find(i => i.id === this.state.activeInput)) {
      this.setActiveInput(null);
    }
    if (this.state.activeOutput && !outputs.find(o => o.id === this.state.activeOutput)) {
      this.setActiveOutput(null);
    }

    this.notifyStateListeners();
  }

  /**
   * Set active input device
   */
  setActiveInput(deviceId: string | null): void {
    // Disconnect previous input
    if (this.state.activeInput && this.midiAccess) {
      const prevInput = this.midiAccess.inputs.get(this.state.activeInput);
      if (prevInput) {
        prevInput.onmidimessage = null;
      }
    }

    this.state.activeInput = deviceId;

    // Connect new input
    if (deviceId && this.midiAccess) {
      const input = this.midiAccess.inputs.get(deviceId);
      if (input) {
        input.onmidimessage = (e) => this.handleMIDIMessage(e);
      }
    }

    this.notifyStateListeners();
  }

  /**
   * Set active output device
   */
  setActiveOutput(deviceId: string | null): void {
    this.state.activeOutput = deviceId;
    this.notifyStateListeners();
  }

  /**
   * Handle incoming MIDI message
   */
  private handleMIDIMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) as MIDIChannel;

    let midiEvent: MIDIEvent | null = null;

    switch (status) {
      case MIDI_NOTE_ON: {
        const note = data[1] as MIDINote;
        const velocity = data[2] as MIDIVelocity;

        if (velocity === 0) {
          // Note on with velocity 0 is note off
          midiEvent = this.handleNoteOff(note, channel);
        } else {
          midiEvent = this.handleNoteOn(note, velocity, channel);
        }
        break;
      }

      case MIDI_NOTE_OFF: {
        const note = data[1] as MIDINote;
        midiEvent = this.handleNoteOff(note, channel);
        break;
      }

      case MIDI_CONTROL_CHANGE: {
        const controller = data[1];
        const value = data[2];
        midiEvent = {
          type: 'cc',
          controller,
          value,
          channel,
          time: this.getCurrentBeat(),
        };
        break;
      }
    }

    if (midiEvent) {
      this.noteListeners.forEach(listener => listener(midiEvent!));
    }
  }

  /**
   * Handle note on
   */
  private handleNoteOn(note: MIDINote, velocity: MIDIVelocity, channel: MIDIChannel): MIDINoteEvent {
    const now = performance.now();
    const beat = this.getCurrentBeat();

    // Track active note for recording
    const key = `${channel}-${note}`;
    this.activeNotes.set(key, {
      note,
      velocity,
      channel,
      startTime: now,
      startBeat: beat,
    });

    return {
      type: 'noteOn',
      note,
      velocity,
      channel,
      time: beat,
    };
  }

  /**
   * Handle note off
   */
  private handleNoteOff(note: MIDINote, channel: MIDIChannel): MIDINoteEvent {
    const beat = this.getCurrentBeat();
    const key = `${channel}-${note}`;
    const activeNote = this.activeNotes.get(key);

    if (activeNote && this.state.isRecording) {
      // Record the completed note
      const duration = beat - activeNote.startBeat;
      if (duration > 0) {
        this.recordedNotes.push({
          id: generateId(),
          note: activeNote.note,
          velocity: activeNote.velocity,
          start: activeNote.startBeat - this.recordingStartBeat,
          duration,
        });
      }
    }

    this.activeNotes.delete(key);

    return {
      type: 'noteOff',
      note,
      velocity: 0,
      channel,
      time: beat,
    };
  }

  /**
   * Get current beat position
   */
  private getCurrentBeat(): Beats {
    if (!this.state.isRecording) return 0;

    const elapsed = (performance.now() - this.recordingStartTime) / 1000;
    return this.recordingStartBeat + secondsToBeats(elapsed, this.recordingBPM);
  }

  /**
   * Send MIDI message to output
   */
  sendMIDI(data: Uint8Array): void {
    if (!this.state.activeOutput || !this.midiAccess) return;

    const output = this.midiAccess.outputs.get(this.state.activeOutput);
    if (output) {
      output.send(data);
    }
  }

  /**
   * Send note on to output
   */
  sendNoteOn(note: MIDINote, velocity: MIDIVelocity, channel: MIDIChannel = 0): void {
    this.sendMIDI(new Uint8Array([MIDI_NOTE_ON | channel, note, velocity]));
  }

  /**
   * Send note off to output
   */
  sendNoteOff(note: MIDINote, channel: MIDIChannel = 0): void {
    this.sendMIDI(new Uint8Array([MIDI_NOTE_OFF | channel, note, 0]));
  }

  // =========================================================================
  // Virtual Keyboard
  // =========================================================================

  /**
   * Key to MIDI note mapping
   */
  private keyToNote(key: string): MIDINote | null {
    const baseNote = this.virtualOctave * 12;
    const keyMap: Record<string, number> = {
      // Lower row (white keys)
      'a': 0,  // C
      'w': 1,  // C#
      's': 2,  // D
      'e': 3,  // D#
      'd': 4,  // E
      'f': 5,  // F
      't': 6,  // F#
      'g': 7,  // G
      'y': 8,  // G#
      'h': 9,  // A
      'u': 10, // A#
      'j': 11, // B
      'k': 12, // C (next octave)
      'o': 13, // C#
      'l': 14, // D
      'p': 15, // D#
      ';': 16, // E
      "'": 17, // F
    };

    if (key in keyMap) {
      return (baseNote + keyMap[key]) as MIDINote;
    }
    return null;
  }

  /**
   * Handle virtual keyboard key down
   */
  virtualKeyDown(key: string): MIDIEvent | null {
    // Octave controls
    if (key === 'z') {
      this.virtualOctave = Math.max(0, this.virtualOctave - 1);
      return null;
    }
    if (key === 'x') {
      this.virtualOctave = Math.min(8, this.virtualOctave + 1);
      return null;
    }

    // Velocity controls
    if (key === 'c') {
      this.virtualVelocity = Math.max(1, this.virtualVelocity - 10) as MIDIVelocity;
      return null;
    }
    if (key === 'v') {
      this.virtualVelocity = Math.min(127, this.virtualVelocity + 10) as MIDIVelocity;
      return null;
    }

    const note = this.keyToNote(key);
    if (note === null) return null;

    const event = this.handleNoteOn(note, this.virtualVelocity, 0);
    this.noteListeners.forEach(listener => listener(event));
    return event;
  }

  /**
   * Handle virtual keyboard key up
   */
  virtualKeyUp(key: string): MIDIEvent | null {
    const note = this.keyToNote(key);
    if (note === null) return null;

    const event = this.handleNoteOff(note, 0);
    this.noteListeners.forEach(listener => listener(event));
    return event;
  }

  /**
   * Get virtual keyboard octave
   */
  getVirtualOctave(): number {
    return this.virtualOctave;
  }

  /**
   * Get virtual keyboard velocity
   */
  getVirtualVelocity(): MIDIVelocity {
    return this.virtualVelocity;
  }

  // =========================================================================
  // Recording
  // =========================================================================

  /**
   * Start recording MIDI
   */
  startRecording(bpm: number, startBeat: Beats = 0): void {
    this.state.isRecording = true;
    this.recordingStartTime = performance.now();
    this.recordingBPM = bpm;
    this.recordingStartBeat = startBeat;
    this.recordedNotes = [];
    this.activeNotes.clear();
    this.notifyStateListeners();
  }

  /**
   * Stop recording and return recorded notes
   */
  stopRecording(): MIDINoteData[] {
    // Complete any still-held notes
    const beat = this.getCurrentBeat();
    this.activeNotes.forEach((activeNote, key) => {
      const duration = beat - activeNote.startBeat;
      if (duration > 0) {
        this.recordedNotes.push({
          id: generateId(),
          note: activeNote.note,
          velocity: activeNote.velocity,
          start: activeNote.startBeat - this.recordingStartBeat,
          duration,
        });
      }
    });

    this.activeNotes.clear();
    this.state.isRecording = false;
    this.notifyStateListeners();

    const notes = [...this.recordedNotes];
    this.recordedNotes = [];
    return notes;
  }

  /**
   * Is recording in progress
   */
  isRecording(): boolean {
    return this.state.isRecording;
  }

  // =========================================================================
  // State & Listeners
  // =========================================================================

  /**
   * Subscribe to MIDI events
   */
  onNote(listener: MIDIListener): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: MIDIEngineStateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Get current state
   */
  getState(): MIDIEngineState {
    return { ...this.state };
  }

  /**
   * Notify state listeners
   */
  private notifyStateListeners(): void {
    this.stateListeners.forEach(listener => listener({ ...this.state }));
  }

  /**
   * Get currently held notes
   */
  getActiveNotes(): MIDINote[] {
    return Array.from(this.activeNotes.values()).map(n => n.note);
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    if (this.state.activeInput) {
      this.setActiveInput(null);
    }
    this.noteListeners.clear();
    this.stateListeners.clear();
    this.activeNotes.clear();
    this.midiAccess = null;
  }
}
