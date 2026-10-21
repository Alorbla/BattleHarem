import { advanceAuctionClock, applyAction, capacityPlayers, type Cards, type Game } from "./game.ts";
import { chooseBotAction } from "./bot.ts";

const THINK_MS = 1000;

// Resolve one participant at a time, using only state already stored in the room.
export function nextBotId(game: Game, cards: Cards): string | null {
  if (game.phase !== "playing") return null;
  const overflow = capacityPlayers(game, cards);
  if (overflow.length) return game.players.find(p => p.bot && overflow.includes(p.id))?.id ?? null;
  if (game.auction) return game.players.find(p => p.bot && p.id !== game.auction!.leaderId && !game.auction!.passes.includes(p.id))?.id ?? null;
  const current = game.players[game.turn];
  return current?.bot ? current.id : null;
}

export function scheduleBots(original: Game, cards: Cards, now = Date.now()): Game {
  if (!nextBotId(original, cards)) return original.botNextAt == null ? original : { ...original, botNextAt: null };
  return original.botNextAt != null ? original : { ...original, botNextAt: now + THINK_MS };
}

// The API commits this with its version check: concurrent polls cannot play twice.
// Expired human/bot responses are settled first; a poll plays at most one bot action.
export function advanceAutomatedGame(original: Game, cards: Cards, now = Date.now(), rng: () => number = Math.random): Game {
  const settled = advanceAuctionClock(original, cards, now);
  if (settled !== original) return scheduleBots({ ...settled, botNextAt: null }, cards, now);
  const scheduled = scheduleBots(original, cards, now);
  if (scheduled !== original || scheduled.botNextAt == null || now < scheduled.botNextAt) return scheduled;
  const playerId = nextBotId(scheduled, cards)!;
  const action = chooseBotAction(scheduled, playerId, cards, now);
  if (!action) throw new Error("Computer player has no legal action");
  const next = applyAction(scheduled, playerId, action, cards, rng, now);
  return scheduleBots({ ...next, botNextAt: null }, cards, now);
}
