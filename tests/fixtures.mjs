import fs from 'node:fs';
import assert from 'node:assert/strict';

export const rules = await import('../lib/game.ts');
export const catalog = JSON.parse(fs.readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'));
export const cards = Object.fromEntries(catalog.map(card => [card.id, card]));
export const characters = catalog.filter(card => card.type === 'character');
export const nonCharacterIds = catalog.filter(card => card.type !== 'character').map(card => card.id).sort();
export function id(name, copy = 0) {
  const found = catalog.filter(card => card.name === name)[copy];
  assert.ok(found, `Catalog card not found: ${name}, copy ${copy}`);
  return found.id;
}
export function seeded(seed = 123456789) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
export function lobby(count = 2, selection = 'choice', goal = 50) {
  const players = Array.from({ length: count }, (_, index) => rules.newPlayer(`p${index}`, `Player ${index}`, `secret-token-${index}`));
  const game = rules.newGame('ABC234', players[0], { goal, selection });
  game.players = players;
  return game;
}
export function playing(count = 2, character = 'Yamada Hiroto', goal = 50) {
  const game = lobby(count, 'choice', goal);
  const others = ['Daikoda Jiro', 'Konda Oda', 'Junpei', 'Kotachi Yoshio', 'Aniko Jiro', 'Itsuka Reiji', 'Shidochi Yuuta'];
  game.players.forEach((player, index) => { player.characterId = id(index === 0 ? character : others[index - 1]); player.ready = true; player.turns = 1; });
  game.phase = 'playing'; game.turn = 0; game.turnNumber = count;
  game.deck = [...nonCharacterIds];
  return game;
}
function take(game, cardId) {
  const at = game.deck.indexOf(cardId);
  assert.ok(at >= 0, `Fixture tried to place an already assigned card: ${cards[cardId]?.name} (${cardId})`);
  game.deck.splice(at, 1);
  return cardId;
}
export function hand(game, playerIndex, ...cardIds) {
  game.players[playerIndex].hand.push(...cardIds.map(cardId => take(game, cardId)));
  return game;
}
export function harem(game, playerIndex, ...entries) {
  game.players[playerIndex].harem.push(...entries.map(entry => typeof entry === 'string' ? { id: take(game, entry) } : { ...entry, id: take(game, entry.id) }));
  return game;
}
export function table(game, playerIndex, ...entries) {
  game.players[playerIndex].table.push(...entries.map(entry => typeof entry === 'string' ? { id: take(game, entry) } : { ...entry, id: take(game, entry.id) }));
  return game;
}
export function allLocations(game) {
  return [
    ...game.deck, ...game.discard,
    ...game.players.flatMap(player => [...player.hand, ...player.harem.map(x => x.id), ...player.table.map(x => x.id), ...(player.endPayment?.id ? [player.endPayment.id] : [])]),
    ...(game.auction ? [game.auction.targetId, ...Object.values(game.auction.bids).flatMap(bid => bid.played)] : []),
  ];
}
export function conserved(game) {
  const found = allLocations(game).sort();
  assert.deepEqual(found, nonCharacterIds, 'Every physical non-character card must exist in exactly one game zone');
  assert.equal(new Set(found).size, found.length, 'No physical card may appear twice');
}
export function act(game, playerIndex, action, rng = seeded(22)) {
  const before = structuredClone(game);
  const next = rules.applyAction(game, `p${playerIndex}`, action, cards, rng);
  assert.deepEqual(game, before, 'Applying an action must not mutate the caller-owned previous state');
  if (next.phase !== 'lobby') conserved(next);
  return next;
}
export function rejects(game, playerIndex, action, pattern = undefined) {
  const before = structuredClone(game);
  assert.throws(() => rules.applyAction(game, `p${playerIndex}`, action, cards, seeded(22)), pattern);
  assert.deepEqual(game, before, 'Rejected action must be atomic');
}
export function stat(game, index = 0) { return rules.statsFor(game, `p${index}`, cards); }
