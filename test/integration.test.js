import test from 'node:test';
import assert from 'node:assert/strict';
import { server, rooms } from '../server.js';

class Player {
  constructor(url){
    this.ws=new WebSocket(url);this.events=[];this.waiters=[];
    this.ws.addEventListener('message',e=>{
      const msg=JSON.parse(e.data);this.events.push(msg);
      const pending=[...this.waiters];
      for(const w of pending)if(w.filter(msg)){this.waiters.splice(this.waiters.indexOf(w),1);clearTimeout(w.t);w.resolve(msg);}
    });
  }
  async ready(){if(this.ws.readyState===1)return;await new Promise((res,rej)=>{this.ws.addEventListener('open',res,{once:true});this.ws.addEventListener('error',rej,{once:true});});}
  send(msg){this.ws.send(JSON.stringify(msg));}
  async wait(filter,timeout=2500){
    const prior=this.events.find(filter);if(prior)return prior;
    return new Promise((resolve,reject)=>{
      const w={filter,resolve,reject,t:setTimeout(()=>{this.waiters.splice(this.waiters.indexOf(w),1);reject(new Error('Timed out waiting for '+filter.toString()));},timeout)};
      this.waiters.push(w);
    });
  }
  consume(){this.events=[];}
  close(){this.ws.close();}
}

test('Real WebSocket clients create, join, play, reconnect and see private cards',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`ws://127.0.0.1:${server.address().port}`;
  const alice=new Player(base),bob=new Player(base),eve=new Player(base);
  let reconnect;
  try{
    await Promise.all([alice.ready(),bob.ready(),eve.ready()]);
    alice.send({type:'create',name:'Alice',stack:1000,smallBlind:5,bigBlind:10});
    const first=await alice.wait(x=>x.type==='joined');
    alice.consume();
    assert.match(first.code,/^[A-Z0-9]{6}$/);
    bob.send({type:'join',code:first.code,name:'Bob'});
    const b=await bob.wait(x=>x.type==='joined');
    bob.consume();
    eve.send({type:'join',code:first.code,name:'Eve'});
    const e=await eve.wait(x=>x.type==='joined');
    eve.consume();
    alice.send({type:'start'});
    const sA=await alice.wait(x=>x.type==='state'&&x.status==='playing');
    const sB=await bob.wait(x=>x.type==='state'&&x.status==='playing');
    const sE=await eve.wait(x=>x.type==='state'&&x.status==='playing');
    assert.equal(sA.players.filter(p=>p.cards.length===2).length,1);
    assert.equal(sB.players.filter(p=>p.cards.length===2).length,1);
    assert.equal(sE.players.filter(p=>p.cards.length===2).length,1);
    assert.equal(sA.players.find(p=>p.id===first.id).cards.length,2);
    assert.equal(sB.players.find(p=>p.id===b.id).cards.length,2);
    assert.equal(sE.players.find(p=>p.id===e.id).cards.length,2);
    const active=sA.hand.actingId;
    const actor=active===first.id?alice:active===b.id?bob:eve;
    actor.consume();actor.send({type:'action',action:'fold'});
    const post=await actor.wait(x=>x.type==='state'&&x.hand?.actingId!==active);
    assert.ok(post.hand.pot>=15);
    const host=rooms.get(first.code);
    assert.equal(host.hand.states[active].folded,true);
    bob.close();
    await new Promise(r=>setTimeout(r,100));
    reconnect=new Player(base);await reconnect.ready();
    reconnect.send({type:'join',code:first.code,name:'Bob',token:b.token});
    const joinBack=await reconnect.wait(x=>x.type==='joined');
    assert.equal(joinBack.id,b.id);
    assert.equal(rooms.get(first.code).players.length,3);
  } finally {
    for(const p of [alice,bob,eve,reconnect])p?.close();
    for(const room of rooms.values()){
      clearTimeout(room.turnTimer);clearTimeout(room.nextTimer);
    }
    await new Promise(resolve=>server.close(resolve));
  }
});
