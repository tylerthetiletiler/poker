# ♠ Poker Night — private multiplayer Texas Hold’em

A complete browser-based Texas Hold'em game for friends. Everyone joins the same server using private invite links; the server controls shuffling, chip balances, turns, bets, and payouts. **Virtual chips only; no cash, payments, or gambling integrations.**

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000`, choose **Create Table**, and share the room invite link. Friends on the same computer can open other browser tabs; to reach you over the internet, **deploy it publicly** as described below. Localhost links will not work for friends on other networks.

## Deploy online (Render)

1. Create a free GitHub repository and upload all contents of this folder (keep `public/`, `server.js`, etc. at its root).
2. At [render.com](https://render.com), choose **New > Web Service**, connect that repository.
3. Set **Runtime: Node**, **Build Command: `npm install`**, **Start Command: `npm start`** (or use the included `render.yaml` to create a Blueprint).
4. Deploy. Open your `https://YOUR-SERVICE.onrender.com` site and create a table. Use **Copy Invite** to send friends the full URL.
5. Render or another host must support long-lived WebSocket connections. On free services the process may sleep during inactivity, and rooms reset on a restart.

Other hosts (Railway, Fly.io, VPS) work with `npm start`, a configured `PORT`, and WebSocket support. The included `Dockerfile` also builds a deployable container.

## Features

- No sign-up needed; create or join a private room with up to 8 human players.
- Server-controlled real-time multiplayer via WebSockets; secret hole cards for each player.
- Dealer rotation, small/big blinds, preflop/flop/turn/river, fold/check/call/bet/raise/all-in.
- Valid betting amounts, short all-in rules, side pots, kicker comparison, tied pots, automatic showdown and payoffs.
- Hand history visible in table chat, table messages, play-chip rebuy after busting, responsive phone/desktop interface.
- 45-second turn clock, automatic check/fold on timeout, reconnectable seats, automatic next deal.
- Start chips and blinds selectable by the table host.

## Operational limitations

- **Rooms are stored in server memory** and disappear when the server restarts. Production use with multiple server instances requires a shared durable store / room coordination; run a single instance for this version.
- Idle/disconnected rooms are removed after ~6 hours. Invite codes are not authenticated accounts or long-term privacy guarantees; only share private links with friends.
- This is a play-money, casual game, **not** a regulated gambling or cash-game platform. It doesn't take deposits, cash out, or offer financial payouts.
- Reconnect tokens live in the current browser's localStorage. Clearing the browser's data loses the old seat; joining again creates a new seat if one is available.

## Test

```bash
npm test
```

## Structure

- `server.js`: Node HTTP static server + WebSocket rooms and poker state machine
- `ws-lite.js`: dependency-free RFC 6455 WebSocket protocol layer
- `poker.js`: secure shuffle, poker hand ranking, side-pot distribution
- `public/`: browser UI (HTML/CSS/vanilla JavaScript)
- `test/`: unit tests for poker combinations and side pots
