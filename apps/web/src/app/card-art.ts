/**
 * Card art wiring (request: "подключить картинки").
 *
 * Served images live in `apps/web/public/cards/<card-id>.png` (copied by the
 * Angular build to `/cards/…`, same origin in dev and in the LAN prod build).
 * 72 of the 87 catalog cards have generated art; the 15 M1/M2 depth cards do
 * not yet, so they temporarily alias the closest existing art (same faction +
 * kind wherever possible) until real art is generated from the prompts being
 * appended to `public/cards/cards.csv`. Every `<img>` using this helper must
 * hide itself on `error` so a missing file falls back to the CSS placeholder.
 */
const ART_ALIAS: Record<string, string> = {
  // Same card family: "Spore Carrier" is the renamed "Plague Bearer".
  'zombie-plague-bearer': 'zombie-plague',
  // Same faction + kind stand-ins for the remaining depth-pass cards.
  'power-stasis-field': 'power-overclock',
  'power-terror-raid': 'power-scorch',
  'universal-demolition-volunteer': 'universal-mercenary',
  'universal-drill-sergeant': 'universal-guard',
  'antlion-tunnel-harrier': 'antlion-hunter',
  'antlion-chitin-skirmisher': 'antlion-guard',
  'antlion-nectar-swarm': 'antlion-swarm',
  'combine-riot-marshal': 'combine-metrocop',
  'combine-metro-bouncer': 'combine-elite',
  'rebel-propaganda-runner': 'rebel-scout',
  'rebel-wrench-tinker': 'rebel-engineer',
  'zombie-rotting-warden': 'zombie-brute',
  'wraith-phantom-harrier': 'wraith-stalker',
  'guardian-sacred-sentinel': 'guardian-sentinel',
};

/** Absolute same-origin URL of the art file for a catalog card id. */
export function cardArtUrl(cardId: string): string {
  const file = ART_ALIAS[cardId] ?? cardId;
  return `/cards/${file}.png`;
}

/** `<img (error)>` handler: hide the broken image, keep the CSS placeholder. */
export function hideBrokenArt(event: Event): void {
  const node = event.target as HTMLImageElement | null;
  if (node) node.style.display = 'none';
}
