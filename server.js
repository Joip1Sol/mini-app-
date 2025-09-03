require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { connectDB } = require('./config/database');
const { 
  handleStartCommand, 
  handlePointsCommand, 
  handlePvpCommand, 
  handleJoinDuel,
  handleDeepLinkJoin,
  completeDuel
} = require('./handlers/commandHandler');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;

// Configurar bot de Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
  polling: true,
  onlyFirstMatch: true
});

// Variables globales para el duelo activo
let activeDuel = null;
let duelTimeout = null;

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Configurar CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Conectar a la base de datos
connectDB().then(() => {
  console.log('✅ Base de datos conectada');
});

// Función para actualizar todos los clientes
function broadcastDuelUpdate(duel) {
  activeDuel = duel;
  io.emit('duel-update', duel);
}

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
  
  // Enviar el duelo activo inmediatamente al conectar
  if (activeDuel) {
    socket.emit('duel-update', activeDuel);
  }
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado');
  });
});

// API para obtener el duelo activo
app.get('/api/active-duel', async (req, res) => {
  try {
    if (activeDuel) {
      const Duel = require('./models/Duel');
      const updatedDuel = await Duel.getDuelById(activeDuel._id);
      res.json(updatedDuel);
    } else {
      res.json(null);
    }
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo duelo activo' });
  }
});

// API para unirse al duelo activo
app.post('/api/join-duel', async (req, res) => {
  try {
    if (!activeDuel) {
      return res.status(400).json({ error: 'No hay duelos activos' });
    }

    const { userId, userName } = req.body;
    
    // Simular la unión al duelo (en producción esto vendría de Telegram)
    const user = { telegramId: userId, first_name: userName };
    
    // Usar handleJoinDuel para procesar la unión
    const Duel = require('./models/Duel');
    const updatedDuel = await Duel.joinDuel(activeDuel._id, user);
    broadcastDuelUpdate(updatedDuel);
    
    res.json({ success: true, duel: updatedDuel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server funcionando', 
    activeDuel: !!activeDuel,
    timestamp: new Date() 
  });
});

// Ruta principal - SINGLE PAGE APPLICATION
app.get('/', (req, res) => {
  res.header('Content-Type', 'text/html; charset=utf-8');
  res.send(generateSPAHTML());
});

// Comandos de Telegram
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const deepLinkParam = match && match[1];
  if (deepLinkParam && deepLinkParam.startsWith('join_')) {
    const duelId = deepLinkParam.replace('join_', '');
    handleDeepLinkJoin(bot, msg, duelId);
  } else {
    handleStartCommand(bot, msg);
  }
});

bot.onText(/\/pvp(?:\s+(\d+))?$/, async (msg, match) => {
  try {
    // Si ya hay un duelo activo, no permitir crear otro
    if (activeDuel) {
      return bot.sendMessage(msg.chat.id, 
        '❌ Ya hay un duelo en progreso. Espera a que termine para crear uno nuevo.'
      );
    }
    
    await handlePvpCommand(bot, msg, match, broadcastDuelUpdate);
  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo');
  }
});

bot.onText(/\/points$/, (msg) => {
  handlePointsCommand(bot, msg);
});

bot.onText(/\/leaderboard$/, async (msg) => {
  try {
    const User = require('./models/User');
    const leaderboard = await User.getLeaderboard(10);
    
    let message = '🏆 *Tabla de Clasificación* 🏆\n\n';
    
    leaderboard.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
      message += `${medal} ${index + 1}. ${user.firstName} - ${user.points} puntos\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error en /leaderboard:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al cargar la tabla de clasificación');
  }
});

// Manejar callbacks de botones
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data === 'join_duel') {
    try {
      // Obtener el duelo activo
      const Duel = require('./models/Duel');
      if (!activeDuel) {
        return bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ No hay duelos activos',
          show_alert: true
        });
      }
      
      // Unirse al duelo
      const user = {
        telegramId: callbackQuery.from.id,
        first_name: callbackQuery.from.first_name
      };
      
      const updatedDuel = await Duel.joinDuel(activeDuel._id, user);
      broadcastDuelUpdate(updatedDuel);
      
      bot.answerCallbackQuery(callbackQuery.id, {
        text: '✅ Te has unido al duelo',
        show_alert: false
      });
    } catch (error) {
      console.error('Error en callback join_duel:', error);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Error al unirse al duelo',
        show_alert: true
      });
    }
  }
});

// Manejar errores
bot.on('error', (error) => {
  console.error('❌ Error del bot de Telegram:', error);
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`🤖 Bot de Telegram iniciado`);
  console.log(`🌐 SPA disponible en: http://localhost:${PORT}`);
});

// Función para generar la Single Page Application
function generateSPAHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>CoinFlip Duelo en Vivo</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            --tg-theme-bg-color: #ffffff;
            --tg-theme-text-color: #222222;
            --tg-theme-button-color: #40a7e3;
            --tg-theme-button-text-color: #ffffff;
            --tg-theme-secondary-bg-color: #f1f1f1;
            --primary-color: #40a7e3;
            --secondary-color: #2d89bc;
            --success-color: #4caf50;
            --warning-color: #ff9800;
            --error-color: #f44336;
            --border-radius: 12px;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --tg-theme-bg-color: #212121;
                --tg-theme-text-color: #ffffff;
                --tg-theme-secondary-bg-color: #181818;
            }
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--tg-theme-bg-color);
            color: var(--tg-theme-text-color);
            padding: 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .container {
            width: 100%;
            max-width: 500px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--tg-theme-secondary-bg-color);
        }

        .header h1 {
            font-size: 2rem;
            margin: 0;
            color: var(--primary-color);
            text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
        }

        .status-banner {
            padding: 15px;
            border-radius: var(--border-radius);
            margin-bottom: 20px;
            text-align: center;
            font-weight: bold;
        }

        .status-waiting {
            background-color: var(--warning-color);
            color: white;
        }

        .status-countdown {
            background-color: var(--primary-color);
            color: white;
        }

        .status-completed {
            background-color: var(--success-color);
            color: white;
        }

        .duel-container {
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .players-section {
            display: flex;
            justify-content: space-around;
            margin-bottom: 25px;
        }

        .player-card {
            text-align: center;
            padding: 15px;
            border-radius: var(--border-radius);
            background: var(--tg-theme-bg-color);
            min-width: 120px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .player-card.active {
            border: 2px solid var(--primary-color);
            transform: scale(1.05);
        }

        .player-card.winner {
            border: 2px solid var(--success-color);
            background: linear-gradient(135deg, var(--success-color) 0%, #a5d6a7 100%);
            color: white;
        }

        .player-name {
            font-weight: bold;
            font-size: 1.1rem;
            margin-bottom: 5px;
        }

        .player-status {
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .vs-separator {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--primary-color);
        }

        .coin-section {
            perspective: 1000px;
            width: 150px;
            height: 150px;
            margin: 0 auto 25px;
            position: relative;
        }

        #coin {
            width: 100%;
            height: 100%;
            position: relative;
            transform-style: preserve-3d;
            transition: transform 0.5s ease-out;
        }

        .coin-face {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .front {
            background: linear-gradient(145deg, #ffd700, #ffed4e);
            border: 4px solid #c4b16b;
            color: #333;
            z-index: 2;
        }

        .back {
            background: linear-gradient(145deg, #c0c0c0, #e8e8e8);
            border: 4px solid #a8a8a8;
            color: #333;
            transform: rotateY(180deg);
        }

        .bet-amount {
            text-align: center;
            font-size: 1.3rem;
            font-weight: bold;
            margin: 15px 0;
            color: var(--primary-color);
        }

        .action-section {
            text-align: center;
            margin: 20px 0;
        }

        .btn {
            padding: 15px 25px;
            border: none;
            border-radius: var(--border-radius);
            background: var(--primary-color);
            color: white;
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            margin: 5px;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0,0,0,0.3);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn.join {
            background: var(--success-color);
        }

        .btn.create {
            background: var(--primary-color);
        }

        .countdown {
            text-align: center;
            font-size: 2rem;
            font-weight: bold;
            margin: 20px 0;
            color: var(--primary-color);
            text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }

        .result-section {
            text-align: center;
            margin: 25px 0;
            padding: 20px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
            animation: fadeIn 0.5s ease-in;
        }

        .winner-text {
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--success-color);
            margin-bottom: 10px;
        }

        .result-details {
            font-size: 1.1rem;
            margin: 5px 0;
        }

        .history-section {
            margin-top: 25px;
            padding: 20px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
        }

        .history-title {
            text-align: center;
            margin-bottom: 15px;
            font-size: 1.2rem;
            color: var(--primary-color);
        }

        .history-item {
            padding: 10px;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
        }

        .history-item:last-child {
            border-bottom: none;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--tg-theme-text-color);
            opacity: 0.7;
        }

        .empty-state h2 {
            margin-bottom: 10px;
            color: var(--primary-color);
        }

        @keyframes flip {
            0% { transform: rotateY(0deg); }
            100% { transform: rotateY(1800deg); }
        }

        @keyframes pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .flipping {
            animation: flip 2s ease-out forwards;
        }

        .pulse {
            animation: pulse 2s infinite;
        }

        .fade-in {
            animation: fadeIn 0.5s ease-in;
        }

        .hidden {
            display: none !important;
        }

        @media (max-width: 600px) {
            .container {
                padding: 10px;
            }
            
            .players-section {
                flex-direction: column;
                gap: 15px;
            }
            
            .coin-section {
                width: 120px;
                height: 120px;
            }
            
            .btn {
                padding: 12px 20px;
                font-size: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 CoinFlip Duelo en Vivo</h1>
            <p>Solo un duelo a la vez - ¡Únete y gana puntos!</p>
        </div>

        <div id="status-banner" class="status-banner hidden">
            <span id="status-text"></span>
        </div>

        <div id="duel-container" class="duel-container hidden">
            <div class="players-section">
                <div class="player-card" id="player-a-card">
                    <div class="player-name" id="player-a-name">Jugador A</div>
                    <div class="player-status" id="player-a-status">Esperando...</div>
                </div>
                
                <div class="vs-separator">VS</div>
                
                <div class="player-card" id="player-b-card">
                    <div class="player-name" id="player-b-name">Jugador B</div>
                    <div class="player-status" id="player-b-status">Disponible</div>
                </div>
            </div>

            <div class="bet-amount">
                💰 <span id="bet-amount">0</span> puntos en juego
            </div>

            <div class="coin-section">
                <div id="coin">
                    <div class="coin-face front"><span id="front-text">A</span></div>
                    <div class="coin-face back"><span id="back-text">B</span></div>
                </div>
            </div>

            <div id="countdown" class="countdown hidden">
                ⏰ <span id="countdown-value">15</span>s
            </div>

            <div class="action-section">
                <button id="join-btn" class="btn join" onclick="joinDuel()">✅ Unirse al Duelo</button>
                <button id="create-btn" class="btn create hidden" onclick="createDuel()">⚔️ Crear Nuevo Duelo</button>
            </div>

            <div id="result-section" class="result-section hidden">
                <div class="winner-text" id="winner-text">🎉 ¡Ganador!</div>
                <div class="result-details" id="result-details"></div>
            </div>
        </div>

        <div id="empty-state" class="empty-state">
            <h2>🎯 No hay duelos activos</h2>
            <p>¡Sé el primero en crear un duelo!</p>
            <button class="btn create" onclick="createDuel()">⚔️ Crear Mi Duelo</button>
        </div>

        <div class="history-section">
            <div class="history-title">📊 Últimos Resultados</div>
            <div id="history-items">
                <div class="history-item">
                    <span>Esperando resultados...</span>
                    <span>--</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let currentDuel = null;
        let countdownInterval = null;

        // Conectar WebSocket y escuchar actualizaciones
        socket.on('connect', () => {
            console.log('🔗 Conectado al servidor');
            loadActiveDuel();
        });

        socket.on('duel-update', (duel) => {
            console.log('🔄 Actualización de duelo recibida:', duel);
            currentDuel = duel;
            updateUI(duel);
        });

        socket.on('disconnect', () => {
            console.log('❌ Desconectado del servidor');
        });

        // Cargar duelo activo al iniciar
        async function loadActiveDuel() {
            try {
                const response = await fetch('/api/active-duel');
                currentDuel = await response.json();
                updateUI(currentDuel);
            } catch (error) {
                console.error('Error loading active duel:', error);
            }
        }

        // Actualizar la interfaz según el estado del duelo
        function updateUI(duel) {
            const duelContainer = document.getElementById('duel-container');
            const emptyState = document.getElementById('empty-state');
            const statusBanner = document.getElementById('status-banner');
            const statusText = document.getElementById('status-text');

            if (!duel) {
                duelContainer.classList.add('hidden');
                emptyState.classList.remove('hidden');
                statusBanner.classList.add('hidden');
                return;
            }

            emptyState.classList.add('hidden');
            duelContainer.classList.remove('hidden');
            statusBanner.classList.remove('hidden');

            // Actualizar información de jugadores
            document.getElementById('player-a-name').textContent = duel.playerA?.first_name || 'Jugador A';
            document.getElementById('player-b-name').textContent = duel.playerB?.first_name || 'Jugador B';
            document.getElementById('bet-amount').textContent = duel.betAmount || 0;

            // Actualizar estado
            const statusMap = {
                'waiting': ['⏳ Esperando jugador B', 'status-waiting'],
                'countdown': ['⏰ Duelo en progreso', 'status-countdown'],
                'completed': ['✅ Duelo completado', 'status-completed']
            };

            const [text, style] = statusMap[duel.status] || ['❓ Estado desconocido', ''];
            statusText.textContent = text;
            statusBanner.className = 'status-banner ' + style;

            // Manejar diferentes estados
            if (duel.status === 'countdown') {
                startCountdown(duel.countdownEnd);
            } else if (duel.status === 'completed') {
                showResult(duel);
            }

            // Actualizar botones
            updateButtons(duel);
        }

        function startCountdown(countdownEnd) {
            const countdownElement = document.getElementById('countdown');
            const countdownValue = document.getElementById('countdown-value');
            countdownElement.classList.remove('hidden');

            function update() {
                const now = new Date();
                const timeLeft = Math.max(0, new Date(countdownEnd) - now);
                const seconds = Math.ceil(timeLeft / 1000);
                
                countdownValue.textContent = seconds;
                
                if (seconds === 0) {
                    clearInterval(countdownInterval);
                    document.getElementById('coin').classList.add('flipping');
                    setTimeout(() => loadActiveDuel(), 2000);
                }
            }

            update();
            countdownInterval = setInterval(update, 1000);
        }

        function showResult(duel) {
            clearInterval(countdownInterval);
            document.getElementById('countdown').classList.add('hidden');
            
            const resultSection = document.getElementById('result-section');
            const winnerText = document.getElementById('winner-text');
            const resultDetails = document.getElementById('result-details');

            if (duel.winner) {
                winnerText.textContent = '🎉 ¡' + duel.winner.first_name + ' gana!';
                resultDetails.innerHTML = '<div>💰 Premio: ' + (duel.betAmount * 2) + ' puntos</div><div>🎯 Resultado: ' + (duel.winner === duel.playerA ? '🟡 Cara' : '⚫ Cruz') + '</div>';
                resultSection.classList.remove('hidden');
            }
        }

        function updateButtons(duel) {
            const joinBtn = document.getElementById('join-btn');
            const createBtn = document.getElementById('create-btn');

            if (duel.status === 'waiting' && !duel.playerB) {
                joinBtn.classList.remove('hidden');
                joinBtn.disabled = false;
                createBtn.classList.add('hidden');
            } else {
                joinBtn.classList.add('hidden');
                if (duel.status === 'completed') {
                    createBtn.classList.remove('hidden');
                } else {
                    createBtn.classList.add('hidden');
                }
            }
        }

        // Funciones de acción
        async function joinDuel() {
            if (!currentDuel) return;

            try {
                const joinBtn = document.getElementById('join-btn');
                joinBtn.disabled = true;
                joinBtn.textContent = '🔄 Uniéndose...';

                // Simular usuario (en producción esto vendría de Telegram)
                const user = {
                    userId: 'user_' + Date.now(),
                    userName: 'Jugador_' + Math.floor(Math.random() * 1000)
                };

                const response = await fetch('/api/join-duel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(user)
                });

                const result = await response.json();
                if (result.success) {
                    joinBtn.textContent = '✅ Unido';
                } else {
                    joinBtn.disabled = false;
                    joinBtn.textContent = '✅ Unirse al Duelo';
                    alert('Error: ' + result.error);
                }
            } catch (error) {
                console.error('Error joining duel:', error);
                const joinBtn = document.getElementById('join-btn');
                joinBtn.disabled = false;
                joinBtn.textContent = '✅ Unirse al Duelo';
            }
        }

        function createDuel() {
            alert('Para crear un duelo, usa el comando /pvp en Telegram');
        }

        // Cargar inicialmente
        document.addEventListener('DOMContentLoaded', loadActiveDuel);
    </script>
</body>
</html>`;
}