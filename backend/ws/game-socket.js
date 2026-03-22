const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const config = require('../config');

const AUTH_COOKIE_NAME = 'auth_token';
const WS_PATH = '/ws/game';

function parseCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function createGameWebSocket(server, gameEngine) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map();

  server.on('upgrade', (request, socket, head) => {
    const parsed = url.parse(request.url, true);
    if (parsed.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const token = parsed.query.token || parseCookieToken(request.headers.cookie);
    const user = verifyToken(token);

    if (!user) {
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

    const existing = clients.get(userId);
    if (existing && existing.readyState <= 1) {
      existing.close(4000, 'replaced');
    }
    clients.set(userId, ws);

    gameEngine.getInitState(ws.user).then((initState) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'init', data: initState }));
      }
    }).catch(() => {});

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'command' && msg.data) {
          gameEngine.applyPlayerCommand(ws.user, msg.data)
            .then((result) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'command_result', data: result }));
              }
            })
            .catch(() => {});
        }
      } catch (err) {}
    });

    ws.on('close', () => {
      if (clients.get(userId) === ws) {
        clients.delete(userId);
      }
      gameEngine.disconnectPlayer(userId, 'ws_close');
    });

    ws.on('error', () => {
      if (clients.get(userId) === ws) {
        clients.delete(userId);
      }
    });
  });

  function broadcastState() {
    if (clients.size === 0) return;

    for (const [userId, ws] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        const state = gameEngine.getPublicState({ id: userId });
        if (state && typeof state.then === 'function') {
          state.then((resolved) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'state', data: resolved }));
            }
          }).catch(() => {});
        } else {
          ws.send(JSON.stringify({ type: 'state', data: state }));
        }
      } catch (err) {}
    }
  }

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

  function broadcastLeaderboard() {
    if (clients.size === 0) return;
    const data = gameEngine.getLeaderboardState();
    const payload = JSON.stringify({ type: 'leaderboard', data });
    for (const [, ws] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      try {
        ws.send(payload);
      } catch (err) {}
    }
  }

  return { wss, clients, broadcastState, broadcastChat, broadcastLeaderboard };
}

module.exports = { createGameWebSocket };
