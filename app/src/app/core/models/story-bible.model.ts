/**
 * The Story Bible — the single source of truth for a comic.
 *
 * See `app/docs/STORY_ENGINE_PLAN.md` for the full rationale. In short: a comic
 * is authored as ONE persistent, hierarchical object, generated top-down from
 * the user's idea. Every wizard step reads from it and writes exactly one level
 * deeper; a child node may only ELABORATE its parent, never invent new plot
 * facts (the "containment contract"). The rendered pages/panels the reader shows
 * are a deterministic PROJECTION of this Bible, not a parallel source of truth.
 *
 * This file defines the shape only. Generation, projection, persistence, and the
 * wizard bindings are layered on in later milestones.
 */

import { ImageRef, LayoutId, BubbleKind } from './comic.model';
import { newId } from '../util/id';
import { timestamp } from '../util/time';
import { DEFAULT_STYLE_ID } from '../style/art-styles';

/**
 * A value paired with its provenance. Every AI-fillable field is wrapped in this
 * so the UI can badge AI suggestions, regeneration can skip user-locked fields,
 * and export records what was authored vs inferred.
 *
 * - `source` — who produced the current value.
 * - `locked` — the user has pinned it; regeneration must not overwrite it.
 *   (Editing an AI field flips it to `source:'user', locked:true`.)
 */
export interface Authored<T> {
  value: T;
  source: 'user' | 'ai';
  locked: boolean;
}

/** One plant→payoff pair from the dramatic spine. */
export interface SetupPair {
  plant: string;
  payoff: string;
}

/** The locked visual world every art prompt inherits — the visual-continuity anchor. */
export interface VisualStyle {
  /** Colour direction, e.g. "muted earth + ochre, dusk light". */
  palette: string;
  /** Rendering direction, e.g. "inked graphic-novel line, cross-hatch shadows". */
  rendering: string;
  /** The chosen art-style id (see art-styles.ts) every panel prompt adapts to. */
  styleId: string;
}

/**
 * The guided intake. `premise` is the seed the user is asked to provide; the
 * rest may be left blank for the AI to invent (each then carries `source:'ai'`).
 */
export interface StorySetup {
  premise: Authored<string>;
  /** Freeform "who's in it" — later expanded into `characters[]`. */
  characters: Authored<string>;
  /** Where — world / place. */
  setting: Authored<string>;
  /** When — time period / timeline / era. */
  era: Authored<string>;
  /** Feel — genre / mood. */
  tone: Authored<string>;
  /** Any plot the user already has in mind. */
  storyline: Authored<string>;
}

/**
 * The dramatic architecture. Persisted (unlike the old pipeline, which computed
 * this and threw it away) so every downstream level stays anchored to the same
 * question, climax, ending, and plant→payoff setups.
 */
export interface StorySpine {
  logline: Authored<string>;
  theme: Authored<string>;
  dramaticQuestion: Authored<string>;
  climax: Authored<string>;
  resolution: Authored<string>;
  setups: Authored<SetupPair[]>;
  visualStyle: VisualStyle;
}

/** A fully-designed character in the Bible. */
export interface BibleCharacter {
  id: string;
  name: Authored<string>;
  /** Locked visual description — the per-character art-consistency anchor. */
  appearance: Authored<string>;
  traits: Authored<string>;
  role: Authored<string>;
  /** How this character changes across the story. */
  arc: Authored<string>;
  /** Optional locked "character reference" portrait for consistent faces. */
  referenceImageRef?: ImageRef;
}

/**
 * A snapshot of the story world at a scene boundary. A scene's `entryState` must
 * chain from the previous scene's `exitState` (or explicitly bridge it) — this
 * is what makes page-to-page continuity literal and checkable instead of hoped-for.
 */
export interface ContinuityState {
  location: string;
  time: string;
  /** Character ids currently on stage. */
  present: string[];
  /** Salient props each character/scene is holding or showing, e.g. { arun: "curved sword" }. */
  props: Record<string, string>;
  mood: string;
  /** What the reader now knows at this point — the information thread. */
  knowledge: string;
}

/**
 * One scene ≈ one page. Maps to a spine beat/setup, carries its dramatic job,
 * and pins the continuity state at its edges.
 */
export interface Scene {
  id: string;
  /** Which spine setup/beat this scene delivers (for coverage checks). */
  mapsToSetup?: string;
  /**
   * The scene written as vivid narrative PROSE — the "good story" layer. Generated
   * BEFORE the panels so the dialogue and art briefs are DERIVED from it (grounded
   * in real narrative, not a one-line summary). Also what the "Read the full story"
   * reading renders, woven scene by scene.
   */
  prose?: Authored<string>;
  goal: Authored<string>;
  conflict: Authored<string>;
  turn: Authored<string>;
  entryState: Authored<ContinuityState>;
  exitState: Authored<ContinuityState>;
  layout?: LayoutId;
  sections: Section[];
}

/**
 * One section ≈ one panel. The leaf: it elaborates its scene into a single
 * drawable moment + one line of dialogue, and holds the self-contained art brief
 * (which inherits the locked world and character appearances).
 */
export interface Section {
  id: string;
  /** What visibly happens in this panel. */
  moment: Authored<string>;
  /** Shot type / camera direction. */
  cameraHint: Authored<string>;
  /** Who speaks/thinks (character id or name); "" for a silent beat. */
  speaker: Authored<string>;
  /** The lettered line — never a placeholder. */
  line: Authored<string>;
  dialogueKind: BubbleKind;
  /** A narration/caption on the panel (scene premise, bridge, or context). */
  narration: Authored<string>;
  /** Self-contained image-generation brief; the panel art is regenerable from this. */
  artPrompt: Authored<string>;
  /** The rendered panel art, once generated/uploaded. Optional. */
  imageRef?: ImageRef;

  // Draggable speech-bubble placement (see page-preview.ts). Unset = defaults.
  bubbleX?: number;
  bubbleY?: number;
  tailX?: number;
  tailY?: number;
  tailAngle?: number;
}

/** The current on-disk shape of a Bible; bump when the schema changes. */
export const STORY_BIBLE_SCHEMA_VERSION = 1;

/** The single source of truth for one comic. */
export interface StoryBible {
  schemaVersion: number;
  id: string;
  title: Authored<string>;
  createdAt: number;
  updatedAt: number;

  setup: StorySetup;
  spine: StorySpine;
  characters: BibleCharacter[];
  scenes: Scene[];

  /** Author credit (optional, shown on covers). */
  author?: string;
  /** Cover art, if generated/uploaded. */
  coverImageRef?: ImageRef;
  backCoverImageRef?: ImageRef;
  /** True while still being authored (resumable draft on the shelf). */
  draft?: boolean;
}

// ── Small constructors so provenance is never forgotten ──────────────────────

/** Wrap a user-provided value. */
export function userField<T>(value: T): Authored<T> {
  return { value, source: 'user', locked: true };
}

/** Wrap an AI-generated value (unlocked — the user may still edit/accept it). */
export function aiField<T>(value: T): Authored<T> {
  return { value, source: 'ai', locked: false };
}

/** An empty, user-owned field (nothing provided yet). */
export function emptyField<T>(empty: T): Authored<T> {
  return { value: empty, source: 'user', locked: false };
}

/**
 * A fresh, empty Story Bible — a valid tree the wizard can start filling. Every
 * setup/spine field begins as an empty user-owned field (nothing provided yet);
 * generation fills the gaps as `source:'ai'`.
 */
export function emptyBible(styleId: string = DEFAULT_STYLE_ID): StoryBible {
  const now = timestamp();
  return {
    schemaVersion: STORY_BIBLE_SCHEMA_VERSION,
    id: newId('bible'),
    title: emptyField(''),
    createdAt: now,
    updatedAt: now,
    setup: {
      premise: emptyField(''),
      characters: emptyField(''),
      setting: emptyField(''),
      era: emptyField(''),
      tone: emptyField(''),
      storyline: emptyField(''),
    },
    spine: {
      logline: emptyField(''),
      theme: emptyField(''),
      dramaticQuestion: emptyField(''),
      climax: emptyField(''),
      resolution: emptyField(''),
      setups: emptyField<SetupPair[]>([]),
      visualStyle: { palette: '', rendering: '', styleId },
    },
    characters: [],
    scenes: [],
    draft: true,
  };
}
