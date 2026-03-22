# Chat MMORPG — Design Document

Data: 2026-03-22

## Requisitos

- Chat unico (jogadores + NPC IA juntos, sem tabs)
- 50 mensagens visiveis, sem load more
- Caixa flutuante compacta no canto inferior esquerdo, semi-transparente
- Sempre visivel sobre o jogo (sem minimize)
- Estilo Ragnarok/Tibia: texto corrido, compacto, inline

## Visual

- Posicao: bottom: 16px, left: 16px
- Largura: min(350px, 45vw)
- Feed: ~220px altura, overflow-y auto, scrollbar oculta
- Fundo: rgba(0,0,0,0.55), sem blur, sem bordas
- Texto: 13px, text-shadow para legibilidade
- Input: barra fina no fundo, sempre visivel

## Cores

- Jogador (outro): #ffffff (branco)
- Jogador (voce): #90ee90 (verde claro)
- NPC Jardineiro: #ffd700 (dourado)
- Timestamp: cinza discreto

## Formato mensagem

Inline <p> — `[HH:MM] Nome: mensagem`

## Backend

- engine.js: PLAYER_CHAT_HISTORY_LIMIT 20 -> 50
- engine.js: NPC speech incluido no playerChat com type: 'npc'
- engine.js: getPublicState() adiciona campo type nas entries
- postgres.js: getRecentVisibleChatMessages() limit 20 -> 50

## Frontend

- Render incremental (append-only, nao re-render completo)
- renderedIds Set para controle
- Remove mensagens antigas quando > 50 no DOM
- Auto-scroll quando near-bottom
- Foco aumenta opacidade do fundo

## Arquivos

- backend/game/engine.js
- backend/database/postgres.js
- frontend/public/game.html
- frontend/public/css/game.css
- frontend/public/js/game.js

## Abordagem

Render incremental (Abordagem A) — append novos, remove antigos, sem re-render.
