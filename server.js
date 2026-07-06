const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateTiles() {
    const tiles = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) {
            tiles.push([i, j]);
        }
    }
    return tiles;
}

function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

function getInitialTurn(hands) {
    let maxDouble = -1;
    let turnIndex = 0;
    
    for (let i = 0; i < 4; i++) {
        for (let tile of hands[i]) {
            if (tile[0] === tile[1] && tile[0] > maxDouble) {
                maxDouble = tile[0];
                turnIndex = i;
            }
        }
    }
    return { turnIndex, maxDouble };
}

function calculateHandScore(hand) {
    return hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
}

function triggerScoreAnim(room, playerIndex, pointsText, reasonText) {
    const team = playerIndex % 2;
    io.to(room.id).emit('score_points', {
        playerId: room.players[playerIndex].id,
        playerName: room.players[playerIndex].name,
        points: pointsText,
        team: team,
        reason: reasonText
    });
}

function getBoardEndsSum(gameState) {
    if (!gameState.spinnerTile) return 0;
    
    let sum = 0;
    const evalBranch = (side) => {
        const branch = gameState.branches[side];
        if (branch.length === 0) {
            if (side === 'left' || side === 'right') return gameState.spinnerTile[0];
            return 0;
        } else {
            const outermost = branch[branch.length - 1];
            if (outermost.tile[0] === outermost.tile[1]) return outermost.tile[0] * 2;
            else return gameState.openEnds[side];
        }
    };
    
    sum += evalBranch('left');
    sum += evalBranch('right');
    sum += evalBranch('top');
    sum += evalBranch('bottom');
    return sum;
}

function getSimulatedEndsSum(gameState, tile, side) {
    if (!gameState.spinnerTile) {
        return tile[0] + tile[1];
    }
    
    let sum = 0;
    ['left', 'right', 'top', 'bottom'].forEach(s => {
        if (s === side) {
            if (tile[0] === tile[1]) sum += tile[0] * 2;
            else sum += (tile[0] === gameState.openEnds[s]) ? tile[1] : tile[0];
        } else {
            const branch = gameState.branches[s];
            if (branch.length === 0) {
                if (s === 'left' || s === 'right') sum += gameState.spinnerTile[0];
            } else {
                const outermost = branch[branch.length - 1];
                if (outermost.tile[0] === outermost.tile[1]) sum += outermost.tile[0] * 2;
                else sum += gameState.openEnds[s];
            }
        }
    });
    return sum;
}

function checkTie(room) {
    const { gameState } = room;
    let anyCanPlay = false;
    for (let i = 0; i < 4; i++) {
        for (let tile of gameState.hands[i]) {
            if (!gameState.spinnerTile) {
                if (tile[0] === tile[1]) anyCanPlay = true;
            } else {
                ['left', 'right', 'top', 'bottom'].forEach(side => {
                    const openEnd = gameState.openEnds[side];
                    if (openEnd !== null && (tile[0] === openEnd || tile[1] === openEnd)) anyCanPlay = true;
                });
            }
        }
    }
    
    if (!anyCanPlay) {
        const team1Sum = calculateHandScore(gameState.hands[0]) + calculateHandScore(gameState.hands[2]);
        const team2Sum = calculateHandScore(gameState.hands[1]) + calculateHandScore(gameState.hands[3]);
        
        let winningTeam = -1;
        
        if (team1Sum < team2Sum) {
            winningTeam = 0;
            const pointsToGive = Math.floor(team2Sum / 5) * 5;
            room.scores[0] += pointsToGive;
            io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `Jogo Fechado! Dupla 1 vence (${team1Sum} vs ${team2Sum}). +${pointsToGive} pts da mão arredondados.` });
            triggerScoreAnim(room, 0, `+${pointsToGive}`, 'Fechamento!');
        } else if (team2Sum < team1Sum) {
            winningTeam = 1;
            const pointsToGive = Math.floor(team1Sum / 5) * 5;
            room.scores[1] += pointsToGive;
            io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `Jogo Fechado! Dupla 2 vence (${team2Sum} vs ${team1Sum}). +${pointsToGive} pts da mão arredondados.` });
            triggerScoreAnim(room, 1, `+${pointsToGive}`, 'Fechamento!');
        } else {
            io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `Jogo Fechado! Empate (${team1Sum} vs ${team2Sum}). Ninguém pontua.` });
            room.gameState.previousWinnerIndex = null;
        }
        
        checkGameOrRoundEnd(room);
        return true;
    }
    return false;
}

function checkGameOrRoundEnd(room) {
    if (room.scores[0] >= 200 || room.scores[1] >= 200) {
        const absoluteWinner = room.scores[0] > room.scores[1] ? 0 : 1;
        io.to(room.id).emit('game_over', {
            winnerTeam: absoluteWinner,
            scores: room.scores,
            players: room.players,
            reason: 'reached_200'
        });
        endGame(room);
        return true;
    } else {
        io.to(room.id).emit('round_over', {
            scores: room.scores,
            winningTeam: room.gameState.previousWinnerIndex !== null ? room.gameState.previousWinnerIndex % 2 : -1
        });
        setTimeout(() => {
            if (room.players.length === 4) startGame(room);
        }, 5000);
        return true;
    }
}

function endGame(room) {
    if(room.gameState && room.gameState.turnTimeout) clearTimeout(room.gameState.turnTimeout);
    room.gameState = null;
    room.scores = [0, 0];
}

function startTurnTimeout(room) {
    if(room.gameState.turnTimeout) clearTimeout(room.gameState.turnTimeout);
    room.gameState.turnTimeout = setTimeout(() => {
        handleTimeout(room);
    }, 20000);
}

function handleTimeout(room) {
    if (!room.gameState) return;
    const turnIndex = room.gameState.turnIndex;
    if (room.players[turnIndex].isBot) return;
    io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `${room.players[turnIndex].name} estourou o tempo de 20s.` });
    executePass(room, turnIndex);
}

function botPlay(room) {
    const turnIndex = room.gameState.turnIndex;
    const hand = room.gameState.hands[turnIndex];
    
    let bestTileIndex = -1;
    let bestSide = '';
    let maxScore = -9999;
    
    for (let i = 0; i < hand.length; i++) {
        const tile = hand[i];
        
        const tryPlay = (side) => {
            const simSum = getSimulatedEndsSum(room.gameState, tile, side);
            let scoreValue = tile[0] + tile[1];
            
            if (simSum > 0 && simSum % 5 === 0) {
                scoreValue += simSum * 100;
            }
            
            if (hand.length === 1 && tile[0] === tile[1]) {
                scoreValue += 2000;
            }
            
            if (scoreValue > maxScore) {
                maxScore = scoreValue;
                bestTileIndex = i;
                bestSide = side;
            }
        };

        if (!room.gameState.spinnerTile) {
            if (tile[0] === tile[1]) tryPlay('left');
        } else {
            ['left', 'right', 'top', 'bottom'].forEach(side => {
                const openEnd = room.gameState.openEnds[side];
                if (openEnd !== null && (tile[0] === openEnd || tile[1] === openEnd)) {
                    tryPlay(side);
                }
            });
        }
    }
    
    setTimeout(() => {
        if (!room.gameState) return;
        if (bestTileIndex !== -1) {
            executePlay(room, turnIndex, bestTileIndex, bestSide);
        } else {
            io.to(room.id).emit('chat_reaction', { sender: room.players[turnIndex].name, reaction: 'Passei...' });
            executePass(room, turnIndex);
        }
    }, 1500 + Math.random() * 2000);
}

function executePass(room, turnIndex) {
    room.gameState.sequentialPasses++;
    const team = turnIndex % 2;
    const oppTeam = (team + 1) % 2;
    
    if (room.gameState.isFirstTurnOfRound && !room.gameState.spinnerTile) {
        io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `${room.players[turnIndex].name} não tinha carroça para sair (+20 pts para Dupla ${oppTeam + 1}).` });
        room.scores[oppTeam] += 20;
        triggerScoreAnim(room, (turnIndex + 1) % 4, '+20', 'Punição: Saída!');
    } else {
        io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `${room.players[turnIndex].name} passou a vez (+20 pts para Dupla ${oppTeam + 1}).` });
        room.scores[oppTeam] += 20;
        triggerScoreAnim(room, (turnIndex + 1) % 4, '+20', 'Passe!');
    }
    
    if (room.gameState.sequentialPasses === 3 && room.gameState.spinnerTile) {
        const galoPlayer = (turnIndex + 1) % 4;
        const galoTeam = galoPlayer % 2;
        room.scores[galoTeam] += 50;
        io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `GALO! Dupla ${galoTeam + 1} ganha +50 pontos!` });
        triggerScoreAnim(room, galoPlayer, '+50', 'GALO!');
        room.gameState.sequentialPasses = 0;
    }
    
    room.gameState.isFirstTurnOfRound = false;
    
    if (room.scores[oppTeam] >= 200 || room.scores[team] >= 200) {
        if (checkGameOrRoundEnd(room)) return;
    }
    
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % 4;
    emitGameState(room);
}

function executePlay(room, playerIndex, handIndex, side) {
    const tile = room.gameState.hands[playerIndex][handIndex];
    room.gameState.sequentialPasses = 0;
    room.gameState.isFirstTurnOfRound = false;
    
    room.gameState.hands[playerIndex].splice(handIndex, 1);
    
    if (!room.gameState.spinnerTile) {
        room.gameState.spinnerTile = tile;
        room.gameState.openEnds = { left: tile[0], right: tile[0], top: tile[0], bottom: tile[0] };
    } else {
        const branch = room.gameState.branches[side];
        const openEnd = room.gameState.openEnds[side];
        let flipped = false;
        if (tile[0] === openEnd) {
            flipped = false;
            room.gameState.openEnds[side] = tile[1];
        } else if (tile[1] === openEnd) {
            flipped = true;
            room.gameState.openEnds[side] = tile[0];
        }
        branch.push({ tile, flipped });
    }
    
    const endsSum = getBoardEndsSum(room.gameState);
    if (endsSum > 0 && endsSum % 5 === 0) {
        const team = playerIndex % 2;
        room.scores[team] += endsSum;
        triggerScoreAnim(room, playerIndex, `+${endsSum}`, 'Ponta!');
        io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `${room.players[playerIndex].name} fez ponta de ${endsSum}!` });
        
        if (room.scores[team] >= 200) {
            checkGameOrRoundEnd(room);
            return;
        }
    }
    
    if (room.gameState.hands[playerIndex].length === 0) {
        const winningTeam = playerIndex % 2;
        room.gameState.previousWinnerIndex = playerIndex;
        
        if (tile[0] === tile[1]) {
            room.scores[winningTeam] += 20;
            triggerScoreAnim(room, playerIndex, '+20', 'Batida de Carroça!');
        }
        
        io.to(room.id).emit('chat_message', { sender: 'Sistema', text: `${room.players[playerIndex].name} BATEU! (Rodada Encerrada)` });
        
        checkGameOrRoundEnd(room);
        return;
    }
    
    if (checkTie(room)) return;
    
    room.gameState.turnIndex = (room.gameState.turnIndex + 1) % 4;
    emitGameState(room);
}

function emitGameState(room) {
    if (!room.gameState) return;
    
    const turnIndex = room.gameState.turnIndex;
    const isBot = room.players[turnIndex].isBot;
    
    if (!isBot) startTurnTimeout(room);
    
    const publicState = {
        spinnerTile: room.gameState.spinnerTile,
        branches: room.gameState.branches,
        openEnds: room.gameState.openEnds,
        turnIndex: room.gameState.turnIndex,
        scores: room.scores,
        playersInfo: room.players.map((p, i) => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            handCount: room.gameState.hands[i].length,
            isBot: p.isBot,
            team: i % 2
        }))
    };
    
    io.to(room.id).emit('game_state', publicState);
    
    room.players.forEach((p, i) => {
        if (!p.isBot) {
            io.to(p.id).emit('private_hand', room.gameState.hands[i]);
        }
    });
    
    if (isBot) botPlay(room);
}

function startGame(room) {
    const tiles = shuffle(generateTiles());
    const hands = [ tiles.slice(0, 7), tiles.slice(7, 14), tiles.slice(14, 21), tiles.slice(21, 28) ];
    
    let turnIndex = 0;
    if (room.gameState && room.gameState.previousWinnerIndex !== null) {
        turnIndex = room.gameState.previousWinnerIndex;
    } else {
        turnIndex = getInitialTurn(hands).turnIndex;
    }
    
    room.gameState = {
        hands,
        spinnerTile: null,
        branches: { left: [], right: [], top: [], bottom: [] },
        openEnds: { left: null, right: null, top: null, bottom: null },
        turnIndex,
        turnTimeout: null,
        sequentialPasses: 0,
        previousWinnerIndex: room.gameState ? room.gameState.previousWinnerIndex : null,
        isFirstTurnOfRound: true
    };
    
    io.to(room.id).emit('chat_message', { sender: 'Sistema', text: 'Nova rodada! A saída deve ser uma Carroça.' });
    emitGameState(room);
}

io.on('connection', (socket) => {
    socket.on('get_rooms', () => {
        const roomList = Object.keys(rooms).map(id => ({
            id,
            name: rooms[id].name,
            hasPassword: !!rooms[id].password,
            playerCount: rooms[id].players.length
        }));
        socket.emit('room_list', roomList);
    });

    socket.on('create_room', (data, callback) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
        rooms[roomId] = {
            id: roomId,
            name: data.name || 'Mesa Híbrida',
            password: data.password || null,
            players: [],
            scores: [0, 0],
            gameState: null
        };
        callback({ success: true, roomId });
        io.emit('room_update');
    });
    
    socket.on('join_room', (data, callback) => {
        const room = rooms[data.roomId];
        if (!room || room.players.length >= 4 || room.gameState) return callback({ success: false });
        
        room.players.push({
            id: socket.id,
            name: data.playerName || 'Anônimo',
            avatar: data.avatar || 'vira-lata',
            isBot: false
        });
        socket.join(room.id);
        socket.room = room.id;
        io.to(room.id).emit('room_joined', { room });
        io.emit('room_update');
        callback({ success: true });
    });
    
    socket.on('start_game_with_bots', () => {
        const room = rooms[socket.room];
        if (room && !room.gameState) {
            const botAvatars = ['capivara', 'vira-lata', 'copo-americano', 'coxinha'];
            let botNum = 1;
            while(room.players.length < 4) {
                room.players.push({ id: 'bot_' + Math.random().toString(36).substr(2, 9), name: 'Bot ' + botNum++, avatar: botAvatars[room.players.length % botAvatars.length], isBot: true });
            }
            io.to(room.id).emit('room_joined', { room });
            startGame(room);
        }
    });
    
    socket.on('play_tile', (data) => {
        const room = rooms[socket.room];
        if (!room || !room.gameState) return;
        const turnIndex = room.gameState.turnIndex;
        if (room.players[turnIndex].id !== socket.id) return;
        executePlay(room, turnIndex, data.handIndex, data.side);
    });
    
    socket.on('pass_turn', () => {
        const room = rooms[socket.room];
        if (!room || !room.gameState) return;
        const turnIndex = room.gameState.turnIndex;
        if (room.players[turnIndex].id !== socket.id) return;
        io.to(room.id).emit('chat_reaction', { sender: room.players[turnIndex].name, reaction: 'Passei...' });
        executePass(room, turnIndex);
    });
    
    socket.on('chat_message', (msg) => {
        const room = rooms[socket.room];
        if (room) {
             const player = room.players.find(p => p.id === socket.id);
             if(player) io.to(socket.room).emit('chat_message', { sender: player.name, text: msg });
        }
    });
    
    socket.on('chat_reaction', (reaction) => {
        const room = rooms[socket.room];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if(player) io.to(socket.room).emit('chat_reaction', { sender: player.name, reaction });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            const room = rooms[socket.room];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                if (room.gameState) {
                    room.players[playerIndex].isBot = true;
                    if (room.gameState.turnIndex === playerIndex) botPlay(room);
                } else {
                    room.players.splice(playerIndex, 1);
                    io.to(room.id).emit('room_joined', { room });
                    if (room.players.length === 0) delete rooms[socket.room];
                }
            }
            io.emit('room_update');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });
