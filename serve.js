const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permite que qualquer site se conecte (ideal para testes no Claude/Vercel)
        methods: ["GET", "POST"]
    }
});

// Banco de dados temporário na memória do servidor
let players = {};
let activeTrades = {};

io.on('connection', (socket) => {
    console.log(`Jogador conectado: ${socket.id}`);

    // 1. NOVO JOGADOR LOGADO
    players[socket.id] = {
        id: socket.id,
        x: 1000,
        y: 1000,
        direction: 'down',
        name: `Player_${socket.id.substring(0, 4)}`,
        level: 1,
        jobLevel: 1,
        hp: 40,
        maxHp: 40,
        gold: 300,
        outfitColor: '#' + Math.floor(Math.random()*16777215).toString(16) // Cor aleatória de roupa
    };

    // Envia a lista de jogadores atuais para o jogador que acabou de entrar
    socket.emit('currentPlayers', players);

    // Avisa todos os outros jogadores que alguém novo se conectou
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // 2. ATUALIZAÇÃO DE MOVIMENTO
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].direction = movementData.direction;
            
            // Avisa os outros onde este jogador está agora
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 3. SISTEMA DE CHAT GLOBAL/PROXIMIDADE
    socket.on('sendMessage', (messageText) => {
        if (players[socket.id]) {
            const chatData = {
                id: socket.id,
                name: players[socket.id].name,
                text: messageText
            };
            // Envia a mensagem para todo mundo no mapa
            io.emit('newMessage', chatData);
        }
    });

    // 4. SISTEMA DE TROCA (TRADE) SECURE ENGINE
    // Solicitar Troca
    socket.on('requestTrade', (targetId) => {
        if (players[targetId] && targetId !== socket.id) {
            io.to(targetId).emit('tradeRequestReceived', { fromId: socket.id, fromName: players[socket.id].name });
        }
    });

    // Aceitar Convite de Troca
    socket.on('acceptTrade', (fromId) => {
        if (players[fromId]) {
            const tradeId = `${fromId}-${socket.id}`;
            activeTrades[tradeId] = {
                p1: { id: fromId, gold: 0, items: [], confirmed: false },
                p2: { id: socket.id, gold: 0, items: [], confirmed: false }
            };
            
            // Abre a janela de trade na tela dos dois jogadores
            io.to(fromId).emit('tradeStarted', { tradeId, targetName: players[socket.id].name });
            io.to(socket.id).emit('tradeStarted', { tradeId, targetName: players[fromId].name });
        }
    });

    // Atualizar oferta de Gold no Trade
    socket.on('updateTradeGold', ({ tradeId, goldAmount }) => {
        let trade = activeTrades[tradeId];
        if (trade) {
            if (trade.p1.id === socket.id && players[socket.id].gold >= goldAmount) trade.p1.gold = goldAmount;
            if (trade.p2.id === socket.id && players[socket.id].gold >= goldAmount) trade.p2.gold = goldAmount;
            
            io.to(trade.p1.id).to(trade.p2.id).emit('tradeUpdated', trade);
        }
    });

    // Confirmar e Finalizar a Troca de forma segura
    socket.on('confirmTrade', (tradeId) => {
        let trade = activeTrades[tradeId];
        if (trade) {
            if (trade.p1.id === socket.id) trade.p1.confirmed = true;
            if (trade.p2.id === socket.id) trade.p2.confirmed = true;

            io.to(trade.p1.id).to(trade.p2.id).emit('tradeUpdated', trade);

            // Se ambos confirmaram, o servidor executa a transação
            if (trade.p1.confirmed && trade.p2.confirmed) {
                if (players[trade.p1.id] && players[trade.p2.id]) {
                    // Transfere o Gold com segurança
                    players[trade.p1.id].gold -= trade.p1.gold;
                    players[trade.p1.id].gold += trade.p2.gold;

                    players[trade.p2.id].gold -= trade.p2.gold;
                    players[trade.p2.id].gold += trade.p1.gold;

                    // Avisa as telas para atualizar os saldos e fechar a janela
                    io.to(trade.p1.id).emit('tradeComplete', { newGold: players[trade.p1.id].gold });
                    io.to(trade.p2.id).emit('tradeComplete', { newGold: players[trade.p2.id].gold });
                }
                delete activeTrades[tradeId];
            }
        }
    });

    // 5. DESCONEXÃO DO JOGADOR
    socket.on('disconnect', () => {
        console.log(`Jogador desconectado: ${socket.id}`);
        delete players[socket.id];
        // Remove o boneco da tela de todos os outros
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor MMORPG Pixelia rodando na porta ${PORT}`);
});
