import test from 'node:test';
import assert from 'node:assert/strict';
import { rules, catalog, cards, characters, id, seeded, lobby, playing, hand, harem, table, conserved, act, rejects, stat } from './fixtures.mjs';

test('full printed catalog has unique physical identities and every card effect can be evaluated', () => {
  assert.equal(catalog.length, 299);
  assert.equal(new Set(catalog.map(card => card.id)).size, 299);
  assert.equal(catalog.filter(card => card.name === 'Friendly chat').length, 3);
  for (const card of catalog) {
    const game = playing();
    if (card.type === 'character') game.players[0].characterId = card.id;
    else if (['girl', 'support'].includes(card.type)) harem(game, 0, card.id);
    else if (['ability', 'harem', 'charge'].includes(card.type)) table(game, 0, { id: card.id, readyAt: 2 });
    assert.doesNotThrow(() => stat(game), card.name);
    if (['tame', 'charge'].includes(card.type)) assert.ok(Number.isFinite(rules.bidPreview(game, 'p0', id('Amagiri Arisu'), [card.id], cards)), card.name);
  }
});

for (const mode of ['random', 'choice']) for (let count = 2; count <= 8; count++) {
  test(`${mode} start for ${count} players deals each character's hand and conserves the shared deck`, () => {
    let game = lobby(count, mode, 25);
    for (let index = 0; index < count; index++) {
      if (mode === 'choice') game = act(game, index, { type: 'choose', cardId: characters[index].id });
      game = act(game, index, { type: 'ready' });
    }
    game = act(game, 0, { type: 'start' }, seeded(100 + count));
    assert.equal(game.phase, 'playing');
    assert.equal(new Set(game.players.map(p => p.characterId)).size, count);
    for (const player of game.players) assert.equal(player.hand.length, rules.statsFor(game, player.id, cards).hand);
    if (mode === 'choice') assert.deepEqual(game.players.map(p => p.characterId), characters.slice(0, count).map(c => c.id));
    assert.ok(game.deck.every(cardId => cards[cardId].type !== 'character'));
    assert.equal(game.players.filter(p => p.turns === 1).length, 1);
    conserved(game);
  });
}

test('lobby rejects unready start, missing choice, non-host start, and player counts outside 2–8', () => {
  let game = lobby();
  rejects(game, 0, { type: 'ready' });
  rejects(game, 0, { type: 'choose', cardId: id('Myselphie') });
  rejects(game, 0, { type: 'start' });
  rejects(game, 1, { type: 'start' });
  for (const count of [1, 9]) {
    let invalid = lobby(count, 'random');
    for (let index = 0; index < count; index++) invalid = act(invalid, index, { type: 'ready' });
    rejects(invalid, 0, { type: 'start' });
  }
});

test('changing options clears readiness; choosing a character clears that player readiness', () => {
  let game = lobby(2, 'choice');
  for (let index = 0; index < 2; index++) {
    game = act(game, index, { type: 'choose', cardId: characters[index].id });
    game = act(game, index, { type: 'ready' });
  }
  game = act(game, 0, { type: 'choose', cardId: characters[2].id });
  assert.equal(game.players[0].ready, false);
  assert.equal(game.players[1].ready, true);
  game = act(game, 0, { type: 'options', options: { goal: 36, selection: 'random' } });
  assert.ok(game.players.every(player => !player.ready));
  rejects(game, 1, { type: 'options', options: { goal: 25, selection: 'choice' } });
});

test('Hiroto, Arisu and Myselphie produce the printed 10 hearts / 7 stars / 5 hand synergy', () => {
  const game = playing(); harem(game, 0, id('Amagiri Arisu'), id('Myselphie'));
  assert.deepEqual({ hearts: stat(game).hearts, stars: stat(game).stars, hand: stat(game).hand, usedSlots: stat(game).usedSlots }, { hearts: 10, stars: 7, hand: 5, usedSlots: 2 });
});

test('dead cards lose their own stats and passives but remain typed, named and slot-consuming', () => {
  const game = playing(); harem(game, 0, { id: id('Amagiri Arisu'), dead: true }, id('Myselphie'));
  const stats = stat(game);
  assert.equal(stats.hearts, 7, 'Dead Tsundere still contributes Hiroto +2; Myselphie contributes 3+2');
  assert.equal(stats.stars, 5, 'Myselphie still sees named Arisu, but Arisu contributes no own +2 stars');
  assert.equal(stats.hand, 4, 'Dead Arisu no longer grants the Common hand bonus');
  assert.equal(stats.usedSlots, 2);
});

test('another Otaku cannot match itself; a second Otaku activates the bonus', () => {
  const game = playing(); harem(game, 0, id('Mamori Miumi'));
  assert.equal(stat(game).stars, 6);
  harem(game, 0, id('Okurimono Mizuki'));
  assert.equal(stat(game).stars, 9);
});

test('alone in the harem excludes both other girls and Support cards', () => {
  const game = playing(); harem(game, 0, id('Kaminoshima Kaede'));
  assert.equal(stat(game).tames, 4);
  harem(game, 0, id('Tanaka Michi'));
  assert.equal(stat(game).tames, 0);
});

test('no-girl compensation counts every harem, ignores own Support and stops upon acquiring a girl', () => {
  const game = playing(); harem(game, 1, id('Amagiri Arisu'), id('Myselphie'), id('Ikazawa Ayumi'));
  harem(game, 0, id('Tanaka Michi'));
  assert.equal(stat(game).hand, 7);
  harem(game, 0, id('Natsukawa Akari'));
  assert.equal(stat(game).hand, 4);
});

for (const [goal, expectedHand, expectedTames] of [[25, 8, 6], [36, 9, 7], [50, 10, 8]]) {
  test(`${goal}-heart game caps general tames at ${expectedTames} and hand at ${expectedHand}, while target bonuses remain uncapped`, () => {
    const game = playing(2, 'Yamada Hiroto', goal);
    harem(game, 0, ...['Amagiri Arisu', 'Kaminoshima Kaede', 'Tenshiko Gabriel', 'Myselphie', 'Natsukawa Akari', 'Ikazawa Ayumi', 'Koyou Saren', 'Wasurenai Hanako'].map(name => id(name)));
    table(game, 0, id('Ultimate tamer'), id('Instant Card'));
    assert.ok(stat(game).usedStars <= stat(game).stars && stat(game).usedSlots <= stat(game).slots);
    assert.equal(stat(game).hand, expectedHand);
    assert.equal(stat(game).tames, expectedTames);
    assert.equal(rules.bidPreview(game, 'p0', id('Yukinomori Akari'), [], cards), expectedTames + 2);
  });
}

test('summon requires a card from the initiator hand, enough tames and a free harem slot', () => {
  const game = playing(); hand(game, 0, id('Myselphie'), id('Friendly chat'), id('Shopping'));
  rejects(game, 0, { type: 'summon', cardId: id('Natsukawa Akari'), cards: [id('Shopping')] });
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Friendly chat')] });
  harem(game, 0, id('Natsukawa Akari'), id('Ikazawa Ayumi'), id('Koyou Saren'));
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')] });
});

test('three-player auction enforces strict raises, resets passes, permits re-entry and awards only after every other player passes', () => {
  let game = playing(3);
  hand(game, 0, id('Myselphie'), id('Shopping', 0), id('Matsuri'), id('Friendly chat', 0));
  hand(game, 1, id('Shopping', 1), id('Hanabi night'));
  hand(game, 2, id('True Love'));
  game = act(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping', 0)] });
  assert.equal(game.auction.bids.p0.power, 3);
  rejects(game, 1, { type: 'bid', cards: [id('Shopping', 1)] });
  rejects(game, 0, { type: 'pass' });
  rejects(game, 0, { type: 'endTurn', cards: [id('Friendly chat', 0)] });
  game = act(game, 2, { type: 'pass' });
  rejects(game, 2, { type: 'pass' });
  game = act(game, 1, { type: 'bid', cards: [id('Hanabi night')] });
  assert.deepEqual(game.auction.passes, []);
  game = act(game, 0, { type: 'bid', cards: [id('Matsuri')] });
  assert.equal(game.auction.bids.p0.power, 9);
  game = act(game, 2, { type: 'bid', cards: [id('True Love')] });
  assert.equal(game.auction.bids.p2.power, 13, 'Konda has four free slots, plus his +2 Common target bonus');
  game = act(game, 0, { type: 'pass' });
  assert.ok(game.auction, 'One of two required passes must not finish the auction');
  game = act(game, 1, { type: 'pass' });
  assert.equal(game.auction, null);
  assert.ok(game.players[2].harem.some(card => card.id === id('Myselphie')));
  for (const name of ['Shopping', 'Hanabi night', 'Matsuri', 'True Love']) assert.ok(game.discard.includes(id(name)));
});

test('cumulative raises add new Tame strength without re-adding character target bonuses', () => {
  let game = playing();
  hand(game, 0, id('Amagiri Arisu'), id('Shopping'), id('Matsuri'), id('Friendly chat'));
  hand(game, 1, id('True Love'));
  game = act(game, 0, { type: 'summon', cardId: id('Amagiri Arisu'), cards: [id('Shopping')] });
  assert.equal(game.auction.bids.p0.power, 5);
  game = act(game, 1, { type: 'bid', cards: [id('True Love')] });
  game = act(game, 0, { type: 'bid', cards: [id('Matsuri')] });
  assert.equal(game.auction.bids.p0.power, 11);
});

test('duplicate cards, cards from another hand, and non-Tame/Charge bids are rejected atomically', () => {
  let game = playing(); hand(game, 0, id('Myselphie'), id('Shopping'), id('Friendly chat')); hand(game, 1, id('True Love'), id('Instant Card'));
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping'), id('Shopping')] });
  game = act(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')] });
  rejects(game, 1, { type: 'bid', cards: [id('Friendly chat')] });
  rejects(game, 1, { type: 'bid', cards: [id('Instant Card')] });
});

test('drawing happens only at the beginning of the owning player turn', () => {
  let game = playing(); hand(game, 0, id('Friendly chat')); hand(game, 1, id('Friendly chat', 1));
  game = act(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.players[1].hand.length, stat(game, 1).hand);
  game = act(game, 1, { type: 'endTurn', cards: [id('Friendly chat', 1)] });
  assert.equal(game.players[0].hand.length, stat(game).hand);
});

test('Charge requires its next own turn, is consumed once, and releases its occupied stars', () => {
  let game = playing(); hand(game, 0, id('Common Charge'), id('Mitsukai Yumi'), id('Shopping'), id('Friendly chat'));
  game = act(game, 0, { type: 'deploy', cardId: id('Common Charge') });
  assert.equal(stat(game).usedStars, 1);
  rejects(game, 0, { type: 'summon', cardId: id('Mitsukai Yumi'), cards: [id('Common Charge')] });
  game = act(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
  assert.equal(game.players[0].turns, 1);
  game = act(game, 1, { type: 'endTurn', cards: [game.players[1].hand[0]] });
  assert.equal(game.players[0].turns, 2);
  game = act(game, 0, { type: 'summon', cardId: id('Mitsukai Yumi'), cards: [id('Common Charge')] });
  assert.equal(stat(game).usedStars, 0);
  game = act(game, 1, { type: 'pass' });
  assert.equal(game.discard.filter(cardId => cardId === id('Common Charge')).length, 1);
  assert.ok(!game.players[0].table.some(card => card.id === id('Common Charge')));
  hand(game, 0, id('Myselphie'));
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Common Charge')] });
});

test('Power Play grants its printed hand bonus while Charge cards are charging, without leaking base tames into passive strength', () => {
  const game = playing(2, 'Nanatsuboshi Hideo');
  table(game, 0, { id: id('Power Play'), readyAt: 2 }, { id: id('Common Charge'), readyAt: 2 });
  assert.equal(stat(game).hand, 5);
  assert.equal(stat(game).tames, 2, 'Only the character no-girl bonus is passive');
  game.players[0].turns = 2;
  assert.equal(stat(game).hand, 3);
});

test('Delta Force and Akujima charge bonuses apply once per used Charge, never as passive tames', () => {
  const game = playing(2, 'Akujima Natsu');
  table(game, 0, id('Delta Force'), { id: id('Common Charge'), readyAt: 1 });
  assert.equal(stat(game).tames, 0);
  assert.equal(rules.bidPreview(game, 'p0', id('Myselphie'), [id('Common Charge')], cards), 6);
});

test('a Tame following consumed Charge observes newly freed stars and prior used-Charge count', () => {
  const game = playing(); table(game, 0, { id: id('Common Charge'), readyAt: 1 });
  const before = structuredClone(game);
  assert.equal(rules.bidPreview(game, 'p0', id('Amagiri Arisu'), [id('Common Charge'), id('Star tamer')], cards), 8);
  assert.equal(rules.bidPreview(game, 'p0', id('Amagiri Arisu'), [id('Charge booster'), id('Common Charge')], cards), 5);
  assert.deepEqual(game, before, 'Preview must not consume cards or change state');
});

test('active-card replacement frees star capacity atomically', () => {
  let game = playing(); table(game, 0, id('Instant Card')); hand(game, 0, id('Instant Tame'), id('Friendly chat'));
  rejects(game, 0, { type: 'deploy', cardId: id('Instant Tame') });
  game = act(game, 0, { type: 'deploy', cardId: id('Instant Tame'), replace: [id('Instant Card')] });
  assert.equal(stat(game).usedStars, 2);
  assert.equal(stat(game).freeStars, 2);
  assert.ok(game.discard.includes(id('Instant Card')));
});

test('Girl and Support consume harem places; housing consumes stars and adds slots', () => {
  const game = playing(); harem(game, 0, id('Myselphie'), id('Tanaka Michi')); table(game, 0, id('Luxury Hotel'));
  assert.equal(stat(game).usedSlots, 2);
  assert.equal(stat(game).slots, 4);
  assert.equal(stat(game).usedStars, 1);
});

test('kill and revive share one use per source per own turn, then reset next own turn', () => {
  let game = playing(); harem(game, 0, id('Fumetsu Kowa'), id('Myselphie')); hand(game, 0, id('Friendly chat')); hand(game, 1, id('Friendly chat', 1));
  game = act(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Myselphie'), mode: 'kill' });
  assert.equal(game.players[0].harem.find(card => card.id === id('Myselphie')).dead, true);
  rejects(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Myselphie'), mode: 'revive' });
  game = act(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
  game = act(game, 1, { type: 'endTurn', cards: [id('Friendly chat', 1)] });
  game = act(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Myselphie'), mode: 'revive' });
  assert.equal(game.players[0].harem.find(card => card.id === id('Myselphie')).dead, false);
  rejects(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Myselphie'), mode: 'kill' });
});

test('kill cannot target another player, Support cards, or use a dead ability source', () => {
  const game = playing(); harem(game, 0, id('Fumetsu Kowa'), id('Tanaka Michi'), { id: id('Atsu Keiko'), dead: true }); harem(game, 1, id('Myselphie'));
  rejects(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Myselphie'), mode: 'kill' });
  rejects(game, 0, { type: 'special', sourceId: id('Fumetsu Kowa'), targetId: id('Tanaka Michi'), mode: 'kill' });
  rejects(game, 0, { type: 'special', sourceId: id('Atsu Keiko'), targetId: id('Fumetsu Kowa'), mode: 'kill' });
});

test('ordinary actions preserve an own hand card for ending the turn; a dormant exception cannot cause a zero-card deadlock', () => {
  const game = playing(); hand(game, 0, id('Myselphie'), id('Shopping')); harem(game, 0, id('Umaru Yone'));
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')] });
  const deployGame = playing(); hand(deployGame, 0, id('Instant Tame'));
  rejects(deployGame, 0, { type: 'deploy', cardId: id('Instant Tame') });
  rejects(playing(), 0, { type: 'endTurn', cards: [] });
});

test('explicit opponent end-payment reservation supports a last-card summon without exposing or duplicating the reserved card', () => {
  let game = playing(); harem(game, 0, id('Umaru Yone'));
  hand(game, 0, id('Amagiri Arisu'), id('Shopping')); hand(game, 1, id('True Love'));
  game = act(game, 0, { type: 'summon', cardId: id('Amagiri Arisu'), cards: [id('Shopping')], reserveOpponentId: 'p1' });
  assert.equal(game.players[0].hand.length, 0);
  assert.equal(game.players[1].hand.length, 0);
  assert.equal(game.players[0].endPayment.id, id('True Love'));
  const view = rules.publicView(game, 'p0', cards);
  assert.equal(view.players[0].endPayment?.id, undefined);
  assert.ok(!JSON.stringify(view).includes(id('True Love')), 'Reserved hidden card identity must not leak through the public view');
  game = act(game, 1, { type: 'pass' });
  game = act(game, 0, { type: 'endTurn', cards: [] });
  assert.equal(game.turn, 1);
  assert.ok(game.discard.includes(id('True Love')));
  assert.equal(game.players[0].endPayment, undefined);
});

test('end-payment reservation requires an active special and an opponent with a card', () => {
  const game = playing(); hand(game, 0, id('Myselphie'), id('Shopping')); hand(game, 1, id('True Love'));
  rejects(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')], reserveOpponentId: 'p1' });
  const emptyOpponent = playing(); harem(emptyOpponent, 0, id('Umaru Yone')); hand(emptyOpponent, 0, id('Myselphie'), id('Shopping'));
  rejects(emptyOpponent, 0, { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')], reserveOpponentId: 'p1' });
});

test('Yuuka can pay the end of turn with an existing dead girl in another harem', () => {
  let game = playing(); harem(game, 0, id('Sumitachi Yuuka')); harem(game, 1, { id: id('Myselphie'), dead: true }); hand(game, 0, id('Friendly chat'));
  game = act(game, 0, { type: 'endTurn', cards: [], special: 'dead', targetId: id('Myselphie') });
  assert.ok(!game.players[1].harem.some(card => card.id === id('Myselphie')));
  assert.ok(game.discard.includes(id('Myselphie')));
  assert.deepEqual(game.players[0].hand, [id('Friendly chat')]);
});

test('charge maturation overflow defers drawing and blocks play until the owner discards enough permanents', () => {
  let game = playing(2, 'Makoto Noa'); game.turn = 1;
  table(game, 0, { id: id('Common Charge'), readyAt: 2 }, id('Falling Stars'), id('Sunny Day')); hand(game, 1, id('Friendly chat'));
  assert.equal(stat(game).stars, 6); assert.equal(stat(game).usedStars, 6);
  game = act(game, 1, { type: 'endTurn', cards: [id('Friendly chat')] });
  assert.equal(stat(game).stars, 5); assert.equal(stat(game).usedStars, 6);
  assert.equal(game.players[0].hand.length, 0, 'Pending overflow must be repaired before automatic turn draw');
  rejects(game, 0, { type: 'endTurn', cards: [] });
  game = act(game, 0, { type: 'discardPermanent', cards: [id('Sunny Day')] });
  assert.ok(stat(game).usedStars <= stat(game).stars);
  assert.equal(game.players[0].hand.length, stat(game).hand);
});

test('any player with overflow can remediate their own permanents out of turn; normal play waits', () => {
  let game = playing(); game.players[1].characterId = id('Makoto Noa');
  table(game, 1, { id: id('Common Charge'), readyAt: 1 }, id('Falling Stars'), id('Sunny Day')); hand(game, 0, id('Friendly chat'));
  assert.ok(stat(game, 1).usedStars > stat(game, 1).stars);
  rejects(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
  rejects(game, 0, { type: 'discardPermanent', cards: [id('Sunny Day')] });
  game = act(game, 1, { type: 'discardPermanent', cards: [id('Sunny Day')] });
  assert.equal(game.turn, 0);
  game = act(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
  assert.equal(game.turn, 1);
});

test('public view exposes only the requesting player hand and never token hashes or the draw-pile order', () => {
  const game = playing(); hand(game, 0, id('Friendly chat'), id('Shopping')); hand(game, 1, id('True Love'));
  const view = rules.publicView(game, 'p0', cards);
  assert.deepEqual(view.players[0].hand, game.players[0].hand);
  assert.deepEqual(view.players[1].hand, []);
  assert.equal(view.players[1].handCount, 1);
  assert.equal(view.deck, undefined); assert.equal(view.deckCount, game.deck.length);
  assert.ok(!JSON.stringify(view).includes('secret-token'));
  assert.ok(view.players.every(player => !Object.hasOwn(player, 'tokenHash')));
  assert.throws(() => rules.publicView(game, 'outsider', cards));
});

test('winning summon finishes immediately at the goal without waiting for endTurn', () => {
  let game = playing(2, 'Yamada Hiroto', 25);
  harem(game, 0, id('Yukinomori Akari'), id('Tsukinose Saya'), id('Seinaru Tsumi')); table(game, 0, id('Dormitory')); hand(game, 0, id('Myselphie'), id('Friendly chat'));
  assert.equal(stat(game).hearts, 23);
  game = act(game, 0, { type: 'summon', cardId: id('Myselphie'), cards: [] });
  game = act(game, 1, { type: 'pass' });
  assert.equal(game.phase, 'finished'); assert.equal(game.winnerId, 'p0');
  assert.equal(stat(game).hearts, 28);
  rejects(game, 0, { type: 'endTurn', cards: [id('Friendly chat')] });
});

test('global card synergies can make another player win immediately on the active player action', () => {
  let game = playing(2, 'Yamada Hiroto', 25);
  harem(game, 1, id('Mizumare Natsuko'), id('Ongakuko Tachi'), id('Tenshiko Gabriel'));
  hand(game, 0, id('Ikazawa Ayumi'), id('Shopping'), id('Friendly chat'));
  assert.equal(stat(game, 1).hearts, 24);
  game = act(game, 0, { type: 'summon', cardId: id('Ikazawa Ayumi'), cards: [id('Shopping')] });
  game = act(game, 1, { type: 'pass' });
  assert.equal(game.phase, 'finished'); assert.equal(game.winnerId, 'p1');
});

test('all ordinary turns retain all physical cards, including when discard is reshuffled after the deck empties', () => {
  let game = playing();
  const all = [...game.deck]; game.deck = []; game.discard = all;
  const card0 = id('Friendly chat'), card1 = id('Friendly chat', 1);
  game.discard = game.discard.filter(cardId => cardId !== card0 && cardId !== card1);
  game.players[0].hand = [card0]; game.players[1].hand = [card1];
  conserved(game);
  for (let turn = 0; turn < 30; turn++) {
    const current = game.turn;
    game = act(game, current, { type: 'endTurn', cards: [game.players[current].hand[0]] }, seeded(500 + turn));
  }
  assert.ok(game.logs.some(entry => /zamiešal/.test(entry.text)));
  conserved(game);
});
