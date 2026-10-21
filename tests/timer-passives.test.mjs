import test from 'node:test';
import assert from 'node:assert/strict';
import { rules, catalog, cards, id, playing, hand, harem, table, conserved, act, rejects, stat } from './fixtures.mjs';

function timed(count = 3, seconds = 60) {
  let game = playing(count);
  game.options.bidSeconds = seconds;
  hand(game, 0, id('Myselphie'), id('Shopping'), id('Friendly chat'));
  hand(game, 1, id('Shopping', 1), id('Shopping', 2));
  return rules.applyAction(game, 'p0', { type: 'summon', cardId: id('Myselphie'), cards: [id('Shopping')] }, cards, Math.random, 1000);
}
test('new rooms default to 60 seconds; host changes reset readiness and invalid timeouts fail', () => {
  const game = rules.newGame('ABC234', rules.newPlayer('p0', 'Host', 'hash'), { goal: 25, selection: 'random' });
  assert.equal(game.options.bidSeconds, 60);
  for (const bidSeconds of [0, 30, 60, 90, 120]) {
    game.players[0].ready = true;
    const next = rules.applyAction(game, 'p0', { type: 'options', options: { ...game.options, bidSeconds } }, cards);
    assert.equal(next.options.bidSeconds, bidSeconds);
    assert.equal(next.players[0].ready, false);
  }
  for (const bidSeconds of [-1, 1, 61, 600, '60', null]) assert.throws(() => rules.validateOptions({ ...game.options, bidSeconds }), rules.RuleError);
});
for (let count = 2; count <= 8; count++) test(`timeout at exact boundary auto-passes ${count - 1} players and awards once (${count} players)`, () => {
  const game = timed(count);
  assert.equal(game.auction.deadlineAt, 61000);
  assert.equal(rules.advanceAuctionClock(game, cards, 60999), game);
  const next = rules.advanceAuctionClock(game, cards, 61000);
  assert.equal(next.auction, null);
  assert.equal(next.players[0].harem.at(-1).id, id('Myselphie'));
  assert.equal(next.logs.filter(x => x.text.includes('automaticky pasuje')).length, count - 1);
  assert.equal(rules.advanceAuctionClock(next, cards, 999999), next);
  assert.ok(game.auction, 'previous snapshot stays unchanged');
  conserved(next);
});
test('a raise resets both all passes and the shared reaction deadline; passing does not extend it', () => {
  let game = timed(3);
  game = rules.applyAction(game, 'p2', { type: 'pass' }, cards, Math.random, 2000);
  assert.equal(game.auction.deadlineAt, 61000);
  game = rules.applyAction(game, 'p1', { type: 'bid', cards: [id('Shopping', 1), id('Shopping', 2)] }, cards, Math.random, 60000);
  assert.equal(game.auction.deadlineAt, 120000);
  assert.deepEqual(game.auction.passes, []);
  assert.equal(rules.advanceAuctionClock(game, cards, 61000), game);
  const next = rules.advanceAuctionClock(game, cards, 120000);
  assert.equal(next.players[1].harem.at(-1).id, id('Myselphie'));
  conserved(next);
});
test('manual pass is not logged twice; late bid/pass cannot mutate the elapsed auction', () => {
  let game = timed(3);
  game = rules.applyAction(game, 'p2', { type: 'pass' }, cards, Math.random, 2000);
  const before = structuredClone(game);
  for (const action of [{ type: 'pass' }, { type: 'bid', cards: [id('Shopping', 1), id('Shopping', 2)] }]) {
    assert.throws(() => rules.applyAction(game, 'p1', action, cards, Math.random, 61000), /Čas na reakciu/);
    assert.deepEqual(game, before);
  }
  const next = rules.advanceAuctionClock(game, cards, 61000);
  assert.equal(next.logs.filter(x => x.text.includes('automaticky pasuje')).length, 1);
  assert.equal(next.logs.filter(x => x.text.includes('Player 2 pasuje')).length, 1);
  conserved(next);
});
test('disabled and legacy rooms wait indefinitely; timeout still performs immediate victory checks', () => {
  for (const option of [0, undefined]) {
    const game = timed(2, option);
    if (option === undefined) { delete game.options.bidSeconds; delete game.auction.deadlineAt; }
    assert.equal(rules.advanceAuctionClock(game, cards, Number.MAX_SAFE_INTEGER), game);
  }
  const game = timed(2);
  game.options.goal = 25;
  table(game, 0, id('Luxury Hotel'));
  for (const name of ['Ongakuko Tachi', 'Fumetsu Kowa', 'Amagiri Arisu']) harem(game, 0, id(name));
  const next = rules.advanceAuctionClock(game, cards, 61000);
  assert.equal(next.phase, 'finished');
  assert.equal(next.winnerId, 'p0');
  conserved(next);
});

// Physical cards, printed bonuses, and occupied stars are used instead of mocked effects.
const cases = [
  ['Sunny Day', ['Miyano Rika'], [], 2],
  ['Falling Stars', ['Miyano Rika', 'Tanaka Kaede', 'Shimazaki Nina'], [], 3],
  ['Crazy Lolicon', ['Tanaka Kaede', 'Kotegawa Kotori'], [], 2],
  ['Playing together', ['Shimazaki Nina', 'Nanami Anzu'], [], 2],
  ['Tokyo Dome', [], ['Shironeko Emily'], 3],
  ['Charge Fusion', [], [], 8],
];
for (const [ability, ownGirls, otherGirls, expectedBonus] of cases) test(`${ability} funds its own deployment at zero free stars`, () => {
  let game = playing();
  harem(game, 0, ...ownGirls.map(name => ({ id: id(name), dead: true })));
  harem(game, 1, ...otherGirls.map(name => ({ id: id(name), dead: true })));
  for (const name of ['Charge', 'double Charge', 'Loli Charge', 'Imouto Charge']) table(game, 0, { id: id(name), readyAt: 2 });
  assert.equal(stat(game).freeStars, 0);
  hand(game, 0, id(ability), id('Friendly chat'));
  const oldStats = stat(game);
  game = act(game, 0, { type: 'deploy', cardId: id(ability) });
  assert.equal(stat(game).stars, oldStats.stars + expectedBonus);
  assert.equal(stat(game).usedStars, 4 + cards[id(ability)].cost.stars);
  if (ability === 'Playing together') assert.equal(stat(game).slots, oldStats.slots + 2);
  conserved(game);
});
test('an active star passive repairs preexisting overflow without forced discard and resumes pending draw', () => {
  let game = playing();
  harem(game, 1, { id: id('Shironeko Emily'), dead: true }, { id: id('Ongakuko Tachi'), dead: true });
  table(game, 0, id('Moonlight Storm'), id('Tripple Charge'));
  hand(game, 0, id('Tokyo Dome'), id('Friendly chat'));
  assert.equal(stat(game).usedStars, 6);
  assert.equal(stat(game).stars, 4);
  game.pendingDraw = 'p0';
  game = act(game, 0, { type: 'deploy', cardId: id('Tokyo Dome') });
  assert.equal(stat(game).usedStars, 9);
  assert.equal(stat(game).stars, 10);
  assert.equal(game.pendingDraw, null);
  assert.equal(game.players[0].hand.length, stat(game).hand);
  conserved(game);
});
test('overflow repair rejects insufficient, out-of-turn and capacity-losing replacement atomically', () => {
  const game = playing();
  table(game, 0, id('Moonlight Storm'), id('Tripple Charge'));
  hand(game, 0, id('Sunny Day'), id('Friendly chat'));
  rejects(game, 0, { type: 'deploy', cardId: id('Sunny Day') }, /Po započítaní pasívok/);
  game.turn = 1;
  rejects(game, 0, { type: 'deploy', cardId: id('Sunny Day') });
  const valid = playing();
  harem(valid, 0, id('Miyano Rika'));
  table(valid, 0, id('Moonlight Storm'));
  hand(valid, 0, id('Sunny Day'), id('Friendly chat'));
  rejects(valid, 0, { type: 'deploy', cardId: id('Sunny Day'), replace: [id('Miyano Rika')] }, /Po započítaní pasívok/);
});
test('Card Dealer subtracts stars as printed, and missing subtype is not granted a star bonus', () => {
  const game = playing();
  harem(game, 0, { id: id('Tanaka Kaede'), dead: true });
  table(game, 0, id('Card Dealer'));
  assert.equal(stat(game).stars, 3);
  table(game, 0, id('Sunny Day'));
  assert.equal(stat(game).stars, 3);
});
test('all printed catalog effect families are recognized and evaluated across live/dead multi-player boards', () => {
  for (const card of catalog.filter(c => !['tame', 'charge'].includes(c.type))) {
    const game = playing(8);
    if (card.type === 'character') game.players[0].characterId = card.id;
    else if (['girl', 'support'].includes(card.type)) harem(game, 0, card.id);
    else table(game, 0, card.id);
    for (const [i, subtype] of ['Tsundere', 'Deredere', 'Loli', 'Imouto', 'Idol', 'Yandere', 'Common', 'Otaku'].entries()) {
      const girl = catalog.find(c => c.type === 'girl' && c.subtype === subtype && c.id !== card.id);
      harem(game, i, { id: girl.id, dead: i % 2 === 0 });
    }
    const stats = stat(game);
    for (const value of Object.values(stats)) assert.ok(Number.isFinite(value), card.name);
  }
});
