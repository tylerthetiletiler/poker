import { randomInt, randomUUID } from 'node:crypto';

export const STAGES = ['preflop', 'flop', 'turn', 'river'];
export const TURN_SECONDS = 45;
const SUITS = ['♠', '♥', '♦', '♣'];

export function makeDeck() {
  const cards = [];
  for (let rank = 2; rank <= 14; rank++) for (const suit of SUITS) cards.push({ rank, suit });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function straightHigh(ranks) {
  const nums = [...new Set(ranks)].sort((a,b) => b-a);
  if (nums.includes(14)) nums.push(1);
  for (let i = 0; i <= nums.length - 5; i++) {
    if (nums[i] - nums[i + 4] === 4) return nums[i];
  }
  return 0;
}

export function evaluateFive(cards) {
  const ranks = cards.map(c => c.rank);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
  const groups = [...counts.entries()].map(([rank, count]) => ({ rank, count }))
    .sort((a,b) => b.count-a.count || b.rank-a.rank);
  const sorted = [...ranks].sort((a,b) => b-a);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const straight = straightHigh(ranks);
  if (flush && straight) return [8, straight];
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank];
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].rank, groups[1].rank];
  if (flush) return [5, ...sorted];
  if (straight) return [4, straight];
  if (groups[0].count === 3) return [3, groups[0].rank, ...groups.filter(g=>g.count===1).map(g=>g.rank).sort((a,b)=>b-a)];
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter(g=>g.count===2).map(g=>g.rank).sort((a,b)=>b-a);
    return [2, ...pairs, groups.find(g=>g.count===1).rank];
  }
  if (groups[0].count === 2) return [1, groups[0].rank, ...groups.filter(g=>g.count===1).map(g=>g.rank).sort((a,b)=>b-a)];
  return [0, ...sorted];
}

export function compareHands(a,b) {
  for (let i = 0; i < Math.max(a.length,b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

export function evaluateSeven(cards) {
  if (cards.length !== 7) throw new Error('Expected exactly seven cards');
  let best = null;
  for (let a = 0; a < 3; a++) for (let b = a+1; b < 4; b++)
    for (let c = b+1; c < 5; c++) for (let d = c+1; d < 6; d++)
      for (let e = d+1; e < 7; e++) {
        const rank = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
        if (!best || compareHands(rank,best)>0) best=rank;
      }
  return best;
}

export function handName(score) {
  return ['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'][score[0]];
}

export function splitPots(players, states, community, dealerIndex) {
  const participants = players.filter(p => states[p.id]?.total > 0);
  const levels = [...new Set(participants.map(p=>states[p.id].total))].sort((a,b)=>a-b);
  const winnings = new Map();
  const descriptions = [];
  let prior = 0;
  for (const level of levels) {
    const contributors = participants.filter(p=>states[p.id].total >= level);
    const amount = (level-prior)*contributors.length;
    prior = level;
    if (!amount) continue;
    const eligible = contributors.filter(p=>!states[p.id].folded);
    if (!eligible.length) throw new Error('No eligible winners for side pot');
    let winners;
    let winningRank = null;
    if (eligible.length === 1) winners = eligible;
    else {
      const ranked = eligible.map(p=>({ p, rank:evaluateSeven([...states[p.id].cards,...community]) }));
      winningRank = ranked.reduce((best,x)=>compareHands(x.rank,best)>0?x.rank:best,ranked[0].rank);
      winners = ranked.filter(x=>compareHands(x.rank,winningRank)===0).map(x=>x.p);
    }
    const share = Math.floor(amount/winners.length);
    let odd = amount % winners.length;
    // Odd chips go clockwise from the dealer.
    const clockwise = [...winners].sort((a,b)=>{
      const ia=players.indexOf(a), ib=players.indexOf(b);
      return ((ia-dealerIndex+players.length)%players.length)-((ib-dealerIndex+players.length)%players.length);
    });
    for (const p of clockwise) {
      const paid = share + (odd-- > 0 ? 1 : 0);
      winnings.set(p.id,(winnings.get(p.id)||0)+paid);
    }
    descriptions.push({ amount, winnerIds:winners.map(p=>p.id), hand:winningRank?handName(winningRank):'Last player standing' });
  }
  return { winnings, descriptions };
}

export function uid() { return randomUUID(); }
