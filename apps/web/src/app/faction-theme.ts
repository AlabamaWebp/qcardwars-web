import type { Faction } from '@qcw/game-core';

/**
 * Faction accent palettes (Phase A.1 — presentational only).
 *
 * `accent` is a bright hue readable on the dark #0c0e12–#202631 surfaces and
 * used for borders, bands, badges and tooltip-adjacent labels. `glow` is the
 * same hue at ~27% alpha for soft box-shadows (lanes). No assets/fonts.
 */
export interface FactionTheme {
  accent: string;
  glow: string;
}

export const FACTION_THEME: Record<Faction, FactionTheme> = {
  // amber/orange — burrower warmth
  antlion: { accent: '#f0a13a', glow: '#f0a13a45' },
  // cyan/steel — Combine tech
  combine: { accent: '#4fc3e8', glow: '#4fc3e845' },
  // crimson — rebel fire
  rebel: { accent: '#e8564f', glow: '#e8564f45' },
  // sickly green — the dead
  zombie: { accent: '#74c96e', glow: '#74c96e45' },
  // violet/silver — faction-agnostic
  universal: { accent: '#a98ae8', glow: '#a98ae845' },
};
