import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { WebSocketServer, WebSocket } from './ws-lite.js';
import { randomBytes } from 'node:crypto';
import { makeDeck, splitPots, evaluateSeven, handName, STAGES, TURN_SECONDS, uid } from './poker.js';

const root = resolve(fileURLToPath(new URL('./public/',import.meta.url)));
const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ico':'image/x-icon','.json':'application/json'};
const server = createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(req.method!=='GET'){res.writeHead(405);res.end('Method not allowed');return;}
  const pathname=(req.url||'/').split('?')[0];
  if(pathname==='/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;
  }
  let name;
  if(pathname==='/'||/^\/r\/[A-Za-z0-9]{4,8}\/?$/.test(pathname))name='index.html';
  else {
    try {name=decodeURIComponent(pathname.replace(/^\//,''));}
    catch {res.writeHead(400);res.end('Invalid path');return;}
  }
  const target=resolve(root,name);
  if(target!==root && !target.startsWith(root+'/')){res.writeHead(403);res.end('Forbidden');return;}
  try {
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':mimes[extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(bytes);
  } catch {res.writeHead(404);res.end('Not found');}
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });
const rooms = new Map();
const now = () => Date.now();
const safeName = name => String(name || '').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,20) || 'Player';
const safeText = text => String(text || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,240);
const send = (ws,data) => { if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); };
const code = () => randomBytes(4).toString('hex').slice(0,6).toUpperCase();
const active = p => p.stack > 0 && p.connected;
const pstate = (room,p) => room.hand?.states[p.id];
const canAct = (room,p) => { const s=pstate(room,p); return !!(s && !s.folded && !s.allIn && p.stack>0); };
const liveHand = room => room.players.filter(p=>pstate(room,p) && !pstate(room,p).folded);
const eligible = room => room.players.filter(p=>active(p));
const pool = hand => Object.values(hand.states).reduce((sum,s)=>sum+s.total,0);
function sendError(ws,message) { send(ws,{type:'error',message}); }

function publicState(room,viewer) {
  const h=room.hand;
  return {
    type:'state', code:room.code, you:viewer.id, host:room.hostId, status:room.status,
    settings:room.settings, deadline:h?.deadline || null,
    players:room.players.map(p=>{
      const s=h?.states[p.id];
      const reveal=!!(s && (p.id===viewer.id || (h.stage==='showdown' && !s.folded)));
      return {id:p.id,name:p.name,stack:p.stack,connected:p.connected,
        playing:!!s,folded:s?.folded ?? false,allIn:s?.allIn ?? false,
        bet:s?.street || 0,total:s?.total || 0,cards:reveal?s.cards:[],
        hasCards:!!s?.cards?.length, isDealer:p.id===h?.dealerId,
        smallBlind:p.id===h?.sbId,bigBlind:p.id===h?.bbId,
        winner:!!h?.winners?.includes(p.id)};
    }),
    hand:h ? {id:h.id,stage:h.stage,board:h.board,pot:pool(h),currentBet:h.currentBet,
      minRaise:h.minRaise,actingId:h.actingId,
      toCall:h.actingId===viewer.id ? Math.max(0,h.currentBet-(h.states[viewer.id]?.street||0)) : 0,
      minTo:h.currentBet ? h.currentBet+h.minRaise : room.settings.bigBlind,
      maxTo:(h.states[viewer.id]?.street||0)+viewer.stack,
      canRaise:canRaise(room,viewer),
      message:h.message || '',payouts:h.payouts || [],
      handNumber:h.id } : null,
    chat:room.chat.slice(-60)
  };
}
function broadcast(room) {
  for(const p of room.players) if(p.ws) send(p.ws,publicState(room,p));
}
function log(room,message,kind='system') {
  room.chat.push({id:uid(),kind,message,time:now()});
  if(room.chat.length>100) room.chat.splice(0,room.chat.length-100);
}
function makePlayer(name,ws) {
  return {id:uid(),token:randomBytes(24).toString('hex'),name:safeName(name),stack:0,ws,connected:true};
}
function clockwise(room,fromIndex,filter) {
  for(let i=1;i<=room.players.length;i++) {
    const idx=(fromIndex+i)%room.players.length;
    const p=room.players[idx];
    if(filter(p)) return p;
  }
  return null;
}
function index(room,id) { return room.players.findIndex(p=>p.id===id); }
function clearTurn(room) { if(room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer=null; }
function clearNext(room) { if(room.nextTimer) clearTimeout(room.nextTimer); room.nextTimer=null; }
function seatDeal(room) {
  const h=room.hand;
  const players=room.players.filter(p=>h.states[p.id]);
  for(let n=0;n<2;n++) for(const p of players) h.states[p.id].cards.push(h.deck.pop());
}
function addChips(room,p,amount) {
  const paid=Math.min(amount,p.stack);
  p.stack-=paid;
  const s=pstate(room,p);
  s.street+=paid; s.total+=paid; s.allIn=p.stack===0;
  return paid;
}
function canRaise(room,p) {
  const h=room.hand,s=h?.states[p.id];
  if(!h || h.stage==='showdown'||h.actingId!==p.id || !canAct(room,p)) return false;
  if(p.stack<=Math.max(0,h.currentBet-s.street)) return false;
  return !s.acted || (h.currentBet-s.actedAt)>=h.minRaise;
}
function chooseTurn(room,fromId) {
  const h=room.hand;
  if(!h || h.stage==='showdown') return;
  if(liveHand(room).length===1) { finishHand(room,true);return; }
  const next=clockwise(room,index(room,fromId),p=>h.pending.has(p.id) && canAct(room,p));
  if(next) {
    h.actingId=next.id;
    if(!next.connected) {
      const toCall=Math.max(0,h.currentBet-h.states[next.id].street);
      performAction(room,next,toCall===0?'check':'fold',undefined,true);
      return;
    }
    h.deadline=now()+TURN_SECONDS*1000;
    clearTurn(room);
    const handId=h.id;
    room.turnTimer=setTimeout(()=>{
      if(room.hand?.id!==handId || room.hand.actingId!==next.id) return;
      const toCall=Math.max(0,room.hand.currentBet-room.hand.states[next.id].street);
      try { performAction(room,next,toCall===0?'check':'fold',undefined,true); } catch(e) { console.error('Timer',e); }
    },TURN_SECONDS*1000+100);
    broadcast(room);
  } else nextStreetOrFinish(room);
}
function postBlinds(room,sb,bb) {
  const h=room.hand;
  addChips(room,sb,room.settings.smallBlind);
  addChips(room,bb,room.settings.bigBlind);
  h.currentBet=room.settings.bigBlind;
  h.minRaise=room.settings.bigBlind;
}
function startHand(room) {
  clearNext(room); clearTurn(room);
  const participants=eligible(room);
  if(participants.length<2) {
    room.status='lobby'; room.hand=null;
    log(room,'Need at least two connected players with chips to start.'); broadcast(room); return;
  }
  const prevDealer=room.hand?.dealerId || null;
  const dealer=prevDealer ? clockwise(room,index(room,prevDealer),p=>participants.includes(p)) : participants[0];
  const sb=participants.length===2 ? dealer : clockwise(room,index(room,dealer.id),p=>participants.includes(p));
  const bb=clockwise(room,index(room,sb.id),p=>participants.includes(p));
  const h={id:(room.hand?.id||0)+1,stage:'preflop',deck:makeDeck(),board:[],
    states:{},dealerId:dealer.id,sbId:sb.id,bbId:bb.id,currentBet:0,minRaise:room.settings.bigBlind,
    actingId:null,deadline:null,pending:new Set(),message:'',winners:[],payouts:[]};
  room.hand=h; room.status='playing';
  for(const p of participants) h.states[p.id]={cards:[],street:0,total:0,folded:false,allIn:false,acted:false,actedAt:0};
  seatDeal(room); postBlinds(room,sb,bb);
  h.pending=new Set(participants.filter(p=>canAct(room,p)).map(p=>p.id));
  log(room,`Hand #${h.id} · ${dealer.name} has the dealer button`);
  chooseTurn(room,bb.id);
}
function dealBoard(room,stage) {
  const h=room.hand;
  h.deck.pop(); // burn
  const count=stage==='flop'?3:1;
  for(let i=0;i<count;i++) h.board.push(h.deck.pop());
}
function nextStreetOrFinish(room) {
  const h=room.hand;
  if(!h || h.stage==='showdown') return;
  clearTurn(room);
  const remaining=liveHand(room);
  if(remaining.length===1) { finishHand(room,true); return; }
  const currentIndex=STAGES.indexOf(h.stage);
  if(currentIndex===3) { finishHand(room,false); return; }
  const nextStage=STAGES[currentIndex+1];
  h.stage=nextStage; dealBoard(room,nextStage);
  h.currentBet=0; h.minRaise=room.settings.bigBlind;
  for(const s of Object.values(h.states)) { s.street=0; s.acted=false; s.actedAt=0; }
  h.pending=new Set(room.players.filter(p=>canAct(room,p)).map(p=>p.id));
  h.actingId=null; h.deadline=null;
  if(h.pending.size===0 || (h.pending.size===1 && remaining.length>1 && remaining.some(p=>pstate(room,p).allIn))) {
    // If everyone else is all-in, no more bets are possible.
    nextStreetOrFinish(room); return;
  }
  chooseTurn(room,h.dealerId);
}
function finishHand(room,uncontested) {
  clearTurn(room);
  const h=room.hand;
  h.actingId=null; h.deadline=null;
  if(!uncontested) while(h.board.length<5) {
    const stage=h.board.length===0?'flop':h.board.length===3?'turn':'river';
    dealBoard(room,stage);
  }
  let winnings,descriptions;
  if(uncontested) {
    const winner=liveHand(room)[0];
    winnings=new Map([[winner.id,pool(h)]]);
    descriptions=[{amount:pool(h),winnerIds:[winner.id],hand:'Uncontested'}];
  } else ({winnings,descriptions}=splitPots(room.players,h.states,h.board,index(room,h.dealerId)));
  for(const [id,amount] of winnings) {
    const p=room.players.find(p=>p.id===id);
    p.stack+=amount;
  }
  h.stage='showdown'; room.status='showdown';
  h.winners=[...winnings.keys()];
  h.payouts=descriptions.map((d,i)=>({pot:i===0?'Main pot':`Side pot ${i}`,amount:d.amount,
    winners:d.winnerIds.map(id=>room.players.find(p=>p.id===id)?.name||'Player'),hand:d.hand}));
  h.message=h.payouts.map(d=>`${d.winners.join(' & ')} won ${d.amount.toLocaleString()} · ${d.hand}`).join('  •  ');
  log(room,h.message);
  broadcast(room);
  room.nextTimer=setTimeout(()=>startHand(room),10000);
}
function performAction(room,p,action,value,automatic=false) {
  const h=room.hand;
  if(room.status!=='playing'||h?.actingId!==p.id) throw new Error('Not your turn');
  const s=h.states[p.id];
  if(!s || s.folded || s.allIn) throw new Error('You cannot act this hand');
  const toCall=Math.max(0,h.currentBet-s.street);
  if(action==='fold') {
    s.folded=true; h.pending.delete(p.id);
  } else if(action==='check') {
    if(toCall!==0) throw new Error('You must call, raise or fold');
    s.acted=true; s.actedAt=h.currentBet; h.pending.delete(p.id);
  } else if(action==='call') {
    addChips(room,p,toCall);
    s.acted=true; s.actedAt=h.currentBet; h.pending.delete(p.id);
  } else if(action==='raise' || action==='allin') {
    if(action==='raise' && (!Number.isSafeInteger(value) || value<=0)) throw new Error('Enter a valid raise amount');
    const target=action==='allin'?s.street+p.stack:value;
    if(!Number.isSafeInteger(target)||target<=s.street||target>s.street+p.stack) throw new Error('Invalid bet size');
    if(target<=h.currentBet) {
      // An all-in for less than a call is still a legal call.
      if(action!=='allin') throw new Error('Raise must exceed current bet');
      addChips(room,p,p.stack);
      s.acted=true;s.actedAt=h.currentBet;h.pending.delete(p.id);
    } else {
      if(!canRaise(room,p)) throw new Error('Action has not been reopened for a raise');
      const increment=target-h.currentBet;
      const minRaise=h.currentBet===0?room.settings.bigBlind:h.minRaise;
      const isAllIn=target===s.street+p.stack;
      if(increment<minRaise&&!isAllIn) throw new Error(`Minimum total bet is ${h.currentBet+minRaise}`);
      addChips(room,p,target-s.street);
      h.currentBet=target;
      if(increment>=minRaise) h.minRaise=increment;
      s.acted=true;s.actedAt=h.currentBet;
      // A short all-in does not reopen raising, but people it puts behind must respond.
      if(increment>=minRaise) h.pending=new Set(room.players.filter(x=>x.id!==p.id&&canAct(room,x)).map(x=>x.id));
      else { h.pending.delete(p.id); for(const x of room.players) if(x.id!==p.id&&canAct(room,x)&&h.states[x.id].street<h.currentBet) h.pending.add(x.id); }
    }
  } else throw new Error('Unknown action');
  if(automatic) log(room,`${p.name} timed out and ${action==='check'?'checked':'folded'}`);
  else log(room,`${p.name} ${action==='raise'?`raised to ${h.currentBet}`:action==='allin'?`went all-in (${s.total} committed)`:action==='call'?`called ${Math.min(toCall,s.total)}`:action+'ed'}`.replace('folded','folded').replace('checkeded','checked'));
  const nextCandidates=[...h.pending].filter(id=>room.players.some(x=>x.id===id&&canAct(room,x)));
  h.pending=new Set(nextCandidates);
  chooseTurn(room,p.id);
}
function handleMessage(ws,msg) {
  if(!msg||typeof msg!=='object'||Array.isArray(msg)) return;
  let p=ws.player,room=ws.room;
  if(msg.type==='create') {
    if(room) return sendError(ws,'Already at a table');
    let invite=code(); while(rooms.has(invite)) invite=code();
    const smallBlind=Number(msg.smallBlind),bigBlind=Number(msg.bigBlind),stack=Number(msg.stack);
    if(!Number.isSafeInteger(smallBlind)||smallBlind<1||smallBlind>5000||
       !Number.isSafeInteger(bigBlind)||bigBlind!==smallBlind*2 ||
       !Number.isSafeInteger(stack)||stack<bigBlind*20||stack>100000) return sendError(ws,'Invalid table settings');
    p=makePlayer(msg.name,ws);p.stack=stack;
    room={code:invite,players:[p],hostId:p.id,settings:{smallBlind,bigBlind,startingStack:stack},
      status:'lobby',hand:null,chat:[],turnTimer:null,nextTimer:null,created:now(),updated:now()};
    rooms.set(invite,room);ws.player=p;ws.room=room;
    log(room,`${p.name} created the table`);
    send(ws,{type:'joined',code:invite,id:p.id,token:p.token});broadcast(room);return;
  }
  if(msg.type==='join') {
    if(room) return sendError(ws,'Already at a table');
    const invite=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    room=rooms.get(invite);
    if(!room) return sendError(ws,'Table not found. Check your invite code.');
    p=room.players.find(x=>x.token===msg.token && typeof msg.token==='string');
    if(p) {
      if(p.ws && p.ws!==ws) { send(p.ws,{type:'replaced'});p.ws.close(); }
      p.connected=true;p.ws=ws;
      log(room,`${p.name} reconnected`);
    } else {
      if(room.players.length>=8) return sendError(ws,'This table is full (8 players maximum)');
      p=makePlayer(msg.name,ws);p.stack=room.settings.startingStack;
      room.players.push(p);log(room,`${p.name} joined the table`);
    }
    ws.player=p;ws.room=room;room.updated=now();
    send(ws,{type:'joined',code:invite,id:p.id,token:p.token});broadcast(room);return;
  }
  if(!room||!p) return sendError(ws,'Join a table first');
  room.updated=now();
  try {
    if(msg.type==='start') {
      if(p.id!==room.hostId) throw new Error('Only the host can start the table');
      if(room.status==='playing') throw new Error('Hand in progress');
      startHand(room);
    } else if(msg.type==='action') {
      performAction(room,p,msg.action,msg.value);
    } else if(msg.type==='chat') {
      const message=safeText(msg.message);
      if(!message) return;
      if(now()-(ws.lastChat||0)<700) throw new Error('Sending messages too quickly');
      ws.lastChat=now();
      room.chat.push({id:uid(),kind:'chat',player:p.name,message,time:now()});
      if(room.chat.length>100) room.chat.shift();broadcast(room);
    } else if(msg.type==='rebuy') {
      if(p.stack!==0) throw new Error('Rebuy is available after you run out of chips');
      if(room.status==='playing' && pstate(room,p)) throw new Error('Wait until the hand ends');
      p.stack=room.settings.startingStack;log(room,`${p.name} bought in for play chips`);broadcast(room);
    } else if(msg.type==='leave') {
      disconnectPlayer(ws,true);send(ws,{type:'left'});
    }
  } catch(e) { sendError(ws,e.message || 'Unable to complete action'); }
}
function disconnectPlayer(ws,leaving=false) {
  const {room,p}={room:ws.room,p:ws.player};
  if(!room||!p||p.ws!==ws) return;
  p.ws=null;p.connected=false;room.updated=now();
  if(leaving && room.status!=='playing' && room.status!=='showdown') {
    room.players=room.players.filter(x=>x!==p);
  }
  if(room.hostId===p.id) room.hostId=room.players.find(x=>x.connected)?.id||p.id;
  log(room,`${p.name} ${leaving?'left':'disconnected'}`);
  if(room.status==='playing'&&room.hand?.actingId===p.id) {
    const s=pstate(room,p),toCall=Math.max(0,room.hand.currentBet-s.street);
    performAction(room,p,toCall===0?'check':'fold',undefined,true);
  } else broadcast(room);
  ws.room=null;ws.player=null;
}
wss.on('connection',(ws,req)=>{
  // Same-origin is required for browsers; null Origin is allowed for CLI/local testing.
  const origin=req.headers.origin;
  if(origin) {
    try { if(new URL(origin).host!==req.headers.host) { ws.close(1008,'Invalid origin');return; } }
    catch { ws.close(1008,'Invalid origin');return; }
  }
  ws.on('message',raw=>{
    try { handleMessage(ws,JSON.parse(String(raw))); }
    catch(e) { sendError(ws,'Invalid message'); }
  });
  ws.on('close',()=>disconnectPlayer(ws));
  ws.on('error',()=>{});
  send(ws,{type:'hello',message:'Welcome to Poker Night'});
});
// Remove abandoned lobby/rooms after six hours; no player data is persisted.
setInterval(()=>{
  for(const [key,room] of rooms) if(now()-room.updated>6*60*60*1000 && room.players.every(p=>!p.connected)) {
    clearTurn(room);clearNext(room);rooms.delete(key);
  }
},60*60*1000).unref();

const port=Number(process.env.PORT)||3000;
if(process.argv[1] === fileURLToPath(import.meta.url)) server.listen(port,'0.0.0.0',()=>console.log(`Poker Night listening on http://localhost:${port}`));
export {server,rooms,wss,performAction,startHand};
