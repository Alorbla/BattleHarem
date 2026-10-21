// Pure game rules. The server is the sole authority; clients receive a redacted view.
export type Stat = "hearts" | "stars" | "tames" | "hand" | "slots";
export type Condition = { type: string; value?: string; names?: string[]; values?: string[] };
export type Effect = {
  stat: Stat; amount: number; condition?: Condition; conditions?: Condition[];
  scale?: { who: "self" | "all"; kind: string; subtype?: string; excludeSelf?: boolean; names?: string[] };
  special?: string;
};
export type Card = {
  id: string; name: string; type: "girl" | "support" | "character" | "tame" | "charge" | "ability" | "harem";
  subtype?: string | null; cost: { stars?: number; tames?: number }; base: Partial<Record<Stat, number>>;
  effects: Effect[]; specials?: string[]; effectText: string; image: string;
  sourceNotes?: string[];
};
export type Cards = Record<string, Card>;
export type Permanent = { id: string; dead?: boolean; readyAt?: number };
export type Player = {
  id: string; name: string; tokenHash: string; characterId: string | null; ready: boolean;
  bot?: boolean;
  hand: string[]; harem: Permanent[]; table: Permanent[]; turns: number; usedActions: string[];
  endPayment?: { kind: "opponent"; ownerId: string; id: string };
};
export type Auction = {
  targetId: string; initiatorId: string; leaderId: string; passes: string[];
  deadlineAt?: number | null;
  bids: Record<string, { power: number; played: string[]; chargeCount: number }>;
};
export type Game = {
  code: string; hostId: string; phase: "lobby" | "playing" | "finished";
  options: { goal: 25 | 36 | 50; selection: "random" | "choice"; bidSeconds?: 0 | 30 | 60 | 90 | 120 };
  players: Player[]; deck: string[]; discard: string[]; turn: number; turnNumber: number;
  auction: Auction | null; winnerId: string | null; logs: { id: number; text: string }[];
  events: string[]; createdAt: number;
  pendingDraw?: string | null;
  botNextAt?: number | null;
};
export type Stats = Record<Stat, number> & { usedStars: number; usedSlots: number; freeStars: number; freeSlots: number };
export class RuleError extends Error {}
export function insist(ok: unknown, message: string): asserts ok { if (!ok) throw new RuleError(message); }
const norm = (text?: string | null) => (text || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const same = (a?: string | null, b?: string | null) => norm(a) === norm(b);
export function shuffle<T>(values: T[], rng: () => number = Math.random): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function newPlayer(id: string, name: string, tokenHash: string): Player {
  insist(typeof name === "string" && name.trim().length >= 1 && name.trim().length <= 24, "Meno musí mať 1 až 24 znakov.");
  return { id, name: name.trim(), tokenHash, characterId: null, ready: false, hand: [], harem: [], table: [], turns: 0, usedActions: [] };
}
export function newGame(code: string, host: Player, options: Game["options"]): Game {
  validateOptions(options);
  return { code, hostId: host.id, phase: "lobby", options: { ...options, bidSeconds: options.bidSeconds ?? 60 }, players: [host], deck: [], discard: [], turn: 0, turnNumber: 0, auction: null, winnerId: null, logs: [], events: [], createdAt: Date.now() };
}
export function validateOptions(options: Game["options"]) {
  insist(options && [25, 36, 50].includes(options.goal) && ["random", "choice"].includes(options.selection), "Neplatné nastavenie partie.");
  insist(options.bidSeconds === undefined || [0, 30, 60, 90, 120].includes(options.bidSeconds), "Čas na reakciu musí byť 30, 60, 90 alebo 120 sekúnd, prípadne bez limitu.");
}
export function log(game: Game, text: string) {
  game.logs.push({ id: (game.logs.at(-1)?.id || 0) + 1, text });
  game.logs = game.logs.slice(-80);
}
export function caps(goal: number) { return goal === 50 ? { hand: 10, tames: 8 } : goal === 36 ? { hand: 9, tames: 7 } : { hand: 8, tames: 6 }; }
function girls(game: Game, player: Player, cards: Cards, who = "self") {
  return (who === "all" ? game.players : [player]).flatMap(p => p.harem.filter(x => cards[x.id].type === "girl").map(x => ({ ...x, owner: p.id })));
}
function sources(player: Player, cards: Cards) {
  return [player.characterId, ...player.harem.filter(c => !c.dead).map(c => c.id), ...player.table.map(c => c.id)].filter((x): x is string => !!x);
}
type Context = { target?: Card; usedCharge?: number; stats?: Stats; usingCharge?: boolean };
function conditionMatches(condition: Condition, game: Game, player: Player, cards: Cards, source: string, context: Context): boolean {
  const own = girls(game, player, cards);
  switch (condition.type) {
    case "character": return same(cards[player.characterId || ""]?.name, condition.value);
    case "hasCard": return player.harem.some(x => same(cards[x.id].name, condition.value));
    case "hasOneOf": return player.harem.some(x => (condition.names || condition.values || []).some(n => same(cards[x.id].name, n)));
    case "hasSubtype": return own.some(x => same(cards[x.id].subtype, condition.value));
    case "hasAnotherSubtype": return own.some(x => x.id !== source && same(cards[x.id].subtype, condition.value));
    case "alone": return player.harem.length === 1 && player.harem[0].id === source;
    case "noGirls": return own.length === 0;
    case "targetSubtype": return same(context.target?.subtype, condition.value);
    case "targetName": return same(context.target?.name, condition.value);
    case "inHarem": return player.harem.some(x => x.id === source && !x.dead);
    default: throw new Error(`Unknown condition ${condition.type} on ${source}`);
  }
}
function effectAmount(effect: Effect, game: Game, player: Player, cards: Cards, source: string, context: Context): number {
  if (effect.special && !(effect.special === "chargeBonus" && context.usingCharge)) return 0;
  const conditions = [...(effect.condition ? [effect.condition] : []), ...(effect.conditions || [])];
  if (!conditions.every(c => conditionMatches(c, game, player, cards, source, context))) return 0;
  const scale = effect.scale;
  if (!scale) return effect.amount;
  const group = scale.who === "all" ? game.players : [player];
  const list = girls(game, player, cards, scale.who).filter(x => !scale.excludeSelf || x.id !== source);
  let count = 0;
  switch (scale.kind) {
    case "girls": count = list.length; break;
    case "subtype": count = list.filter(x => same(cards[x.id].subtype, scale.subtype)).length; break;
    case "dead": count = list.filter(x => x.dead).length; break;
    case "alive": count = list.filter(x => !x.dead).length; break;
    case "named": count = list.filter(x => scale.names?.some(n => same(cards[x.id].name, n))).length; break;
    case "ability": count = group.reduce((sum, p) => sum + p.table.filter(x => cards[x.id].type === "ability").length, 0); break;
    case "charge": count = group.reduce((sum, p) => sum + p.table.filter(x => cards[x.id].type === "charge").length, 0); break;
    case "abilityAndCharge": count = group.reduce((sum, p) => sum + p.table.filter(x => ["ability", "charge"].includes(cards[x.id].type)).length, 0); break;
    case "charging": count = group.reduce((sum, p) => sum + p.table.filter(x => cards[x.id].type === "charge" && (x.readyAt || 0) > p.turns).length, 0); break;
    case "usedCharge": count = context.usedCharge || 0; break;
    case "freeStars": count = context.stats?.freeStars || 0; break;
    case "freeSlots": count = context.stats?.freeSlots || 0; break;
    default: throw new Error(`Unknown scale ${scale.kind} on ${source}`);
  }
  return effect.amount * count;
}
function sumEffects(game: Game, player: Player, cards: Cards, stat: Stat, context: Context, targetOnly = false) {
  return sources(player, cards).reduce((sum, source) => sum + cards[source].effects.filter(e => e.stat === stat && !e.special && !(stat === "tames" && cards[source].type === "charge")).reduce((n, effect) => {
    const conditionalTarget = [effect.condition, ...(effect.conditions || [])].some(c => c && ["targetSubtype", "targetName"].includes(c.type));
    if (stat === "tames" && conditionalTarget !== targetOnly) return n;
    return n + effectAmount(effect, game, player, cards, source, context);
  }, 0), 0);
}
export function statsFor(game: Game, playerId: string, cards: Cards): Stats {
  const player = game.players.find(p => p.id === playerId)!;
  const stats: Stats = { hearts: 0, stars: 0, tames: 0, hand: 0, slots: 0, usedStars: 0, usedSlots: player.harem.length, freeStars: 0, freeSlots: 0 };
  if (!player.characterId) return stats;
  for (const id of sources(player, cards)) for (const key of ["hearts", "stars", "hand", "slots"] as Stat[]) stats[key] += cards[id].base[key] || 0;
  stats.usedStars = player.table.reduce((n, x) => n + (cards[x.id].cost.stars || 0), 0);
  for (const key of ["stars", "slots"] as Stat[]) stats[key] = Math.max(0, stats[key] + sumEffects(game, player, cards, key, { stats }));
  stats.freeStars = Math.max(0, stats.stars - stats.usedStars);
  stats.freeSlots = Math.max(0, stats.slots - stats.usedSlots);
  for (const key of ["hearts", "hand", "tames"] as Stat[]) stats[key] = Math.max(0, stats[key] + sumEffects(game, player, cards, key, { stats }));
  if (!girls(game, player, cards).length) stats.hand += girls(game, player, cards, "all").length;
  stats.hand = Math.min(stats.hand, caps(game.options.goal).hand);
  stats.tames = Math.min(stats.tames, caps(game.options.goal).tames);
  return stats;
}
export function specialsFor(player: Player, cards: Cards): { id: string; special: string }[] {
  return sources(player, cards).flatMap(id => (cards[id].specials || []).map(special => ({ id, special })));
}
export function capacityPlayers(game: Game, cards: Cards): string[] {
  return game.players.filter(p => { const s = statsFor(game, p.id, cards); return s.usedStars > s.stars || s.usedSlots > s.slots; }).map(p => p.id);
}
function checkWin(game: Game, cards: Cards) {
  if (game.phase !== "playing") return;
  if (capacityPlayers(game, cards).length) return;
  for (let n = 0; n < game.players.length; n++) {
    const player = game.players[(game.turn + n) % game.players.length];
    if (statsFor(game, player.id, cards).hearts >= game.options.goal) {
      game.phase = "finished"; game.winnerId = player.id;
      log(game, `${player.name} dosiahol cieľ ${game.options.goal} sŕdc a vyhráva!`);
      return;
    }
  }
}
function drawToLimit(game: Game, player: Player, cards: Cards, rng: () => number) {
  const limit = statsFor(game, player.id, cards).hand;
  let drawn = 0;
  while (player.hand.length < limit) {
    if (!game.deck.length && game.discard.length) { game.deck = shuffle(game.discard, rng); game.discard = []; log(game, "Odhadzovací balíček sa zamiešal a tvorí nový doberací balíček."); }
    if (!game.deck.length) break;
    player.hand.push(game.deck.pop()!); drawn++;
  }
  return drawn;
}
function beginTurn(game: Game, cards: Cards, rng: () => number) {
  const player = game.players[game.turn];
  player.turns++; player.usedActions = []; game.turnNumber++;
  if (capacityPlayers(game, cards).length) {
    game.pendingDraw = player.id;
    log(game, `${player.name} začína ťah. Najprv treba uvoľniť prekročenú kapacitu.`);
    return;
  }
  const drawn = drawToLimit(game, player, cards, rng);
  log(game, `Na ťahu je ${player.name}. Doberá ${drawn} ${drawn === 1 ? "kartu" : drawn < 5 ? "karty" : "kariet"}.`);
  checkWin(game, cards);
}
function selectedIds(value: unknown): string[] {
  insist(Array.isArray(value) && value.length <= 40 && value.every(x => typeof x === "string"), "Neplatný výber kariet.");
  insist(new Set(value).size === value.length, "Rovnakú kartu nemožno použiť dvakrát.");
  return value as string[];
}
function takeHand(player: Player, id: string) { const index = player.hand.indexOf(id); insist(index >= 0, "Túto kartu nemáš v ruke."); player.hand.splice(index, 1); }
function assertTurn(game: Game, player: Player) {
  insist(game.phase === "playing", "Partia práve neprebieha.");
  insist(game.players[game.turn].id === player.id, "Teraz je na ťahu iný hráč.");
  insist(!game.auction, "Najprv dokončite summon.");
}
function ensureReserve(player: Player) { insist(player.hand.length >= 1 || player.endPayment, "Nechaj si aspoň jednu kartu na ukončenie ťahu alebo pri začatí summonu rezervuj kartu súpera príslušnou schopnosťou."); }
function ensureCapacity(game: Game, player: Player, cards: Cards) {
  const stats = statsFor(game, player.id, cards);
  insist(stats.usedStars <= stats.stars, `Po započítaní pasívok potrebuješ ${stats.usedStars} hviezd, ale kapacita je ${stats.stars}. Vyber karty na výmenu.`);
  insist(stats.usedSlots <= stats.slots, `Po započítaní pasívok potrebuješ ${stats.usedSlots} miest v háreme, ale kapacita je ${stats.slots}. Uvoľni miesto alebo rozšír hárem.`);
}
function resumePendingDraw(game: Game, cards: Cards, rng: () => number) {
  if (!capacityPlayers(game, cards).length && game.pendingDraw) {
    const next = game.players.find(p => p.id === game.pendingDraw)!;
    const drawn = drawToLimit(game, next, cards, rng); game.pendingDraw = null;
    log(game, `${next.name} doberá ${drawn} kariet a pokračuje vo svojom ťahu.`);
  }
}
function removePermanents(game: Game, player: Player, ids: string[]) {
  for (const id of ids) {
    const tableIndex = player.table.findIndex(x => x.id === id);
    const haremIndex = player.harem.findIndex(x => x.id === id);
    insist(tableIndex >= 0 || haremIndex >= 0, "Túto kartu nemáš vyloženú.");
    if (tableIndex >= 0) player.table.splice(tableIndex, 1); else player.harem.splice(haremIndex, 1);
    game.discard.push(id);
  }
}
export function bidPreview(game: Game, playerId: string, targetId: string, ids: string[], cards: Cards): number {
  game = structuredClone(game);
  const player = game.players.find(p => p.id === playerId)!;
  const target = cards[targetId];
  const prior = game.auction?.bids[playerId];
  let stats = statsFor(game, player.id, cards);
  let power = prior?.power ?? stats.tames + sumEffects(game, player, cards, "tames", { stats, target }, true);
  let usedCharge = prior?.chargeCount || 0;
  // Charge cards are consumed before hand cards, consistently in UI and server.
  const sorted = [...ids].sort((a, b) => Number(cards[b]?.type === "charge") - Number(cards[a]?.type === "charge"));
  for (const id of sorted) {
    const card = cards[id];
    insist(card && ["tame", "charge"].includes(card.type), "Do ponuky patria iba Tame alebo nabité Charge karty.");
    const context: Context = { target, stats, usedCharge, usingCharge: card.type === "charge" };
    power += (card.base.tames || 0) + card.effects.filter(e => e.stat === "tames").reduce((n, e) => n + effectAmount(e, game, player, cards, id, context), 0);
    if (card.type === "charge") {
      power += sources(player, cards).reduce((n, source) => n + cards[source].effects.filter(e => e.special === "chargeBonus").reduce((m, e) => m + effectAmount(e, game, player, cards, source, context), 0), 0);
      usedCharge++;
      player.table = player.table.filter(x => x.id !== id);
      stats = statsFor(game, player.id, cards);
    }
  }
  return power;
}
function placeBid(game: Game, player: Player, ids: string[], cards: Cards, initial: boolean, now: number) {
  const auction = game.auction!;
  const stats = statsFor(game, player.id, cards);
  insist(stats.freeSlots >= 1, "Na získanie karty potrebuješ voľné miesto v háreme.");
  insist(initial || auction.leaderId !== player.id, "Momentálne máš najvyššiu ponuku.");
  insist(initial || !auction.passes.includes(player.id), "Už si pasoval. Po novom prihodení môžeš reagovať znova.");
  for (const id of ids) {
    const card = cards[id];
    insist(card, "Neznáma karta.");
    if (card.type === "tame") insist(player.hand.includes(id), "Tame kartu musíš mať v ruke.");
    else { const permanent = player.table.find(c => c.id === id); insist(card.type === "charge" && permanent && (permanent.readyAt || 0) <= player.turns, "Charge karta musí byť vyložená a nabitá."); }
  }
  const power = bidPreview(game, player.id, auction.targetId, ids, cards);
  const threshold = initial ? (cards[auction.targetId].cost.tames || 0) : auction.bids[auction.leaderId].power + 1;
  insist(power >= threshold, `Potrebuješ aspoň ${threshold} tames. Tvoja ponuka má ${power}.`);
  let used = 0;
  for (const id of ids) {
    if (cards[id].type === "tame") takeHand(player, id);
    else { player.table = player.table.filter(x => x.id !== id); used++; }
  }
  if (game.players[game.turn].id === player.id) ensureReserve(player);
  const before = auction.bids[player.id];
  auction.bids[player.id] = { power, played: [...(before?.played || []), ...ids], chargeCount: (before?.chargeCount || 0) + used };
  auction.leaderId = player.id; auction.passes = [];
  auction.deadlineAt = game.options.bidSeconds ? now + game.options.bidSeconds * 1000 : null;
  log(game, `${player.name} ${initial ? "začína summon" : "prihodil na"} ${cards[auction.targetId].name}: ${power} tames.`);
}
function finishAuction(game: Game, cards: Cards) {
  const auction = game.auction!;
  const winner = game.players.find(p => p.id === auction.leaderId)!;
  winner.harem.push({ id: auction.targetId });
  for (const bid of Object.values(auction.bids)) game.discard.push(...bid.played);
  log(game, `${winner.name} získava ${cards[auction.targetId].name} za ${auction.bids[winner.id].power} tames.`);
  game.auction = null;
  checkWin(game, cards);
}
// Persist this transition before processing a later action. Repeated polls are a no-op.
export function advanceAuctionClock(original: Game, cards: Cards, now = Date.now()): Game {
  if (original.phase !== "playing" || !original.auction?.deadlineAt || now < original.auction.deadlineAt) return original;
  const game = structuredClone(original);
  const auction = game.auction!;
  for (const player of game.players) {
    if (player.id === auction.leaderId || auction.passes.includes(player.id)) continue;
    auction.passes.push(player.id);
    log(game, `${player.name} automaticky pasuje — čas na reakciu vypršal.`);
  }
  finishAuction(game, cards);
  return game;
}
export type Action = { type: string; [key: string]: unknown };
function prepareBots(game: Game, cards: Cards, rng: () => number) {
  const characters = Object.values(cards).filter(c => c.type === "character");
  for (const player of game.players) if (player.bot) {
    if (game.options.selection === "choice" && !player.characterId) player.characterId = characters[Math.floor(rng() * characters.length)].id;
    player.ready = true;
  }
}
export function applyAction(original: Game, playerId: string, action: Action, cards: Cards, rng: () => number = Math.random, now = Date.now()): Game {
  const game = structuredClone(original);
  const player = game.players.find(p => p.id === playerId);
  insist(player, "Nie si členom tejto miestnosti.");
  insist(action && typeof action.type === "string", "Neplatná akcia.");
  if (action.type === "addBot" || action.type === "removeBot") {
    insist(game.phase === "lobby" && player.id === game.hostId && !player.bot, "Počítače pridáva a odoberá hostiteľ v čakárni.");
    if (action.type === "addBot") {
      insist(game.players.length < 8, "Miestnosť je plná. Maximum je 8 hráčov.");
      let number = 1;
      while (game.players.some(p => p.id === `bot-${number}` || same(p.name, `Počítač ${number}`))) number++;
      const bot = newPlayer(`bot-${number}`, `Počítač ${number}`, ""); bot.bot = true;
      game.players.push(bot); prepareBots(game, cards, rng);
      log(game, `${player.name} pridáva súpera ${bot.name}.`);
    } else {
      const bot = game.players.find(p => p.id === action.playerId && p.bot);
      insist(bot, "Vyber počítačového súpera na odobratie.");
      game.players = game.players.filter(p => p.id !== bot.id);
      log(game, `${player.name} odoberá súpera ${bot.name}.`);
    }
    return game;
  }
  if (action.type === "options") {
    insist(game.phase === "lobby" && player.id === game.hostId, "Nastavenia mení hostiteľ v čakárni.");
    validateOptions(action.options as Game["options"]); game.options = { ...action.options as Game["options"], bidSeconds: (action.options as Game["options"]).bidSeconds ?? game.options.bidSeconds ?? 0 };
    game.players.forEach(p => { p.ready = false; }); prepareBots(game, cards, rng); return game;
  }
  if (action.type === "choose") {
    insist(game.phase === "lobby" && game.options.selection === "choice", "Výber postavy teraz nie je dostupný.");
    insist(typeof action.cardId === "string" && cards[action.cardId]?.type === "character", "Vyber platnú postavu.");
    player.characterId = action.cardId; player.ready = false; return game;
  }
  if (action.type === "ready") { insist(game.phase === "lobby", "Partia už začala."); insist(game.options.selection === "random" || player.characterId, "Najprv si vyber postavu."); player.ready = !player.ready; return game; }
  if (action.type === "start") {
    insist(game.phase === "lobby" && player.id === game.hostId, "Partiu začína hostiteľ.");
    insist(game.players.length >= 2 && game.players.length <= 8, "Na hru potrebujete 2 až 8 hráčov.");
    insist(game.players.every(p => p.ready), "Počkaj, kým všetci hráči potvrdia pripravenosť.");
    const characters = shuffle(Object.values(cards).filter(c => c.type === "character").map(c => c.id), rng);
    if (game.options.selection === "random") game.players.forEach((p, i) => { p.characterId = characters[i]; });
    insist(game.players.every(p => p.characterId && cards[p.characterId]?.type === "character"), "Každý hráč potrebuje postavu.");
    game.deck = shuffle(Object.values(cards).filter(c => c.type !== "character").map(c => c.id), rng);
    game.phase = "playing"; game.turn = Math.floor(rng() * game.players.length);
    for (const p of game.players) drawToLimit(game, p, cards, rng);
    log(game, `Partia pre ${game.players.length} hráčov začína. Cieľ: ${game.options.goal} sŕdc.`);
    beginTurn(game, cards, rng); return game;
  }
  if (action.type === "rematch") {
    insist(game.phase === "finished" && game.hostId === player.id, "Novú partiu po výhre otvára hostiteľ.");
    game.phase = "lobby"; game.deck = []; game.discard = []; game.auction = null; game.winnerId = null; game.turnNumber = 0;
    game.players.forEach(p => { p.hand = []; p.harem = []; p.table = []; p.turns = 0; p.usedActions = []; p.ready = false; delete p.endPayment; });
    game.pendingDraw = null; game.botNextAt = null; prepareBots(game, cards, rng);
    log(game, "Miestnosť je pripravená na novú partiu."); return game;
  }
  if (action.type === "leave") {
    insist(game.phase === "lobby", "Z prebiehajúcej partie sa môžeš odpojiť a neskôr sa vrátiť na tomto zariadení.");
    game.players = game.players.filter(p => p.id !== player.id);
    if (!game.players.some(p => !p.bot)) game.players = [];
    if (game.hostId === player.id) game.hostId = game.players.find(p => !p.bot)?.id || "";
    log(game, `${player.name} opustil miestnosť.`); return game;
  }
  insist(game.phase === "playing", "Partia práve neprebieha.");
  insist(!game.auction?.deadlineAt || now < game.auction.deadlineAt, "Čas na reakciu vypršal. Stav summonu sa práve obnovuje.");
  const overflow = capacityPlayers(game, cards);
  const repairingCapacity = action.type === "deploy" && overflow.includes(player.id) && game.players[game.turn].id === player.id && !game.auction;
  if (overflow.length && !repairingCapacity) {
    insist(action.type === "discardPermanent" && overflow.includes(player.id), "Najprv treba opraviť prekročenú kapacitu: odhoď vyložené karty alebo vo svojom ťahu vylož kartu, ktorá deficit pokryje.");
    const ids = selectedIds(action.cards); insist(ids.length, "Vyber vyloženú kartu na odhodenie.");
    removePermanents(game, player, ids);
    log(game, `${player.name} uvoľňuje kapacitu: ${ids.map(id => cards[id].name).join(", ")}.`);
    resumePendingDraw(game, cards, rng);
    checkWin(game, cards); return game;
  }
  if (action.type === "bid") {
    insist(game.auction, "Nepriebehá žiadny summon.");
    placeBid(game, player, selectedIds(action.cards), cards, false, now); checkWin(game, cards); return game;
  }
  if (action.type === "pass") {
    insist(game.auction && game.auction.leaderId !== player.id, "Teraz nemôžeš pasovať.");
    insist(!game.auction.passes.includes(player.id), "Už si pasoval. Po novom prihodení môžeš reagovať znovu.");
    game.auction.passes.push(player.id); log(game, `${player.name} pasuje.`);
    if (game.players.every(p => p.id === game.auction!.leaderId || game.auction!.passes.includes(p.id))) finishAuction(game, cards);
    return game;
  }
  assertTurn(game, player);
  if (action.type === "deploy") {
    const id = String(action.cardId); const card = cards[id];
    insist(card && ["charge", "ability", "harem"].includes(card.type), "Túto kartu musíš získať cez summon alebo použiť pri prihodení.");
    takeHand(player, id);
    removePermanents(game, player, selectedIds(action.replace || []));
    player.table.push({ id, ...(card.type === "charge" ? { readyAt: player.turns + 1 } : {}) });
    ensureCapacity(game, player, cards);
    if (!game.players.some(p => statsFor(game, p.id, cards).hearts >= game.options.goal)) ensureReserve(player);
    log(game, `${player.name} vykladá ${card.name}${card.type === "charge" ? ". Nabije sa na začiatku jeho ďalšieho ťahu" : ""}.`);
  } else if (action.type === "discardPermanent") {
    const ids = selectedIds(action.cards); insist(ids.length, "Vyber vyloženú kartu na odhodenie.");
    removePermanents(game, player, ids);
    log(game, `${player.name} uvoľňuje kapacitu odhodením ${ids.map(id => cards[id].name).join(", ")}.`);
  } else if (action.type === "summon") {
    const id = String(action.cardId); const card = cards[id];
    insist(card && ["girl", "support"].includes(card.type), "Summon je určený pre Girl a Support karty.");
    ensureCapacity(game, player, cards); takeHand(player, id);
    if (action.reserveOpponentId && !player.endPayment) {
      insist(specialsFor(player, cards).some(x => x.special === "endWithOpponentCard"), "Nemáš schopnosť ukončiť ťah kartou súpera.");
      const opponent = game.players.find(p => p.id === action.reserveOpponentId && p.id !== player.id);
      insist(opponent && opponent.hand.length, "Vyber súpera, ktorý má kartu v ruke.");
      const reserved = opponent.hand.splice(Math.floor(rng() * opponent.hand.length), 1)[0];
      player.endPayment = { kind: "opponent", ownerId: opponent.id, id: reserved };
      log(game, `${player.name} rezervuje jednu náhodnú kartu hráča ${opponent.name} na ukončenie ťahu.`);
    }
    game.auction = { targetId: id, initiatorId: player.id, leaderId: player.id, passes: [], bids: {} };
    placeBid(game, player, selectedIds(action.cards), cards, true, now);
  } else if (action.type === "special") {
    const sourceId = String(action.sourceId); const targetId = String(action.targetId);
    const available = specialsFor(player, cards).filter(x => x.id === sourceId);
    const mode = action.mode === "revive" ? "revive" : "kill";
    insist(available.some(x => x.special === "killRevive" || x.special === mode), "Túto schopnosť nemáš aktívnu.");
    insist(!player.usedActions.includes(sourceId), "Túto schopnosť si už v tomto ťahu použil.");
    const target = player.harem.find(x => x.id === targetId && cards[x.id].type === "girl");
    insist(target && (mode === "revive" ? target.dead : !target.dead), "Vyber vhodné vlastné dievča.");
    target.dead = mode === "kill"; player.usedActions.push(sourceId);
    log(game, `${player.name} ${mode === "kill" ? "obetuje" : "oživuje"} ${cards[targetId].name}.`);
  } else if (action.type === "endTurn") {
    const discard = selectedIds(action.cards || []);
    const special = action.special as string | undefined;
    let specialUsed = false;
    if (player.endPayment) { game.discard.push(player.endPayment.id); delete player.endPayment; specialUsed = true; }
    if (special === "opponent") {
      insist(specialUsed, "Kartu súpera treba rezervovať pri začatí summonu.");
    } else if (special === "dead") {
      insist(!specialUsed, "Na ukončenie je už rezervovaná karta súpera.");
      insist(specialsFor(player, cards).some(x => x.special === "endWithDeadGirl"), "Túto schopnosť nemáš aktívnu.");
      const owner = game.players.find(p => p.harem.some(c => c.id === action.targetId && c.dead));
      insist(owner, "Vyber mŕtve dievča na stole.");
      removePermanents(game, owner, [String(action.targetId)]); specialUsed = true;
    }
    insist(discard.length > 0 || specialUsed, "Na ukončenie ťahu odhoď aspoň jednu kartu z ruky.");
    for (const id of discard) { takeHand(player, id); game.discard.push(id); }
    insist(player.hand.length <= statsFor(game, player.id, cards).hand, "Odhoď karty nad svoj aktuálny limit ruky.");
    ensureCapacity(game, player, cards);
    log(game, `${player.name} ukončuje ťah a odhadzuje ${discard.length + (specialUsed ? 1 : 0)} kariet.`);
    checkWin(game, cards);
    if (game.phase === "playing") { game.turn = (game.turn + 1) % game.players.length; beginTurn(game, cards, rng); }
    return game;
  } else throw new RuleError("Neznáma herná akcia.");
  if (action.type === "summon") player.usedActions.push("summoned");
  if (repairingCapacity) resumePendingDraw(game, cards, rng);
  checkWin(game, cards);
  return game;
}
export function publicView(game: Game, playerId: string, cards: Cards) {
  insist(game.players.some(p => p.id === playerId), "Nie si členom tejto miestnosti.");
  return {
    code: game.code, hostId: game.hostId, phase: game.phase, options: game.options,
    turn: game.turn, turnNumber: game.turnNumber, auction: game.auction, winnerId: game.winnerId,
    logs: game.logs, deckCount: game.deck.length, discardCount: game.discard.length,
    discardTop: game.discard.at(-1) || null, you: playerId,
    capacityPlayers: capacityPlayers(game, cards), pendingDraw: game.pendingDraw || null,
    players: game.players.map(({ tokenHash: _secret, hand, endPayment, ...player }) => ({
      ...player, hand: player.id === playerId ? hand : [], handCount: hand.length,
      ...(endPayment ? { endPayment: { kind: endPayment.kind, ownerId: endPayment.ownerId } } : {}),
      stats: statsFor(game, player.id, cards),
    })),
  };
}
