/**
 * Sampler - Sample playback instrument for zDAW
 *
 * Supports multi-sample instruments with velocity layers,
 * key zones, ADSR envelopes, and loop points.
 */

import type {
  MIDINote,
  MIDIVelocity,
  SampleZone,
  SamplerInstrument,
  ADSREnvelope,
  Seconds,
} from '../types';
import { noteToFrequency, generateId } from '../types';

/** Active voice state */
interface SamplerVoice {
  note: MIDINote;
  velocity: MIDIVelocity;
  source: AudioBufferSourceNode;
  envelope: GainNode;
  startTime: number;
  zone: SampleZone;
  released: boolean;
}

/** Sampler configuration */
interface SamplerConfig {
  polyphony?: number;
}

/**
 * Sampler instrument
 */
export class Sampler {
  private context: AudioContext;
  private output: GainNode;
  private samples: Map<string, AudioBuffer> = new Map();
  private zones: SampleZone[] = [];
  private voices: Map<string, SamplerVoice> = new Map();
  private polyphony: number;
  private gain: number = 1;

  constructor(context: AudioContext, config: SamplerConfig = {}) {
    this.context = context;
    this.polyphony = config.polyphony ?? 16;
    this.output = context.createGain();
  }

  /**
   * Get output node
   */
  getOutput(): GainNode {
    return this.output;
  }

  /**
   * Load a sample buffer
   */
  loadSample(id: string, buffer: AudioBuffer): void {
    this.samples.set(id, buffer);
  }

  /**
   * Add a sample zone
   */
  addZone(zone: SampleZone): void {
    this.zones.push(zone);
  }

  /**
   * Clear all zones
   */
  clearZones(): void {
    this.zones = [];
  }

  /**
   * Load an instrument preset
   */
  loadInstrument(instrument: SamplerInstrument): void {
    this.zones = [...instrument.zones];
    this.polyphony = instrument.polyphony;
  }

  /**
   * Find matching zone for note and velocity
   */
  private findZone(note: MIDINote, velocity: MIDIVelocity): SampleZone | null {
    for (const zone of this.zones) {
      if (
        note >= zone.lowNote &&
        note <= zone.highNote &&
        velocity >= zone.lowVelocity &&
        velocity <= zone.highVelocity
      ) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Start a note
   */
  noteOn(note: MIDINote, velocity: MIDIVelocity): string | null {
    const zone = this.findZone(note, velocity);
    if (!zone) return null;

    const sample = this.samples.get(zone.sampleId);
    if (!sample) return null;

    // Voice stealing if at polyphony limit
    if (this.voices.size >= this.polyphony) {
      this.stealVoice();
    }

    const now = this.context.currentTime;
    const voiceId = generateId();

    // Create source
    const source = this.context.createBufferSource();
    source.buffer = sample;

    // Calculate playback rate for pitch
    const semitones = note - zone.rootNote + zone.tune;
    source.playbackRate.value = Math.pow(2, semitones / 12);

    // Apply loop if configured
    if (zone.loop?.enabled) {
      source.loop = true;
      source.loopStart = zone.loop.start / sample.sampleRate;
      source.loopEnd = zone.loop.end / sample.sampleRate;
    }

    // Create envelope
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0, now);

    // Apply ADSR attack
    const env = zone.envelope;
    const velocityGain = (velocity / 127) * zone.gain;
    envelope.gain.linearRampToValueAtTime(velocityGain, now + env.attack);

    // Decay to sustain
    envelope.gain.linearRampToValueAtTime(
      velocityGain * env.sustain,
      now + env.attack + env.decay
    );

    // Pan
    const panner = this.context.createStereoPanner();
    panner.pan.value = zone.pan;

    // Connect: source -> envelope -> panner -> output
    source.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.output);

    source.start(now);

    // Track voice
    const voice: SamplerVoice = {
      note,
      velocity,
      source,
      envelope,
      startTime: now,
      zone,
      released: false,
    };
    this.voices.set(voiceId, voice);

    // Clean up when source ends
    source.onended = () => {
      panner.disconnect();
      envelope.disconnect();
      this.voices.delete(voiceId);
    };

    return voiceId;
  }

  /**
   * Release a note
   */
  noteOff(note: MIDINote): void {
    const now = this.context.currentTime;

    // Find and release all voices for this note
    for (const [id, voice] of this.voices) {
      if (voice.note === note && !voice.released) {
        voice.released = true;

        const env = voice.zone.envelope;
        const currentGain = voice.envelope.gain.value;

        // Cancel scheduled values and do release
        voice.envelope.gain.cancelScheduledValues(now);
        voice.envelope.gain.setValueAtTime(currentGain, now);
        voice.envelope.gain.linearRampToValueAtTime(0, now + env.release);

        // Stop source after release
        voice.source.stop(now + env.release + 0.01);
      }
    }
  }

  /**
   * Release all notes
   */
  allNotesOff(): void {
    const now = this.context.currentTime;

    for (const [id, voice] of this.voices) {
      if (!voice.released) {
        voice.released = true;
        voice.envelope.gain.cancelScheduledValues(now);
        voice.envelope.gain.setValueAtTime(voice.envelope.gain.value, now);
        voice.envelope.gain.linearRampToValueAtTime(0, now + 0.05);
        voice.source.stop(now + 0.06);
      }
    }
  }

  /**
   * Steal oldest voice
   */
  private stealVoice(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, voice] of this.voices) {
      if (voice.startTime < oldestTime) {
        oldestTime = voice.startTime;
        oldestId = id;
      }
    }

    if (oldestId) {
      const voice = this.voices.get(oldestId)!;
      const now = this.context.currentTime;

      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setValueAtTime(voice.envelope.gain.value, now);
      voice.envelope.gain.linearRampToValueAtTime(0, now + 0.01);
      voice.source.stop(now + 0.02);

      this.voices.delete(oldestId);
    }
  }

  /**
   * Set output gain
   */
  setGain(gain: number): void {
    this.gain = gain;
    this.output.gain.setValueAtTime(gain, this.context.currentTime);
  }

  /**
   * Get active voice count
   */
  getVoiceCount(): number {
    return this.voices.size;
  }

  /**
   * Destroy sampler
   */
  destroy(): void {
    this.allNotesOff();
    this.output.disconnect();
    this.samples.clear();
    this.zones = [];
  }
}

/**
 * Create a basic GM-style piano sampler
 * (In production, this would load actual samples)
 */
export function createBasicPiano(context: AudioContext): Sampler {
  const sampler = new Sampler(context, { polyphony: 32 });

  // Generate simple synthetic piano-like samples for each octave
  for (let octave = 0; octave <= 8; octave++) {
    const rootNote = (octave * 12 + 60) as MIDINote; // C of each octave

    // Create a synthetic "piano" buffer
    const buffer = generatePianoBuffer(context, rootNote);
    const sampleId = `piano-${octave}`;
    sampler.loadSample(sampleId, buffer);

    // Create zone spanning the octave
    const zone: SampleZone = {
      id: generateId(),
      sampleId,
      rootNote,
      lowNote: (octave * 12) as MIDINote,
      highNote: ((octave + 1) * 12 - 1) as MIDINote,
      lowVelocity: 1 as MIDIVelocity,
      highVelocity: 127 as MIDIVelocity,
      tune: 0,
      pan: 0,
      gain: 0.7,
      envelope: {
        attack: 0.005,
        decay: 0.5,
        sustain: 0.3,
        release: 0.3,
      },
    };

    sampler.addZone(zone);
  }

  return sampler;
}

/**
 * Generate a synthetic piano-like buffer
 */
function generatePianoBuffer(context: AudioContext, note: MIDINote): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 3; // 3 seconds
  const length = sampleRate * duration;
  const buffer = context.createBuffer(2, length, sampleRate);
  const freq = noteToFrequency(note);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 2);

      // Multiple harmonics with decay
      let sample = 0;
      sample += Math.sin(2 * Math.PI * freq * t) * 0.5;
      sample += Math.sin(2 * Math.PI * freq * 2 * t) * 0.3 * Math.exp(-t * 4);
      sample += Math.sin(2 * Math.PI * freq * 3 * t) * 0.2 * Math.exp(-t * 6);
      sample += Math.sin(2 * Math.PI * freq * 4 * t) * 0.1 * Math.exp(-t * 8);
      sample += Math.sin(2 * Math.PI * freq * 5 * t) * 0.05 * Math.exp(-t * 10);

      // Add slight attack transient
      const attack = 1 - Math.exp(-t * 100);

      data[i] = sample * envelope * attack;
    }
  }

  return buffer;
}
