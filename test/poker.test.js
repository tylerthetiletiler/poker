import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFive, evaluateSeven, compareHands, handName, splitPots, makeDeck } from '../poker.js';
const C=(r,s)=>({rank:r,suit:s});
const cs=(ranks,suits)=>ranks.map((r,i)=>C(r,suits?.[i]||'♠'));

test('Deck contains 52 different cards',()=>{
 const d=makeDeck();
 assert.equal(d.length,52);
 assert.equal(new Set(d.map(x=>x.rank+x.suit)).size,52);
});
test('Straight flush wins over quad and royal flush is the strongest straight flush',()=>{
 const royal=evaluateFive(cs([14,13,12,11,10]));
 const quad=evaluateFive([C(7,'♠'),C(7,'♦'),C(7,'♥'),C(7,'♣'),C(14,'♥')]);
 assert.equal(royal[0],8);assert.ok(compareHands(royal,quad)>0);
});
test('Wheel A-2-3-4-5 is a 5-high straight, not ace-high',()=>{
 const wheel=evaluateFive([C(14,'♠'),C(2,'♥'),C(3,'♦'),C(4,'♣'),C(5,'♠')]);
 const six=evaluateFive([C(2,'♠'),C(3,'♥'),C(4,'♦'),C(5,'♣'),C(6,'♠')]);
 assert.equal(wheel[0],4);assert.equal(wheel[1],5);assert.ok(compareHands(six,wheel)>0);
});
test('Two pair kicker decides tie',()=>{
 const a=evaluateFive([C(14,'♠'),C(14,'♥'),C(8,'♦'),C(8,'♣'),C(13,'♠')]);
 const b=evaluateFive([C(14,'♠'),C(14,'♥'),C(8,'♦'),C(8,'♣'),C(12,'♠')]);
 assert.equal(handName(a),'Two pair');assert.ok(compareHands(a,b)>0);
});
test('Seven cards evaluates best five across all combinations',()=>{
 const score=evaluateSeven([C(14,'♠'),C(13,'♠'),C(12,'♠'),C(11,'♠'),C(10,'♠'),C(9,'♥'),C(9,'♦')]);
 assert.deepEqual(score,[8,14]);
});
test('Full house correctly uses the larger set of trips',()=>{
 const score=evaluateSeven([C(14,'♠'),C(14,'♥'),C(14,'♦'),C(13,'♠'),C(13,'♥'),C(13,'♦'),C(2,'♣')]);
 assert.deepEqual(score,[6,14,13]);
});
test('Side pots divide among main and side pot winners',()=>{
 const players=['a','b','c'].map(id=>({id}));
 const community=[C(2,'♠'),C(5,'♠'),C(8,'♠'),C(11,'♦'),C(13,'♥')];
 const states={
   a:{cards:[C(14,'♠'),C(10,'♠')],total:100,folded:false},
   b:{cards:[C(11,'♥'),C(11,'♣')],total:300,folded:false},
   c:{cards:[C(2,'♦'),C(3,'♦')],total:300,folded:false}
 };
 const res=splitPots(players,states,community,0);
 assert.equal(res.winnings.get('a'),300);
 assert.equal(res.winnings.get('b'),400);
 assert.equal([...res.winnings.values()].reduce((a,b)=>a+b),700);
 assert.deepEqual(res.descriptions.map(x=>x.amount),[300,400]);
});
test('Tied hands split pot with odd chip clockwise from dealer',()=>{
 const players=['a','b','c'].map(id=>({id}));
 const community=[C(2,'♠'),C(5,'♥'),C(8,'♦'),C(11,'♣'),C(13,'♥')];
 const states={
   a:{cards:[C(14,'♠'),C(3,'♣')],total:101,folded:false},
   b:{cards:[C(14,'♥'),C(3,'♦')],total:101,folded:false},
   c:{cards:[C(10,'♦'),C(9,'♦')],total:101,folded:true}
 };
 const res=splitPots(players,states,community,2);
 assert.equal(res.winnings.get('a'),152);
 assert.equal(res.winnings.get('b'),151);
});
