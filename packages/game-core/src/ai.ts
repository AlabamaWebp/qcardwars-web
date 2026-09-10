import { getCard } from './cards';
import { applyAction } from './engine';
import { CardKind, GameAction, GameState, PlayerId } from './types';

/** Display name of the solo AI seat (shared so the client can recognize solo matches). */
export const AI_PLAYER_NAME = 'AI Opponent';

/**
 * Phase D D-1 — deterministic solo-AI policy.
 *
 * Chooses exactly ONE action per call; the server drives one call per tick
 * (~700 ms) so the AI plays at a readable pace. Legality is never
 * re-implemented here: every candidate is validated by trial-applying it
 * through `applyAction` (which is pure — it clones before mutating), and the
 * first candidate that applies cleanly wins. When nothing else is legal the
 * AI ends its turn, so a solo match can never wedge on the AI's turn.
 *
 * Policy (highest cost first, so the AI spends its budget every turn):
 *   1. Play the highest-cost hand card with a legal play.
 *   2. Otherwise activate the first legal ready special.
 *   3. Otherwise end the turn.
 */
export function chooseAiAction(state: GameState, playerId: PlayerId): GameAction | null {
  if (state.status !== 'playing' || state.activePlayerId !== playerId) return null;
  const player = state.players[playerId];
  const revision = state.revision;
  const laneIndices = state.lanes.map((lane) => lane.index);

  // 1) Cards, highest cost first (stable sort: ties keep hand order).
  const hand = [...player.hand].sort((a, b) => getCard(b.cardId).cost - getCard(a.cardId).cost);
  for (const handCard of hand) {
    const card = getCard(handCard.cardId);
    if (card.cost > player.mana) continue;
    for (const action of playCandidates(revision, playerId, handCard.uid, card.kind, laneIndices)) {
      if (tryApply(state, action)) return action;
    }
  }

  // 2) Specials: first ready unit with a legal activation (own lane tried first for targeted specials).
  for (const lane of state.lanes) {
    const unit = lane.sides[playerId].unit;
    if (!unit) continue;
    const unitCard = getCard(unit.cardId);
    const special = unitCard.kind === 'unit' ? unitCard.special : undefined;
    if (!special) continue;
    if (special.target === 'friendly-unit' || special.target === 'enemy-unit') {
      for (const targetLaneIndex of [lane.index, ...laneIndices.filter((i) => i !== lane.index)]) {
        const action: GameAction = {
          type: 'activate-special',
          expectedRevision: revision,
          playerId,
          laneIndex: lane.index,
          targetLaneIndex,
        };
        if (tryApply(state, action)) return action;
      }
    } else {
      const action: GameAction = {
        type: 'activate-special',
        expectedRevision: revision,
        playerId,
        laneIndex: lane.index,
      };
      if (tryApply(state, action)) return action;
    }
  }

  // 3) End the turn (always legal on your own playing turn).
  return { type: 'end-turn', expectedRevision: revision, playerId };
}

function playCandidates(
  revision: number,
  playerId: PlayerId,
  handCardUid: string,
  kind: CardKind,
  laneIndices: number[],
): GameAction[] {
  if (kind === 'power') {
    // No lane first (covers 'none' and 'enemy-hero' powers), then every lane.
    return [
      { type: 'play-card', expectedRevision: revision, playerId, handCardUid },
      ...laneIndices.map(
        (i): GameAction => ({
          type: 'play-card',
          expectedRevision: revision,
          playerId,
          handCardUid,
          laneIndex: i,
          targetLaneIndex: i,
        }),
      ),
    ];
  }
  return laneIndices.map(
    (i): GameAction => ({
      type: 'play-card',
      expectedRevision: revision,
      playerId,
      handCardUid,
      laneIndex: i,
    }),
  );
}

/**
 * Trial-apply an action. `applyAction` is pure (clones before mutating), so a
 * passing OR failing trial leaves `state` untouched; the caller re-applies the
 * returned action for real.
 */
function tryApply(state: GameState, action: GameAction): boolean {
  try {
    applyAction(state, action);
    return true;
  } catch {
    return false;
  }
}
