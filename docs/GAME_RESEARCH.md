# QCardWars public-mechanics research

Research date: 2026-09-07.

This is a **clean-room mechanics brief** assembled from public descriptions/discussions. It is not based on the
original Lua source and the repository must not import original code/assets.

## Confirmed public mechanics

Primary source: Steam Workshop item **QCardWars - Card Game in GMod!**, by MerekiDor / Octantis Addons,
Workshop ID `2718789320`.

- The game is 1v1. The original author explicitly said support for more than two players would not be added.
- Each side uses four lanes. The default lane themes are Antlion, Combine, Rebel and Zombie.
- Unit type must match a lane type, except universal units which can go anywhere.
- Units have ATK and HP.
- Cards in opposing positions fight; if a unit has no enemy unit in front of it, it damages the enemy player.
- Goal: reduce the opponent to 0 HP.
- Mana is gained/refilled at the beginning of a turn and rises as turns progress: public example says turn 1 has
  1 MP and turn 5 has 5 MP.
- Buildings can coexist with units on a lane and provide passive effects. Ordinary combat does not destroy them;
  some powers can.
- Powers are one-shot effects and may buff units, deal direct damage, manipulate/add deck cards, etc.
- Unit specials can only be activated after that unit has survived at least one turn, cost mana, and have limited
  uses.
- Custom content in the addon is data/action oriented: card parameters plus sequences such as Set HP / Set ATK.
- `Bucket` is a protected fallback/default unit when a unit is invalid or unavailable.
- The original deck generator was described by the author as separating cards into tiers and taking roughly 12
  random cards matching the selected lanes from every tier. This intentionally produces a fairly random deck.

## Publicly reported implementation limitations in the addon

These are useful warnings for the web architecture, not features to reproduce:

- deck visibility/network issues were reported under high network load;
- custom cards could fail to appear due to networking/preset issues;
- old UI/data bugs could reset special cost/description;
- presets were stored locally and had surprising load/add semantics.

The web implementation should avoid these by making the server authoritative, using a single canonical state,
and sending sanitized state snapshots/revisions after every accepted mutation.

## Unknown / not reliably confirmed

Do **not** claim these defaults are exact original values unless new evidence is added:

- starting player HP;
- exact mana cap;
- exact starting hand size and draw cadence;
- exact number/names of tiers;
- precise timing/order of simultaneous combat;
- exact vanilla card stats and full vanilla card catalog;
- full custom ability expression language semantics.

For these, use `docs/SPEC.md` web-baseline values. Keep them centralized/configurable.

## Sources

- Steam Workshop: https://steamcommunity.com/sharedfiles/filedetails?id=2718789320
- Steam bug/suggestion discussion: https://steamcommunity.com/workshop/filedetails/discussion/2718789320/3196993316885100881/
- Public deck-generation quote is visible in that discussion around the posts explaining tier-based random decks.
- Secondary mirror used only to corroborate the public description: https://catalogue.smods.ru/archives/347583

## IP boundary

Mechanics can be recreated, but do not ship Valve/Garry's Mod/QCardWars proprietary models, card art, audio or
copied Lua source. This scaffold uses text/CSS placeholders. If the project is later released publicly, consider
an original title/faction reskin and verify branding/licensing separately.
