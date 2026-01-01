/**
 * AudioEngine - Core audio processing for zDAW
 *
 * Manages Web Audio API graph for multi-track playback, effects processing,
 * and integration with the OS audio mixer.
 */

import type {
  Track,
  AudioTrack,
  MIDITrack,
  MasterTrack,
  BusTrack,
  Clip,
  AudioClip,
  Beats,
  Seconds,
  TransportState,
  LoopRegion,
  PluginInstance,
  AudioSample,
} from '../types';
import { beatsToSeconds, secondsToBeats, dbToGain, generateId } from '../types';
import { VSTHost, PluginNode } from './VSTHost';

/** Track channel with audio nodes */
interface TrackChannel {
  id: string;
  input: GainNode;
  pan: StereoPannerNode;
  preFaderSend: GainNode;
  fader: GainNode;
  postFaderSend: GainNode;
  mute: GainNode;
  effectsChain: PluginNode[];
  output: GainNode;
  meter: AnalyserNode;
  scheduledSources: AudioBufferSourceNode[];
}

/** Audio engine configuration */
interface AudioEngineConfig {
  sampleRate?: number;
  bufferSize?: number;
  latencyHint?: AudioContextLatencyCategory;
}

/** Audio engine state */
interface AudioEngineState {
  isRunning: boolean;
  transportState: TransportState;
  position: Beats;
  bpm: number;
  loop: LoopRegion;
}

type AudioEngineListener = (state: AudioEngineState) => void;

/**
 * Main audio engine class
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private masterChannel: TrackChannel | null = null;
  private trackChannels: Map<string, TrackChannel> = new Map();
  private busChannels: Map<string, TrackChannel> = new Map();
  private vstHost: VSTHost | null = null;

  private state: AudioEngineState = {
    isRunning: false,
    transportState: 'stopped',
    position: 0,
    bpm: 120,
    loop: { enabled: false, start: 0, end: 16 },
  };

  private samples: Map<string, AudioBuffer> = new Map();
  private listeners: Set<AudioEngineListener> = new Set();
  private positionTimer: number | null = null;
  private startTime: number = 0;
  private startPosition: Beats = 0;

  // External mixer integration (optional)
  private mixerChannelId: string | null = null;
  private mixerGainNode: GainNode | null = null;

  constructor(private config: AudioEngineConfig = {}) {}

  /**
   * Initialize the audio engine
   */
  async initialize(): Promise<void> {
    if (this.context) return;

    this.context = new AudioContext({
      sampleRate: this.config.sampleRate ?? 44100,
      latencyHint: this.config.latencyHint ?? 'interactive',
    });

    // Create master channel
    this.masterChannel = this.createChannel('master');
    this.masterChannel.output.connect(this.context.destination);

    // Initialize VST host
    this.vstHost = new VSTHost(this.context);
    await this.vstHost.initialize();

    this.state.isRunning = true;
    this.notifyListeners();
  }

  /**
   * Get the audio context
   */
  getContext(): AudioContext | null {
    return this.context;
  }

  /**
   * Connect to OS mixer (for @z-os/core integration)
   */
  connectToMixer(channelId: string, gainNode: GainNode): void {
    this.mixerChannelId = channelId;
    this.mixerGainNode = gainNode;

    if (this.masterChannel && this.context) {
      // Disconnect from destination, connect to mixer
      this.masterChannel.output.disconnect();
      this.masterChannel.output.connect(gainNode);
    }
  }

  /**
   * Create a channel strip with standard routing
   */
  private createChannel(id: string): TrackChannel {
    const ctx = this.context!;

    const input = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const preFaderSend = ctx.createGain();
    const fader = ctx.createGain();
    const postFaderSend = ctx.createGain();
    const mute = ctx.createGain();
    const output = ctx.createGain();
    const meter = ctx.createAnalyser();

    // Standard channel strip routing
    input.connect(pan);
    pan.connect(preFaderSend);
    preFaderSend.connect(fader);
    fader.connect(postFaderSend);
    postFaderSend.connect(mute);
    mute.connect(output);
    output.connect(meter);

    meter.fftSize = 256;
    meter.smoothingTimeConstant = 0.8;

    return {
      id,
      input,
      pan,
      preFaderSend,
      fader,
      postFaderSend,
      mute,
      effectsChain: [],
      output,
      meter,
      scheduledSources: [],
    };
  }

  /**
   * Add a track to the engine
   */
  addTrack(track: Track): void {
    if (!this.context || !this.masterChannel) return;
    if (this.trackChannels.has(track.id)) return;

    const channel = this.createChannel(track.id);

    // Apply track settings
    channel.fader.gain.value = dbToGain(track.volume);
    channel.pan.pan.value = track.pan;
    channel.mute.gain.value = track.muted ? 0 : 1;

    // Route to master (or bus)
    if (track.type !== 'master') {
      const routing = (track as AudioTrack | MIDITrack).routing;
      if (routing?.output && this.busChannels.has(routing.output)) {
        channel.output.connect(this.busChannels.get(routing.output)!.input);
      } else {
        channel.output.connect(this.masterChannel.input);
      }
    }

    // Add effects chain
    if (track.effects?.length) {
      this.rebuildEffectsChain(channel, track.effects);
    }

    this.trackChannels.set(track.id, channel);
  }

  /**
   * Add a bus/return track
   */
  addBus(bus: BusTrack): void {
    if (!this.context || !this.masterChannel) return;
    if (this.busChannels.has(bus.id)) return;

    const channel = this.createChannel(bus.id);
    channel.fader.gain.value = dbToGain(bus.volume);
    channel.pan.pan.value = bus.pan;
    channel.mute.gain.value = bus.muted ? 0 : 1;
    channel.output.connect(this.masterChannel.input);

    this.busChannels.set(bus.id, channel);
  }

  /**
   * Remove a track from the engine
   */
  removeTrack(trackId: string): void {
    const channel = this.trackChannels.get(trackId);
    if (!channel) return;

    // Stop all scheduled sources
    channel.scheduledSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    });

    // Disconnect all nodes
    channel.input.disconnect();
    channel.pan.disconnect();
    channel.preFaderSend.disconnect();
    channel.fader.disconnect();
    channel.postFaderSend.disconnect();
    channel.mute.disconnect();
    channel.output.disconnect();

    // Destroy effect nodes
    channel.effectsChain.forEach(plugin => plugin.destroy());

    this.trackChannels.delete(trackId);
  }

  /**
   * Update track parameters
   */
  updateTrack(trackId: string, updates: Partial<Track>): void {
    const channel = this.trackChannels.get(trackId);
    if (!channel || !this.context) return;

    const now = this.context.currentTime;

    if (updates.volume !== undefined) {
      channel.fader.gain.setTargetAtTime(dbToGain(updates.volume), now, 0.01);
    }

    if (updates.pan !== undefined) {
      channel.pan.pan.setTargetAtTime(updates.pan, now, 0.01);
    }

    if (updates.muted !== undefined) {
      channel.mute.gain.setTargetAtTime(updates.muted ? 0 : 1, now, 0.01);
    }

    if (updates.effects) {
      this.rebuildEffectsChain(channel, updates.effects);
    }
  }

  /**
   * Rebuild effects chain for a channel
   */
  private rebuildEffectsChain(channel: TrackChannel, effects: PluginInstance[]): void {
    if (!this.vstHost || !this.context) return;

    // Destroy old chain
    channel.effectsChain.forEach(plugin => plugin.destroy());
    channel.effectsChain = [];

    // Rebuild routing without effects first
    channel.pan.disconnect();
    channel.pan.connect(channel.preFaderSend);

    // Create new effect nodes
    let lastNode: AudioNode = channel.pan;

    for (const effect of effects) {
      const pluginNode = this.vstHost.createPlugin(effect.pluginId);
      if (pluginNode) {
        // Apply parameters
        for (const [paramId, value] of Object.entries(effect.parameters)) {
          pluginNode.setParameter(paramId, value);
        }
        pluginNode.setEnabled(effect.enabled);

        // Connect in series
        lastNode.disconnect();
        lastNode.connect(pluginNode.getInput());
        lastNode = pluginNode.getOutput();

        channel.effectsChain.push(pluginNode);
      }
    }

    // Connect final node to pre-fader send
    lastNode.connect(channel.preFaderSend);
  }

  /**
   * Update effect parameter
   */
  updateEffectParameter(trackId: string, effectIndex: number, paramId: string, value: number): void {
    const channel = this.trackChannels.get(trackId);
    if (!channel || effectIndex >= channel.effectsChain.length) return;

    channel.effectsChain[effectIndex].setParameter(paramId, value);
  }

  /**
   * Load an audio sample
   */
  async loadSample(id: string, source: ArrayBuffer | string): Promise<AudioBuffer | null> {
    if (!this.context) return null;

    try {
      let arrayBuffer: ArrayBuffer;

      if (typeof source === 'string') {
        const response = await fetch(source);
        arrayBuffer = await response.arrayBuffer();
      } else {
        arrayBuffer = source;
      }

      const buffer = await this.context.decodeAudioData(arrayBuffer);
      this.samples.set(id, buffer);
      return buffer;
    } catch (e) {
      console.error('Failed to load sample:', e);
      return null;
    }
  }

  /**
   * Get a loaded sample
   */
  getSample(id: string): AudioBuffer | undefined {
    return this.samples.get(id);
  }

  /**
   * Get meter levels for a track
   */
  getMeterLevels(trackId: string): { left: number; right: number } {
    const channel = trackId === 'master'
      ? this.masterChannel
      : this.trackChannels.get(trackId);

    if (!channel) return { left: 0, right: 0 };

    const data = new Float32Array(channel.meter.fftSize);
    channel.meter.getFloatTimeDomainData(data);

    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);

    // Simple stereo approximation (proper would need split channels)
    return { left: rms, right: rms };
  }

  // =========================================================================
  // Transport
  // =========================================================================

  /**
   * Set BPM
   */
  setBPM(bpm: number): void {
    this.state.bpm = Math.max(20, Math.min(999, bpm));
    this.notifyListeners();
  }

  /**
   * Get current BPM
   */
  getBPM(): number {
    return this.state.bpm;
  }

  /**
   * Set loop region
   */
  setLoop(loop: LoopRegion): void {
    this.state.loop = loop;
    this.notifyListeners();
  }

  /**
   * Get current position in beats
   */
  getPosition(): Beats {
    if (!this.context || this.state.transportState !== 'playing') {
      return this.state.position;
    }

    const elapsed = this.context.currentTime - this.startTime;
    let position = this.startPosition + secondsToBeats(elapsed, this.state.bpm);

    // Handle looping
    if (this.state.loop.enabled) {
      const loopLength = this.state.loop.end - this.state.loop.start;
      if (position >= this.state.loop.end) {
        position = this.state.loop.start + ((position - this.state.loop.start) % loopLength);
      }
    }

    return position;
  }

  /**
   * Seek to position
   */
  seek(position: Beats): void {
    const wasPlaying = this.state.transportState === 'playing';

    if (wasPlaying) {
      this.stop();
    }

    this.state.position = Math.max(0, position);
    this.notifyListeners();

    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Start playback
   */
  play(tracks?: Track[]): void {
    if (!this.context || this.state.transportState === 'playing') return;

    // Resume context if suspended
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    this.state.transportState = 'playing';
    this.startTime = this.context.currentTime;
    this.startPosition = this.state.position;

    // Schedule audio clips if tracks provided
    if (tracks) {
      this.schedulePlayback(tracks);
    }

    // Start position update timer
    this.positionTimer = window.setInterval(() => {
      this.state.position = this.getPosition();
      this.notifyListeners();

      // Handle loop
      if (this.state.loop.enabled && this.state.position >= this.state.loop.end) {
        this.seek(this.state.loop.start);
      }
    }, 50);

    this.notifyListeners();
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.state.transportState === 'stopped') {
      // Already stopped, reset to start
      this.state.position = 0;
      this.notifyListeners();
      return;
    }

    // Stop all scheduled sources
    this.trackChannels.forEach(channel => {
      channel.scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          // Already stopped
        }
      });
      channel.scheduledSources = [];
    });

    if (this.positionTimer) {
      window.clearInterval(this.positionTimer);
      this.positionTimer = null;
    }

    this.state.transportState = 'stopped';
    this.notifyListeners();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state.transportState !== 'playing') return;

    // Update position before pausing
    this.state.position = this.getPosition();

    // Stop all scheduled sources
    this.trackChannels.forEach(channel => {
      channel.scheduledSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          // Already stopped
        }
      });
      channel.scheduledSources = [];
    });

    if (this.positionTimer) {
      window.clearInterval(this.positionTimer);
      this.positionTimer = null;
    }

    this.state.transportState = 'paused';
    this.notifyListeners();
  }

  /**
   * Toggle play/pause
   */
  togglePlayPause(tracks?: Track[]): void {
    if (this.state.transportState === 'playing') {
      this.pause();
    } else {
      this.play(tracks);
    }
  }

  /**
   * Start recording
   */
  record(): void {
    if (this.state.transportState === 'recording') return;

    // Resume context if suspended
    if (this.context?.state === 'suspended') {
      this.context.resume();
    }

    this.state.transportState = 'recording';
    this.startTime = this.context?.currentTime ?? 0;
    this.startPosition = this.state.position;

    // Start position update timer
    this.positionTimer = window.setInterval(() => {
      this.state.position = this.getPosition();
      this.notifyListeners();
    }, 50);

    this.notifyListeners();
  }

  /**
   * Get transport state
   */
  getTransportState(): TransportState {
    return this.state.transportState;
  }

  /**
   * Schedule playback of clips on tracks
   */
  private schedulePlayback(tracks: Track[]): void {
    if (!this.context) return;

    const now = this.context.currentTime;
    const startBeat = this.state.position;
    const bpm = this.state.bpm;

    for (const track of tracks) {
      if (track.type !== 'audio' && track.type !== 'midi') continue;
      if (track.muted) continue;

      const channel = this.trackChannels.get(track.id);
      if (!channel) continue;

      const clips = (track as AudioTrack).clips || [];

      for (const clip of clips) {
        if (clip.type !== 'audio') continue;
        if (clip.muted) continue;

        // Skip clips that end before current position
        if (clip.start + clip.duration <= startBeat) continue;

        const audioClip = clip as AudioClip;

        for (const region of audioClip.regions) {
          const sample = this.samples.get(region.sampleId);
          if (!sample) continue;

          // Calculate when this region should play
          const regionStartBeat = clip.start + region.start;
          const regionEndBeat = regionStartBeat + region.duration;

          // Skip if region ends before current position
          if (regionEndBeat <= startBeat) continue;

          // Calculate timing
          let playStartTime: number;
          let bufferOffset: number;

          if (regionStartBeat <= startBeat) {
            // We're in the middle of this region
            playStartTime = now;
            const beatOffset = startBeat - regionStartBeat;
            bufferOffset = region.offset + beatsToSeconds(beatOffset, bpm);
          } else {
            // Region starts in the future
            playStartTime = now + beatsToSeconds(regionStartBeat - startBeat, bpm);
            bufferOffset = region.offset;
          }

          const playDuration = beatsToSeconds(region.duration, bpm);

          // Create and schedule source
          const source = this.context.createBufferSource();
          source.buffer = sample;

          // Apply region gain
          const gainNode = this.context.createGain();
          gainNode.gain.value = region.gain;

          source.connect(gainNode);
          gainNode.connect(channel.input);

          source.start(playStartTime, bufferOffset, playDuration);
          channel.scheduledSources.push(source);

          // Clean up when done
          source.onended = () => {
            const idx = channel.scheduledSources.indexOf(source);
            if (idx !== -1) {
              channel.scheduledSources.splice(idx, 1);
            }
            gainNode.disconnect();
          };
        }
      }
    }
  }

  // =========================================================================
  // State & Lifecycle
  // =========================================================================

  /**
   * Subscribe to state changes
   */
  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  /**
   * Get current state
   */
  getState(): AudioEngineState {
    return { ...this.state };
  }

  /**
   * Shutdown the engine
   */
  async shutdown(): Promise<void> {
    this.stop();

    // Disconnect all channels
    this.trackChannels.forEach((_, id) => this.removeTrack(id));
    this.busChannels.forEach((channel) => {
      channel.input.disconnect();
      channel.output.disconnect();
    });

    if (this.masterChannel) {
      this.masterChannel.input.disconnect();
      this.masterChannel.output.disconnect();
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    this.state.isRunning = false;
    this.notifyListeners();
  }

  /**
   * Get the track input node (for instruments/recording)
   */
  getTrackInput(trackId: string): GainNode | null {
    return this.trackChannels.get(trackId)?.input ?? null;
  }

  /**
   * Get the master output node
   */
  getMasterOutput(): GainNode | null {
    return this.masterChannel?.output ?? null;
  }

  /**
   * Play a one-shot audio buffer (for previews, UI sounds)
   */
  playOneShot(buffer: AudioBuffer, volume: number = 1): void {
    if (!this.context || !this.masterChannel) return;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();

    source.buffer = buffer;
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(this.masterChannel.input);

    source.start();

    source.onended = () => {
      gain.disconnect();
    };
  }
}
