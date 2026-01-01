/**
 * Piano - Piano roll editor for zDAW
 *
 * Features:
 * - MIDI note display and editing
 * - Note drawing, selection, move, resize
 * - Velocity editing
 * - Grid snap
 * - Keyboard for preview
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  MouseEvent,
} from 'react';
import type { MIDINoteData, MIDINote, MIDIVelocity, Beats } from '../types';
import { generateId, noteToName, quantize } from '../types';

interface PianoRollProps {
  notes: MIDINoteData[];
  clipDuration: Beats;
  gridSnap: Beats;
  zoom: number;
  selectedNotes: string[];
  onNotesChange: (notes: MIDINoteData[]) => void;
  onNoteSelect: (noteIds: string[]) => void;
  onNotePreview?: (note: MIDINote) => void;
  onNoteRelease?: (note: MIDINote) => void;
}

const NOTE_HEIGHT = 12;
const KEY_WIDTH = 48;
const BEAT_WIDTH_BASE = 60;
const TOTAL_NOTES = 128;
const VELOCITY_HEIGHT = 60;

// Note colors
const isBlackKey = (note: number): boolean => {
  const n = note % 12;
  return [1, 3, 6, 8, 10].includes(n);
};

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  clipDuration,
  gridSnap,
  zoom,
  selectedNotes,
  onNotesChange,
  onNoteSelect,
  onNotePreview,
  onNoteRelease,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState((128 - 72) * NOTE_HEIGHT); // Start around C4
  const [tool, setTool] = useState<'select' | 'draw' | 'erase'>('draw');
  const [dragging, setDragging] = useState<{
    type: 'draw' | 'move' | 'resize' | 'velocity';
    noteId?: string;
    startX: number;
    startY: number;
    startBeat?: Beats;
    startNote?: MIDINote;
    edge?: 'left' | 'right';
    startVelocity?: MIDIVelocity;
  } | null>(null);

  const beatWidth = BEAT_WIDTH_BASE * zoom;
  const totalWidth = clipDuration * beatWidth;
  const totalHeight = TOTAL_NOTES * NOTE_HEIGHT;

  // Convert x to beats
  const xToBeats = useCallback(
    (x: number): Beats => {
      return (x - KEY_WIDTH + scrollX) / beatWidth;
    },
    [scrollX, beatWidth]
  );

  // Convert y to note
  const yToNote = useCallback(
    (y: number): MIDINote => {
      return (127 - Math.floor((y + scrollY) / NOTE_HEIGHT)) as MIDINote;
    },
    [scrollY]
  );

  // Convert beats to x
  const beatsToX = useCallback(
    (beats: Beats): number => {
      return KEY_WIDTH + beats * beatWidth - scrollX;
    },
    [scrollX, beatWidth]
  );

  // Convert note to y
  const noteToY = useCallback(
    (note: MIDINote): number => {
      return (127 - note) * NOTE_HEIGHT - scrollY;
    },
    [scrollY]
  );

  // Handle wheel for scroll
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        setScrollX((prev) => Math.max(0, Math.min(totalWidth - 600, prev + e.deltaY)));
      } else {
        setScrollY((prev) => Math.max(0, Math.min(totalHeight - 300, prev + e.deltaY)));
      }
    },
    [totalWidth, totalHeight]
  );

  // Handle mouse down on grid
  const handleGridMouseDown = useCallback(
    (e: MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if in velocity lane
      if (y > totalHeight - scrollY + 10) {
        // Velocity editing
        for (const note of notes) {
          const noteX = beatsToX(note.start);
          const noteEndX = beatsToX(note.start + note.duration);
          if (x >= noteX && x <= noteEndX) {
            setDragging({
              type: 'velocity',
              noteId: note.id,
              startX: x,
              startY: y,
              startVelocity: note.velocity,
            });
            return;
          }
        }
        return;
      }

      const beat = xToBeats(x);
      const noteNum = yToNote(y);

      // Check if clicking on existing note
      for (const note of notes) {
        if (
          noteNum === note.note &&
          beat >= note.start &&
          beat <= note.start + note.duration
        ) {
          if (tool === 'erase') {
            // Delete note
            onNotesChange(notes.filter((n) => n.id !== note.id));
            return;
          }

          // Check for resize edges
          const noteX = beatsToX(note.start);
          const noteEndX = beatsToX(note.start + note.duration);

          if (Math.abs(x - noteX) < 6) {
            setDragging({
              type: 'resize',
              noteId: note.id,
              startX: x,
              startY: y,
              startBeat: note.start,
              edge: 'left',
            });
          } else if (Math.abs(x - noteEndX) < 6) {
            setDragging({
              type: 'resize',
              noteId: note.id,
              startX: x,
              startY: y,
              startBeat: note.start + note.duration,
              edge: 'right',
            });
          } else {
            // Move note
            setDragging({
              type: 'move',
              noteId: note.id,
              startX: x,
              startY: y,
              startBeat: note.start,
              startNote: note.note,
            });

            // Select note
            if (!e.shiftKey) {
              onNoteSelect([note.id]);
            } else {
              onNoteSelect([...selectedNotes, note.id]);
            }
          }

          onNotePreview?.(note.note);
          return;
        }
      }

      // Drawing new note
      if (tool === 'draw' || tool === 'select') {
        const snappedBeat = quantize(beat, gridSnap);
        const newNote: MIDINoteData = {
          id: generateId(),
          note: noteNum,
          velocity: 100 as MIDIVelocity,
          start: snappedBeat,
          duration: gridSnap,
        };

        setDragging({
          type: 'draw',
          noteId: newNote.id,
          startX: x,
          startY: y,
          startBeat: snappedBeat,
        });

        onNotesChange([...notes, newNote]);
        onNoteSelect([newNote.id]);
        onNotePreview?.(noteNum);
      }
    },
    [
      notes,
      tool,
      xToBeats,
      yToNote,
      beatsToX,
      gridSnap,
      selectedNotes,
      onNotesChange,
      onNoteSelect,
      onNotePreview,
      scrollY,
      totalHeight,
    ]
  );

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const deltaX = x - dragging.startX;
      const deltaY = y - dragging.startY;
      const deltaBeat = deltaX / beatWidth;
      const deltaNote = -Math.round(deltaY / NOTE_HEIGHT);

      if (dragging.type === 'draw' && dragging.noteId) {
        const beat = xToBeats(x);
        const snappedBeat = quantize(Math.max(0, beat), gridSnap);
        const duration = Math.max(gridSnap, snappedBeat - dragging.startBeat!);

        onNotesChange(
          notes.map((n) =>
            n.id === dragging.noteId ? { ...n, duration } : n
          )
        );
      }

      if (dragging.type === 'move' && dragging.noteId) {
        const newStart = quantize(
          Math.max(0, dragging.startBeat! + deltaBeat),
          gridSnap
        );
        const newNote = Math.max(
          0,
          Math.min(127, dragging.startNote! + deltaNote)
        ) as MIDINote;

        onNotesChange(
          notes.map((n) =>
            n.id === dragging.noteId ? { ...n, start: newStart, note: newNote } : n
          )
        );
      }

      if (dragging.type === 'resize' && dragging.noteId) {
        onNotesChange(
          notes.map((n) => {
            if (n.id !== dragging.noteId) return n;

            if (dragging.edge === 'left') {
              const newStart = quantize(
                Math.max(0, dragging.startBeat! + deltaBeat),
                gridSnap
              );
              const newDuration = n.start + n.duration - newStart;
              if (newDuration >= gridSnap) {
                return { ...n, start: newStart, duration: newDuration };
              }
            } else {
              const newEnd = quantize(dragging.startBeat! + deltaBeat, gridSnap);
              const newDuration = newEnd - n.start;
              if (newDuration >= gridSnap) {
                return { ...n, duration: newDuration };
              }
            }
            return n;
          })
        );
      }

      if (dragging.type === 'velocity' && dragging.noteId) {
        const velocityDelta = Math.round(-deltaY / 2);
        const newVelocity = Math.max(
          1,
          Math.min(127, (dragging.startVelocity ?? 100) + velocityDelta)
        ) as MIDIVelocity;

        onNotesChange(
          notes.map((n) =>
            n.id === dragging.noteId ? { ...n, velocity: newVelocity } : n
          )
        );
      }
    },
    [dragging, notes, beatWidth, xToBeats, gridSnap, onNotesChange]
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (dragging?.type === 'move' || dragging?.type === 'draw') {
      const note = notes.find((n) => n.id === dragging.noteId);
      if (note) {
        onNoteRelease?.(note.note);
      }
    }
    setDragging(null);
  }, [dragging, notes, onNoteRelease]);

  // Handle keyboard click
  const handleKeyClick = useCallback(
    (note: MIDINote) => {
      onNotePreview?.(note);
    },
    [onNotePreview]
  );

  const handleKeyRelease = useCallback(
    (note: MIDINote) => {
      onNoteRelease?.(note);
    },
    [onNoteRelease]
  );

  // Delete selected notes on backspace/delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedNotes.length > 0) {
          onNotesChange(notes.filter((n) => !selectedNotes.includes(n.id)));
          onNoteSelect([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notes, selectedNotes, onNotesChange, onNoteSelect]);

  // Render piano keys
  const renderKeys = () => {
    const keys: JSX.Element[] = [];
    const startNote = Math.max(0, Math.floor(scrollY / NOTE_HEIGHT));
    const endNote = Math.min(127, startNote + Math.ceil(400 / NOTE_HEIGHT));

    for (let i = startNote; i <= endNote; i++) {
      const note = (127 - i) as MIDINote;
      const y = i * NOTE_HEIGHT - scrollY;
      const isBlack = isBlackKey(note);
      const isC = note % 12 === 0;

      keys.push(
        <g
          key={note}
          onMouseDown={() => handleKeyClick(note)}
          onMouseUp={() => handleKeyRelease(note)}
          onMouseLeave={() => handleKeyRelease(note)}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={0}
            y={y}
            width={isBlack ? KEY_WIDTH * 0.65 : KEY_WIDTH}
            height={NOTE_HEIGHT}
            fill={isBlack ? '#222' : '#ddd'}
            stroke="#333"
            strokeWidth={0.5}
          />
          {isC && (
            <text
              x={4}
              y={y + NOTE_HEIGHT - 2}
              fill="#555"
              fontSize={9}
              fontWeight={600}
            >
              {noteToName(note)}
            </text>
          )}
        </g>
      );
    }

    return keys;
  };

  // Render grid
  const renderGrid = () => {
    const lines: JSX.Element[] = [];

    // Horizontal lines (notes)
    const startNote = Math.floor(scrollY / NOTE_HEIGHT);
    const endNote = Math.min(127, startNote + Math.ceil(400 / NOTE_HEIGHT));

    for (let i = startNote; i <= endNote; i++) {
      const y = i * NOTE_HEIGHT - scrollY;
      const note = 127 - i;
      const isBlack = isBlackKey(note);
      const isC = note % 12 === 0;

      lines.push(
        <rect
          key={`row-${i}`}
          x={0}
          y={y}
          width={totalWidth}
          height={NOTE_HEIGHT}
          fill={isBlack ? '#1a1a1a' : '#222'}
          stroke={isC ? '#444' : '#2a2a2a'}
          strokeWidth={isC ? 1 : 0.5}
        />
      );
    }

    // Vertical lines (beats)
    const startBeat = Math.floor(scrollX / beatWidth);
    const endBeat = Math.ceil((scrollX + 800) / beatWidth);

    for (let beat = startBeat; beat <= endBeat; beat++) {
      const x = beat * beatWidth - scrollX;
      const isBar = beat % 4 === 0;

      lines.push(
        <line
          key={`beat-${beat}`}
          x1={x}
          y1={0}
          x2={x}
          y2={totalHeight}
          stroke={isBar ? '#444' : '#333'}
          strokeWidth={isBar ? 1 : 0.5}
        />
      );
    }

    return lines;
  };

  // Render notes
  const renderNotes = () => {
    return notes.map((note) => {
      const x = beatsToX(note.start);
      const y = noteToY(note.note);
      const width = note.duration * beatWidth;
      const isSelected = selectedNotes.includes(note.id);

      // Skip if out of view
      if (y < -NOTE_HEIGHT || y > 500) return null;
      if (x + width < 0 || x > 900) return null;

      return (
        <g key={note.id}>
          <rect
            x={x}
            y={y + 1}
            width={width - 1}
            height={NOTE_HEIGHT - 2}
            fill={`hsl(${(note.velocity / 127) * 30 + 200}, 70%, ${50 + (note.velocity / 127) * 20}%)`}
            stroke={isSelected ? '#fff' : 'transparent'}
            strokeWidth={2}
            rx={2}
          />
          {/* Velocity indicator */}
          <rect
            x={x}
            y={y + NOTE_HEIGHT - 3}
            width={(note.velocity / 127) * (width - 1)}
            height={2}
            fill="#fff"
            opacity={0.3}
          />
        </g>
      );
    });
  };

  // Render velocity lane
  const renderVelocityLane = () => {
    return notes.map((note) => {
      const x = beatsToX(note.start);
      const width = note.duration * beatWidth;
      const height = (note.velocity / 127) * VELOCITY_HEIGHT;
      const isSelected = selectedNotes.includes(note.id);

      if (x + width < 0 || x > 900) return null;

      return (
        <rect
          key={`vel-${note.id}`}
          x={x}
          y={VELOCITY_HEIGHT - height}
          width={width - 1}
          height={height}
          fill={isSelected ? '#3b82f6' : '#666'}
          rx={2}
        />
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a]">
      {/* Toolbar */}
      <div className="h-8 flex items-center gap-2 px-2 bg-[#252525] border-b border-black">
        <div className="flex gap-1">
          <button
            onClick={() => setTool('select')}
            className={`px-2 py-1 text-xs rounded ${
              tool === 'select' ? 'bg-blue-600' : 'bg-white/10'
            }`}
          >
            Select
          </button>
          <button
            onClick={() => setTool('draw')}
            className={`px-2 py-1 text-xs rounded ${
              tool === 'draw' ? 'bg-blue-600' : 'bg-white/10'
            }`}
          >
            Draw
          </button>
          <button
            onClick={() => setTool('erase')}
            className={`px-2 py-1 text-xs rounded ${
              tool === 'erase' ? 'bg-red-600' : 'bg-white/10'
            }`}
          >
            Erase
          </button>
        </div>

        <div className="h-4 w-px bg-white/20" />

        <span className="text-xs text-white/50">Grid:</span>
        <span className="text-xs text-white/70">{gridSnap} beat</span>

        <div className="flex-1" />

        <span className="text-xs text-white/50">{notes.length} notes</span>
      </div>

      {/* Main area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width="100%" height="100%">
          {/* Piano keys */}
          <g>
            {renderKeys()}
          </g>

          {/* Grid and notes area */}
          <g
            transform={`translate(${KEY_WIDTH}, 0)`}
            onMouseDown={handleGridMouseDown}
          >
            {renderGrid()}
            {renderNotes()}
          </g>
        </svg>
      </div>

      {/* Velocity lane */}
      <div
        className="h-16 bg-[#1a1a1a] border-t border-black"
        onMouseDown={handleGridMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <svg width="100%" height="100%">
          <g transform={`translate(${KEY_WIDTH}, 0)`}>
            <rect x={0} y={0} width="100%" height={VELOCITY_HEIGHT} fill="#111" />
            {renderVelocityLane()}
          </g>
          {/* Label */}
          <text x={4} y={12} fill="#666" fontSize={10}>VEL</text>
        </svg>
      </div>
    </div>
  );
};
