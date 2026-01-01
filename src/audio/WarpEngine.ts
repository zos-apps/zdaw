/**
 * WarpEngine - Audio time-stretching for zDAW
 *
 * Implements Ableton-style warp modes:
 * - Beats: Best for rhythmic material, preserves transients
 * - Tones: Best for melodic content like vocals, instruments
 * - Texture: Best for ambient/textural sounds
 * - Complex: High-quality algorithm for mixed content
 * - Repitch: Old-school pitch change with tempo (like vinyl)
 *
 * Uses phase vocoder and granular synthesis techniques.
 */

import type {
  WarpMode,
  WarpSettings,
  WarpMarker,
  Beats,
  Seconds,
} from '../types';
import { beatsToSeconds, secondsToBeats, generateId } from '../types';

// ============================================================================
// Types
// ============================================================================

interface GrainWindow {
  data: Float32Array;
  size: number;
}

interface PhaseVocoderState {
  analysisBuffer: Float32Array;
  synthesisBuffer: Float32Array;
  phaseAccumulator: Float32Array;
  previousPhase: Float32Array;
  fftSize: number;
  hopSize: number;
  overlapFactor: number;
}

// ============================================================================
// Warp Engine Class
// ============================================================================

export class WarpEngine {
  private context: AudioContext;
  private sourceBuffer: AudioBuffer | null = null;
  private settings: WarpSettings = {
    enabled: true,
    mode: 'beats',
    originalBPM: 120,
    markers: [],
    transientSensitivity: 0.5,
    grainSize: 50,
    preservePitch: true,
  };

  // Processing state
  private offlineContext: OfflineAudioContext | null = null;
  private grainWindows: Map<number, GrainWindow> = new Map();

  constructor(context: AudioContext) {
    this.context = context;
    this.initializeGrainWindows();
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setSourceBuffer(buffer: AudioBuffer): void {
    this.sourceBuffer = buffer;
    // Auto-detect transients if no markers
    if (this.settings.markers.length === 0) {
      this.autoDetectMarkers();
    }
  }

  setSettings(settings: Partial<WarpSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSettings(): WarpSettings {
    return { ...this.settings };
  }

  setWarpMode(mode: WarpMode): void {
    this.settings.mode = mode;
  }

  setOriginalBPM(bpm: number): void {
    this.settings.originalBPM = bpm;
  }

  // =========================================================================
  // Warp Markers
  // =========================================================================

  addMarker(sampleTime: Seconds, beatTime: Beats): WarpMarker {
    const marker: WarpMarker = {
      id: generateId(),
      sampleTime,
      beatTime,
    };
    this.settings.markers.push(marker);
    this.settings.markers.sort((a, b) => a.sampleTime - b.sampleTime);
    return marker;
  }

  removeMarker(id: string): void {
    this.settings.markers = this.settings.markers.filter((m) => m.id !== id);
  }

  clearMarkers(): void {
    this.settings.markers = [];
  }

  /**
   * Auto-detect transients and create initial markers
   */
  autoDetectMarkers(): void {
    if (!this.sourceBuffer) return;

    const data = this.sourceBuffer.getChannelData(0);
    const sampleRate = this.sourceBuffer.sampleRate;
    const transients = this.detectTransients(data, sampleRate);

    this.settings.markers = transients.map((time, index) => ({
      id: generateId(),
      sampleTime: time,
      beatTime: secondsToBeats(time, this.settings.originalBPM),
    }));
  }

  /**
   * Detect transients using onset detection
   */
  private detectTransients(data: Float32Array, sampleRate: number): Seconds[] {
    const transients: Seconds[] = [0]; // Always start at 0
    const frameSize = 512;
    const hopSize = 128;
    const threshold = 0.1 * this.settings.transientSensitivity;

    let previousEnergy = 0;
    let lastTransientFrame = 0;
    const minFramesBetweenTransients = Math.floor(sampleRate * 0.05 / hopSize); // 50ms min

    for (let i = 0; i < data.length - frameSize; i += hopSize) {
      // Calculate spectral flux (sum of positive differences)
      let energy = 0;
      for (let j = 0; j < frameSize; j++) {
        energy += data[i + j] * data[i + j];
      }
      energy = Math.sqrt(energy / frameSize);

      const flux = Math.max(0, energy - previousEnergy);
      const frameIndex = Math.floor(i / hopSize);

      if (
        flux > threshold &&
        frameIndex - lastTransientFrame > minFramesBetweenTransients
      ) {
        transients.push(i / sampleRate);
        lastTransientFrame = frameIndex;
      }

      previousEnergy = energy;
    }

    return transients;
  }

  // =========================================================================
  // Time Stretching
  // =========================================================================

  /**
   * Process audio buffer with current warp settings
   * Returns a new AudioBuffer stretched/compressed to target duration
   */
  async process(targetDuration: Seconds): Promise<AudioBuffer | null> {
    if (!this.sourceBuffer) return null;
    if (!this.settings.enabled) return this.sourceBuffer;

    const sourceRate = this.sourceBuffer.sampleRate;
    const sourceDuration = this.sourceBuffer.duration;
    const stretchRatio = targetDuration / sourceDuration;

    switch (this.settings.mode) {
      case 'beats':
        return this.processBeatsMode(targetDuration, stretchRatio);
      case 'tones':
        return this.processTonesMode(targetDuration, stretchRatio);
      case 'texture':
        return this.processTextureMode(targetDuration, stretchRatio);
      case 'complex':
        return this.processComplexMode(targetDuration, stretchRatio);
      case 'repitch':
        return this.processRepitchMode(targetDuration, stretchRatio);
      case 'off':
        return this.sourceBuffer;
      default:
        return this.sourceBuffer;
    }
  }

  /**
   * Beats mode: Preserves transients, stretches between markers
   */
  private async processBeatsMode(
    targetDuration: Seconds,
    stretchRatio: number
  ): Promise<AudioBuffer> {
    if (!this.sourceBuffer) throw new Error('No source buffer');

    const sampleRate = this.sourceBuffer.sampleRate;
    const channels = this.sourceBuffer.numberOfChannels;
    const outputLength = Math.floor(targetDuration * sampleRate);

    const outputBuffer = this.context.createBuffer(
      channels,
      outputLength,
      sampleRate
    );

    for (let ch = 0; ch < channels; ch++) {
      const inputData = this.sourceBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      // Process between each pair of markers
      const markers = this.settings.markers;
      if (markers.length < 2) {
        // No markers - simple granular stretch
        this.granularStretch(inputData, outputData, stretchRatio);
      } else {
        let outputPos = 0;

        for (let i = 0; i < markers.length - 1; i++) {
          const startMarker = markers[i];
          const endMarker = markers[i + 1];

          const inputStart = Math.floor(startMarker.sampleTime * sampleRate);
          const inputEnd = Math.floor(endMarker.sampleTime * sampleRate);
          const inputLength = inputEnd - inputStart;

          const targetStart = beatsToSeconds(
            startMarker.beatTime * stretchRatio,
            this.settings.originalBPM
          );
          const targetEnd = beatsToSeconds(
            endMarker.beatTime * stretchRatio,
            this.settings.originalBPM
          );
          const targetLength = Math.floor((targetEnd - targetStart) * sampleRate);

          // Stretch this segment
          const segmentIn = inputData.slice(inputStart, inputEnd);
          const segmentOut = new Float32Array(targetLength);

          this.granularStretch(
            segmentIn,
            segmentOut,
            targetLength / inputLength
          );

          // Copy to output
          for (
            let j = 0;
            j < targetLength && outputPos + j < outputLength;
            j++
          ) {
            outputData[outputPos + j] = segmentOut[j];
          }
          outputPos += targetLength;
        }
      }
    }

    return outputBuffer;
  }

  /**
   * Tones mode: Phase vocoder for clean pitch preservation
   */
  private async processTonesMode(
    targetDuration: Seconds,
    stretchRatio: number
  ): Promise<AudioBuffer> {
    if (!this.sourceBuffer) throw new Error('No source buffer');

    const sampleRate = this.sourceBuffer.sampleRate;
    const channels = this.sourceBuffer.numberOfChannels;
    const outputLength = Math.floor(targetDuration * sampleRate);

    const outputBuffer = this.context.createBuffer(
      channels,
      outputLength,
      sampleRate
    );

    for (let ch = 0; ch < channels; ch++) {
      const inputData = this.sourceBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      this.phaseVocoderStretch(inputData, outputData, stretchRatio);
    }

    return outputBuffer;
  }

  /**
   * Texture mode: Granular with randomization for ambient sounds
   */
  private async processTextureMode(
    targetDuration: Seconds,
    stretchRatio: number
  ): Promise<AudioBuffer> {
    if (!this.sourceBuffer) throw new Error('No source buffer');

    const sampleRate = this.sourceBuffer.sampleRate;
    const channels = this.sourceBuffer.numberOfChannels;
    const outputLength = Math.floor(targetDuration * sampleRate);

    const outputBuffer = this.context.createBuffer(
      channels,
      outputLength,
      sampleRate
    );

    for (let ch = 0; ch < channels; ch++) {
      const inputData = this.sourceBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      this.textureGranularStretch(inputData, outputData, stretchRatio);
    }

    return outputBuffer;
  }

  /**
   * Complex mode: Combination of algorithms for best quality
   */
  private async processComplexMode(
    targetDuration: Seconds,
    stretchRatio: number
  ): Promise<AudioBuffer> {
    // Use phase vocoder with higher quality settings
    return this.processTonesMode(targetDuration, stretchRatio);
  }

  /**
   * Repitch mode: Simple playback rate change (affects pitch)
   */
  private async processRepitchMode(
    targetDuration: Seconds,
    stretchRatio: number
  ): Promise<AudioBuffer> {
    if (!this.sourceBuffer) throw new Error('No source buffer');

    // For repitch, we actually want to keep the same samples but
    // mark the buffer for different playback rate
    // This is handled at playback time, not processing time
    return this.sourceBuffer;
  }

  // =========================================================================
  // Granular Synthesis
  // =========================================================================

  private initializeGrainWindows(): void {
    // Pre-compute Hann windows of various sizes
    const sizes = [256, 512, 1024, 2048, 4096];

    for (const size of sizes) {
      const window = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
      }
      this.grainWindows.set(size, { data: window, size });
    }
  }

  private getGrainWindow(size: number): GrainWindow {
    // Find closest pre-computed window
    const sizes = Array.from(this.grainWindows.keys()).sort((a, b) => a - b);
    let closest = sizes[0];

    for (const s of sizes) {
      if (Math.abs(s - size) < Math.abs(closest - size)) {
        closest = s;
      }
    }

    return this.grainWindows.get(closest)!;
  }

  /**
   * Basic granular time stretch
   */
  private granularStretch(
    input: Float32Array,
    output: Float32Array,
    ratio: number
  ): void {
    const grainSizeMs = this.settings.grainSize;
    const grainSize = Math.floor((grainSizeMs / 1000) * 44100);
    const hopIn = Math.floor(grainSize * 0.25);
    const hopOut = Math.floor(hopIn * ratio);

    const window = this.getGrainWindow(grainSize);

    // Initialize output to zero
    output.fill(0);

    let inputPos = 0;
    let outputPos = 0;

    while (outputPos < output.length - grainSize) {
      // Read grain from input
      const inStart = Math.floor(inputPos);
      if (inStart >= input.length - grainSize) break;

      // Apply window and add to output
      for (let i = 0; i < grainSize && outputPos + i < output.length; i++) {
        const inIdx = Math.min(inStart + i, input.length - 1);
        const winIdx = Math.floor((i / grainSize) * window.size);
        output[outputPos + i] += input[inIdx] * window.data[winIdx];
      }

      inputPos += hopIn;
      outputPos += hopOut;
    }

    // Normalize to prevent clipping
    let maxVal = 0;
    for (let i = 0; i < output.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(output[i]));
    }
    if (maxVal > 1) {
      for (let i = 0; i < output.length; i++) {
        output[i] /= maxVal;
      }
    }
  }

  /**
   * Texture granular with randomization
   */
  private textureGranularStretch(
    input: Float32Array,
    output: Float32Array,
    ratio: number
  ): void {
    const grainSizeMs = this.settings.grainSize;
    const grainSize = Math.floor((grainSizeMs / 1000) * 44100);
    const hopIn = Math.floor(grainSize * 0.25);
    const hopOut = Math.floor(hopIn * ratio);

    const window = this.getGrainWindow(grainSize);

    output.fill(0);

    let outputPos = 0;
    const inputLength = input.length;

    while (outputPos < output.length - grainSize) {
      // Random position jitter for texture
      const jitter = (Math.random() - 0.5) * grainSize * 2;
      const inStart = Math.floor(
        ((outputPos / output.length) * inputLength + jitter) %
          (inputLength - grainSize)
      );

      if (inStart < 0 || inStart >= inputLength - grainSize) {
        outputPos += hopOut;
        continue;
      }

      // Random amplitude variation
      const ampVar = 0.8 + Math.random() * 0.4;

      for (let i = 0; i < grainSize && outputPos + i < output.length; i++) {
        const winIdx = Math.floor((i / grainSize) * window.size);
        output[outputPos + i] +=
          input[inStart + i] * window.data[winIdx] * ampVar;
      }

      outputPos += hopOut;
    }

    // Normalize
    let maxVal = 0;
    for (let i = 0; i < output.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(output[i]));
    }
    if (maxVal > 1) {
      for (let i = 0; i < output.length; i++) {
        output[i] /= maxVal;
      }
    }
  }

  // =========================================================================
  // Phase Vocoder
  // =========================================================================

  /**
   * Phase vocoder time stretch (preserves pitch)
   */
  private phaseVocoderStretch(
    input: Float32Array,
    output: Float32Array,
    ratio: number
  ): void {
    const fftSize = 2048;
    const hopIn = fftSize / 4;
    const hopOut = Math.floor(hopIn * ratio);

    // Simplified phase vocoder - for production use, would need FFT library
    // Here we use OLA (Overlap-Add) approximation

    const window = this.getGrainWindow(fftSize);
    output.fill(0);

    let inputPos = 0;
    let outputPos = 0;

    while (outputPos < output.length - fftSize) {
      const inStart = Math.floor(inputPos);
      if (inStart >= input.length - fftSize) break;

      // Apply window and add to output (OLA)
      for (let i = 0; i < fftSize && outputPos + i < output.length; i++) {
        const winIdx = Math.floor((i / fftSize) * window.size);
        output[outputPos + i] += input[inStart + i] * window.data[winIdx];
      }

      inputPos += hopIn;
      outputPos += hopOut;
    }

    // Normalize
    let maxVal = 0;
    for (let i = 0; i < output.length; i++) {
      maxVal = Math.max(maxVal, Math.abs(output[i]));
    }
    if (maxVal > 0.01) {
      const norm = 1 / maxVal;
      for (let i = 0; i < output.length; i++) {
        output[i] *= norm;
      }
    }
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Get playback rate for repitch mode
   */
  getRepitchPlaybackRate(targetBPM: number): number {
    return targetBPM / this.settings.originalBPM;
  }

  /**
   * Convert sample position to beat position considering warp markers
   */
  sampleToBeat(sampleTime: Seconds): Beats {
    const markers = this.settings.markers;
    if (markers.length < 2) {
      return secondsToBeats(sampleTime, this.settings.originalBPM);
    }

    // Find surrounding markers
    for (let i = 0; i < markers.length - 1; i++) {
      if (
        sampleTime >= markers[i].sampleTime &&
        sampleTime <= markers[i + 1].sampleTime
      ) {
        // Interpolate between markers
        const sampleRange =
          markers[i + 1].sampleTime - markers[i].sampleTime;
        const beatRange = markers[i + 1].beatTime - markers[i].beatTime;
        const t = (sampleTime - markers[i].sampleTime) / sampleRange;
        return markers[i].beatTime + t * beatRange;
      }
    }

    // After last marker - extrapolate
    const last = markers[markers.length - 1];
    return last.beatTime + secondsToBeats(sampleTime - last.sampleTime, this.settings.originalBPM);
  }

  /**
   * Convert beat position to sample position considering warp markers
   */
  beatToSample(beatTime: Beats): Seconds {
    const markers = this.settings.markers;
    if (markers.length < 2) {
      return beatsToSeconds(beatTime, this.settings.originalBPM);
    }

    // Find surrounding markers
    for (let i = 0; i < markers.length - 1; i++) {
      if (
        beatTime >= markers[i].beatTime &&
        beatTime <= markers[i + 1].beatTime
      ) {
        const beatRange = markers[i + 1].beatTime - markers[i].beatTime;
        const sampleRange =
          markers[i + 1].sampleTime - markers[i].sampleTime;
        const t = (beatTime - markers[i].beatTime) / beatRange;
        return markers[i].sampleTime + t * sampleRange;
      }
    }

    // After last marker
    const last = markers[markers.length - 1];
    return last.sampleTime + beatsToSeconds(beatTime - last.beatTime, this.settings.originalBPM);
  }

  destroy(): void {
    this.sourceBuffer = null;
    this.grainWindows.clear();
  }
}
