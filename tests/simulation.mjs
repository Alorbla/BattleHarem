// Deterministic complete-game smoke tests. This is a modest heuristic, not a production opponent.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { rules, cards, seeded, lobby, conserved } from './fixtures.mjs';

const noRandom = () => 0.375;
function statsValue(stats) {
  return stats.hearts * 4 + stats.stars * 1.2 + stats.tames * 3 + stats.hand * 1.5 + Math.min(5, stats.freeSlots) * 1.8 + Math.min(4, stats.freeStars) * 0.4;
}
function stats(game, player) { return rules.statsFor(game, player.id, cards); }
function attempt(game, player, action) {
  try { return rules.applyAction(game, player.id, action, cards, noRandom); }
  catch (error) { if (error instanceof rules.RuleError) return null; throw error; }
}
function preview(game, player, target, ids) { return rules.bidPreview(game, player.id, target, ids, cards); }

function bidCards(game, player, target, initial) {
  const required = initial ? cards[target].cost.tames : game.auction.bids[game.auction.leaderId].power + 1;
  const pool = [
    ...player.table.filter(x => cards[x.id].type === 'charge' && (x.readyAt || 0) <= player.turns).map(x => x.id),
    ...player.hand.filter(cardId => cards[cardId].type === 'tame'),
  ];
  const base = preview(game, player, target, []);
  const power = Object.fromEntries(pool.map(cardId => [cardId, preview(game, player, target, [cardId]) - base]));
  const candidates = [[]];
  for (let a = 0; a < pool.length; a++) {
    candidates.push([pool[a]]);
    for (let b = a + 1; b < pool.length; b++) candidates.push([pool[a], pool[b]]);
  }
  for (const sorted of [
    [...pool].sort((a,b) => power[b]-power[a]),
    [...pool].sort((a,b) => power[a]-power[b]),
    [...pool].sort((a,b) => Number(cards[b].type === 'charge')-Number(cards[a].type === 'charge') || power[b]-power[a]),
  ]) for (let length = 3; length <= sorted.length; length++) candidates.push(sorted.slice(0, length));
  let best = null;
  for (const selected of candidates) {
    const handsUsed = selected.filter(cardId => cards[cardId].type === 'tame').length;
    if (game.players[game.turn].id === player.id && !player.endPayment && player.hand.length - handsUsed - Number(initial) < 1) continue;
    const result = preview(game, player, target, selected);
    if (result < required) continue;
    const expense = handsUsed * 2 + selected.length * 0.7 + (result - required) * 0.025;
    if (!best || expense < best.expense) best = { selected, expense, result };
  }
  return best;
}

function acquisitionValue(game, player, cardId) {
  const copy = structuredClone(game);
  const owner = copy.players.find(p => p.id === player.id);
  owner.harem.push({ id: cardId });
  return statsValue(stats(copy, owner)) - statsValue(stats(game, player));
}

function chooseTurnAction(game, player) {
  const before = stats(game, player), currentValue = statsValue(before);
  const options = [];
  for (const cardId of player.hand) {
    const card = cards[cardId];
    if (['ability','harem','charge'].includes(card.type)) {
      for (const replace of [[], ...player.table.map(entry => [entry.id])]) {
        const action = { type: 'deploy', cardId, replace };
        const next = attempt(game, player, action);
        if (!next) continue;
        let value = statsValue(stats(next, next.players.find(p => p.id === player.id))) - currentValue;
        if (card.type === 'charge') value += 2 + (card.base.tames || 0) * 0.75;
        if (card.type === 'ability' && !replace.length && before.freeStars > 2) value += 0.5;
        if (next.phase === 'finished' && next.winnerId === player.id) value += 10000;
        if (value > 0.1) options.push({ action, value });
      }
    } else if (['girl','support'].includes(card.type) && before.freeSlots >= 1) {
      const bid = bidCards(game, player, cardId, true);
      if (!bid) continue;
      const action = { type: 'summon', cardId, cards: bid.selected };
      if (!attempt(game, player, action)) continue;
      const value = acquisitionValue(game, player, cardId) - bid.expense * 0.35;
      if (value > 0.1) options.push({ action, value });
    }
  }
  for (const special of rules.specialsFor(player, cards)) {
    if (!['kill','revive','killRevive'].includes(special.special) || player.usedActions.includes(special.id)) continue;
    for (const target of player.harem.filter(entry => cards[entry.id].type === 'girl')) {
      const mode = target.dead ? 'revive' : 'kill';
      const action = { type: 'special', sourceId: special.id, targetId: target.id, mode };
      const next = attempt(game, player, action);
      if (!next) continue;
      let value = statsValue(stats(next, next.players.find(p => p.id === player.id))) - currentValue;
      if (next.phase === 'finished' && next.winnerId === player.id) value += 10000;
      if (value > 0.5) options.push({ action, value });
    }
  }
  // Upgrade an occupied harem place only if the held replacement is affordable afterwards.
  if (before.freeSlots === 0) for (const old of player.harem) {
    const action = { type: 'discardPermanent', cards: [old.id] };
    const next = attempt(game, player, action);
    if (!next || rules.capacityPlayers(next, cards).length) continue;
    const nextPlayer = next.players.find(p => p.id === player.id);
    for (const cardId of player.hand.filter(cid => ['girl','support'].includes(cards[cid].type))) {
      const bid = bidCards(next, nextPlayer, cardId, true);
      if (!bid) continue;
      const afterAcquire = structuredClone(next);
      afterAcquire.players.find(p => p.id === player.id).harem.push({id:cardId});
      const value = statsValue(stats(afterAcquire, nextPlayer)) - currentValue - bid.expense * 0.35;
      if (value > 1) options.push({action,value:value * 0.85});
    }
  }
  options.sort((a,b) => b.value-a.value);
  return options[0]?.action || null;
}

function remediate(game, player) {
  const choices = [...player.table, ...player.harem].map(entry => {
    const action = {type:'discardPermanent',cards:[entry.id]};
    const next = attempt(game,player,action);
    if (!next) return null;
    const s=stats(next,player),overflow=Math.max(0,s.usedStars-s.stars)+Math.max(0,s.usedSlots-s.slots);
    return {action,value:statsValue(s)-overflow*1000};
  }).filter(Boolean).sort((a,b)=>b.value-a.value);
  assert.ok(choices.length,'Overflow player has no legal remediation');
  return choices[0].action;
}

function chooseDiscard(game, player, actedThisTurn) {
  const s=stats(game,player);
  const ranking=player.hand.map(cardId=>{
    const card=cards[cardId];let value=0;
    if(card.type==='tame')value=3+(card.base.tames||0)*1.2;
    else if(card.type==='charge')value=s.freeStars>=card.cost.stars?3+(card.base.tames||0):1;
    else if(['girl','support'].includes(card.type))value=s.freeSlots?Math.min(10,acquisitionValue(game,player,cardId)/3):0;
    else if(card.type==='harem')value=s.freeSlots<2?10:2;
    else value=1;
    return {cardId,value};
  }).sort((a,b)=>a.value-b.value);
  const minimum=player.endPayment?0:1;
  const count=Math.max(minimum,player.hand.length-s.hand,actedThisTurn?minimum:Math.max(1,player.hand.length-2));
  return ranking.slice(0,count).map(x=>x.cardId);
}

export function simulate({count,goal,seed,maxTurns=1200,maxActions=20000}) {
  const rng=seeded(seed);let game=lobby(count,'random',goal),actions=0,contested=0,lastTurn=-1,actedThisTurn=false;
  const counts={};
  function commit(player,action){
    game=rules.applyAction(game,player.id,action,cards,rng);actions++;counts[action.type]=(counts[action.type]||0)+1;
    if(game.phase!=='lobby')conserved(game);
  }
  for(const player of game.players)commit(player,{type:'ready'});
  commit(game.players[0],{type:'start'});
  while(game.phase==='playing'&&game.turnNumber<maxTurns&&actions<maxActions){
    const overflow=rules.capacityPlayers(game,cards);
    if(overflow.length){const player=game.players.find(p=>p.id===overflow[0]);commit(player,remediate(game,player));continue;}
    if(game.auction){
      const candidates=game.players.filter(player=>player.id!==game.auction.leaderId&&!game.auction.passes.includes(player.id));
      assert.ok(candidates.length,'Auction with no unresolved opponent must have completed');
      const player=candidates[Math.floor(rng()*candidates.length)];let action={type:'pass'};
      if(stats(game,player).freeSlots>=1&&rng()<0.32){
        const bid=bidCards(game,player,game.auction.targetId,false);
        if(bid&&acquisitionValue(game,player,game.auction.targetId)>bid.expense*.5){
          const proposed={type:'bid',cards:bid.selected};if(attempt(game,player,proposed)){action=proposed;contested++;}
        }
      }
      commit(player,action);continue;
    }
    const player=game.players[game.turn];
    if(lastTurn!==game.turnNumber){lastTurn=game.turnNumber;actedThisTurn=false;}
    const action=chooseTurnAction(game,player);
    if(action){commit(player,action);actedThisTurn=true;continue;}
    const end={type:'endTurn',cards:chooseDiscard(game,player,actedThisTurn)};
    try{commit(player,end);}catch(error){
      fs.writeFileSync(new URL(`./simulation-blocked-${count}-${goal}-${seed}.json`,import.meta.url),JSON.stringify({game,action:end,error:error.message},null,2));
      throw error;
    }
  }
  const summary={players:count,goal,seed,status:game.phase,turns:game.turnNumber,actions,contested,winner:game.players.find(p=>p.id===game.winnerId)?.name,winnerHearts:game.winnerId?rules.statsFor(game,game.winnerId,cards).hearts:null,hearts:game.players.map(p=>stats(game,p).hearts),counts};
  if(game.phase!=='finished')fs.writeFileSync(new URL(`./simulation-unfinished-${count}-${goal}-${seed}.json`,import.meta.url),JSON.stringify({summary,game},null,2));
  return summary;
}

const scenarios=[{count:2,goal:25,seed:20261019},{count:4,goal:25,seed:20261020},{count:8,goal:25,seed:20261021},{count:4,goal:36,seed:20261022},{count:4,goal:50,seed:20261023}];
const results=[];
for(const scenario of scenarios){const result=simulate(scenario);results.push(result);console.log(JSON.stringify(result));}
fs.writeFileSync(new URL('./simulation-results.json',import.meta.url),JSON.stringify(results,null,2));
assert.ok(results.every(result=>result.status==='finished'),'Every seeded scenario should reach a winner');
