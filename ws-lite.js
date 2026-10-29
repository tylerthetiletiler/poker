// Small RFC 6455 WebSocket server for browser-originated connections.
// No npm dependencies; accepts text, close, ping/pong, and fragmented text frames.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
const MAGIC='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX=8192;
function frame(opcode,payload=Buffer.alloc(0)) {
  if(!Buffer.isBuffer(payload))payload=Buffer.from(payload);
  const length=payload.length;
  const header=Buffer.alloc(length<126?2:length<=65535?4:10);
  header[0]=0x80|opcode;
  if(length<126)header[1]=length;
  else if(length<=65535){header[1]=126;header.writeUInt16BE(length,2);}
  else{header[1]=127;header.writeBigUInt64BE(BigInt(length),2);}
  return Buffer.concat([header,payload]);
}
export class WebSocket extends EventEmitter {
  static OPEN=1;
  static CLOSED=3;
  readyState=1;
  constructor(socket){
    super();this.socket=socket;this.buffer=Buffer.alloc(0);this.fragmented=[];this.fragmentSize=0;this.fragmentOpcode=null;
    socket.on('data',c=>this.consume(c));
    socket.on('error',e=>this.emit('error',e));
    socket.on('close',()=>{this.readyState=3;this.emit('close');});
  }
  send(value){if(this.readyState===1)this.socket.write(frame(1,String(value)));}
  close(code=1000,reason=''){
    if(this.readyState!==1)return;
    this.readyState=2;
    const msg=Buffer.from(String(reason).slice(0,100));
    const data=Buffer.alloc(2+msg.length);data.writeUInt16BE(code,0);msg.copy(data,2);
    this.socket.end(frame(8,data));
  }
  fail(){this.close(1009,'Message too large');}
  handle(opcode,fin,payload){
    if(opcode===8){this.close();return;}
    if(opcode===9){if(this.readyState===1)this.socket.write(frame(10,payload));return;}
    if(opcode===10)return;
    if(opcode===1){
      if(this.fragmentOpcode!==null){this.close(1002,'Invalid frames');return;}
      if(fin){this.emit('message',payload);return;}
      this.fragmentOpcode=opcode;this.fragmented=[payload];this.fragmentSize=payload.length;return;
    }
    if(opcode===0&&this.fragmentOpcode!==null){
      this.fragmented.push(payload);this.fragmentSize+=payload.length;
      if(this.fragmentSize>MAX){this.fail();return;}
      if(fin){this.emit('message',Buffer.concat(this.fragmented));this.fragmented=[];this.fragmentOpcode=null;this.fragmentSize=0;}
      return;
    }
    this.close(1003,'Unsupported frame');
  }
  consume(chunk){
    if(this.readyState!==1)return;
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=2){
      const first=this.buffer[0], second=this.buffer[1];
      const fin=!!(first&0x80),opcode=first&0x0f,masked=!!(second&0x80);
      if(!masked){this.close(1002,'Client frames must be masked');return;}
      let len=second&0x7f,offset=2;
      if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);offset=4;}
      else if(len===127){
        if(this.buffer.length<10)return;
        const big=this.buffer.readBigUInt64BE(2);
        if(big>BigInt(MAX)){this.fail();return;}
        len=Number(big);offset=10;
      }
      if(len>MAX){this.fail();return;}
      if(this.buffer.length<offset+4+len)return;
      const mask=this.buffer.subarray(offset,offset+4);
      const payload=Buffer.from(this.buffer.subarray(offset+4,offset+4+len));
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      this.buffer=this.buffer.subarray(offset+4+len);
      this.handle(opcode,fin,payload);
      if(this.readyState!==1)return;
    }
  }
}
export class WebSocketServer extends EventEmitter {
  constructor({server,maxPayload=8192}){
    super();
    server.on('upgrade',(req,socket,head)=>{
      if(req.headers.upgrade?.toLowerCase()!=='websocket'||
         !/\bupgrade\b/i.test(req.headers.connection||'')||
         req.headers['sec-websocket-version']!=='13'||
         !/^[a-zA-Z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']||'')){
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');return;
      }
      const key=req.headers['sec-websocket-key'];
      const accept=createHash('sha1').update(key+MAGIC).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const ws=new WebSocket(socket);
      this.emit('connection',ws,req);
      if(head?.length)ws.consume(head);
    });
  }
}
