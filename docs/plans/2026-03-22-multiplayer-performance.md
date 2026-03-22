# Multiplayer Performance Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce bandwidth 70%+, latência percebida de 250-630ms para <150ms, suportar 20+ jogadores simultâneos.

**Architecture:** 3 níveis incrementais — (1) Quick wins no backend/frontend sem mudar protocolo, (2) Delta state para só enviar mudanças, (3) Migração HTTP polling → WebSocket com server push.

**Tech Stack:** Express.js, ws (WebSocket), compression (gzip), vanilla JS

---

### Task 1: Gzip Compression no Express

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/package.json`

**Step 1: Install compression**

Run: `cd backend && npm install compression`

**Step 2: Add compression middleware before routes**

In `server.js`, after `setupSecurity(app)` and before `express.json()`:

```javascript
const compression = require('compression');
app.use(compression({ threshold: 512 }));
```

**Step 3: Verify**

Run: `curl -s -H "Accept-Encoding: gzip" -o /dev/null -w "%{size_download}" http://localhost:8080/health`

Compare with uncompressed size. Expect ~60% reduction on game state.

**Step 4: Commit**

```bash
git add backend/server.js backend/package.json backend/package-lock.json
git commit -m "perf: add gzip compression to Express responses"
```

---

### Task 2: Rate Limit Per-IP (não global)

**Files:**
- Modify: `backend/middleware/security.js`

**Step 1: Change rate limiter keyGenerator**

In `buildJsonRateLimiter`, add `keyGenerator` option that uses req IP + user ID:

```javascript
function buildJsonRateLimiter({ windowMs, max, error, scope, skip }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const userId = req.authUser?.id || '';
      return `${scope}:${ip}:${userId}`;
    },
    // ... rest unchanged
  });
}
```

**Step 2: Verify** — Multiple clients from different IPs should each get their own 90-req window.

**Step 3: Commit**

```bash
git add backend/middleware/security.js
git commit -m "perf: per-IP rate limiting instead of shared global bucket"
```

---

### Task 3: Remove Array Sort + Cache Timestamps

**Files:**
- Modify: `backend/game/engine.js`

**Step 1: Remove players sort**

In `getPublicState()` (~line 736-738), change:

```javascript
players: Array.from(this.state.players.values())
  .map((candidate) => this.buildPublicPlayerState(candidate, now))
  .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
```

To:

```javascript
players: Array.from(this.state.players.values())
  .map((candidate) => this.buildPublicPlayerState(candidate, now)),
```

**Step 2: Use epoch ms instead of ISO strings for chat**

In `getPublicState()` playerChat section, change `createdAt`:

```javascript
createdAt: entry.createdAt,  // Already ms timestamp, let client format
```

Remove: `new Date(entry.createdAt).toISOString()`

**Step 3: Update frontend** `formatClockTimestamp` to handle both ISO and epoch:

In `game.js`, update `buildChatLineNode` to handle numeric timestamp:

```javascript
const tsValue = typeof entry?.createdAt === 'number'
    ? new Date(entry.createdAt)
    : entry?.createdAt;
ts.textContent = formatClockTimestamp(tsValue);
```

**Step 4: Commit**

```bash
git add backend/game/engine.js frontend/public/js/game.js
git commit -m "perf: remove per-request player sort, use epoch timestamps"
```

---

### Task 4: Split Static vs Dynamic State

**Files:**
- Modify: `backend/game/engine.js`
- Modify: `backend/routes/ai-game.js`
- Modify: `backend/game/world-definition.js`
- Modify: `frontend/public/js/game.js`

**Step 1: Create getStaticWorldState() in world-definition.js**

```javascript
function getStaticWorldState(worldState) {
  return {
    bounds: worldState.bounds,
    lake: {
      id: worldState.lake.id,
      type: worldState.lake.type,
      position: clonePoint(worldState.lake.position),
      radius: worldState.lake.radius,
    },
    house: {
      id: worldState.house.id,
      type: worldState.house.type,
      position: clonePoint(worldState.house.position),
      width: worldState.house.width,
      depth: worldState.house.depth,
      wallHeight: worldState.house.wallHeight,
      wallThickness: worldState.house.wallThickness,
      doorWidth: worldState.house.doorWidth,
      doorHeight: worldState.house.doorHeight,
      collisionBoxes: worldState.house.walls.map(cloneRect),
    },
    soccer: {
      field: cloneRect(worldState.soccer.field),
      goalA: cloneRect(worldState.soccer.goalA),
      goalB: cloneRect(worldState.soccer.goalB),
    },
    appleLayout: APPLE_OFFSETS.map(clonePoint),
  };
}
```

Export it alongside `getPublicWorldState`.

**Step 2: Create getDynamicWorldState() in world-definition.js**

```javascript
function getDynamicWorldState(worldState) {
  return {
    trees: worldState.trees.map((tree) => ({
      id: tree.id,
      position: clonePoint(tree.position),
      applesRemaining: tree.applesRemaining,
    })),
    droppedApples: Array.isArray(worldState.droppedApples)
      ? worldState.droppedApples.map(cloneDroppedApple)
      : [],
    soccerBall: worldState.soccer?.ball
      ? { position: clonePoint(worldState.soccer.ball.position), velocity: clonePoint(worldState.soccer.ball.velocity) }
      : null,
    graves: Array.isArray(worldState.graves)
      ? worldState.graves.map(cloneGrave)
      : [],
  };
}
```

**Step 3: Add new endpoint GET /api/v1/ai-game/init in ai-game.js**

```javascript
router.get('/init', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(aiGameEngine.getInitState(req.authUser));
  } catch (error) {
    next(error);
  }
});
```

**Step 4: Add getInitState() to engine.js**

```javascript
async getInitState(user) {
  const player = await this.touchPlayerSession(user);
  return {
    settings: {
      playerMoveSpeed: config.PLAYER_MOVE_SPEED,
      playerRunSpeed: config.PLAYER_RUN_SPEED,
      chatMaxChars: config.PLAYER_CHAT_MAX_CHARS,
      nicknameMaxChars: PLAYER_NICKNAME_MAX_LENGTH,
    },
    world: getStaticWorldState(this.state.world),
  };
}
```

**Step 5: Remove static data from getPublicState()**

Replace `world: getPublicWorldState(this.state.world)` with `world: getDynamicWorldState(this.state.world)`.

Remove `settings` from `getPublicState()` (now in init).

**Step 6: Update frontend to call /init once on load**

In `game.js`, before starting the poll loop, fetch init data:

```javascript
const initResponse = await fetch(`${apiBaseUrl}/api/v1/ai-game/init`, fetchOptions);
const initData = await initResponse.json();
// Store initData.settings and initData.world as cached static state
```

Use cached world data for rendering; only use dynamic world from polls for trees/apples/ball/graves.

**Step 7: Commit**

```bash
git add backend/game/engine.js backend/game/world-definition.js backend/routes/ai-game.js frontend/public/js/game.js
git commit -m "perf: split static/dynamic state, add /init endpoint"
```

---

### Task 5: Separate Leaderboard + Chat polling

**Files:**
- Modify: `backend/game/engine.js`
- Modify: `frontend/public/js/game.js`

**Step 1: Remove leaderboard and chat from getPublicState()**

Remove `leaderboard`, `soccerLeaderboard`, and `playerChat` from the return object of `getPublicState()`.

**Step 2: Add getLeaderboardState() and getChatState() methods**

```javascript
getLeaderboardState() {
  return {
    leaderboard: { /* same as before */ },
    soccerLeaderboard: { /* same as before */ },
  };
}

getChatState(user) {
  const player = this.state.players.get(user?.id);
  return {
    entries: this.state.playerChat.map((entry) => ({
      id: entry.id,
      type: entry.type || 'player',
      isSelf: entry.playerId === player?.id,
      playerName: entry.playerName,
      message: entry.message,
      createdAt: entry.createdAt,
    })),
  };
}
```

**Step 3: Add new endpoints in ai-game.js**

```javascript
router.get('/leaderboard', async (req, res, next) => {
  try {
    res.json(aiGameEngine.getLeaderboardState());
  } catch (error) {
    next(error);
  }
});

router.get('/chat', async (req, res, next) => {
  try {
    res.json(aiGameEngine.getChatState(req.authUser));
  } catch (error) {
    next(error);
  }
});
```

**Step 4: Update frontend to poll these at lower frequency**

- State poll: every 200ms (positions only — much smaller payload now)
- Chat poll: every 1000ms
- Leaderboard poll: every 5000ms

**Step 5: Commit**

```bash
git add backend/game/engine.js backend/routes/ai-game.js frontend/public/js/game.js
git commit -m "perf: separate leaderboard/chat endpoints with lower poll frequency"
```

---

### Task 6: WebSocket Server Setup

**Files:**
- Modify: `backend/package.json`
- Create: `backend/ws/game-socket.js`
- Modify: `backend/server.js`

**Step 1: Install ws**

Run: `cd backend && npm install ws`

**Step 2: Create game-socket.js**

```javascript
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const url = require('url');

function createGameWebSocket(server, gameEngine) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map(); // userId -> ws

  server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);
    if (pathname !== '/ws/game') {
      socket.destroy();
      return;
    }

    const token = query.token || parseCookieToken(request.headers.cookie);
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let user;
    try {
      user = jwt.verify(token, config.JWT_SECRET);
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const userId = ws.user.id;
    clients.set(userId, ws);

    // Send init state on connect
    const initState = gameEngine.getInitState(ws.user);
    ws.send(JSON.stringify({ type: 'init', data: initState }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'command') {
          gameEngine.applyPlayerCommand(ws.user, msg.data)
            .then((result) => {
              ws.send(JSON.stringify({ type: 'command_result', data: result }));
            })
            .catch(() => {});
        }
      } catch (err) {}
    });

    ws.on('close', () => {
      clients.delete(userId);
      gameEngine.disconnectPlayer(userId, 'ws_close');
    });

    ws.on('error', () => {
      clients.delete(userId);
    });
  });

  // Broadcast game state every tick
  function broadcastState() {
    if (clients.size === 0) return;
    const now = Date.now();

    for (const [userId, ws] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        const state = gameEngine.getPublicState({ id: userId });
        ws.send(JSON.stringify({ type: 'state', data: state }));
      } catch (err) {}
    }
  }

  // Broadcast chat when new message arrives
  function broadcastChat() {
    if (clients.size === 0) return;
    for (const [userId, ws] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        const chat = gameEngine.getChatState({ id: userId });
        ws.send(JSON.stringify({ type: 'chat', data: chat }));
      } catch (err) {}
    }
  }

  // Broadcast leaderboard on change
  function broadcastLeaderboard() {
    if (clients.size === 0) return;
    const data = gameEngine.getLeaderboardState();
    const payload = JSON.stringify({ type: 'leaderboard', data });
    for (const [, ws] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      try { ws.send(payload); } catch (err) {}
    }
  }

  return { wss, clients, broadcastState, broadcastChat, broadcastLeaderboard };
}

function parseCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

module.exports = { createGameWebSocket };
```

**Step 3: Integrate in server.js**

```javascript
const http = require('http');
const { createGameWebSocket } = require('./ws/game-socket');

// Replace app.listen with http.createServer
const server = http.createServer(app);
const gameWs = createGameWebSocket(server, aiGameEngine);

// Hook into engine tick for broadcasting
const originalAdvance = aiGameEngine.advanceSimulation.bind(aiGameEngine);
aiGameEngine.advanceSimulation = function(deltaMs) {
  originalAdvance(deltaMs);
  gameWs.broadcastState();
};

server.listen(config.PORT, '0.0.0.0', () => { /* same logs */ });
```

**Step 4: Commit**

```bash
git add backend/ws/game-socket.js backend/server.js backend/package.json backend/package-lock.json
git commit -m "feat: add WebSocket server for real-time game state push"
```

---

### Task 7: Frontend WebSocket Client

**Files:**
- Modify: `frontend/public/js/game.js`

**Step 1: Add WebSocket connection logic**

Replace the polling `fetchGameState` with WebSocket:

```javascript
let gameSocket = null;
let wsReconnectTimeout = null;

function connectGameSocket() {
  const wsUrl = apiBaseUrl.replace(/^http/, 'ws') + '/ws/game';
  gameSocket = new WebSocket(wsUrl);

  gameSocket.onopen = () => {
    console.log('WebSocket connected');
    if (wsReconnectTimeout) {
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = null;
    }
  };

  gameSocket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'init':
        applyInitData(msg.data);
        break;
      case 'state':
        applySnapshot(msg.data);
        break;
      case 'chat':
        renderPlayerChat(msg.data);
        break;
      case 'leaderboard':
        renderTableLeaderboard(/* leaderboard args */);
        renderTableLeaderboard(/* soccer args */);
        break;
    }
  };

  gameSocket.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    wsReconnectTimeout = setTimeout(connectGameSocket, 1000);
  };

  gameSocket.onerror = () => {
    gameSocket.close();
  };
}
```

**Step 2: Replace sendCommand to use WebSocket**

```javascript
async function sendCommand(type, payload) {
  if (gameSocket?.readyState === WebSocket.OPEN) {
    gameSocket.send(JSON.stringify({ type: 'command', data: { type, payload } }));
    return;
  }
  // Fallback to HTTP if WS not connected
  return sendHttpCommand(type, payload);
}
```

**Step 3: Keep HTTP polling as fallback**

If WebSocket fails to connect after 3 retries, fall back to HTTP polling.

**Step 4: Commit**

```bash
git add frontend/public/js/game.js
git commit -m "feat: WebSocket client with HTTP polling fallback"
```

---

### Task 8: Remote Player Extrapolation

**Files:**
- Modify: `frontend/public/js/player.js`
- Modify: `frontend/public/js/game.js`

**Step 1: Add velocity tracking to remote state**

In `game.js` `applySnapshot()`, calculate velocity from position delta:

```javascript
const prevPos = remoteState.targetPosition.clone();
remoteState.targetPosition.set(x, y, z);
const dt = (now - (remoteState.lastUpdateTime || now)) / 1000;
if (dt > 0.01 && dt < 1) {
  remoteState.velocity = {
    x: (x - prevPos.x) / dt,
    z: (z - prevPos.z) / dt,
  };
}
remoteState.lastUpdateTime = now;
```

**Step 2: Use velocity in updateRemote**

In `player.js` `updateRemote()`, extrapolate position:

```javascript
updateRemote(delta, targetPosition, targetRotationY, velocity) {
  // Extrapolate target based on velocity
  const extrapolatedX = targetPosition.x + (velocity?.x || 0) * delta * 0.5;
  const extrapolatedZ = targetPosition.z + (velocity?.z || 0) * delta * 0.5;

  const dx = extrapolatedX - this.group.position.x;
  const dz = extrapolatedZ - this.group.position.z;
  // ... rest of interpolation using extrapolated values
}
```

**Step 3: Add walking hysteresis**

Replace `distance > 0.04` threshold with velocity-based check:

```javascript
const speed = Math.sqrt((velocity?.x || 0) ** 2 + (velocity?.z || 0) ** 2);
this.isWalking = speed > 0.5; // 0.5 units/sec threshold
```

**Step 4: Commit**

```bash
git add frontend/public/js/player.js frontend/public/js/game.js
git commit -m "perf: add velocity extrapolation and walking hysteresis for remote players"
```
