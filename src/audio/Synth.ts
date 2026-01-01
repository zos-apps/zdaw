/**
 * Synth - Polyphonic synthesizer for zDAW
 *
 * Features:
 * - Multiple oscillator types (sine, square, saw, triangle)
 * - Dual oscillators with detune
 * - ADSR amplitude envelope
 * - Filter with resonance and envelope
 * - Polyphonic voice management
 */

import type {
  MIDINote,
  MIDIVelocity,
  OscillatorType,
  ADSREnvelope,
  FilterType,
  SynthPatch,
  SynthVoice,
} from '../types';
import { noteToFrequency, generateId } from '../types';

/** Active synth voice */
interface ActiveVoice {
  id: string;
  note: MIDINote;
  velocity: MIDIVelocity;
  oscillators: OscillatorNode[];
  gains: GainNode[];
  filter: BiquadFilterNode;
  envelope: GainNode;
  filterEnvelope: GainNode;
  startTime: number;
  released: boolean;
  releaseTime: number;
}

/** Synth configuration */
interface SynthConfig {
  polyphony?: number;
}

/** Default patch */
const DEFAULT_PATCH: SynthPatch = {
  id: 'default',
  name: 'Init Patch',
  voices: [
    {
      oscillator: 'sawtooth',
      detune: 0,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
      filter: {
        type: 'lowpass',
        frequency: 2000,
        resonance: 1,
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.3, release: 0.3 },
        envelopeAmount: 2000,
      },
      gain: 0.3,
    },
  ],
  polyphony: 8,
  portamento: 0,
};

/**
 * Polyphonic synthesizer
 */
export class Synth {
  private context: AudioContext;
  private output: GainNode;
  private patch: SynthPatch;
  private activeVoices: Map<string, ActiveVoice> = new Map();
  private polyphony: number;
  private masterGain: number = 0.5;

  constructor(context: AudioContext, config: SynthConfig = {}) {
    this.context = context;
    this.polyphony = config.polyphony ?? 8;
    this.output = context.createGain();
    this.output.gain.value = this.masterGain;
    this.patch = { ...DEFAULT_PATCH };
  }

  /**
   * Get output node
   */
  getOutput(): GainNode {
    return this.output;
  }

  /**
   * Load a patch
   */
  loadPatch(patch: SynthPatch): void {
    this.patch = { ...patch };
    this.polyphony = patch.polyphony;
  }

  /**
   * Get current patch
   */
  getPatch(): SynthPatch {
    return { ...this.patch };
  }

  /**
   * Set oscillator type
   */
  setOscillatorType(voiceIndex: number, type: OscillatorType): void {
    if (this.patch.voices[voiceIndex]) {
      this.patch.voices[voiceIndex].oscillator = type;
    }
  }

  /**
   * Set filter parameters
   */
  setFilter(
    voiceIndex: number,
    params: Partial<SynthVoice['filter']>
  ): void {
    if (this.patch.voices[voiceIndex]) {
      Object.assign(this.patch.voices[voiceIndex].filter, params);
    }
  }

  /**
   * Set envelope parameters
   */
  setEnvelope(voiceIndex: number, params: Partial<ADSREnvelope>): void {
    if (this.patch.voices[voiceIndex]) {
      Object.assign(this.patch.voices[voiceIndex].envelope, params);
    }
  }

  /**
   * Start a note
   */
  noteOn(note: MIDINote, velocity: MIDIVelocity = 100): string {
    // Voice stealing if at limit
    if (this.activeVoices.size >= this.polyphony) {
      this.stealVoice();
    }

    const now = this.context.currentTime;
    const voiceId = generateId();
    const freq = noteToFrequency(note);
    const velocityScale = velocity / 127;

    const oscillators: OscillatorNode[] = [];
    const gains: GainNode[] = [];

    // Create envelope gain
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0, now);

    // Create filter
    const filter = this.context.createBiquadFilter();
    filter.type = this.patch.voices[0]?.filter.type ?? 'lowpass';
    filter.frequency.value = this.patch.voices[0]?.filter.frequency ?? 2000;
    filter.Q.value = this.patch.voices[0]?.filter.resonance ?? 1;

    // Filter envelope modulation gain
    const filterEnvelope = this.context.createGain();
    filterEnvelope.gain.value = 0;

    // Create oscillators for each voice configuration
    for (const voiceConfig of this.patch.voices) {
      const osc = this.context.createOscillator();
      osc.type = voiceConfig.oscillator;
      osc.frequency.value = freq;
      osc.detune.value = voiceConfig.detune;

      const oscGain = this.context.createGain();
      oscGain.gain.value = voiceConfig.gain * velocityScale;

      osc.connect(oscGain);
      oscGain.connect(filter);

      oscillators.push(osc);
      gains.push(oscGain);

      osc.start(now);
    }

    // Connect filter -> envelope -> output
    filter.connect(envelope);
    envelope.connect(this.output);

    // Apply amplitude envelope
    const ampEnv = this.patch.voices[0]?.envelope ?? DEFAULT_PATCH.voices[0].envelope;
    envelope.gain.linearRampToValueAtTime(1, now + ampEnv.attack);
    envelope.gain.linearRampToValueAtTime(
      ampEnv.sustain,
      now + ampEnv.attack + ampEnv.decay
    );

    // Apply filter envelope
    const filterConfig = this.patch.voices[0]?.filter ?? DEFAULT_PATCH.voices[0].filter;
    const filterEnv = filterConfig.envelope;
    const baseFreq = filterConfig.frequency;
    const envAmount = filterConfig.envelopeAmount;

    filter.frequency.setValueAtTime(baseFreq, now);
    filter.frequency.linearRampToValueAtTime(
      baseFreq + envAmount * velocityScale,
      now + filterEnv.attack
    );
    filter.frequency.linearRampToValueAtTime(
      baseFreq + envAmount * velocityScale * filterEnv.sustain,
      now + filterEnv.attack + filterEnv.decay
    );

    // Track voice
    const voice: ActiveVoice = {
      id: voiceId,
      note,
      velocity,
      oscillators,
      gains,
      filter,
      envelope,
      filterEnvelope,
      startTime: now,
      released: false,
      releaseTime: 0,
    };
    this.activeVoices.set(voiceId, voice);

    return voiceId;
  }

  /**
   * Release a note
   */
  noteOff(note: MIDINote): void {
    const now = this.context.currentTime;

    for (const [id, voice] of this.activeVoices) {
      if (voice.note === note && !voice.released) {
        this.releaseVoice(voice);
      }
    }
  }

  /**
   * Release a specific voice
   */
  private releaseVoice(voice: ActiveVoice): void {
    const now = this.context.currentTime;
    voice.released = true;
    voice.releaseTime = now;

    const ampEnv = this.patch.voices[0]?.envelope ?? DEFAULT_PATCH.voices[0].envelope;
    const filterEnv = this.patch.voices[0]?.filter.envelope ?? DEFAULT_PATCH.voices[0].filter.envelope;
    const filterConfig = this.patch.voices[0]?.filter ?? DEFAULT_PATCH.voices[0].filter;

    // Amplitude release
    const currentGain = voice.envelope.gain.value;
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(currentGain, now);
    voice.envelope.gain.linearRampToValueAtTime(0, now + ampEnv.release);

    // Filter release
    const currentFreq = voice.filter.frequency.value;
    voice.filter.frequency.cancelScheduledValues(now);
    voice.filter.frequency.setValueAtTime(currentFreq, now);
    voice.filter.frequency.linearRampToValueAtTime(
      filterConfig.frequency,
      now + filterEnv.release
    );

    // Stop oscillators after release
    const stopTime = now + ampEnv.release + 0.01;
    for (const osc of voice.oscillators) {
      osc.stop(stopTime);
    }

    // Clean up after stop
    setTimeout(() => {
      voice.envelope.disconnect();
      voice.filter.disconnect();
      for (const gain of voice.gains) {
        gain.disconnect();
      }
      this.activeVoices.delete(voice.id);
    }, (ampEnv.release + 0.02) * 1000);
  }

  /**
   * Release all notes
   */
  allNotesOff(): void {
    for (const [id, voice] of this.activeVoices) {
      if (!voice.released) {
        this.releaseVoice(voice);
      }
    }
  }

  /**
   * Steal oldest voice
   */
  private stealVoice(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, voice] of this.activeVoices) {
      if (voice.startTime < oldestTime) {
        oldestTime = voice.startTime;
        oldestId = id;
      }
    }

    if (oldestId) {
      const voice = this.activeVoices.get(oldestId)!;
      const now = this.context.currentTime;

      // Quick fade out
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setValueAtTime(voice.envelope.gain.value, now);
      voice.envelope.gain.linearRampToValueAtTime(0, now + 0.01);

      for (const osc of voice.oscillators) {
        osc.stop(now + 0.02);
      }

      setTimeout(() => {
        voice.envelope.disconnect();
        voice.filter.disconnect();
        for (const gain of voice.gains) {
          gain.disconnect();
        }
        this.activeVoices.delete(oldestId!);
      }, 30);
    }
  }

  /**
   * Set master gain
   */
  setMasterGain(gain: number): void {
    this.masterGain = gain;
    this.output.gain.setValueAtTime(gain, this.context.currentTime);
  }

  /**
   * Get active voice count
   */
  getVoiceCount(): number {
    return this.activeVoices.size;
  }

  /**
   * Get currently playing notes
   */
  getActiveNotes(): MIDINote[] {
    return Array.from(this.activeVoices.values())
      .filter(v => !v.released)
      .map(v => v.note);
  }

  /**
   * Destroy synth
   */
  destroy(): void {
    this.allNotesOff();
    // Wait for voices to clean up
    setTimeout(() => {
      this.output.disconnect();
    }, 500);
  }
}

// ============================================================================
// Preset Patches
// ============================================================================

export const SYNTH_PRESETS: SynthPatch[] = [
  {
    id: 'init',
    name: 'Init Patch',
    voices: [
      {
        oscillator: 'sawtooth',
        detune: 0,
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
        filter: {
          type: 'lowpass',
          frequency: 2000,
          resonance: 1,
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3 },
          envelopeAmount: 3000,
        },
        gain: 0.3,
      },
    ],
    polyphony: 8,
    portamento: 0,
  },
  {
    id: 'supersaw',
    name: 'Super Saw',
    voices: [
      {
        oscillator: 'sawtooth',
        detune: -12,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
        filter: {
          type: 'lowpass',
          frequency: 4000,
          resonance: 0.5,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 },
          envelopeAmount: 2000,
        },
        gain: 0.2,
      },
      {
        oscillator: 'sawtooth',
        detune: 0,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
        filter: {
          type: 'lowpass',
          frequency: 4000,
          resonance: 0.5,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 },
          envelopeAmount: 2000,
        },
        gain: 0.2,
      },
      {
        oscillator: 'sawtooth',
        detune: 12,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2 },
        filter: {
          type: 'lowpass',
          frequency: 4000,
          resonance: 0.5,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 },
          envelopeAmount: 2000,
        },
        gain: 0.2,
      },
    ],
    polyphony: 6,
    portamento: 0,
  },
  {
    id: 'pad',
    name: 'Soft Pad',
    voices: [
      {
        oscillator: 'sine',
        detune: -5,
        envelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 1 },
        filter: {
          type: 'lowpass',
          frequency: 1500,
          resonance: 0.3,
          envelope: { attack: 0.5, decay: 0.5, sustain: 0.3, release: 1 },
          envelopeAmount: 1000,
        },
        gain: 0.25,
      },
      {
        oscillator: 'triangle',
        detune: 5,
        envelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 1 },
        filter: {
          type: 'lowpass',
          frequency: 1500,
          resonance: 0.3,
          envelope: { attack: 0.5, decay: 0.5, sustain: 0.3, release: 1 },
          envelopeAmount: 1000,
        },
        gain: 0.25,
      },
    ],
    polyphony: 8,
    portamento: 0.05,
  },
  {
    id: 'bass',
    name: 'Mono Bass',
    voices: [
      {
        oscillator: 'square',
        detune: 0,
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.1 },
        filter: {
          type: 'lowpass',
          frequency: 300,
          resonance: 3,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.1 },
          envelopeAmount: 2000,
        },
        gain: 0.4,
      },
    ],
    polyphony: 1,
    portamento: 0.02,
  },
  {
    id: 'pluck',
    name: 'Pluck',
    voices: [
      {
        oscillator: 'sawtooth',
        detune: 0,
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
        filter: {
          type: 'lowpass',
          frequency: 500,
          resonance: 2,
          envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
          envelopeAmount: 8000,
        },
        gain: 0.35,
      },
    ],
    polyphony: 8,
    portamento: 0,
  },
  {
    id: 'lead',
    name: 'Lead',
    voices: [
      {
        oscillator: 'square',
        detune: 0,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.2 },
        filter: {
          type: 'lowpass',
          frequency: 2000,
          resonance: 4,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2 },
          envelopeAmount: 3000,
        },
        gain: 0.25,
      },
      {
        oscillator: 'sawtooth',
        detune: 7,
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.2 },
        filter: {
          type: 'lowpass',
          frequency: 2000,
          resonance: 4,
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2 },
          envelopeAmount: 3000,
        },
        gain: 0.2,
      },
    ],
    polyphony: 4,
    portamento: 0.01,
  },
];
