import test from 'node:test';
import assert from 'node:assert/strict';
import {startHand,performAction} from '../server.js';
let randomSeed=342321;
function random(){randomSeed=(randomSeed*1664525+1013904223)>>>0;return randomSeed/(2**32);}
test('200 simulated multiplayer hands conserve chips across bets, side pots and all-ins',()=>{
  const players=Array.from({length:6},(_,i)=>({id:'test'+i,name:'Tester '+i,stack:2500,connected:true,ws:null}));
  const room={code:'TEST',players,hostId:players[0].id,settings:{smallBlind:10,bigBlind:20,startingStack:2500},status:'lobby',hand:null,chat:[],turnTimer:null,nextTimer:null};
  try {
    for(let round=0;round<200;round++){
      for(const p of players){if(p.stack<100){p.stack=2500;}}
      const starting=players.reduce((s,p)=>s+p.stack,0);
      startHand(room);let n=0;
      while(room.status==='playing'){
        assert.ok(++n<300,`Hand ${round} did not finish`);
        const id=room.hand.actingId,p=players.find(p=>p.id===id),h=room.hand,s=h.states[id];
        assert.ok(p,'Player should be acting');
        const toCall=Math.max(0,h.currentBet-s.street);
        const canRaise=(!s.acted||(h.currentBet-s.actedAt)>=h.minRaise) && p.stack>toCall;
        const r=random();
        let action,value;
        if(r<.1 && toCall>0)action='fold';
        else if(r<.23 && p.stack>0 && canRaise)action='allin';
        else if(r<.40 && canRaise && h.currentBet+h.minRaise<=p.stack+s.street){action='raise';value=h.currentBet+h.minRaise;}
        else action=toCall?'call':'check';
        performAction(room,p,action,value);
      }
      clearTimeout(room.nextTimer);room.nextTimer=null;
      assert.equal(room.status,'showdown');
      assert.equal(players.reduce((s,p)=>s+p.stack,0),starting,`Chips lost in hand ${round}`);
      assert.ok(room.hand.payouts.length>=1);
    }
  } finally {clearTimeout(room.nextTimer);clearTimeout(room.turnTimer);}
});
