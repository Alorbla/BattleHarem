import test from 'node:test';
import assert from 'node:assert/strict';
import { rules, cards, characters, seeded, lobby, playing, hand, harem, table, id, conserved } from './fixtures.mjs';
import { chooseBotAction } from '../lib/bot.ts';
import { scheduleBots, advanceAutomatedGame, nextBotId } from '../lib/automation.ts';

const NOW = 1_800_000_000_000;

function commit(game, playerId, action, rng = seeded(17), now = NOW) {
  const before = structuredClone(game);
  const next = rules.applyAction(game, playerId, action, cards, rng, now);
  assert.deepEqual(game, before, 'Actions must not mutate the previous state');
  if (next.phase !== 'lobby') conserved(next);
  return next;
}

function refuse(game, playerId, action) {
  const before = structuredClone(game);
  assert.throws(() => rules.applyAction(game, playerId, action, cards, seeded(17), NOW), rules.RuleError);
  assert.deepEqual(game, before, 'Rejected bot management must be atomic');
}

function withBots(count = 2, selection = 'random', goal = 50) {
  let game = lobby(1, selection, goal);
  while (game.players.length < count) game = commit(game, 'p0', { type: 'addBot' });
  return game;
}

function startBots(count, goal, rng) {
  let game = withBots(count, 'random', goal);
  game.options.bidSeconds = 0;
  game = commit(game, 'p0', { type: 'ready' }, rng);
  game = commit(game, 'p0', { type: 'start' }, rng);
  // A real room retains its human host. Mark that seat as a bot only in this
  // simulation so the production policy can exercise every turn autonomously.
  game.players[0].bot = true;
  game.players[0].tokenHash = '';
  return scheduleBots(game, cards, NOW);
}

function assertLegalDecision(game, playerId, now = NOW) {
  const before = structuredClone(game);
  const action = chooseBotAction(game, playerId, cards, now);
  assert.deepEqual(game, before, 'Thinking must not mutate cards, hands, or timers');
  assert.ok(action, `Eligible bot ${playerId} must have a legal action`);
  const next = rules.applyAction(game, playerId, action, cards, seeded(31), now);
  conserved(next);
  return action;
}

function assertHiddenInvariant(game, playerId, now, seed) {
  const shuffled = structuredClone(game);
  const opponents = shuffled.players.filter(player => player.id !== playerId);
  const reservations = shuffled.players.filter(player => player.endPayment);
  const hidden = rules.shuffle([...shuffled.deck, ...opponents.flatMap(player => player.hand), ...reservations.map(player => player.endPayment.id)], seeded(seed));
  const deckCount = shuffled.deck.length;
  shuffled.deck = hidden.splice(0, deckCount);
  for (const opponent of opponents) opponent.hand = hidden.splice(0, opponent.hand.length);
  for (const player of reservations) player.endPayment.id = hidden.shift();
  conserved(shuffled);
  assert.deepEqual(rules.publicView(shuffled, playerId, cards), rules.publicView(game, playerId, cards), 'The altered state must be indistinguishable to the bot');
  assert.deepEqual(chooseBotAction(shuffled, playerId, cards, now), chooseBotAction(game, playerId, cards, now), 'Bots must not use hidden opponents\' cards or draw-pile identities');
}

test('only the lobby host adds or removes computer opponents; the table is limited to eight', () => {
  let game = lobby(2, 'random');
  refuse(game, 'p1', { type: 'addBot' });
  refuse(game, 'outsider', { type: 'addBot' });
  game = commit(game, 'p0', { type: 'addBot', playerId: 'forged', tokenHash: 'forged', name: 'forged' });
  const bot = game.players.at(-1);
  assert.match(bot.id, /^bot-\d+$/);
  assert.equal(bot.bot, true);
  assert.equal(bot.ready, true);
  assert.equal(bot.tokenHash, '', 'Computer seats have no usable authentication credential');
  assert.notEqual(bot.id, 'forged');
  assert.notEqual(bot.name, 'forged');
  refuse(game, 'p1', { type: 'removeBot', playerId: bot.id });
  refuse(game, 'p0', { type: 'removeBot', playerId: 'p1' });
  refuse(game, 'p0', { type: 'removeBot', playerId: 'p0' });
  refuse(game, 'p0', { type: 'removeBot', playerId: 'absent' });
  while (game.players.length < 8) game = commit(game, 'p0', { type: 'addBot' });
  assert.equal(new Set(game.players.map(player => player.id)).size, 8);
  refuse(game, 'p0', { type: 'addBot' });
  game = commit(game, 'p0', { type: 'removeBot', playerId: bot.id });
  assert.equal(game.players.length, 7);
  assert.ok(!game.players.some(player => player.id === bot.id));
  game = commit(game, 'p0', { type: 'addBot' });
  assert.equal(new Set(game.players.map(player => player.id)).size, 8);
  const view = rules.publicView(game, 'p0', cards);
  assert.ok(view.players.filter(player => player.bot).every(player => !Object.hasOwn(player, 'tokenHash')));
  game.players.filter(player => !player.bot).forEach(player => { player.ready = true; });
  game = commit(game, 'p0', { type: 'start' });
  refuse(game, 'p0', { type: 'addBot' });
  refuse(game, 'p0', { type: 'removeBot', playerId: game.players.find(player => player.bot).id });
});

test('bots select characters and stay ready after lobby choices, options, and rematch', () => {
  let game = withBots(4, 'choice');
  const assertReadyBots = () => {
    for (const player of game.players.filter(player => player.bot)) {
      assert.equal(player.ready, true);
      assert.equal(cards[player.characterId]?.type, 'character');
    }
  };
  assertReadyBots();
  game = commit(game, 'p0', { type: 'choose', cardId: characters[0].id });
  assertReadyBots();
  game = commit(game, 'p0', { type: 'options', options: { goal: 36, selection: 'random', bidSeconds: 30 } });
  assert.ok(game.players.filter(player => player.bot).every(player => player.ready));
  assert.equal(game.players[0].ready, false);
  game = commit(game, 'p0', { type: 'options', options: { goal: 25, selection: 'choice', bidSeconds: 60 } });
  assertReadyBots();
  game = commit(game, 'p0', { type: 'choose', cardId: characters[1].id });
  game = commit(game, 'p0', { type: 'ready' });
  game = commit(game, 'p0', { type: 'start' });
  game.phase = 'finished'; game.winnerId = game.players[1].id;
  game = commit(game, 'p0', { type: 'rematch' });
  assert.equal(game.phase, 'lobby');
  assert.equal(game.players[0].ready, false);
  assertReadyBots();
  assert.ok(game.players.every(player => !player.hand.length && !player.harem.length && !player.table.length));
});

test('host migration chooses a human and the last departing human clears computer seats', () => {
  let game = withBots(3);
  game.players.push(rules.newPlayer('p1', 'Second human', 'second-secret'));
  game = commit(game, 'p0', { type: 'leave' });
  assert.equal(game.hostId, 'p1');
  assert.equal(game.players.filter(player => player.bot).length, 2);
  game = commit(game, 'p1', { type: 'leave' });
  assert.deepEqual(game.players, []);
  assert.equal(game.hostId, '');
});

test('bot scheduling waits one second, preserves the deadline on polling, and performs one action', () => {
  let game = playing();
  game.players[0].bot = true;
  hand(game, 0, id('Friendly chat'), id('Shopping'));
  const before = structuredClone(game);
  game = scheduleBots(game, cards, NOW);
  assert.equal(game.botNextAt, NOW + 1000);
  assert.equal(before.botNextAt, undefined);
  assert.strictEqual(scheduleBots(game, cards, NOW + 400), game, 'Polling must not restart the thinking timer');
  assert.strictEqual(advanceAutomatedGame(game, cards, NOW + 999, seeded(9)), game);
  const saved = structuredClone(game);
  const action = assertLegalDecision(game, 'p0', NOW + 1000);
  const expectedAction = rules.applyAction(game, 'p0', action, cards, seeded(9), NOW + 1000);
  expectedAction.botNextAt = null;
  const expected = scheduleBots(expectedAction, cards, NOW + 1000);
  const next = advanceAutomatedGame(game, cards, NOW + 1000, seeded(9));
  assert.deepEqual(game, saved);
  assert.deepEqual(next, expected, 'One due poll must apply exactly one legal bot action');
  conserved(next);
});

test('scheduling prioritizes capacity repair and waits when a human must act', () => {
  const game = playing();
  game.players[1].bot = true;
  game.players[1].characterId = id('Makoto Noa');
  table(game, 1, { id: id('Common Charge'), readyAt: 1 }, id('Falling Stars'), id('Sunny Day'));
  hand(game, 0, id('Friendly chat'));
  assert.equal(nextBotId(game, cards), 'p1');
  assert.equal(assertLegalDecision(game, 'p1').type, 'discardPermanent');
  let next = scheduleBots(game, cards, NOW);
  for (let repairs = 0; rules.capacityPlayers(next, cards).length && repairs < 5; repairs++) {
    next = advanceAutomatedGame(next, cards, next.botNextAt, seeded(8));
    conserved(next);
  }
  assert.deepEqual(rules.capacityPlayers(next, cards), []);
  assert.equal(next.turn, 0);
  assert.equal(nextBotId(next, cards), null);
  assert.ok(next.botNextAt == null);
  assert.equal(chooseBotAction(next, 'p1', cards, NOW), null);
  assert.strictEqual(scheduleBots(next, cards, NOW), next);
  next.botNextAt = NOW;
  assert.ok(scheduleBots(next, cards, NOW).botNextAt == null, 'A stale timer is cleared while humans must act');
});

test('a bot repairs its own overflow by deploying a passive that funds itself', () => {
  const game = playing(); game.players[0].bot = true;
  harem(game, 1, { id: id('Shironeko Emily'), dead: true }, { id: id('Ongakuko Tachi'), dead: true });
  table(game, 0, id('Moonlight Storm'), id('Tripple Charge'));
  hand(game, 0, id('Tokyo Dome'), id('Friendly chat'));
  game.pendingDraw = 'p0';
  assert.deepEqual(rules.capacityPlayers(game, cards), ['p0']);
  const action = assertLegalDecision(game, 'p0');
  assert.equal(action.type, 'deploy');
  assert.equal(action.cardId, id('Tokyo Dome'));
  const next = commit(game, 'p0', action);
  assert.deepEqual(rules.capacityPlayers(next, cards), []);
  assert.equal(next.pendingDraw, null);
  assert.ok(next.players[0].hand.length > game.players[0].hand.length - 1, 'A successful repair resumes the deferred draw');
});

test('a bot reserves an opponent card for a last-card summon, then pays its end of turn', () => {
  let game = playing(); game.players[0].bot = true;
  harem(game, 0, id('Umaru Yone'));
  hand(game, 0, id('Amagiri Arisu'), id('Shopping'));
  hand(game, 1, id('True Love'));
  const action = assertLegalDecision(game, 'p0');
  assert.equal(action.type, 'summon');
  assert.equal(action.reserveOpponentId, 'p1');
  assertHiddenInvariant(game, 'p0', NOW, 88);
  game = commit(game, 'p0', action);
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.players[0].endPayment.id, id('True Love'));
  game = commit(game, 'p1', { type: 'pass' });
  assertHiddenInvariant(game, 'p0', NOW, 89);
  const end = assertLegalDecision(game, 'p0');
  assert.equal(end.type, 'endTurn');
  game = commit(game, 'p0', end);
  assert.equal(game.turn, 1);
  assert.equal(game.players[0].endPayment, undefined);
  assert.ok(game.discard.includes(id('True Love')));
});

test('a bot uses Yuuka to end with a dead girl in another harem', () => {
  const game = playing(); game.players[0].bot = true;
  harem(game, 0, id('Sumitachi Yuuka'));
  // Retain another girl so removing this one does not grant the opponent the
  // no-girl hand compensation and make the special strategically undesirable.
  harem(game, 1, { id: id('Myselphie'), dead: true }, { id: id('Miyano Rika'), dead: true });
  hand(game, 0, id('Friendly chat'));
  const action = assertLegalDecision(game, 'p0');
  assert.equal(action.type, 'endTurn');
  assert.equal(action.special, 'dead');
  assert.ok(game.players[1].harem.some(entry => entry.id === action.targetId && entry.dead));
  const next = commit(game, 'p0', action);
  assert.ok(next.discard.includes(action.targetId));
  assert.deepEqual(next.players[0].hand, [id('Friendly chat')]);
});

test('an expired summon resolves before a simultaneously due bot can bid', () => {
  let game = playing();
  game.players[1].bot = true;
  game.options.bidSeconds = 30;
  hand(game, 0, id('Myselphie'), id('Shopping'), id('Friendly chat'));
  hand(game, 1, id('Hanabi night'));
  game = commit(game, 'p0', { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')] });
  assert.equal(nextBotId(game, cards), 'p1');
  assertLegalDecision(game, 'p1');
  game.botNextAt = game.auction.deadlineAt;
  const before = structuredClone(game);
  const next = advanceAutomatedGame(game, cards, game.auction.deadlineAt, seeded(5));
  assert.deepEqual(game, before);
  assert.equal(next.auction, null);
  assert.ok(next.players[0].harem.some(entry => entry.id === id('Myselphie')));
  assert.deepEqual(next.players[1].hand, [id('Hanabi night')]);
  assert.ok(next.botNextAt == null);
  assert.strictEqual(advanceAutomatedGame(next, cards, NOW + 60_000), next, 'Repeated polls must not award a card twice');
  conserved(next);
});

test('no bot is scheduled in a lobby or after a finished game', () => {
  for (const phase of ['lobby', 'finished']) {
    const game = withBots(2); game.phase = phase;
    assert.equal(nextBotId(game, cards), null);
    assert.strictEqual(scheduleBots(game, cards, NOW), game);
    assert.strictEqual(advanceAutomatedGame(game, cards, NOW), game);
  }
});

for (const count of [2, 4, 8]) for (const goal of [25, 36, 50]) {
  test(`${count} computer players finish a ${goal}-heart game within bounded turns without hidden information`, { timeout: 30_000 }, context => {
    const started = performance.now();
    const rng = seeded(20261020 + count * 100 + goal);
    let game = startBots(count, goal, rng);
    let actions = 0;
    const actionCounts = {};
    while (game.phase === 'playing' && game.turnNumber < 500 && actions < 5000) {
      const playerId = nextBotId(game, cards);
      assert.ok(playerId, `No eligible bot on turn ${game.turnNumber}`);
      assert.ok(Number.isFinite(game.botNextAt), 'An eligible bot must have a server deadline');
      const now = game.botNextAt;
      if (actions < 12 || actions % 100 === 0) {
        const action = assertLegalDecision(game, playerId, now);
        actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
        assertHiddenInvariant(game, playerId, now, 889 + actions);
      }
      const previousLogId = game.logs.at(-1)?.id || 0;
      const next = advanceAutomatedGame(game, cards, now, rng);
      assert.ok((next.logs.at(-1)?.id || 0) > previousLogId, `Bot ${playerId} made no progress on turn ${game.turnNumber}`);
      game = next; actions++;
      conserved(game);
    }
    const result = { players: count, goal, turns: game.turnNumber, actions, elapsedMs: Math.round(performance.now() - started), phase: game.phase, hearts: game.players.map(player => rules.statsFor(game, player.id, cards).hearts), sampledActions: actionCounts };
    context.diagnostic(JSON.stringify(result));
    assert.equal(game.phase, 'finished', `Bots failed to reach a winner: ${JSON.stringify(result)}`);
    assert.ok(game.winnerId);
    assert.ok(rules.statsFor(game, game.winnerId, cards).hearts >= goal);
    assert.deepEqual(rules.capacityPlayers(game, cards), []);
    assert.ok(game.botNextAt == null, 'Finished games must not retain an automated action deadline');
  });
}
