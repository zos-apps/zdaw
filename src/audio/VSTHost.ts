/**
 * VSTHost - AudioWorklet-based plugin host for zDAW
 *
 * Provides a plugin architecture using Web Audio API nodes.
 * Built-in effects: EQ, Compressor, Reverb, Delay, Filter, Gain, Limiter
 */

import type { PluginDefinition, PluginParameter, PluginType } from '../types';

/**
 * Plugin node interface
 */
export interface PluginNode {
  getInput(): AudioNode;
  getOutput(): AudioNode;
  setParameter(id: string, value: number): void;
  getParameter(id: string): number;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  destroy(): void;
}

/**
 * Base class for native Web Audio plugins
 */
abstract class NativePlugin implements PluginNode {
  protected context: AudioContext;
  protected inputGain: GainNode;
  protected outputGain: GainNode;
  protected bypassGain: GainNode;
  protected enabled: boolean = true;
  protected parameters: Map<string, number> = new Map();

  constructor(context: AudioContext) {
    this.context = context;
    this.inputGain = context.createGain();
    this.outputGain = context.createGain();
    this.bypassGain = context.createGain();
    this.bypassGain.gain.value = 0;

    // Bypass routing
    this.inputGain.connect(this.bypassGain);
    this.bypassGain.connect(this.outputGain);
  }

  getInput(): AudioNode {
    return this.inputGain;
  }

  getOutput(): AudioNode {
    return this.outputGain;
  }

  setParameter(id: string, value: number): void {
    this.parameters.set(id, value);
    this.applyParameter(id, value);
  }

  getParameter(id: string): number {
    return this.parameters.get(id) ?? 0;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const now = this.context.currentTime;
    if (enabled) {
      this.bypassGain.gain.setValueAtTime(0, now);
    } else {
      this.bypassGain.gain.setValueAtTime(1, now);
    }
    this.onEnableChange(enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  protected abstract applyParameter(id: string, value: number): void;
  protected onEnableChange(enabled: boolean): void {}

  destroy(): void {
    this.inputGain.disconnect();
    this.outputGain.disconnect();
    this.bypassGain.disconnect();
  }
}

// ============================================================================
// Built-in Effects
// ============================================================================

/**
 * 3-Band EQ
 */
class EQPlugin extends NativePlugin {
  private lowShelf: BiquadFilterNode;
  private midPeak: BiquadFilterNode;
  private highShelf: BiquadFilterNode;

  constructor(context: AudioContext) {
    super(context);

    this.lowShelf = context.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 320;

    this.midPeak = context.createBiquadFilter();
    this.midPeak.type = 'peaking';
    this.midPeak.frequency.value = 1000;
    this.midPeak.Q.value = 1;

    this.highShelf = context.createBiquadFilter();
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 3200;

    // Connect chain
    this.inputGain.connect(this.lowShelf);
    this.lowShelf.connect(this.midPeak);
    this.midPeak.connect(this.highShelf);
    this.highShelf.connect(this.outputGain);

    // Set defaults
    this.setParameter('lowGain', 0);
    this.setParameter('midGain', 0);
    this.setParameter('highGain', 0);
    this.setParameter('lowFreq', 320);
    this.setParameter('midFreq', 1000);
    this.setParameter('highFreq', 3200);
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'lowGain':
        this.lowShelf.gain.setValueAtTime(value, now);
        break;
      case 'midGain':
        this.midPeak.gain.setValueAtTime(value, now);
        break;
      case 'highGain':
        this.highShelf.gain.setValueAtTime(value, now);
        break;
      case 'lowFreq':
        this.lowShelf.frequency.setValueAtTime(value, now);
        break;
      case 'midFreq':
        this.midPeak.frequency.setValueAtTime(value, now);
        break;
      case 'highFreq':
        this.highShelf.frequency.setValueAtTime(value, now);
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.lowShelf.disconnect();
    this.midPeak.disconnect();
    this.highShelf.disconnect();
  }
}

/**
 * Dynamics Compressor
 */
class CompressorPlugin extends NativePlugin {
  private compressor: DynamicsCompressorNode;
  private makeupGain: GainNode;

  constructor(context: AudioContext) {
    super(context);

    this.compressor = context.createDynamicsCompressor();
    this.makeupGain = context.createGain();

    this.inputGain.connect(this.compressor);
    this.compressor.connect(this.makeupGain);
    this.makeupGain.connect(this.outputGain);

    // Set defaults
    this.setParameter('threshold', -24);
    this.setParameter('knee', 30);
    this.setParameter('ratio', 12);
    this.setParameter('attack', 0.003);
    this.setParameter('release', 0.25);
    this.setParameter('makeup', 0);
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'threshold':
        this.compressor.threshold.setValueAtTime(value, now);
        break;
      case 'knee':
        this.compressor.knee.setValueAtTime(value, now);
        break;
      case 'ratio':
        this.compressor.ratio.setValueAtTime(value, now);
        break;
      case 'attack':
        this.compressor.attack.setValueAtTime(value, now);
        break;
      case 'release':
        this.compressor.release.setValueAtTime(value, now);
        break;
      case 'makeup':
        this.makeupGain.gain.setValueAtTime(Math.pow(10, value / 20), now);
        break;
    }
  }

  getReduction(): number {
    return this.compressor.reduction;
  }

  destroy(): void {
    super.destroy();
    this.compressor.disconnect();
    this.makeupGain.disconnect();
  }
}

/**
 * Reverb using ConvolverNode (algorithmic IR)
 */
class ReverbPlugin extends NativePlugin {
  private convolver: ConvolverNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private irGenerated: boolean = false;

  constructor(context: AudioContext) {
    super(context);

    this.convolver = context.createConvolver();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();

    // Parallel dry/wet routing
    this.inputGain.connect(this.dryGain);
    this.inputGain.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);

    // Set defaults
    this.setParameter('decay', 2);
    this.setParameter('mix', 0.3);
    this.setParameter('predelay', 0);

    // Generate IR
    this.generateIR(2);
  }

  private generateIR(decay: number): void {
    const sampleRate = this.context.sampleRate;
    const length = sampleRate * Math.min(decay, 5);
    const impulse = this.context.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        // Exponential decay with noise
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }

    this.convolver.buffer = impulse;
    this.irGenerated = true;
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'decay':
        if (this.irGenerated) {
          this.generateIR(value);
        }
        break;
      case 'mix':
        this.dryGain.gain.setValueAtTime(1 - value, now);
        this.wetGain.gain.setValueAtTime(value, now);
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.convolver.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
  }
}

/**
 * Stereo Delay
 */
class DelayPlugin extends NativePlugin {
  private delayL: DelayNode;
  private delayR: DelayNode;
  private feedbackL: GainNode;
  private feedbackR: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;

  constructor(context: AudioContext) {
    super(context);

    this.delayL = context.createDelay(5);
    this.delayR = context.createDelay(5);
    this.feedbackL = context.createGain();
    this.feedbackR = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);

    // Dry path
    this.inputGain.connect(this.dryGain);
    this.dryGain.connect(this.outputGain);

    // Wet path with stereo delay
    this.inputGain.connect(this.splitter);
    this.splitter.connect(this.delayL, 0);
    this.splitter.connect(this.delayR, 1);

    // Feedback
    this.delayL.connect(this.feedbackL);
    this.feedbackL.connect(this.delayL);
    this.delayR.connect(this.feedbackR);
    this.feedbackR.connect(this.delayR);

    // Merge to wet output
    this.delayL.connect(this.merger, 0, 0);
    this.delayR.connect(this.merger, 0, 1);
    this.merger.connect(this.wetGain);
    this.wetGain.connect(this.outputGain);

    // Set defaults
    this.setParameter('timeL', 0.25);
    this.setParameter('timeR', 0.375);
    this.setParameter('feedback', 0.4);
    this.setParameter('mix', 0.3);
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'timeL':
        this.delayL.delayTime.setValueAtTime(value, now);
        break;
      case 'timeR':
        this.delayR.delayTime.setValueAtTime(value, now);
        break;
      case 'feedback':
        this.feedbackL.gain.setValueAtTime(value, now);
        this.feedbackR.gain.setValueAtTime(value, now);
        break;
      case 'mix':
        this.dryGain.gain.setValueAtTime(1 - value, now);
        this.wetGain.gain.setValueAtTime(value, now);
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.delayL.disconnect();
    this.delayR.disconnect();
    this.feedbackL.disconnect();
    this.feedbackR.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.splitter.disconnect();
    this.merger.disconnect();
  }
}

/**
 * Filter (LP/HP/BP)
 */
class FilterPlugin extends NativePlugin {
  private filter: BiquadFilterNode;

  constructor(context: AudioContext) {
    super(context);

    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';

    this.inputGain.connect(this.filter);
    this.filter.connect(this.outputGain);

    // Set defaults
    this.setParameter('frequency', 1000);
    this.setParameter('resonance', 1);
    this.setParameter('type', 0); // 0=LP, 1=HP, 2=BP
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'frequency':
        this.filter.frequency.setValueAtTime(value, now);
        break;
      case 'resonance':
        this.filter.Q.setValueAtTime(value, now);
        break;
      case 'type':
        const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass'];
        this.filter.type = types[Math.floor(value)] || 'lowpass';
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.filter.disconnect();
  }
}

/**
 * Simple Gain
 */
class GainPlugin extends NativePlugin {
  private gain: GainNode;

  constructor(context: AudioContext) {
    super(context);

    this.gain = context.createGain();
    this.inputGain.connect(this.gain);
    this.gain.connect(this.outputGain);

    this.setParameter('gain', 0);
  }

  protected applyParameter(id: string, value: number): void {
    if (id === 'gain') {
      const linear = Math.pow(10, value / 20);
      this.gain.gain.setValueAtTime(linear, this.context.currentTime);
    }
  }

  destroy(): void {
    super.destroy();
    this.gain.disconnect();
  }
}

/**
 * Limiter (using dynamics compressor with extreme settings)
 */
class LimiterPlugin extends NativePlugin {
  private limiter: DynamicsCompressorNode;

  constructor(context: AudioContext) {
    super(context);

    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;

    this.inputGain.connect(this.limiter);
    this.limiter.connect(this.outputGain);

    this.setParameter('ceiling', -0.3);
    this.setParameter('release', 0.1);
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'ceiling':
        this.limiter.threshold.setValueAtTime(value, now);
        break;
      case 'release':
        this.limiter.release.setValueAtTime(value, now);
        break;
    }
  }

  getReduction(): number {
    return this.limiter.reduction;
  }

  destroy(): void {
    super.destroy();
    this.limiter.disconnect();
  }
}

/**
 * Chorus effect
 */
class ChorusPlugin extends NativePlugin {
  private delayL: DelayNode;
  private delayR: DelayNode;
  private lfoL: OscillatorNode;
  private lfoR: OscillatorNode;
  private lfoGainL: GainNode;
  private lfoGainR: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;

  constructor(context: AudioContext) {
    super(context);

    this.delayL = context.createDelay(0.1);
    this.delayR = context.createDelay(0.1);
    this.delayL.delayTime.value = 0.02;
    this.delayR.delayTime.value = 0.022;

    this.lfoL = context.createOscillator();
    this.lfoR = context.createOscillator();
    this.lfoL.type = 'sine';
    this.lfoR.type = 'sine';
    this.lfoL.frequency.value = 0.5;
    this.lfoR.frequency.value = 0.55;

    this.lfoGainL = context.createGain();
    this.lfoGainR = context.createGain();
    this.lfoGainL.gain.value = 0.002;
    this.lfoGainR.gain.value = 0.002;

    this.dryGain = context.createGain();
    this.wetGain = context.createGain();

    // LFO modulation
    this.lfoL.connect(this.lfoGainL);
    this.lfoR.connect(this.lfoGainR);
    this.lfoGainL.connect(this.delayL.delayTime);
    this.lfoGainR.connect(this.delayR.delayTime);

    // Signal path
    this.inputGain.connect(this.dryGain);
    this.inputGain.connect(this.delayL);
    this.inputGain.connect(this.delayR);
    this.dryGain.connect(this.outputGain);
    this.delayL.connect(this.wetGain);
    this.delayR.connect(this.wetGain);
    this.wetGain.connect(this.outputGain);

    this.lfoL.start();
    this.lfoR.start();

    this.setParameter('rate', 0.5);
    this.setParameter('depth', 0.002);
    this.setParameter('mix', 0.5);
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'rate':
        this.lfoL.frequency.setValueAtTime(value, now);
        this.lfoR.frequency.setValueAtTime(value * 1.1, now);
        break;
      case 'depth':
        this.lfoGainL.gain.setValueAtTime(value, now);
        this.lfoGainR.gain.setValueAtTime(value, now);
        break;
      case 'mix':
        this.dryGain.gain.setValueAtTime(1 - value, now);
        this.wetGain.gain.setValueAtTime(value, now);
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.lfoL.stop();
    this.lfoR.stop();
    this.delayL.disconnect();
    this.delayR.disconnect();
    this.lfoL.disconnect();
    this.lfoR.disconnect();
    this.lfoGainL.disconnect();
    this.lfoGainR.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
  }
}

/**
 * Distortion/Overdrive
 */
class DistortionPlugin extends NativePlugin {
  private waveshaper: WaveShaperNode;
  private preGain: GainNode;
  private postGain: GainNode;
  private filter: BiquadFilterNode;

  constructor(context: AudioContext) {
    super(context);

    this.preGain = context.createGain();
    this.waveshaper = context.createWaveShaper();
    this.postGain = context.createGain();
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;

    this.inputGain.connect(this.preGain);
    this.preGain.connect(this.waveshaper);
    this.waveshaper.connect(this.filter);
    this.filter.connect(this.postGain);
    this.postGain.connect(this.outputGain);

    this.setParameter('drive', 1);
    this.setParameter('tone', 8000);
    this.setParameter('mix', 1);
  }

  private makeDistortionCurve(amount: number): Float32Array {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    const k = amount * 100;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  protected applyParameter(id: string, value: number): void {
    const now = this.context.currentTime;
    switch (id) {
      case 'drive':
        this.preGain.gain.setValueAtTime(value, now);
        this.waveshaper.curve = this.makeDistortionCurve(value);
        this.postGain.gain.setValueAtTime(1 / Math.max(value, 1), now);
        break;
      case 'tone':
        this.filter.frequency.setValueAtTime(value, now);
        break;
    }
  }

  destroy(): void {
    super.destroy();
    this.preGain.disconnect();
    this.waveshaper.disconnect();
    this.postGain.disconnect();
    this.filter.disconnect();
  }
}

// ============================================================================
// Plugin Definitions
// ============================================================================

export const BUILTIN_PLUGINS: PluginDefinition[] = [
  {
    id: 'eq',
    name: '3-Band EQ',
    type: 'eq',
    category: 'effect',
    parameters: [
      { id: 'lowGain', name: 'Low', value: 0, range: { min: -24, max: 24, default: 0 }, unit: 'dB' },
      { id: 'midGain', name: 'Mid', value: 0, range: { min: -24, max: 24, default: 0 }, unit: 'dB' },
      { id: 'highGain', name: 'High', value: 0, range: { min: -24, max: 24, default: 0 }, unit: 'dB' },
      { id: 'lowFreq', name: 'Low Freq', value: 320, range: { min: 20, max: 500, default: 320 }, unit: 'Hz' },
      { id: 'midFreq', name: 'Mid Freq', value: 1000, range: { min: 200, max: 5000, default: 1000 }, unit: 'Hz' },
      { id: 'highFreq', name: 'High Freq', value: 3200, range: { min: 1000, max: 16000, default: 3200 }, unit: 'Hz' },
    ],
  },
  {
    id: 'compressor',
    name: 'Compressor',
    type: 'compressor',
    category: 'effect',
    parameters: [
      { id: 'threshold', name: 'Threshold', value: -24, range: { min: -60, max: 0, default: -24 }, unit: 'dB' },
      { id: 'ratio', name: 'Ratio', value: 4, range: { min: 1, max: 20, default: 4 } },
      { id: 'attack', name: 'Attack', value: 0.003, range: { min: 0.001, max: 0.5, default: 0.003 }, unit: 's' },
      { id: 'release', name: 'Release', value: 0.25, range: { min: 0.01, max: 1, default: 0.25 }, unit: 's' },
      { id: 'knee', name: 'Knee', value: 30, range: { min: 0, max: 40, default: 30 }, unit: 'dB' },
      { id: 'makeup', name: 'Makeup', value: 0, range: { min: 0, max: 24, default: 0 }, unit: 'dB' },
    ],
  },
  {
    id: 'reverb',
    name: 'Reverb',
    type: 'reverb',
    category: 'effect',
    parameters: [
      { id: 'decay', name: 'Decay', value: 2, range: { min: 0.1, max: 5, default: 2 }, unit: 's' },
      { id: 'mix', name: 'Mix', value: 0.3, range: { min: 0, max: 1, default: 0.3 } },
      { id: 'predelay', name: 'Pre-delay', value: 0, range: { min: 0, max: 0.1, default: 0 }, unit: 's' },
    ],
  },
  {
    id: 'delay',
    name: 'Stereo Delay',
    type: 'delay',
    category: 'effect',
    parameters: [
      { id: 'timeL', name: 'Time L', value: 0.25, range: { min: 0.01, max: 2, default: 0.25 }, unit: 's' },
      { id: 'timeR', name: 'Time R', value: 0.375, range: { min: 0.01, max: 2, default: 0.375 }, unit: 's' },
      { id: 'feedback', name: 'Feedback', value: 0.4, range: { min: 0, max: 0.95, default: 0.4 } },
      { id: 'mix', name: 'Mix', value: 0.3, range: { min: 0, max: 1, default: 0.3 } },
    ],
  },
  {
    id: 'filter',
    name: 'Filter',
    type: 'filter',
    category: 'effect',
    parameters: [
      { id: 'type', name: 'Type', value: 0, range: { min: 0, max: 2, default: 0, step: 1 } },
      { id: 'frequency', name: 'Frequency', value: 1000, range: { min: 20, max: 20000, default: 1000 }, unit: 'Hz' },
      { id: 'resonance', name: 'Resonance', value: 1, range: { min: 0.1, max: 20, default: 1 } },
    ],
  },
  {
    id: 'gain',
    name: 'Utility Gain',
    type: 'gain',
    category: 'effect',
    parameters: [
      { id: 'gain', name: 'Gain', value: 0, range: { min: -24, max: 24, default: 0 }, unit: 'dB' },
    ],
  },
  {
    id: 'limiter',
    name: 'Limiter',
    type: 'limiter',
    category: 'effect',
    parameters: [
      { id: 'ceiling', name: 'Ceiling', value: -0.3, range: { min: -12, max: 0, default: -0.3 }, unit: 'dB' },
      { id: 'release', name: 'Release', value: 0.1, range: { min: 0.01, max: 0.5, default: 0.1 }, unit: 's' },
    ],
  },
  {
    id: 'chorus',
    name: 'Chorus',
    type: 'chorus',
    category: 'effect',
    parameters: [
      { id: 'rate', name: 'Rate', value: 0.5, range: { min: 0.1, max: 5, default: 0.5 }, unit: 'Hz' },
      { id: 'depth', name: 'Depth', value: 0.002, range: { min: 0.0001, max: 0.01, default: 0.002 } },
      { id: 'mix', name: 'Mix', value: 0.5, range: { min: 0, max: 1, default: 0.5 } },
    ],
  },
  {
    id: 'distortion',
    name: 'Distortion',
    type: 'distortion',
    category: 'effect',
    parameters: [
      { id: 'drive', name: 'Drive', value: 1, range: { min: 0.1, max: 10, default: 1 } },
      { id: 'tone', name: 'Tone', value: 8000, range: { min: 1000, max: 20000, default: 8000 }, unit: 'Hz' },
    ],
  },
];

// ============================================================================
// VST Host
// ============================================================================

/**
 * Plugin factory
 */
type PluginFactory = (context: AudioContext) => PluginNode;

/**
 * VST Host - manages plugin instances
 */
export class VSTHost {
  private context: AudioContext;
  private factories: Map<string, PluginFactory> = new Map();
  private plugins: PluginDefinition[] = [];

  constructor(context: AudioContext) {
    this.context = context;
  }

  /**
   * Initialize built-in plugins
   */
  async initialize(): Promise<void> {
    // Register built-in plugin factories
    this.factories.set('eq', (ctx) => new EQPlugin(ctx));
    this.factories.set('compressor', (ctx) => new CompressorPlugin(ctx));
    this.factories.set('reverb', (ctx) => new ReverbPlugin(ctx));
    this.factories.set('delay', (ctx) => new DelayPlugin(ctx));
    this.factories.set('filter', (ctx) => new FilterPlugin(ctx));
    this.factories.set('gain', (ctx) => new GainPlugin(ctx));
    this.factories.set('limiter', (ctx) => new LimiterPlugin(ctx));
    this.factories.set('chorus', (ctx) => new ChorusPlugin(ctx));
    this.factories.set('distortion', (ctx) => new DistortionPlugin(ctx));

    this.plugins = [...BUILTIN_PLUGINS];
  }

  /**
   * Get all available plugins
   */
  getPlugins(): PluginDefinition[] {
    return [...this.plugins];
  }

  /**
   * Get plugin definition by ID
   */
  getPlugin(id: string): PluginDefinition | undefined {
    return this.plugins.find(p => p.id === id);
  }

  /**
   * Create a plugin instance
   */
  createPlugin(id: string): PluginNode | null {
    const factory = this.factories.get(id);
    if (!factory) {
      console.warn(`Plugin not found: ${id}`);
      return null;
    }
    return factory(this.context);
  }

  /**
   * Register a custom plugin
   */
  registerPlugin(definition: PluginDefinition, factory: PluginFactory): void {
    this.plugins.push(definition);
    this.factories.set(definition.id, factory);
  }
}
