const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US');
const rank = r => ({14:'A',13:'K',12:'Q',11:'J',10:'10'})[r] || String(r);
const isRed = s => s==='♥'||s==='♦';
let ws=null, game=null, myId=null, currentCode=null, currentToken=null, chosenName='',soundEnabled=false, soundContext=null, sideTab='players', lastChatId=null, reconnectTimer=null, toastTimer=null, intentionalLeave=false, pendingJoin=null;
const seatPositions = total => Array.from({length:total},(_,i)=>{
  const a=(90+360*i/total)*Math.PI/180;
  return {x:50+44*Math.cos(a),y:50+43*Math.sin(a)};
});

function playTone(freq=520){
  if(!soundEnabled)return;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    soundContext ||= new Context();
    const osc=soundContext.createOscillator(),gain=soundContext.createGain();
    osc.type='sine';osc.frequency.value=freq;
    gain.gain.setValueAtTime(.04,soundContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+.17);
    osc.connect(gain);gain.connect(soundContext.destination);
    osc.start();osc.stop(soundContext.currentTime+.18);
  }catch{}
}
function toast(message,bad=false){
  const node=$('toast');node.textContent=message;node.className=bad?'show bad':'show';clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.className='',3200);
}
function send(message){
  if(ws?.readyState!==WebSocket.OPEN) {toast('Connection lost. Reconnecting…',true);return false;}
  ws.send(JSON.stringify(message));return true;
}
function connect(initial){
  if(reconnectTimer)clearTimeout(reconnectTimer);
  pendingJoin=initial;
  if(ws && (ws.readyState===WebSocket.CONNECTING || ws.readyState===WebSocket.OPEN)) {
    ws.close();
  }
  const socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
  ws=socket;
  $('connectionStatus').textContent='Connecting…';
  socket.addEventListener('open',()=>{
    $('connectionStatus').textContent='Connected · live table';
    send(pendingJoin);
  });
  socket.addEventListener('message',ev=>{
    let data;try{data=JSON.parse(ev.data)}catch{return;}
    if(data.type==='joined'){
      currentCode=data.code;myId=data.id;currentToken=data.token;
      localStorage.setItem('poker-night:'+currentCode,JSON.stringify({token:currentToken,name:chosenName}));
      localStorage.setItem('poker-night:name',chosenName);
      history.replaceState(null,'','/r/'+currentCode);
      $('landing').classList.add('hidden');$('game').classList.remove('hidden');
      $('roomCode').textContent=currentCode;
      if(data.code!==initial?.code) toast('Your table is ready. Invite your friends!');
    } else if(data.type==='state'){
      const old=game;game=data;
      if(old?.hand?.id!==data.hand?.id&&data.status==='playing')playTone(620);
      else if(old?.hand?.actingId!==data.hand?.actingId&&data.hand?.actingId===myId)playTone(790);
      else if(old?.status!=='showdown'&&data.status==='showdown')playTone(900);
      render();
    } else if(data.type==='error'){
      toast(data.message,true);
      if(!currentCode){$('landing').classList.remove('hidden');$('game').classList.add('hidden');}
    } else if(data.type==='replaced'){
      intentionalLeave=true;toast('This seat was opened in another tab');
    }
  });
  socket.addEventListener('close',()=>{
    if(socket!==ws)return;
    $('connectionStatus').textContent='Disconnected · attempting to reconnect';
    if(intentionalLeave)return;
    if(currentCode && currentToken){
      reconnectTimer=setTimeout(()=>connect({type:'join',code:currentCode,name:chosenName,token:currentToken}),2200);
    } else if(pendingJoin?.type==='create'){
      toast('Unable to connect to the server. Try again.',true);
    } else if(pendingJoin?.type==='join'){
      reconnectTimer=setTimeout(()=>connect(pendingJoin),2500);
    }
  });
  socket.addEventListener('error',()=>{});
}
function cardFace(c,small=false){
  if(!c)return `<div class="card-face blank" aria-label="Empty card slot"></div>`;
  return `<div class="card-face ${isRed(c.suit)?'red':''}" title="${rank(c.rank)}${c.suit}"><span>${rank(c.rank)}</span><span class="suit">${c.suit}</span></div>`;
}
function backFace(){return `<div class="card-face back" title="Face-down card"></div>`;}
function initials(name){return String(name||'?').trim().slice(0,1).toUpperCase();}
function me(){return game?.players.find(p=>p.id===myId);}
function renderSeats(){
  const players=game.players;
  const pos=seatPositions(players.length);
  $('seats').innerHTML=players.map((p,i)=>{
    const active=p.id===game.hand?.actingId;
    const mine=p.id===myId;
    const statuses=[];
    if(!p.connected)statuses.push('OFFLINE');
    else if(p.folded)statuses.push('FOLDED');
    else if(p.allIn)statuses.push('ALL IN');
    else if(active)statuses.push('THINKING…');
    else if(p.playing)statuses.push('IN HAND');
    else if(p.stack===0)statuses.push('BUSTED');
    else statuses.push('READY');
    const cards=p.hasCards?(p.cards.length?p.cards.map(c=>cardFace(c,true)).join(''):backFace()+backFace()):'';
    return `<div class="seat ${mine?'self':''} ${active?'active':''} ${p.folded?'folded':''} ${p.winner?'winner':''}" style="left:${pos[i].x}%;top:${pos[i].y}%">
      <div class="seat-box">${p.isDealer?'<span class="seat-marker" title="Dealer">D</span>':''}<span class="seat-avatar">${esc(initials(p.name))}</span><span class="seat-name">${esc(p.name)}${mine?' (you)':''}</span><span class="seat-stack">◉ ${fmt(p.stack)}</span><span class="seat-status">${statuses.join(' · ')}</span>${active?'<div class="seat-timer"><span></span></div>':''}</div>
      <div class="seat-cards">${cards}</div>${p.bet>0?`<div class="seat-bet">◉ ${fmt(p.bet)}</div>`:''}
    </div>`;
  }).join('');
}
function renderPlayers(){
  $('sideCount').textContent=game.players.length;
  $('playerList').innerHTML=game.players.map(p=>`<div class="player-row"><span class="player-avatar">${esc(initials(p.name))}</span><span class="player-info"><b>${esc(p.name)}${p.id===game.host?'<span class="host-badge">HOST</span>':''}</b><small>${p.id===myId?'You · ':''}${p.connected?(p.playing?(p.folded?'Folded':p.allIn?'All-in':'Playing'):'Waiting'):'Offline'}</small></span><span class="player-money">◉ ${fmt(p.stack)}<small>${p.bet?'Bet '+fmt(p.bet):'CHIPS'}</small></span></div>`).join('');
}
function renderChat(){
  const container=$('messages');const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<100;
  const tail=game.chat.at(-1)?.id;
  if(lastChatId && tail && tail!==lastChatId && sideTab!=='chat') $('unreadDot').classList.remove('hidden');
  lastChatId=tail;
  container.innerHTML=game.chat.map(x=>x.kind==='chat'?`<div class="message"><div class="author">${esc(x.player)}<span class="time">${new Date(x.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span></div><div class="body">${esc(x.message)}</div></div>`:`<div class="message system">${esc(x.message)}</div>`).join('');
  if(nearBottom)container.scrollTop=container.scrollHeight;
}
function renderActions(){
  const box=$('actionArea'),h=game.hand,p=me();
  if(game.status==='lobby'){
    if(p?.stack===0){box.innerHTML='<div class="action-buttons"><span class="idle-message">You’re out of chips.</span><button class="btn-action" data-action="rebuy">Get fresh play chips ↻</button></div>';return;}
    if(game.host===myId){
      box.innerHTML=`<div class="action-status"><span>Waiting for your crew · ${game.players.filter(p=>p.connected&&p.stack>0).length} ready</span><span>2 players minimum</span></div><div class="action-buttons"><button class="btn-action" data-action="start" ${game.players.filter(p=>p.connected&&p.stack>0).length<2?'disabled':''}>♠ &nbsp; Deal the first hand</button><button data-action="copy">↗ &nbsp; Invite friends</button></div>`;
    } else box.innerHTML='<div class="idle-message">The host will start the game when everyone is ready. Invite a friend to join!</div>';
    return;
  }
  if(game.status==='showdown'){
    const result=h?.payouts?.map(p=>`${esc(p.winners.join(' & '))} won ${fmt(p.amount)} (${esc(p.hand)})`).join(' · ') || 'Hand complete';
    box.innerHTML=`<div class="action-status"><span>🏆 ${result}</span></div><div class="action-buttons">${p?.stack===0?'<button class="btn-allin" data-action="rebuy">↻ &nbsp; Rebuy play chips</button>':''}${game.host===myId?'<button class="btn-action" data-action="start">Deal next hand →</button>':'<span class="hint">Next hand begins automatically in 10 seconds if enough players are connected.</span>'}</div>`;
    return;
  }
  if(!h){box.innerHTML='<div class="idle-message">The table is getting ready…</div>';return;}
  if(p?.stack===0 && !p.playing){box.innerHTML='<div class="action-buttons"><span class="idle-message">You’re out of chips. Rejoin the game.</span><button class="btn-action" data-action="rebuy">Get fresh chips ↻</button></div>';return;}
  if(h.actingId!==myId){
    const actor=game.players.find(x=>x.id===h.actingId);
    box.innerHTML=`<div class="idle-message">${actor?`Waiting for <b>${esc(actor.name)}</b> to act`:'Dealing the next street…'} ${actor?'<span class="turn-time"><span class="countdown"></span>s remaining</span>':''}</div>`;
    return;
  }
  const toCall=h.toCall,minimum=h.minTo,maximum=h.maxTo;
  const canRaise=h.canRaise;
  const defaultRaise=Math.min(maximum,minimum);
  box.innerHTML=`<div class="action-status"><span>♠ Your move · <b>${toCall>0?fmt(toCall)+' chips to call':'Check or make a bet'}</b></span><span class="turn-time">⏱ <span class="countdown"></span>s</span></div>
  <div class="action-buttons"><button class="btn-fold" data-action="fold">Fold</button><button data-action="${toCall>0?'call':'check'}" class="btn-action">${toCall>0?'Call '+fmt(Math.min(toCall,p.stack)):'Check'}</button>
  ${canRaise?`<div class="raise-group"><input id="raiseValue" type="number" inputmode="numeric" aria-label="Total bet amount" min="${minimum}" max="${maximum}" value="${defaultRaise}" step="1" /><button data-action="raise" ${maximum<minimum?'disabled title="Use all-in for a short raise"':''}>${h.currentBet?'Raise':'Bet'}</button></div>`:''}
  <button class="btn-allin" data-action="allin">All in · ${fmt(p.stack)}</button></div><span class="hint">${canRaise?(maximum>=minimum?'Enter the total chips you want committed this round · Minimum '+fmt(minimum):'Only an all-in raise is available'):''} All amounts are virtual chips.</span>`;
}
function render(){
  if(!game)return;
  $('roomCode').textContent=game.code;
  $('blindLabel').textContent=`Blinds ${fmt(game.settings.smallBlind)} / ${fmt(game.settings.bigBlind)}`;
  $('playerCount').textContent=`${game.players.filter(p=>p.connected).length} / 8 players`;
  $('sideHandState').textContent=(game.hand?.stage||'LOBBY').toUpperCase();
  $('roundTitle').textContent=game.status==='lobby'?'Waiting for players':game.status==='showdown'?'Showdown':({preflop:'Pre-flop action',flop:'The flop',turn:'The turn',river:'The river'})[game.hand?.stage]||'Poker Night';
  $('potAmount').textContent=fmt(game.hand?.pot||0);
  $('boardCards').innerHTML=Array.from({length:5},(_,i)=>cardFace(game.hand?.board[i])).join('');
  $('streetName').textContent=game.status==='lobby'?'TAKE A SEAT':game.status==='showdown'?'WINNERS ARE IN':game.hand?.stage?.toUpperCase()||'POKER NIGHT';
  $('handNumber').textContent=game.hand?`Hand #${game.hand.id}`:'Private play-money poker';
  renderSeats();renderPlayers();renderActions();renderChat();updateCountdown();
}
function updateCountdown(){
  if(!game?.deadline)return;
  const secs=Math.max(0,Math.ceil((game.deadline-Date.now())/1000));
  document.querySelectorAll('.countdown').forEach(e=>e.textContent=secs);
  document.querySelectorAll('.seat-timer span').forEach(e=>e.style.width=(secs/45*100)+'%');
}
setInterval(updateCountdown,250);
function copyInvite(){
  if(!currentCode)return;
  const url=location.origin+'/r/'+currentCode;
  navigator.clipboard?.writeText(url).then(()=>toast('Invite link copied!')).catch(()=>prompt('Copy this invite link:',url)) || prompt('Copy this invite link:',url);
}
function switchSide(tab){
  sideTab=tab;
  document.querySelectorAll('.side-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.side===tab));
  $('playersPanel').classList.toggle('hidden',tab!=='players');$('chatPanel').classList.toggle('hidden',tab!=='chat');
  if(tab==='chat'){$('unreadDot').classList.add('hidden');$('messages').scrollTop=$('messages').scrollHeight;}
}
function switchLanding(tab){
  document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===tab));
  $('createForm').classList.toggle('hidden',tab!=='create');$('joinForm').classList.toggle('hidden',tab!=='join');
}
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>switchLanding(btn.dataset.tab)));
document.querySelectorAll('[data-side]').forEach(btn=>btn.addEventListener('click',()=>switchSide(btn.dataset.side)));
$('createForm').addEventListener('submit',e=>{
  e.preventDefault();intentionalLeave=false;
  chosenName=$('createName').value.trim()||'Player';
  const stack=Number($('buyIn').value),smallBlind=Number($('blind').value);
  if(stack < smallBlind*40){toast('Increase starting chips or choose smaller blinds',true);return;}
  connect({type:'create',name:chosenName,stack,smallBlind,bigBlind:smallBlind*2});
});
$('joinForm').addEventListener('submit',e=>{
  e.preventDefault();intentionalLeave=false;
  chosenName=$('joinName').value.trim()||'Player';
  const invite=$('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  const old=JSON.parse(localStorage.getItem('poker-night:'+invite)||'null');
  connect({type:'join',code:invite,name:chosenName,token:old?.token});
});
$('chatForm').addEventListener('submit',e=>{
  e.preventDefault();const input=$('chatInput');if(send({type:'chat',message:input.value}))input.value='';
});
$('copyInvite').addEventListener('click',copyInvite);
$('audioToggle').addEventListener('click',()=>{soundEnabled=!soundEnabled;toast(soundEnabled?'Table sounds on':'Table sounds off');$('audioToggle').textContent=soundEnabled?'♫':'♪';if(soundEnabled)playTone(540);});
$('leaveTable').addEventListener('click',()=>{
  if(!confirm('Leave the table? You can still rejoin with your invite link.'))return;
  intentionalLeave=true;send({type:'leave'});ws?.close();game=null;myId=null;currentCode=null;currentToken=null;
  history.replaceState(null,'','/');$('landing').classList.remove('hidden');$('game').classList.add('hidden');toast('You left the table');
});
$('actionArea').addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button || button.disabled)return;
  const action=button.dataset.action;
  if(action==='copy')return copyInvite();
  if(action==='start'||action==='rebuy')return send({type:action});
  if(action==='raise'){
    const value=Number($('raiseValue')?.value);
    if(!Number.isSafeInteger(value)){toast('Enter a whole-chip amount',true);return;}
    send({type:'action',action,value});return;
  }
  send({type:'action',action});
});
// The invite URL automatically opens the join form, or reconnects an existing seat.
const pathCode=location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/)?.[1]?.toUpperCase();
const savedName=localStorage.getItem('poker-night:name')||'';
$('createName').value=savedName;$('joinName').value=savedName;
if(pathCode){
  $('joinCode').value=pathCode;switchLanding('join');
  const old=JSON.parse(localStorage.getItem('poker-night:'+pathCode)||'null');
  if(old?.token){
    chosenName=old.name||savedName||'Player';
    connect({type:'join',code:pathCode,name:chosenName,token:old.token});
  }
}
