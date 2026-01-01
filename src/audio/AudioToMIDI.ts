/**
 * AudioToMIDI - Audio to MIDI conversion for zDAW
 *
 * Analyzes audio content and extracts:
 * - Monophonic pitch (for melodies, bass lines)
 * - Polyphonic pitch (for chords, complex audio)
 * - Rhythm/transients (for drums to MIDI)
 *
 * Uses autocorrelation for pitch detection and
 * onset detection for rhythm extraction.
 */

import type {
  MIDINoteData,
  MIDINote,
  MIDIVelocity,
  Beats,
  Seconds,
} from '../types';
import { generateId, secondsToBeats } from '../types';

// ============================================================================
// Types
// ============================================================================

/** Conversion mode */
export type ConversionMode = 'melody' | 'harmony' | 'drums';

/** Conversion settings */
export interface AudioToMIDISettings {
  mode: ConversionMode;
  sensitivity: number; // 0-1, affects onset detection
  minNoteLength: Seconds; // Minimum note duration
  minFrequency: number; // Hz, minimum pitch to detect
  maxFrequency: number; // Hz, maximum pitch to detect
  tuning: number; // A4 reference frequency (default 440)
}

/** Detected pitch event */
interface PitchEvent {
  time: Seconds;
  frequency: number;
  confidence: number;
  amplitude: number;
}

/** Detected onset */
interface OnsetEvent {
  time: Seconds;
  strength: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SETTINGS: AudioToMIDISettings = {
  mode: 'melody',
  sensitivity: 0.5,
  minNoteLength: 0.05, // 50ms
  minFrequency: 80, // ~E2
  maxFrequency: 2000, // ~B6
  tuning: 440,
};

// ============================================================================
// Audio to MIDI Converter
// ============================================================================

export class AudioToMIDI {
  private settings: AudioToMIDISettings = { ...DEFAULT_SETTINGS };

  constructor(settings?: Partial<AudioToMIDISettings>) {
    if (settings) {
      this.settings = { ...this.settings, ...settings };
    }
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setSettings(settings: Partial<AudioToMIDISettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): AudioToMIDISettings {
    return { ...this.settings };
  }

  // =========================================================================
  // Main Conversion
  // =========================================================================

  /**
   * Convert audio buffer to MIDI notes
   */
  convert(buffer: AudioBuffer, bpm: number): MIDINoteData[] {
    switch (this.settings.mode) {
      case 'melody':
        return this.convertMelody(buffer, bpm);
      case 'harmony':
        return this.convertHarmony(buffer, bpm);
      case 'drums':
        return this.convertDrums(buffer, bpm);
      default:
        return [];
    }
  }

  // =========================================================================
  // Melody Conversion (Monophonic)
  // =========================================================================

  private convertMelody(buffer: AudioBuffer, bpm: number): MIDINoteData[] {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // Detect pitches using autocorrelation
    const pitchEvents = this.detectPitchesMonophonic(data, sampleRate);

    // Detect onsets for note segmentation
    const onsets = this.detectOnsets(data, sampleRate);

    // Convert pitch events to notes
    return this.pitchEventsToNotes(pitchEvents, onsets, bpm);
  }

  /**
   * Autocorrelation-based pitch detection
   */
  private detectPitchesMonophonic(
    data: Float32Array,
    sampleRate: number
  ): PitchEvent[] {
    const pitchEvents: PitchEvent[] = [];
    const frameSize = 2048;
    const hopSize = 512;

    const minPeriod = Math.floor(sampleRate / this.settings.maxFrequency);
    const maxPeriod = Math.floor(sampleRate / this.settings.minFrequency);

    for (let i = 0; i < data.length - frameSize; i += hopSize) {
      // Extract frame
      const frame = data.slice(i, i + frameSize);

      // Calculate amplitude
      let rms = 0;
      for (let j = 0; j < frameSize; j++) {
        rms += frame[j] * frame[j];
      }
      rms = Math.sqrt(rms / frameSize);

      // Skip quiet frames
      if (rms < 0.01) continue;

      // Autocorrelation
      const { period, confidence } = this.autocorrelate(
        frame,
        minPeriod,
        maxPeriod
      );

      if (confidence > 0.8 * this.settings.sensitivity) {
        const frequency = sampleRate / period;

        if (
          frequency >= this.settings.minFrequency &&
          frequency <= this.settings.maxFrequency
        ) {
          pitchEvents.push({
            time: i / sampleRate,
            frequency,
            confidence,
            amplitude: rms,
          });
        }
      }
    }

    return pitchEvents;
  }

  /**
   * Normalized autocorrelation for pitch detection
   */
  private autocorrelate(
    frame: Float32Array,
    minPeriod: number,
    maxPeriod: number
  ): { period: number; confidence: number } {
    let bestPeriod = minPeriod;
    let bestCorrelation = -1;

    // Calculate autocorrelation for each period
    for (let period = minPeriod; period <= maxPeriod; period++) {
      let correlation = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let j = 0; j < frame.length - period; j++) {
        correlation += frame[j] * frame[j + period];
        norm1 += frame[j] * frame[j];
        norm2 += frame[j + period] * frame[j + period];
      }

      // Normalized correlation
      const normalizedCorr =
        correlation / (Math.sqrt(norm1 * norm2) + 0.0001);

      if (normalizedCorr > bestCorrelation) {
        bestCorrelation = normalizedCorr;
        bestPeriod = period;
      }
    }

    return {
      period: bestPeriod,
      confidence: Math.max(0, bestCorrelation),
    };
  }

  /**
   * Convert frequency to MIDI note number
   */
  private frequencyToMIDI(frequency: number): MIDINote {
    const semitones = 12 * Math.log2(frequency / this.settings.tuning);
    return Math.round(69 + semitones) as MIDINote;
  }

  /**
   * Convert pitch events to note data
   */
  private pitchEventsToNotes(
    pitchEvents: PitchEvent[],
    onsets: OnsetEvent[],
    bpm: number
  ): MIDINoteData[] {
    if (pitchEvents.length === 0) return [];

    const notes: MIDINoteData[] = [];
    let currentNote: { start: number; note: MIDINote; velocity: number } | null = null;

    for (let i = 0; i < pitchEvents.length; i++) {
      const event = pitchEvents[i];
      const midiNote = this.frequencyToMIDI(event.frequency);
      const velocity = Math.round(event.amplitude * 127) as MIDIVelocity;

      // Check if this is a new note
      const isNewNote =
        currentNote === null ||
        midiNote !== currentNote.note ||
        this.hasOnsetBetween(onsets, currentNote.start, event.time);

      if (isNewNote) {
        // End previous note
        if (currentNote !== null) {
          const duration = event.time - currentNote.start;
          if (duration >= this.settings.minNoteLength) {
            notes.push({
              id: generateId(),
              note: currentNote.note,
              velocity: currentNote.velocity as MIDIVelocity,
              start: secondsToBeats(currentNote.start, bpm),
              duration: secondsToBeats(duration, bpm),
            });
          }
        }

        // Start new note
        currentNote = {
          start: event.time,
          note: midiNote,
          velocity: Math.min(127, Math.max(1, velocity)),
        };
      }
    }

    // Add final note
    if (currentNote !== null && pitchEvents.length > 0) {
      const lastTime = pitchEvents[pitchEvents.length - 1].time;
      const duration = lastTime - currentNote.start + 0.1; // Add small duration for last note

      if (duration >= this.settings.minNoteLength) {
        notes.push({
          id: generateId(),
          note: currentNote.note,
          velocity: currentNote.velocity as MIDIVelocity,
          start: secondsToBeats(currentNote.start, bpm),
          duration: secondsToBeats(duration, bpm),
        });
      }
    }

    return notes;
  }

  // =========================================================================
  // Harmony Conversion (Polyphonic)
  // =========================================================================

  private convertHarmony(buffer: AudioBuffer, bpm: number): MIDINoteData[] {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // For polyphonic, we use spectral analysis
    const frameSize = 4096;
    const hopSize = 1024;
    const notes: MIDINoteData[] = [];

    // Simple spectral peak detection
    for (let i = 0; i < data.length - frameSize; i += hopSize) {
      const frame = data.slice(i, i + frameSize);
      const spectrum = this.computeMagnitudeSpectrum(frame);
      const peaks = this.findSpectralPeaks(spectrum, sampleRate / frameSize);

      const time = i / sampleRate;

      for (const peak of peaks) {
        if (
          peak.frequency >= this.settings.minFrequency &&
          peak.frequency <= this.settings.maxFrequency
        ) {
          const midiNote = this.frequencyToMIDI(peak.frequency);
          const velocity = Math.round(peak.magnitude * 127) as MIDIVelocity;

          // Check if this note already exists at this time
          const existingNote = notes.find(
            (n) =>
              n.note === midiNote &&
              Math.abs(secondsToBeats(time, bpm) - n.start) < 0.1
          );

          if (!existingNote) {
            notes.push({
              id: generateId(),
              note: midiNote,
              velocity: Math.min(127, Math.max(1, velocity)),
              start: secondsToBeats(time, bpm),
              duration: secondsToBeats(hopSize / sampleRate, bpm),
            });
          }
        }
      }
    }

    // Merge adjacent notes of same pitch
    return this.mergeAdjacentNotes(notes);
  }

  /**
   * Simple DFT for magnitude spectrum (would use FFT in production)
   */
  private computeMagnitudeSpectrum(frame: Float32Array): Float32Array {
    const N = frame.length;
    const spectrum = new Float32Array(N / 2);

    // Apply Hann window
    const windowed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      windowed[i] = frame[i] * window;
    }

    // Simple DFT (would use FFT for performance)
    for (let k = 0; k < N / 2; k++) {
      let real = 0;
      let imag = 0;

      for (let n = 0; n < N; n++) {
        const angle = (-2 * Math.PI * k * n) / N;
        real += windowed[n] * Math.cos(angle);
        imag += windowed[n] * Math.sin(angle);
      }

      spectrum[k] = Math.sqrt(real * real + imag * imag) / N;
    }

    return spectrum;
  }

  /**
   * Find peaks in spectrum
   */
  private findSpectralPeaks(
    spectrum: Float32Array,
    frequencyResolution: number
  ): Array<{ frequency: number; magnitude: number }> {
    const peaks: Array<{ frequency: number; magnitude: number }> = [];
    const threshold = 0.01 * this.settings.sensitivity;

    for (let i = 2; i < spectrum.length - 2; i++) {
      const mag = spectrum[i];

      // Check if local maximum
      if (
        mag > threshold &&
        mag > spectrum[i - 1] &&
        mag > spectrum[i + 1] &&
        mag > spectrum[i - 2] &&
        mag > spectrum[i + 2]
      ) {
        peaks.push({
          frequency: i * frequencyResolution,
          magnitude: mag,
        });
      }
    }

    // Sort by magnitude and return top peaks
    return peaks.sort((a, b) => b.magnitude - a.magnitude).slice(0, 8);
  }

  /**
   * Merge adjacent notes of same pitch
   */
  private mergeAdjacentNotes(notes: MIDINoteData[]): MIDINoteData[] {
    if (notes.length === 0) return [];

    // Sort by note then by start time
    notes.sort((a, b) => {
      if (a.note !== b.note) return a.note - b.note;
      return a.start - b.start;
    });

    const merged: MIDINoteData[] = [];
    let current = { ...notes[0] };

    for (let i = 1; i < notes.length; i++) {
      const note = notes[i];

      if (
        note.note === current.note &&
        note.start <= current.start + current.duration + 0.05
      ) {
        // Merge - extend duration
        current.duration = Math.max(
          current.duration,
          note.start + note.duration - current.start
        );
        current.velocity = Math.max(current.velocity, note.velocity);
      } else {
        merged.push(current);
        current = { ...note };
      }
    }

    merged.push(current);

    // Resort by start time
    return merged.sort((a, b) => a.start - b.start);
  }

  // =========================================================================
  // Drums Conversion
  // =========================================================================

  private convertDrums(buffer: AudioBuffer, bpm: number): MIDINoteData[] {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    // Detect onsets
    const onsets = this.detectOnsets(data, sampleRate);

    // For each onset, classify the drum type based on frequency content
    const notes: MIDINoteData[] = [];

    for (const onset of onsets) {
      const sampleStart = Math.floor(onset.time * sampleRate);
      const sampleEnd = Math.min(sampleStart + 4096, data.length);
      const frame = data.slice(sampleStart, sampleEnd);

      // Classify drum type based on spectral centroid
      const centroid = this.computeSpectralCentroid(frame, sampleRate);
      const midiNote = this.classifyDrum(centroid);
      const velocity = Math.round(onset.strength * 127) as MIDIVelocity;

      notes.push({
        id: generateId(),
        note: midiNote,
        velocity: Math.min(127, Math.max(1, velocity)),
        start: secondsToBeats(onset.time, bpm),
        duration: 0.25, // Fixed short duration for drum hits
      });
    }

    return notes;
  }

  /**
   * Compute spectral centroid for drum classification
   */
  private computeSpectralCentroid(
    frame: Float32Array,
    sampleRate: number
  ): number {
    const spectrum = this.computeMagnitudeSpectrum(frame);
    const frequencyResolution = sampleRate / frame.length;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < spectrum.length; i++) {
      const frequency = i * frequencyResolution;
      numerator += frequency * spectrum[i];
      denominator += spectrum[i];
    }

    return denominator > 0 ? numerator / denominator : 0;
  }

  /**
   * Classify drum based on spectral centroid
   */
  private classifyDrum(centroid: number): MIDINote {
    // General MIDI drum map
    if (centroid < 150) {
      return 36 as MIDINote; // Kick
    } else if (centroid < 500) {
      return 38 as MIDINote; // Snare
    } else if (centroid < 1500) {
      return 42 as MIDINote; // Closed hi-hat
    } else {
      return 46 as MIDINote; // Open hi-hat
    }
  }

  // =========================================================================
  // Onset Detection
  // =========================================================================

  private detectOnsets(data: Float32Array, sampleRate: number): OnsetEvent[] {
    const onsets: OnsetEvent[] = [];
    const frameSize = 512;
    const hopSize = 128;
    const threshold = 0.05 * this.settings.sensitivity;

    let previousEnergy = 0;
    let previousFlux = 0;
    let lastOnsetFrame = -1000;
    const minFramesBetween = Math.floor((0.05 * sampleRate) / hopSize); // 50ms minimum

    for (let i = 0; i < data.length - frameSize; i += hopSize) {
      // Calculate energy
      let energy = 0;
      for (let j = 0; j < frameSize; j++) {
        energy += data[i + j] * data[i + j];
      }
      energy = Math.sqrt(energy / frameSize);

      // Spectral flux
      const flux = Math.max(0, energy - previousEnergy);
      const fluxDerivative = flux - previousFlux;

      const frameIndex = Math.floor(i / hopSize);

      // Detect onset when flux derivative is positive and above threshold
      if (
        fluxDerivative > threshold &&
        flux > threshold &&
        frameIndex - lastOnsetFrame > minFramesBetween
      ) {
        onsets.push({
          time: i / sampleRate,
          strength: Math.min(1, flux * 10),
        });
        lastOnsetFrame = frameIndex;
      }

      previousEnergy = energy;
      previousFlux = flux;
    }

    return onsets;
  }

  /**
   * Check if there's an onset between two times
   */
  private hasOnsetBetween(
    onsets: OnsetEvent[],
    startTime: number,
    endTime: number
  ): boolean {
    return onsets.some(
      (o) => o.time > startTime + 0.02 && o.time < endTime
    );
  }
}
