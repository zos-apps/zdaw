/**
 * CaptureMIDI - Retroactive MIDI recording for zDAW
 *
 * Continuously buffers incoming MIDI events so users can
 * capture what they just played even without pressing record.
 *
 * Features:
 * - Rolling buffer of recent MIDI input
 * - Configurable buffer length (default 2 minutes)
 * - Quantization on capture
 * - Tempo-aware beat alignment
 */

import type {
  MIDINoteData,
  MIDINote,
  MIDIVelocity,
  MIDIChannel,
  Beats,
  CapturedMIDI,
} from '../types';
import { generateId, secondsToBeats, quantize } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Raw MIDI event in the buffer */
interface BufferedMIDIEvent {
  type: 'noteOn' | 'noteOff';
  note: MIDINote;
  velocity: MIDIVelocity;
  channel: MIDIChannel;
  timestamp: number; // performance.now() timestamp
}

/** Active note being tracked */
interface ActiveNote {
  note: MIDINote;
  velocity: MIDIVelocity;
  channel: MIDIChannel;
  startTime: number;
}

/** Capture MIDI configuration */
interface CaptureMIDIConfig {
  bufferLengthSeconds: number; // How long to keep in buffer (default 120)
  maxNotes: number; // Maximum notes to keep
}

// ============================================================================
// Capture MIDI Class
// ============================================================================

export class CaptureMIDI {
  private config: CaptureMIDIConfig = {
    bufferLengthSeconds: 120, // 2 minutes
    maxNotes: 5000,
  };

  private eventBuffer: BufferedMIDIEvent[] = [];
  private activeNotes: Map<string, ActiveNote> = new Map();
  private currentBPM: number = 120;
  private transportPosition: Beats = 0;
  private transportStartTime: number = 0;
  private isTransportPlaying: boolean = false;

  constructor(config?: Partial<CaptureMIDIConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setBufferLength(seconds: number): void {
    this.config.bufferLengthSeconds = seconds;
    this.pruneBuffer();
  }

  setBPM(bpm: number): void {
    this.currentBPM = bpm;
  }

  setTransportState(
    playing: boolean,
    position: Beats,
    startTime: number = performance.now()
  ): void {
    this.isTransportPlaying = playing;
    this.transportPosition = position;
    this.transportStartTime = startTime;
  }

  // =========================================================================
  // MIDI Input
  // =========================================================================

  /**
   * Process incoming MIDI note on
   */
  noteOn(
    note: MIDINote,
    velocity: MIDIVelocity,
    channel: MIDIChannel = 0
  ): void {
    const timestamp = performance.now();

    // Add to buffer
    this.eventBuffer.push({
      type: 'noteOn',
      note,
      velocity,
      channel,
      timestamp,
    });

    // Track active note
    const key = `${channel}-${note}`;
    this.activeNotes.set(key, {
      note,
      velocity,
      channel,
      startTime: timestamp,
    });

    this.pruneBuffer();
  }

  /**
   * Process incoming MIDI note off
   */
  noteOff(note: MIDINote, channel: MIDIChannel = 0): void {
    const timestamp = performance.now();

    // Add to buffer
    this.eventBuffer.push({
      type: 'noteOff',
      note,
      velocity: 0,
      channel,
      timestamp,
    });

    // Remove from active notes
    const key = `${channel}-${note}`;
    this.activeNotes.delete(key);
  }

  // =========================================================================
  // Capture
  // =========================================================================

  /**
   * Capture the buffered MIDI as a clip
   * Returns notes converted to beat-relative positions
   */
  capture(options: {
    startTime?: number; // If specified, only capture from this time
    endTime?: number; // If specified, only capture until this time
    quantization?: Beats; // Grid to quantize to (0 = no quantization)
    alignToBeat?: boolean; // Align start to nearest beat
  } = {}): CapturedMIDI | null {
    const now = performance.now();
    const startTime = options.startTime ?? now - this.config.bufferLengthSeconds * 1000;
    const endTime = options.endTime ?? now;
    const quantizationGrid = options.quantization ?? 0;

    // Filter events within time range
    const eventsInRange = this.eventBuffer.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime
    );

    if (eventsInRange.length === 0) {
      return null;
    }

    // Convert events to notes
    const notes: MIDINoteData[] = [];
    const pendingNotes: Map<string, BufferedMIDIEvent> = new Map();

    const firstEventTime = eventsInRange[0].timestamp;

    for (const event of eventsInRange) {
      const key = `${event.channel}-${event.note}`;

      if (event.type === 'noteOn' && event.velocity > 0) {
        pendingNotes.set(key, event);
      } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
        const noteOnEvent = pendingNotes.get(key);
        if (noteOnEvent) {
          // Convert timestamps to beats
          const durationMs = event.timestamp - noteOnEvent.timestamp;
          const startMs = noteOnEvent.timestamp - firstEventTime;

          let startBeat = this.msToBeats(startMs);
          let duration = this.msToBeats(durationMs);

          // Apply quantization
          if (quantizationGrid > 0) {
            startBeat = quantize(startBeat, quantizationGrid);
            duration = Math.max(
              quantizationGrid,
              quantize(duration, quantizationGrid)
            );
          }

          notes.push({
            id: generateId(),
            note: noteOnEvent.note,
            velocity: noteOnEvent.velocity,
            start: startBeat,
            duration,
          });

          pendingNotes.delete(key);
        }
      }
    }

    // Handle notes that are still held (add them with duration to current time)
    for (const [key, noteOnEvent] of pendingNotes) {
      const durationMs = endTime - noteOnEvent.timestamp;
      const startMs = noteOnEvent.timestamp - firstEventTime;

      let startBeat = this.msToBeats(startMs);
      let duration = this.msToBeats(durationMs);

      if (quantizationGrid > 0) {
        startBeat = quantize(startBeat, quantizationGrid);
        duration = Math.max(
          quantizationGrid,
          quantize(duration, quantizationGrid)
        );
      }

      notes.push({
        id: generateId(),
        note: noteOnEvent.note,
        velocity: noteOnEvent.velocity,
        start: startBeat,
        duration,
      });
    }

    // Sort notes by start time
    notes.sort((a, b) => a.start - b.start);

    // Calculate total duration
    let totalDuration = 0;
    for (const note of notes) {
      const noteEnd = note.start + note.duration;
      if (noteEnd > totalDuration) {
        totalDuration = noteEnd;
      }
    }

    // Optionally align to bar boundary
    if (options.alignToBeat) {
      const offset = notes[0]?.start ?? 0;
      for (const note of notes) {
        note.start -= offset;
      }
    }

    return {
      notes,
      startTime: firstEventTime,
      duration: totalDuration,
      tempo: this.currentBPM,
    };
  }

  /**
   * Capture only the most recent phrase
   * Detects gaps in playing to find phrase boundaries
   */
  captureLastPhrase(gapThresholdMs: number = 2000): CapturedMIDI | null {
    const now = performance.now();

    // Find the start of the last phrase (after a gap)
    let phraseStart = 0;
    let lastEventTime = 0;

    for (let i = this.eventBuffer.length - 1; i >= 0; i--) {
      const event = this.eventBuffer[i];

      if (lastEventTime === 0) {
        lastEventTime = event.timestamp;
        continue;
      }

      const gap = lastEventTime - event.timestamp;
      if (gap > gapThresholdMs) {
        phraseStart = lastEventTime;
        break;
      }

      lastEventTime = event.timestamp;
    }

    // If no gap found, capture everything
    if (phraseStart === 0 && this.eventBuffer.length > 0) {
      phraseStart = this.eventBuffer[0].timestamp;
    }

    return this.capture({
      startTime: phraseStart,
      endTime: now,
      alignToBeat: true,
    });
  }

  /**
   * Capture the last N bars
   */
  captureLastBars(bars: number): CapturedMIDI | null {
    const now = performance.now();
    const beatsToCapture = bars * 4; // Assuming 4/4 time
    const msToCapture = this.beatsToMs(beatsToCapture);

    return this.capture({
      startTime: now - msToCapture,
      endTime: now,
      alignToBeat: true,
    });
  }

  // =========================================================================
  // Buffer Management
  // =========================================================================

  /**
   * Clear the buffer
   */
  clear(): void {
    this.eventBuffer = [];
    this.activeNotes.clear();
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    eventCount: number;
    activeNotes: number;
    bufferDurationMs: number;
  } {
    const now = performance.now();
    const oldestEvent = this.eventBuffer[0];
    const bufferDuration = oldestEvent ? now - oldestEvent.timestamp : 0;

    return {
      eventCount: this.eventBuffer.length,
      activeNotes: this.activeNotes.size,
      bufferDurationMs: bufferDuration,
    };
  }

  /**
   * Check if there's content to capture
   */
  hasContent(): boolean {
    return this.eventBuffer.length > 0;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Remove old events from buffer
   */
  private pruneBuffer(): void {
    const now = performance.now();
    const cutoffTime = now - this.config.bufferLengthSeconds * 1000;

    // Remove old events
    while (
      this.eventBuffer.length > 0 &&
      this.eventBuffer[0].timestamp < cutoffTime
    ) {
      this.eventBuffer.shift();
    }

    // Also limit by max notes
    while (this.eventBuffer.length > this.config.maxNotes) {
      this.eventBuffer.shift();
    }
  }

  /**
   * Convert milliseconds to beats
   */
  private msToBeats(ms: number): Beats {
    return secondsToBeats(ms / 1000, this.currentBPM);
  }

  /**
   * Convert beats to milliseconds
   */
  private beatsToMs(beats: Beats): number {
    return (beats / this.currentBPM) * 60 * 1000;
  }

  /**
   * Get current beat position based on transport
   */
  private getCurrentBeat(): Beats {
    if (!this.isTransportPlaying) {
      return this.transportPosition;
    }

    const elapsedMs = performance.now() - this.transportStartTime;
    return this.transportPosition + this.msToBeats(elapsedMs);
  }
}

// ============================================================================
// Singleton Instance (optional convenience)
// ============================================================================

let globalCaptureMIDI: CaptureMIDI | null = null;

export function getCaptureMIDI(): CaptureMIDI {
  if (!globalCaptureMIDI) {
    globalCaptureMIDI = new CaptureMIDI();
  }
  return globalCaptureMIDI;
}

export function initCaptureMIDI(config?: Partial<CaptureMIDIConfig>): CaptureMIDI {
  globalCaptureMIDI = new CaptureMIDI(config);
  return globalCaptureMIDI;
}
