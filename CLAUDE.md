# Garden Quest — Guia do Projeto

## O que e este projeto

Garden Quest e um jogo 3D multiplayer web onde jogadores exploram um jardim magico, coletam recursos (macas, agua), jogam futebol e interagem com um NPC controlado por IA (Jardineiro IA).

## Tech Stack

- **Backend:** Express.js 4.21 + Node.js 20+
- **Frontend:** Vanilla JavaScript + Three.js (3D)
- **Banco:** PostgreSQL via Supabase (conexao direta pg, sem Data API)
- **Auth:** Google OAuth 2.0 + JWT (httpOnly cookies)
- **IA:** OpenAI Responses API (structured output para NPC)
- **Deploy:** Google Cloud Run (Docker) + Nginx (reverse proxy)
- **Seguranca:** Helmet, CORS, Rate Limiting, Input Validation

## Comandos

```bash
# Backend dev
cd backend && npm run dev

# PostgreSQL local
docker compose -f docker-compose.local.yml up -d

# Validar env
cd backend && npm run check:env

# Deploy
./deploy.sh
```

## Estrutura

```
backend/
  server.js              # Entry point Express
  config/index.js        # Env loader + validation
  middleware/security.js  # Helmet, CORS, rate limit, auth
  routes/                # auth.js, ai-game.js, logs.js
  database/              # postgres.js (pool), supabase-schema.sql
  game/                  # engine.js (2500+ linhas), world-definition.js, command-security.js
  services/              # openai-client.js
frontend/public/
  js/                    # config, auth, game, world, player, actions, dashboard
  css/                   # login.css, game.css
```

## Convencoes

- Idioma do codigo: ingles (variaveis, funcoes)
- Idioma do usuario: pt-BR
- JavaScript puro (sem TypeScript)
- CSS puro (sem Tailwind/Bootstrap)
- Server-authoritative: toda logica de jogo roda no backend
- Game tick: 250ms | AI decision: 4000ms
- Polling-based sync (frontend poll /api/v1/ai-game/public-state)

## Seguranca

- JWT em cookies httpOnly + SameSite
- Rate limiting por rota (configuraveis via env)
- Input validation contra injection (command-security.js)
- RLS no Supabase
- Admin: email allowlist (ADMIN_GOOGLE_EMAILS)
- NUNCA expor secrets no frontend

## Skills do Projeto

O orquestrador `gardenquest-orchestrator` roteia automaticamente para as skills corretas:

| Dominio | Skills |
|---------|--------|
| 3D/Three.js | three-best-practices |
| Game Engine | clean-code, software-design-philosophy |
| NPC/IA | openai-api-development |
| API/Express | api-security-best-practices |
| PostgreSQL | postgres |
| Docker | docker-expert |
| Cloud Run | gcp-cloud-run |
| Nginx | nginx-configuration |
| WebSocket | websocket-engineer |
| Seguranca | security-best-practices, api-security-best-practices |
| Performance | web-performance-optimization, high-perf-browser |
| Deploy/Bash | bash-pro, administering-linux |
| Arquitetura | clean-architecture, software-design-philosophy |
