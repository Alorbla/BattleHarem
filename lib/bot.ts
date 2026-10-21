import { applyAction, bidPreview, capacityPlayers, RuleError, specialsFor, statsFor } from "./game.ts";
import type { Action, Card, Cards, Game, Permanent, Player, Stats } from "./game.ts";

// Decisions only receive this observation. In particular, speculative draws and
// random opponent-card reservations cannot reveal the real shuffled deck/hand.
function observation(game: Game, playerId: string): Game {
  const { players, deck: _deck, discard: _discard, ...visible } = game;
  return structuredClone({
    ...visible, deck: [], discard: [], logs: [], events: [],
    players: players.map(player => ({
      ...player, tokenHash: "",
      hand: player.id === playerId ? [...player.hand] : Array.from({ length: player.hand.length }, (_, index) => `hidden:${player.id}:${index}`),
      ...(player.endPayment ? { endPayment: { kind: "opponent" as const, ownerId: player.endPayment.ownerId, id: `reserved:${player.id}` } } : {}),
    })),
  });
}

type Search = { game: Game; player: Player; cards: Cards; now: number; attempts: number; previews: number; planLimit: number; previewLimit: number };
type Choice = { action: Action; value: number };
type Bid = { selected: string[]; expense: number; power: number };
const noRandom = () => 0.375;
const LIMIT_ATTEMPTS = 84;
const LIMIT_PREVIEWS = 160;
const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const own = (game: Game, playerId: string) => game.players.find(player => player.id === playerId)!;
const deficit = (stats: Stats) => Math.max(0, stats.usedStars - stats.stars) + Math.max(0, stats.usedSlots - stats.slots);

function attempt(search: Search, game: Game, action: Action): Game | null {
  if (search.attempts++ >= LIMIT_ATTEMPTS) return null;
  try { return applyAction(game, search.player.id, action, search.cards, noRandom, search.now); }
  catch (error) { if (error instanceof RuleError) return null; throw error; }
}

function preview(search: Search, game: Game, target: string, selected: string[]): number | null {
  if (search.previews++ >= search.previewLimit) return null;
  try { return bidPreview(game, search.player.id, target, selected, search.cards); }
  catch (error) { if (error instanceof RuleError) return null; throw error; }
}

function replacePlayer(game: Game, player: Player): Game {
  return { ...game, players: game.players.map(current => current.id === player.id ? player : current) };
}

function statsValue(stats: Stats, goal: number): number {
  // Unused capacity is valuable, but a huge empty capacity should not outweigh
  // actually acquiring hearts. The deficit penalty also protects Charge combos.
  return stats.hearts * 4.8 + Math.max(0, stats.hearts - goal + 8) * 1.1
    + Math.min(stats.stars, stats.usedStars + 5) * 1.15
    + stats.tames * 3 + stats.hand * 1.8
    + Math.min(5, stats.freeSlots) * 2 + Math.min(4, stats.freeStars) * 0.35
    - deficit(stats) * 80;
}

function boardValue(game: Game, playerId: string, cards: Cards, knownStats?: Stats): number {
  const player = own(game, playerId);
  let value = statsValue(knownStats || statsFor(game, playerId, cards), game.options.goal);
  for (const entry of player.table) {
    const card = cards[entry.id];
    if (card.type === "charge") value += 2 + (card.base.tames || 0) * 0.65 + ((entry.readyAt || 0) <= player.turns ? 0.5 : 0);
  }
  for (const special of specialsFor(player, cards)) {
    if (special.special === "endWithOpponentCard") value += 2;
    if (special.special === "endWithDeadGirl") value += 0.8;
    if (["kill", "revive", "killRevive"].includes(special.special)) value += player.harem.some(entry => cards[entry.id].type === "girl") ? 0.8 : 0.2;
  }
  if (game.phase === "finished") value += game.winnerId === playerId ? 100000 : -100000;
  return value;
}

function withAcquisition(game: Game, playerId: string, cardId: string): Game {
  const player = own(game, playerId);
  return replacePlayer({ ...game, auction: null }, { ...player, harem: [...player.harem, { id: cardId }] });
}

function acquisitionValue(game: Game, playerId: string, cardId: string, cards: Cards, currentValue?: number): number {
  return boardValue(withAcquisition(game, playerId, cardId), playerId, cards) - (currentValue ?? boardValue(game, playerId, cards));
}

function roughPower(card: Card): number {
  return (card.base.tames || 0) + card.effects.filter(effect => effect.stat === "tames").reduce((sum, effect) => sum + effect.amount * (effect.scale ? 2 : 1), 0);
}

// The candidate set is fixed and bounded, independent of hidden card identities
// or machine timing. Singles, cheap pairs and differently ordered prefixes cover
// small bids, large bids, and Charge-dependent combinations without a powerset.
function findBid(search: Search, game: Game, target: string, initial: boolean, canReserve = false): Bid | null {
  const player = own(game, search.player.id), cards = search.cards;
  const required = initial ? cards[target].cost.tames || 0 : game.auction!.bids[game.auction!.leaderId].power + 1;
  const pool = [
    ...player.table.filter(entry => cards[entry.id].type === "charge" && (entry.readyAt || 0) <= player.turns).map(entry => entry.id),
    ...player.hand.filter(id => cards[id]?.type === "tame"),
  ].sort((a, b) => roughPower(cards[b]) - roughPower(cards[a]) || lex(a, b));
  const base = preview(search, game, target, []);
  if (base === null) return null;
  const canSpend = (ids: string[]) => game.players[game.turn].id !== player.id || player.endPayment || canReserve
    || player.hand.length - Number(initial) - ids.filter(id => cards[id].type === "tame").length >= 1;
  if (base >= required && canSpend([])) return { selected: [], expense: 0, power: base };
  const contribution: Record<string, number> = {};
  const exactSingles: Record<string, number> = {};
  for (const id of pool.slice(0, 12)) {
    const power = preview(search, game, target, [id]);
    if (power === null) break;
    exactSingles[id] = power;
    contribution[id] = power - base;
  }
  for (const id of pool) contribution[id] ??= roughPower(cards[id]);
  const price = (id: string) => cards[id].type === "charge" ? 1.6 + (cards[id].base.tames || 0) * 0.35 : 1.8 + (cards[id].base.tames || 0) * 0.18;
  const sets = new Map<string, string[]>();
  const add = (ids: string[]) => { if (ids.length && ids.length <= 40 && canSpend(ids)) sets.set([...ids].sort().join("|"), ids); };
  pool.forEach(id => add([id]));
  const shortlist = [...pool].sort((a, b) => contribution[b] / price(b) - contribution[a] / price(a) || lex(a, b)).slice(0, 10);
  for (let a = 0; a < shortlist.length; a++) for (let b = a + 1; b < shortlist.length; b++) add([shortlist[a], shortlist[b]]);
  const orders = [
    [...pool].sort((a, b) => contribution[b] - contribution[a] || lex(a, b)),
    [...pool].sort((a, b) => contribution[b] / price(b) - contribution[a] / price(a) || lex(a, b)),
    [...pool].sort((a, b) => Number(cards[b].type === "charge") - Number(cards[a].type === "charge") || contribution[b] - contribution[a] || lex(a, b)),
  ];
  for (const order of orders) for (let length = 2; length <= order.length; length++) add(order.slice(0, length));
  const estimate = (ids: string[]) => base + ids.reduce((sum, id) => sum + contribution[id], 0);
  const expense = (ids: string[]) => ids.reduce((sum, id) => sum + price(id), 0);
  const ranked = [...sets.values()].sort((a, b) => Number(estimate(b) >= required) - Number(estimate(a) >= required)
    || expense(a) - expense(b) || estimate(b) - estimate(a) || lex(a.join(), b.join()));
  // Test strong prefixes as well, even when nonlinear Charge effects make the
  // inexpensive candidates' additive estimates inaccurate.
  const candidates = [...ranked.slice(0, 22), ...orders.flatMap(order => [order, order.slice(0, Math.max(1, order.length - 1))])];
  const seen = new Set<string>();
  let best: Bid | null = null;
  for (const selected of candidates) {
    const key = [...selected].sort().join("|");
    if (seen.has(key) || !canSpend(selected)) continue;
    seen.add(key);
    const power = selected.length === 1 && exactSingles[selected[0]] !== undefined ? exactSingles[selected[0]] : preview(search, game, target, selected);
    if (power === null || power < required) continue;
    const cost = expense(selected) + (power - required) * 0.035;
    if (!best || cost < best.expense) best = { selected, expense: cost, power };
  }
  return best;
}

function reserveOpponent(search: Search, game: Game): string | undefined {
  const player = own(game, search.player.id);
  if (player.endPayment || !specialsFor(player, search.cards).some(entry => entry.special === "endWithOpponentCard")) return undefined;
  return game.players.filter(other => other.id !== player.id && other.hand.length > 0)
    .sort((a, b) => statsFor(game, b.id, search.cards).hearts - statsFor(game, a.id, search.cards).hearts || b.hand.length - a.hand.length || lex(a.id, b.id))[0]?.id;
}

function replacementSets(player: Player, card: Card, cards: Cards): string[][] {
  const all = [...player.table, ...player.harem];
  const value = (entry: Permanent) => {
    const source = cards[entry.id];
    return (entry.dead ? 0 : (source.base.hearts || 0) * 4 + (source.base.stars || 0) + (source.base.slots || 0) * 2)
      + source.effects.filter(effect => effect.amount > 0).reduce((sum, effect) => sum + effect.amount * (effect.stat === "hearts" ? 2 : 1), 0)
      + (source.type === "charge" ? 2 + (source.base.tames || 0) : 0);
  };
  const cheapest = [...all].sort((a, b) => value(a) - value(b) || lex(a.id, b.id));
  const sets = [[], ...cheapest.slice(0, 10).map(entry => [entry.id])];
  const costly = [...all].filter(entry => (cards[entry.id].cost.stars || 0) > 0)
    .sort((a, b) => (cards[b.id].cost.stars || 0) - (cards[a.id].cost.stars || 0) || value(a) - value(b) || lex(a.id, b.id));
  for (const order of [cheapest, costly]) {
    for (let length = 2; length <= Math.min(6, order.length); length++) sets.push(order.slice(0, length).map(entry => entry.id));
  }
  // A large new Harem sometimes replaces a smaller existing location.
  if (card.type === "harem") for (const entry of player.table.filter(entry => cards[entry.id].type === "harem")) sets.push([entry.id]);
  return sets;
}

function deploymentChoices(search: Search, game: Game): Choice[] {
  const player = own(game, search.player.id), cards = search.cards;
  const current = boardValue(game, player.id, cards), choices: Choice[] = [];
  const plans: { cardId: string; replace: string[] }[] = [], replacementPlans: { cardId: string; replace: string[] }[][] = [];
  for (const cardId of player.hand) {
    const card = cards[cardId];
    if (!card || !["ability", "harem", "charge"].includes(card.type)) continue;
    plans.push({ cardId, replace: [] });
    replacementPlans.push(replacementSets(player, card, cards).filter(ids => ids.length).map(replace => ({ cardId, replace })));
  }
  // Try every held card without replacement first, then round-robin its best
  // replacement candidates. Dense boards get fewer expensive rule evaluations.
  for (let index = 0; index < 24; index++) for (const list of replacementPlans) if (list[index]) plans.push(list[index]);
  for (const { cardId, replace } of plans.slice(0, search.planLimit)) {
      const card = cards[cardId];
      const removed = new Set(replace);
      const next = replacePlayer(game, { ...player, hand: player.hand.filter(id => id !== cardId),
        table: [...player.table.filter(entry => !removed.has(entry.id)), { id: cardId, ...(card.type === "charge" ? { readyAt: player.turns + 1 } : {}) }],
        harem: player.harem.filter(entry => !removed.has(entry.id)),
      });
      const stats = statsFor(next, player.id, cards);
      if (deficit(stats)) continue;
      if (player.hand.length <= 1 && !player.endPayment && stats.hearts < game.options.goal) continue;
      const value = boardValue(next, player.id, cards, stats) - current - 0.25 + (stats.hearts >= game.options.goal ? 100000 : 0);
      choices.push({ action: { type: "deploy", cardId, replace }, value });
  }
  return choices.sort((a, b) => b.value - a.value);
}

function cleanup(search: Search): Action | null {
  const { game, player, cards } = search;
  if (game.players[game.turn].id === player.id && !game.auction) {
    for (const choice of deploymentChoices(search, game).slice(0, 8)) if (attempt(search, game, choice.action)) return choice.action;
  }
  const choices: Choice[] = [];
  for (const entry of [...player.table, ...player.harem]) {
    const action = { type: "discardPermanent", cards: [entry.id] };
    const next = replacePlayer(game, { ...player, table: player.table.filter(item => item.id !== entry.id), harem: player.harem.filter(item => item.id !== entry.id) });
    choices.push({ action, value: boardValue(next, player.id, cards) - deficit(statsFor(next, player.id, cards)) * 1000 });
  }
  choices.sort((a, b) => b.value - a.value);
  for (const choice of choices) if (attempt(search, game, choice.action)) return choice.action;
  return null;
}

function summonChoices(search: Search, game: Game, maxTargets = 4): Choice[] {
  const player = own(game, search.player.id), cards = search.cards, choices: Choice[] = [];
  if (statsFor(game, player.id, cards).freeSlots < 1) return choices;
  const current = boardValue(game, player.id, cards), reserveOpponentId = reserveOpponent(search, game);
  const targets = player.hand.filter(id => ["girl", "support"].includes(cards[id]?.type))
    .map(id => ({ id, gain: acquisitionValue(game, player.id, id, cards, current) }))
    .filter(entry => entry.gain > 0).sort((a, b) => b.gain - a.gain || lex(a.id, b.id)).slice(0, maxTargets);
  for (const target of targets) {
    const bid = findBid(search, game, target.id, true, !!reserveOpponentId);
    if (!bid) continue;
    const action: Action = { type: "summon", cardId: target.id, cards: bid.selected, ...(reserveOpponentId ? { reserveOpponentId } : {}) };
    const next = attempt(search, game, action);
    if (!next) continue;
    const acquired = withAcquisition(next, player.id, target.id), stats = statsFor(acquired, player.id, cards);
    const value = boardValue(acquired, player.id, cards, stats) - current - bid.expense * 0.5 + (reserveOpponentId ? 1 : 0)
      + (stats.hearts >= game.options.goal && !deficit(stats) ? 100000 : 0);
    if (value > 0.2) choices.push({ action, value });
  }
  return choices;
}

function turnChoice(search: Search): Action | null {
  const { game, player, cards } = search, current = boardValue(game, player.id, cards);
  const choices = deploymentChoices(search, game).filter(choice => choice.value > 0.2).slice(0, 12);
  choices.push(...summonChoices(search, game));
  let specialTrials = 0;
  for (const special of specialsFor(player, cards)) {
    if (!["kill", "revive", "killRevive"].includes(special.special) || player.usedActions.includes(special.id)) continue;
    for (const target of player.harem.filter(entry => cards[entry.id].type === "girl")) {
      const mode = target.dead ? "revive" : "kill";
      if (special.special !== "killRevive" && special.special !== mode) continue;
      if (specialTrials++ >= Math.min(24, search.planLimit)) break;
      const action = { type: "special", sourceId: special.id, targetId: target.id, mode };
      const next = replacePlayer(game, { ...player, harem: player.harem.map(entry => entry.id === target.id ? { ...entry, dead: mode === "kill" } : entry) });
      const stats = statsFor(next, player.id, cards);
      const value = boardValue(next, player.id, cards, stats) - current + (stats.hearts >= game.options.goal && !deficit(stats) ? 100000 : 0);
      if (value > 0.5) choices.push({ action, value });
    }
  }
  // Make room for an affordable upgrade only after checking its complete plan.
  if (statsFor(game, player.id, cards).freeSlots === 0 && !choices.some(choice => choice.value > 2)) {
    const removals = player.harem.map(entry => {
      const next = replacePlayer(game, { ...player, harem: player.harem.filter(item => item.id !== entry.id) });
      return { id: entry.id, next, value: boardValue(next, player.id, cards) };
    }).sort((a, b) => b.value - a.value).slice(0, 3);
    for (const removal of removals) {
      if (capacityPlayers(removal.next, cards).length) continue;
      const acquired = summonChoices(search, removal.next, 2).sort((a, b) => b.value - a.value)[0];
      if (acquired && removal.value - current + acquired.value > 1.5) {
        choices.push({ action: { type: "discardPermanent", cards: [removal.id] }, value: (removal.value - current + acquired.value) * 0.8 });
      }
    }
  }
  choices.sort((a, b) => b.value - a.value);
  for (const choice of choices) if (attempt(search, game, choice.action)) return choice.action;
  return null;
}

function discardRanking(search: Search): { id: string; value: number }[] {
  const { game, player, cards } = search, stats = statsFor(game, player.id, cards);
  const current = boardValue(game, player.id, cards, stats);
  return player.hand.map(id => {
    const card = cards[id]; let value = 0;
    if (card.type === "tame") value = 3 + (card.base.tames || 0) * 1.2 + card.effects.filter(effect => effect.stat === "tames").reduce((sum, effect) => sum + Math.max(0, effect.amount) * 0.3, 0);
    else if (card.type === "charge") value = stats.freeStars >= (card.cost.stars || 0) ? 3 + (card.base.tames || 0) : 1;
    else if (["girl", "support"].includes(card.type)) value = Math.min(12, Math.max(0, acquisitionValue(game, player.id, id, cards, current)) / 3) * (stats.freeSlots ? 1 : 0.3);
    else if (card.type === "harem") value = stats.freeSlots < 2 ? 9 : 2;
    else {
      const next = replacePlayer(game, { ...player, table: [...player.table, { id }] });
      value = Math.max(0, boardValue(next, player.id, cards) - current) / 3;
    }
    return { id, value };
  }).sort((a, b) => a.value - b.value || lex(a.id, b.id));
}

function endTurn(search: Search): Action | null {
  const { game, player, cards } = search, ranking = discardRanking(search), stats = statsFor(game, player.id, cards);
  const minimum = player.endPayment ? 0 : 1;
  // Keep useful cards to contest other players' summons, but cycle stalled hands
  // instead of indefinitely holding the same unaffordable combination.
  const weak = ranking.filter(entry => entry.value < 2.5).length;
  const discardCount = Math.max(minimum, player.hand.length - stats.hand, weak, player.hand.length - 4);
  const selected = ranking.slice(0, discardCount).map(entry => entry.id);
  const options: Choice[] = [{ action: { type: "endTurn", cards: selected }, value: 0 }];
  if (!player.endPayment && specialsFor(player, cards).some(entry => entry.special === "endWithDeadGirl")) {
    const withoutPayment = ranking.slice(0, Math.max(0, discardCount - 1)).map(entry => entry.id);
    for (const owner of game.players) for (const dead of owner.harem.filter(entry => entry.dead && cards[entry.id].type === "girl")) {
      const next = replacePlayer(game, { ...owner, harem: owner.harem.filter(entry => entry.id !== dead.id) });
      const selfChange = boardValue(next, player.id, cards) - boardValue(game, player.id, cards);
      const opponentChange = owner.id === player.id ? 0 : boardValue(next, owner.id, cards) - boardValue(game, owner.id, cards);
      options.push({ action: { type: "endTurn", cards: withoutPayment, special: "dead", targetId: dead.id }, value: selfChange - opponentChange * 0.4 + 1 });
    }
  }
  // A legal minimum fallback is kept even when an over-limit/special interaction
  // changes the number of cards that needs to be discarded.
  options.push({ action: { type: "endTurn", cards: ranking.slice(0, Math.max(minimum, player.hand.length - stats.hand)).map(entry => entry.id) }, value: -0.1 });
  options.sort((a, b) => b.value - a.value);
  for (const option of options) if (attempt(search, game, option.action)) return option.action;
  return null;
}

/** Choose one legal action using only this player's public observation and hand. */
export function chooseBotAction(game: Game, playerId: string, cards: Cards, now = Date.now()): Action | null {
  if (!game.players.some(player => player.id === playerId) || game.phase === "finished") return null;
  const visible = observation(game, playerId), player = own(visible, playerId);
  const girlsOnTable = visible.players.reduce((count, owner) => count + owner.harem.filter(entry => cards[entry.id]?.type === "girl").length, 0);
  const complexity = (player.harem.length + player.table.length + 1) * Math.max(4, girlsOnTable);
  const search: Search = { game: visible, player, cards, now, attempts: 0, previews: 0,
    planLimit: Math.max(6, Math.min(160, Math.floor(18000 / complexity))),
    previewLimit: Math.max(8, Math.min(LIMIT_PREVIEWS, Math.floor(24000 / complexity))),
  };
  if (visible.phase === "lobby") {
    if (visible.options.selection === "choice" && !player.characterId) {
      const available = Object.values(cards).filter(card => card.type === "character").sort((a, b) => lex(a.id, b.id));
      const position = visible.players.findIndex(other => other.id === player.id);
      return available.length ? { type: "choose", cardId: available[(position * 7) % available.length].id } : null;
    }
    return player.ready ? null : { type: "ready" };
  }
  if (visible.auction?.deadlineAt && now >= visible.auction.deadlineAt) return null;
  const overflow = capacityPlayers(visible, cards);
  if (overflow.length) return overflow.includes(playerId) ? cleanup(search) : null;
  if (visible.auction) {
    const auction = visible.auction;
    if (auction.leaderId === playerId || auction.passes.includes(playerId)) return null;
    if (statsFor(visible, playerId, cards).freeSlots > 0) {
      const bid = findBid(search, visible, auction.targetId, false);
      if (bid) {
        const action = { type: "bid", cards: bid.selected }, next = attempt(search, visible, action);
        if (next) {
          const acquired = withAcquisition(next, playerId, auction.targetId), stats = statsFor(acquired, playerId, cards);
          const gain = boardValue(acquired, playerId, cards, stats) - boardValue(visible, playerId, cards) - bid.expense * 0.7;
          if ((gain > 0.8 || stats.hearts >= visible.options.goal) && !deficit(stats)) return action;
        }
      }
    }
    return { type: "pass" };
  }
  if (visible.players[visible.turn].id !== playerId || visible.pendingDraw) return null;
  const action = turnChoice(search);
  if (action) return action;
  // Progress must not depend on the exploratory budget left after scoring moves.
  // Ending a turn gets its own bounded allowance (at most one option per dead
  // Girl plus two hand-payment options), so a busy board cannot strand a bot.
  search.attempts = 0;
  return endTurn(search);
}
