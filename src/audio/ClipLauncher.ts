/**
 * ClipLauncher - Session clip scheduling engine for zDAW
 *
 * Handles:
 * - Quantized clip launching
 * - Scene launching
 * - Follow actions
 * - Clip looping
 * - Legato mode
 * - Audio/MIDI clip playback coordination
 */

import type {
  Clip,
  AudioClip,
  MIDIClip,
  ClipState,
  LaunchQuantization,
  FollowActionPair,
  FollowAction,
  Beats,
  TransportState,
  MIDINoteData,
} from '../types';
import {
  beatsToSeconds,
  secondsToBeats,
  launchQuantizationToBeats,
  getNextQuantizedBeat,
  generateId,
} from '../types';

// ============================================================================
// Types
// ============================================================================

/** Scheduled clip event */
interface ScheduledClip {
  id: string;
  trackId: string;
  slotIndex: number;
  clip: Clip;
  state: ClipState;
  launchTime: Beats; // When to start playing
  stopTime: Beats | null; // When to stop (null = loop indefinitely)
  loopCount: number;
  sources: AudioBufferSourceNode[];
  midiEvents: ScheduledMIDIEvent[];
}

/** Scheduled MIDI event */
interface ScheduledMIDIEvent {
  noteId: string;
  note: number;
  velocity: number;
  startTime: number; // AudioContext time
  endTime: number;
  triggered: boolean;
}

/** Clip launcher state */
interface ClipLauncherState {
  playing: Map<string, ScheduledClip>; // trackId -> scheduled clip
  triggered: Map<string, ScheduledClip>; // clips waiting to start
  stopping: Map<string, ScheduledClip>; // clips waiting to stop
}

/** Clip launcher event */
export type ClipLauncherEvent =
  | { type: 'clip-started'; trackId: string; slotIndex: number }
  | { type: 'clip-stopped'; trackId: string; slotIndex: number }
  | { type: 'clip-looped'; trackId: string; slotIndex: number; loopCount: number }
  | { type: 'follow-action'; trackId: string; slotIndex: number; action: FollowAction };

type ClipLauncherListener = (event: ClipLauncherEvent) => void;

// ============================================================================
// Clip Launcher Class
// ============================================================================

export class ClipLauncher {
  private context: AudioContext;
  private destination: AudioNode;
  private state: ClipLauncherState = {
    playing: new Map(),
    triggered: new Map(),
    stopping: new Map(),
  };

  private bpm: number = 120;
  private globalQuantization: LaunchQuantization = '1-bar';
  private transportState: TransportState = 'stopped';
  private position: Beats = 0;
  private startTime: number = 0;

  private listeners: Set<ClipLauncherListener> = new Set();
  private tickerId: number | null = null;

  // Audio sample cache
  private sampleCache: Map<string, AudioBuffer> = new Map();

  // MIDI output callback
  private midiOutput: ((note: number, velocity: number, channel: number) => void) | null = null;

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setBPM(bpm: number): void {
    this.bpm = bpm;
  }

  setGlobalQuantization(q: LaunchQuantization): void {
    this.globalQuantization = q;
  }

  setMIDIOutput(callback: (note: number, velocity: number, channel: number) => void): void {
    this.midiOutput = callback;
  }

  loadSample(id: string, buffer: AudioBuffer): void {
    this.sampleCache.set(id, buffer);
  }

  // =========================================================================
  // Transport
  // =========================================================================

  start(position: Beats = 0): void {
    if (this.transportState === 'playing') return;

    this.transportState = 'playing';
    this.position = position;
    this.startTime = this.context.currentTime;

    // Start ticker
    this.startTicker();
  }

  stop(): void {
    this.transportState = 'stopped';

    // Stop all playing clips
    for (const [trackId, scheduled] of this.state.playing) {
      this.stopScheduledClip(scheduled);
    }

    this.state.playing.clear();
    this.state.triggered.clear();
    this.state.stopping.clear();

    if (this.tickerId) {
      cancelAnimationFrame(this.tickerId);
      this.tickerId = null;
    }
  }

  pause(): void {
    this.transportState = 'paused';
    this.position = this.getPosition();

    // Pause all sources (in Web Audio this means stopping)
    for (const [_, scheduled] of this.state.playing) {
      for (const source of scheduled.sources) {
        try {
          source.stop();
        } catch (e) {
          // Already stopped
        }
      }
    }

    if (this.tickerId) {
      cancelAnimationFrame(this.tickerId);
      this.tickerId = null;
    }
  }

  getPosition(): Beats {
    if (this.transportState !== 'playing') {
      return this.position;
    }
    const elapsed = this.context.currentTime - this.startTime;
    return this.position + secondsToBeats(elapsed, this.bpm);
  }

  // =========================================================================
  // Clip Launching
  // =========================================================================

  /**
   * Launch a clip with quantization
   */
  launchClip(
    trackId: string,
    slotIndex: number,
    clip: Clip,
    quantization: LaunchQuantization = 'global'
  ): void {
    const q = quantization === 'global' ? this.globalQuantization : quantization;
    const currentPos = this.getPosition();
    const launchTime = getNextQuantizedBeat(currentPos, q, this.bpm);

    // Create scheduled clip
    const scheduled: ScheduledClip = {
      id: generateId(),
      trackId,
      slotIndex,
      clip,
      state: 'triggered',
      launchTime,
      stopTime: null,
      loopCount: 0,
      sources: [],
      midiEvents: [],
    };

    // Check for legato mode
    const currentlyPlaying = this.state.playing.get(trackId);
    if (currentlyPlaying && clip.legato === 'legato') {
      // Continue from current position within new clip
      scheduled.launchTime = currentPos;
    }

    // Mark currently playing clip for stop
    if (currentlyPlaying) {
      currentlyPlaying.stopTime = launchTime;
      this.state.stopping.set(trackId, currentlyPlaying);
    }

    // Add to triggered queue
    this.state.triggered.set(trackId, scheduled);

    // If no quantization, start immediately
    if (q === 'none' || launchTime <= currentPos) {
      this.startClip(scheduled);
    }
  }

  /**
   * Stop clip on track
   */
  stopClip(
    trackId: string,
    quantization: LaunchQuantization = 'global'
  ): void {
    const q = quantization === 'global' ? this.globalQuantization : quantization;
    const currentPos = this.getPosition();
    const stopTime = getNextQuantizedBeat(currentPos, q, this.bpm);

    const playing = this.state.playing.get(trackId);
    if (playing) {
      playing.state = 'stopping';
      playing.stopTime = stopTime;
      this.state.stopping.set(trackId, playing);

      if (q === 'none' || stopTime <= currentPos) {
        this.stopScheduledClip(playing);
        this.state.playing.delete(trackId);
        this.state.stopping.delete(trackId);
      }
    }

    // Cancel triggered clip
    this.state.triggered.delete(trackId);
  }

  /**
   * Launch a scene (all clips in a row)
   */
  launchScene(
    clips: Array<{ trackId: string; slotIndex: number; clip: Clip }>,
    quantization: LaunchQuantization = 'global'
  ): void {
    for (const { trackId, slotIndex, clip } of clips) {
      this.launchClip(trackId, slotIndex, clip, quantization);
    }
  }

  /**
   * Stop all clips
   */
  stopAll(quantization: LaunchQuantization = 'none'): void {
    for (const [trackId, _] of this.state.playing) {
      this.stopClip(trackId, quantization);
    }
    this.state.triggered.clear();
  }

  // =========================================================================
  // Internal Scheduling
  // =========================================================================

  private startTicker(): void {
    const tick = () => {
      if (this.transportState !== 'playing') return;

      const pos = this.getPosition();
      const now = this.context.currentTime;

      // Check triggered clips
      for (const [trackId, scheduled] of this.state.triggered) {
        if (pos >= scheduled.launchTime) {
          this.startClip(scheduled);
          this.state.triggered.delete(trackId);
        }
      }

      // Check stopping clips
      for (const [trackId, scheduled] of this.state.stopping) {
        if (scheduled.stopTime !== null && pos >= scheduled.stopTime) {
          this.stopScheduledClip(scheduled);
          this.state.playing.delete(trackId);
          this.state.stopping.delete(trackId);
        }
      }

      // Process playing clips (loop, follow actions)
      for (const [trackId, scheduled] of this.state.playing) {
        this.processPlayingClip(scheduled, pos, now);
      }

      this.tickerId = requestAnimationFrame(tick);
    };

    this.tickerId = requestAnimationFrame(tick);
  }

  private startClip(scheduled: ScheduledClip): void {
    scheduled.state = 'playing';
    this.state.playing.set(scheduled.trackId, scheduled);

    if (scheduled.clip.type === 'audio') {
      this.startAudioClip(scheduled, scheduled.clip as AudioClip);
    } else {
      this.startMIDIClip(scheduled, scheduled.clip as MIDIClip);
    }

    this.emit({
      type: 'clip-started',
      trackId: scheduled.trackId,
      slotIndex: scheduled.slotIndex,
    });
  }

  private startAudioClip(scheduled: ScheduledClip, clip: AudioClip): void {
    const now = this.context.currentTime;
    const clipStartBeats = scheduled.launchTime;
    const clipDuration = clip.duration;

    for (const region of clip.regions) {
      const sample = this.sampleCache.get(region.sampleId);
      if (!sample) continue;

      const source = this.context.createBufferSource();
      source.buffer = sample;

      // Apply region settings
      const gainNode = this.context.createGain();
      gainNode.gain.value = region.gain;

      source.connect(gainNode);
      gainNode.connect(this.destination);

      // Calculate timing
      const regionStartTime = now + beatsToSeconds(region.start, this.bpm);
      const duration = beatsToSeconds(region.duration, this.bpm);

      // Handle looping
      if (clip.loopEnabled) {
        source.loop = true;
        source.loopStart = beatsToSeconds(clip.loopStart || 0, this.bpm);
        source.loopEnd = beatsToSeconds(clip.loopEnd || clipDuration, this.bpm);
      }

      source.start(regionStartTime, region.offset, clip.loopEnabled ? undefined : duration);

      scheduled.sources.push(source);

      source.onended = () => {
        const idx = scheduled.sources.indexOf(source);
        if (idx !== -1) scheduled.sources.splice(idx, 1);
        gainNode.disconnect();
      };
    }
  }

  private startMIDIClip(scheduled: ScheduledClip, clip: MIDIClip): void {
    const now = this.context.currentTime;

    // Schedule all notes
    for (const note of clip.notes) {
      const noteStartTime = now + beatsToSeconds(note.start, this.bpm);
      const noteEndTime = noteStartTime + beatsToSeconds(note.duration, this.bpm);

      scheduled.midiEvents.push({
        noteId: note.id,
        note: note.note,
        velocity: note.velocity,
        startTime: noteStartTime,
        endTime: noteEndTime,
        triggered: false,
      });
    }
  }

  private processPlayingClip(
    scheduled: ScheduledClip,
    pos: Beats,
    now: number
  ): void {
    // Process MIDI events
    if (scheduled.clip.type === 'midi') {
      for (const event of scheduled.midiEvents) {
        if (!event.triggered && now >= event.startTime) {
          event.triggered = true;
          this.midiOutput?.(event.note, event.velocity, 0);
        }
        if (event.triggered && now >= event.endTime) {
          this.midiOutput?.(event.note, 0, 0);
        }
      }
    }

    // Check for loop
    const clipDuration = scheduled.clip.duration;
    const clipPos = pos - scheduled.launchTime;

    if (scheduled.clip.loopEnabled !== false) {
      const loopEnd = scheduled.clip.loopEnd || clipDuration;
      if (clipPos >= loopEnd * (scheduled.loopCount + 1)) {
        scheduled.loopCount++;

        this.emit({
          type: 'clip-looped',
          trackId: scheduled.trackId,
          slotIndex: scheduled.slotIndex,
          loopCount: scheduled.loopCount,
        });

        // Check follow actions
        if (scheduled.clip.followAction) {
          this.processFollowAction(scheduled, scheduled.clip.followAction);
        }

        // Reschedule MIDI events for next loop
        if (scheduled.clip.type === 'midi') {
          this.rescheduleMIDI(scheduled, scheduled.clip as MIDIClip);
        }
      }
    } else {
      // Non-looping clip - stop when done
      if (clipPos >= clipDuration) {
        this.stopScheduledClip(scheduled);
        this.state.playing.delete(scheduled.trackId);
      }
    }
  }

  private rescheduleMIDI(scheduled: ScheduledClip, clip: MIDIClip): void {
    const now = this.context.currentTime;
    const loopLength = beatsToSeconds(clip.loopEnd || clip.duration, this.bpm);

    // Clear old events
    scheduled.midiEvents = [];

    // Schedule next loop
    for (const note of clip.notes) {
      const noteStartTime = now + beatsToSeconds(note.start, this.bpm);
      const noteEndTime = noteStartTime + beatsToSeconds(note.duration, this.bpm);

      scheduled.midiEvents.push({
        noteId: note.id,
        note: note.note,
        velocity: note.velocity,
        startTime: noteStartTime,
        endTime: noteEndTime,
        triggered: false,
      });
    }
  }

  private processFollowAction(
    scheduled: ScheduledClip,
    followAction: FollowActionPair
  ): void {
    // Choose between action A and B based on chance
    const random = Math.random();
    const action =
      random <= followAction.actionA.chance
        ? followAction.actionA
        : followAction.actionB;

    if (action.action === 'none') return;

    this.emit({
      type: 'follow-action',
      trackId: scheduled.trackId,
      slotIndex: scheduled.slotIndex,
      action,
    });

    // Execute follow action
    switch (action.action) {
      case 'stop':
        this.stopClip(scheduled.trackId, 'none');
        break;
      case 'play-again':
        // Continue current clip (do nothing, it's looping)
        break;
      case 'next':
        // Would need track info to know next slot
        break;
      case 'previous':
        // Would need track info to know previous slot
        break;
      case 'jump':
        if (action.jumpTarget) {
          // Would need to look up clip by ID
        }
        break;
    }
  }

  private stopScheduledClip(scheduled: ScheduledClip): void {
    scheduled.state = 'stopped';

    // Stop audio sources
    for (const source of scheduled.sources) {
      try {
        source.stop();
      } catch (e) {
        // Already stopped
      }
    }
    scheduled.sources = [];

    // Stop MIDI notes
    for (const event of scheduled.midiEvents) {
      if (event.triggered) {
        this.midiOutput?.(event.note, 0, 0);
      }
    }
    scheduled.midiEvents = [];

    this.emit({
      type: 'clip-stopped',
      trackId: scheduled.trackId,
      slotIndex: scheduled.slotIndex,
    });
  }

  // =========================================================================
  // Event Handling
  // =========================================================================

  subscribe(listener: ClipLauncherListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ClipLauncherEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  // =========================================================================
  // State Query
  // =========================================================================

  getClipState(trackId: string, slotIndex: number): ClipState {
    const playing = this.state.playing.get(trackId);
    if (playing && playing.slotIndex === slotIndex) {
      return playing.state;
    }

    const triggered = this.state.triggered.get(trackId);
    if (triggered && triggered.slotIndex === slotIndex) {
      return 'triggered';
    }

    const stopping = this.state.stopping.get(trackId);
    if (stopping && stopping.slotIndex === slotIndex) {
      return 'stopping';
    }

    return 'stopped';
  }

  isPlaying(trackId: string): boolean {
    return this.state.playing.has(trackId);
  }

  getPlayingClip(trackId: string): Clip | null {
    return this.state.playing.get(trackId)?.clip || null;
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.sampleCache.clear();
  }
}
