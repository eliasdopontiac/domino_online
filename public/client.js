const socket = io();

const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

showScreen('lobby');

// ── DOM refs ──────────────────────────────────────────────────────────────────
const btnCreate       = document.getElementById('btn-create-room');
const roomListUl      = document.getElementById('room-list');
const boardEl         = document.getElementById('board');
const myHandEl        = document.getElementById('my-hand');
const btnPass         = document.getElementById('btn-pass');
const opponentsEl     = document.getElementById('opponents-container');

// ── State ─────────────────────────────────────────────────────────────────────
let myPlayerId       = null;
let currentGameState = null;

const avatarIcons = {
    'capivara':      '🐹',
    'vira-lata':     '🐶',
    'copo-americano':'🍺',
    'coxinha':       '🍗'
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getPlayerConfig() {
    return {
        playerName: document.getElementById('player-name').value.trim() || 'Jogador',
        avatar: document.querySelector('input[name="avatar"]:checked').value
    };
}

function logComanda(text) {
    const comandaLog = document.getElementById('comanda-log');
    const li = document.createElement('li');
    li.innerText = '- ' + text;
    comandaLog.appendChild(li);
    comandaLog.scrollTop = comandaLog.scrollHeight;
}

// ── LOBBY ─────────────────────────────────────────────────────────────────────
btnCreate.addEventListener('click', () => {
    const name = document.getElementById('new-room-name').value.trim() || 'Mesa Híbrida JISS';
    const password = document.getElementById('new-room-password').value;
    socket.emit('create_room', { name, password }, (res) => {
        if (res && res.success) {
            joinRoom(res.roomId);
        } else {
            alert('Erro ao criar sala.');
        }
    });
});

socket.on('room_list', (rooms) => {
    roomListUl.innerHTML = '';
    if (!rooms || rooms.length === 0) {
        roomListUl.innerHTML = '<li>Nenhuma mesa aberta. Crie uma!</li>';
        return;
    }
    rooms.forEach(r => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${r.name} (${r.playerCount}/4)</span>`;
        if (r.playerCount < 4) {
            const btn = document.createElement('button');
            btn.innerText = 'Entrar';
            btn.onclick = () => joinRoom(r.id);
            li.appendChild(btn);
        }
        roomListUl.appendChild(li);
    });
});

socket.on('room_update', () => socket.emit('get_rooms'));

function joinRoom(roomId) {
    const config = getPlayerConfig();
    socket.emit('join_room', { roomId, ...config }, (res) => {
        if (res && res.success) {
            myPlayerId = socket.id;
            showScreen('waiting');
            socket.emit('get_rooms');
        } else {
            alert('Erro ao entrar na mesa: ' + (res ? res.message : 'desconhecido'));
        }
    });
}

// ── WAITING ROOM ──────────────────────────────────────────────────────────────
socket.on('room_joined', (data) => {
    const room = data.room;
    const list = document.getElementById('waiting-players-list');
    if (!list) return;
    list.innerHTML = '';

    for (let i = 0; i < 4; i++) {
        const p = room.players[i];
        const slot = document.createElement('div');
        slot.className = 'player-slot ' + (p ? '' : 'empty');
        if (p) {
            slot.innerHTML = `<span class="avatar">${avatarIcons[p.avatar] || '👤'}</span> <strong>${p.name}</strong> ${p.isBot ? '(Bot)' : ''}`;
        } else {
            slot.innerHTML = `<span>Aguardando jogador...</span>`;
        }
        list.appendChild(slot);
    }

    const btnBots = document.getElementById('btn-start-bots');
    if (btnBots) {
        btnBots.style.display = (room.players.length < 4) ? 'inline-block' : 'none';
    }
});

document.getElementById('btn-start-bots').addEventListener('click', () => {
    socket.emit('start_game_with_bots');
});

// ── TILE RENDERING ────────────────────────────────────────────────────────────
function renderTileDOM(tileData, isBoard = false) {
    const [d1, d2] = tileData;
    const tileDiv = document.createElement('div');
    tileDiv.className = `tile ${isBoard ? 'board-tile' : ''}`;

    const topDiv = document.createElement('div');
    topDiv.className = `tile-half dots-${d1}`;
    for (let i = 1; i <= 9; i++) topDiv.innerHTML += `<div class="dot d${i}"></div>`;

    const botDiv = document.createElement('div');
    botDiv.className = `tile-half dots-${d2}`;
    for (let i = 1; i <= 9; i++) botDiv.innerHTML += `<div class="dot d${i}"></div>`;

    tileDiv.appendChild(topDiv);
    tileDiv.appendChild(botDiv);

    return tileDiv;
}

// ── GAME STATE ────────────────────────────────────────────────────────────────
socket.on('game_state', (state) => {
    if (!screens.game.classList.contains('active')) showScreen('game');
    currentGameState = state;

    // Build cross board
    boardEl.className = 'board-cross';
    boardEl.innerHTML = `
        <div class="branch-left"  id="br-left"></div>
        <div class="board-center-col">
            <div class="branch-top"    id="br-top"></div>
            <div class="spinner-slot"  id="spinner-slot"></div>
            <div class="branch-bottom" id="br-bottom"></div>
        </div>
        <div class="branch-right" id="br-right"></div>
    `;

    if (state.spinnerTile) {
        const spinnerDom = renderTileDOM(state.spinnerTile, true);
        spinnerDom.classList.add('vertical');
        document.getElementById('spinner-slot').appendChild(spinnerDom);

        const renderBranch = (side, isVerticalAxis) => {
            const container = document.getElementById(`br-${side}`);
            state.branches[side].forEach(item => {
                const domTile = renderTileDOM(item.tile, true);
                if (isVerticalAxis) {
                    if (item.tile[0] !== item.tile[1]) {
                        domTile.style.transform = (side === 'top')
                            ? (item.flipped ? 'rotate(0deg)' : 'rotate(180deg)')
                            : (item.flipped ? 'rotate(180deg)' : 'rotate(0deg)');
                    } else {
                        domTile.style.transform = 'rotate(90deg)';
                        domTile.style.margin = '20px 0';
                    }
                } else {
                    if (item.tile[0] !== item.tile[1]) {
                        domTile.style.transform = (side === 'left')
                            ? (item.flipped ? 'rotate(-90deg)' : 'rotate(90deg)')
                            : (item.flipped ? 'rotate(90deg)' : 'rotate(-90deg)');
                        domTile.style.margin = '0 20px';
                    }
                }
                container.appendChild(domTile);
            });
        };

        renderBranch('left',   false);
        renderBranch('right',  false);
        renderBranch('top',    true);
        renderBranch('bottom', true);
    }

    updateScoreboard(state.scores);
    renderOpponents(state);

    const scroll = document.getElementById('board-scroll');
    if (scroll) {
        scroll.scrollLeft = (scroll.scrollWidth  - scroll.clientWidth)  / 2;
        scroll.scrollTop  = (scroll.scrollHeight - scroll.clientHeight) / 2;
    }
});

// ── SCOREBOARD ────────────────────────────────────────────────────────────────
function updateScoreboard(scores) {
    if (!scores) return;
    const comandaLog = document.getElementById('comanda-log');
    comandaLog.innerHTML = `
        <li style="font-size:1.4rem;font-weight:bold;border-bottom:1px dashed #aaa;margin-bottom:8px;">
            🏆 Placar (até 200 pts):
        </li>
        <li style="font-size:1.2rem;">Dupla 1: <strong>${scores[0]} pts</strong></li>
        <li style="font-size:1.2rem;margin-bottom:10px;">Dupla 2: <strong>${scores[1]} pts</strong></li>
        <li style="border-bottom:1px dashed #aaa;margin-bottom:8px;"></li>
    `;
}

// ── OPPONENTS ─────────────────────────────────────────────────────────────────
function renderOpponents(state) {
    if (!state || !state.playersInfo || state.playersInfo.length < 4) return;

    let myIndex = state.playersInfo.findIndex(p => p.id === myPlayerId);
    if (myIndex === -1) myIndex = 0;

    const myInfo = state.playersInfo[myIndex];
    if (!myInfo) return;

    document.getElementById('my-avatar').innerText = avatarIcons[myInfo.avatar] || '👤';

    const positions = [
        { player: state.playersInfo[(myIndex + 1) % 4], pos: 'left'  },
        { player: state.playersInfo[(myIndex + 2) % 4], pos: 'top'   },
        { player: state.playersInfo[(myIndex + 3) % 4], pos: 'right' }
    ];

    opponentsEl.innerHTML = '';
    positions.forEach(item => {
        const p = item.player;
        if (!p) return;
        const isActive = state.playersInfo[state.turnIndex] && state.playersInfo[state.turnIndex].id === p.id;
        const teamLabel = p.team === myInfo.team ? '🤝 Parceiro' : '⚔️ Adversário';
        opponentsEl.innerHTML += `
            <div class="opponent pos-${item.pos} ${isActive ? 'active-turn' : ''}" id="player-${p.id}">
                <div class="avatar-bubble" id="bubble-${p.id}"></div>
                <div class="avatar">${avatarIcons[p.avatar] || '👤'}</div>
                <div class="name">${p.name} <small>(${teamLabel})</small></div>
                <div class="hand-count">${p.handCount} peças</div>
            </div>
        `;
    });

    const activePlayer = state.playersInfo[state.turnIndex];
    if (activePlayer && activePlayer.id === myPlayerId) {
        document.getElementById('my-avatar-container').classList.add('active-turn');
    } else {
        document.getElementById('my-avatar-container').classList.remove('active-turn');
    }
}

// ── HAND ──────────────────────────────────────────────────────────────────────
socket.on('private_hand', (hand) => {
    myHandEl.innerHTML = '';
    const state = currentGameState;
    const isMyTurn = state && state.playersInfo[state.turnIndex].id === myPlayerId;
    let hasPlayable = false;

    hand.forEach((tile, index) => {
        const domTile = renderTileDOM(tile, false);

        let playableLeft = false, playableRight = false, playableTop = false, playableBottom = false;

        if (isMyTurn) {
            if (!state.spinnerTile) {
                // First play must be a double (carroça)
                if (tile[0] === tile[1]) playableLeft = true;
            } else {
                const ends = state.openEnds;
                if (ends.left   !== null && (tile[0] === ends.left   || tile[1] === ends.left))   playableLeft   = true;
                if (ends.right  !== null && (tile[0] === ends.right  || tile[1] === ends.right))  playableRight  = true;
                if (ends.top    !== null && (tile[0] === ends.top    || tile[1] === ends.top))    playableTop    = true;
                if (ends.bottom !== null && (tile[0] === ends.bottom || tile[1] === ends.bottom)) playableBottom = true;
            }
        }

        const isPlayable = playableLeft || playableRight || playableTop || playableBottom;

        if (isMyTurn && !isPlayable) {
            domTile.classList.add('unplayable-dim');
        }

        if (isMyTurn && isPlayable) {
            const overlay = document.createElement('div');
            overlay.className = 'play-overlay';

            if (!state.spinnerTile) {
                // First play — just one button to place the carroça as spinner
                const btn = document.createElement('button');
                btn.innerHTML = '▶ Jogar';
                btn.onclick = () => socket.emit('play_tile', { handIndex: index, side: 'left' });
                overlay.appendChild(btn);
            } else {
                if (playableLeft) {
                    const btn = document.createElement('button');
                    btn.innerHTML = '⬅️';
                    btn.onclick = () => socket.emit('play_tile', { handIndex: index, side: 'left' });
                    overlay.appendChild(btn);
                }
                if (playableRight) {
                    const btn = document.createElement('button');
                    btn.innerHTML = '➡️';
                    btn.onclick = () => socket.emit('play_tile', { handIndex: index, side: 'right' });
                    overlay.appendChild(btn);
                }
                if (playableTop) {
                    const btn = document.createElement('button');
                    btn.innerHTML = '⬆️';
                    btn.onclick = () => socket.emit('play_tile', { handIndex: index, side: 'top' });
                    overlay.appendChild(btn);
                }
                if (playableBottom) {
                    const btn = document.createElement('button');
                    btn.innerHTML = '⬇️';
                    btn.onclick = () => socket.emit('play_tile', { handIndex: index, side: 'bottom' });
                    overlay.appendChild(btn);
                }
            }

            domTile.appendChild(overlay);
            domTile.classList.add('playable');
            hasPlayable = true;
        }

        myHandEl.appendChild(domTile);
    });

    if (btnPass) btnPass.style.display = (isMyTurn && !hasPlayable) ? 'block' : 'none';
});

// ── PASS ──────────────────────────────────────────────────────────────────────
if (btnPass) {
    btnPass.addEventListener('click', () => {
        socket.emit('pass_turn');
    });
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');
const btnSendChat  = document.getElementById('btn-send-chat');

socket.on('chat_message', (msg) => {
    const div = document.createElement('div');
    div.innerHTML = `<strong>${msg.sender}:</strong> ${msg.text}`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    logComanda(`${msg.sender}: ${msg.text}`);
});

btnSendChat.addEventListener('click', () => {
    if (chatInput.value.trim()) {
        socket.emit('chat_message', chatInput.value);
        chatInput.value = '';
    }
});
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnSendChat.click();
});

document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        socket.emit('chat_reaction', e.target.closest('.reaction-btn').dataset.reaction);
    });
});

// ── BUBBLES ───────────────────────────────────────────────────────────────────
function showBubble(playerId, text) {
    let bubbleId = (playerId === myPlayerId) ? 'my-bubble' : `bubble-${playerId}`;
    const bubble = document.getElementById(bubbleId);
    if (bubble) {
        bubble.innerText = text;
        bubble.classList.add('show');
        setTimeout(() => bubble.classList.remove('show'), 3000);
    }
}

socket.on('chat_reaction', (data) => {
    if (!currentGameState) return;
    const player = currentGameState.playersInfo.find(p => p.name === data.sender);
    if (player) showBubble(player.id, data.reaction);
});

// ── ROUND / GAME OVER ─────────────────────────────────────────────────────────
socket.on('round_over', () => {
    logComanda('Rodada encerrada! Nova em 5 segundos...');
});

socket.on('game_over', (data) => {
    const modal = document.getElementById('game-over-modal');
    document.getElementById('game-over-title').innerText = `Dupla ${data.winnerTeam + 1} Venceu o Jogo!`;
    document.getElementById('game-over-reason').innerHTML =
        `Parabéns à Dupla ${data.winnerTeam + 1} por atingir ${data.scores[data.winnerTeam]} pontos!<br><br>` +
        `Placar Final: Dupla 1 (${data.scores[0]} pts) vs Dupla 2 (${data.scores[1]} pts)`;
    modal.classList.remove('hidden');
});

// ── SCORE ANIMATIONS ──────────────────────────────────────────────────────────
socket.on('score_points', (data) => {
    let container = (data.playerId === myPlayerId)
        ? document.getElementById('my-avatar-container')
        : document.getElementById(`player-${data.playerId}`);

    if (container) {
        const popup = document.createElement('div');
        popup.className = 'score-floating-anim';
        popup.innerHTML = `<strong>${data.points}</strong><br><small style="font-size:.9rem">${data.reason}</small>`;
        container.appendChild(popup);
        setTimeout(() => { if (popup.parentNode) popup.parentNode.removeChild(popup); }, 3000);
    }

    logComanda(`${data.playerName}: ${data.points} pts (${data.reason})`);
});
