require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { connectDB } = require('./config/database');
const { 
  handleStartCommand, 
  handlePointsCommand, 
  handlePvpCommand, 
  handleJoinDuel 
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

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
  
  socket.on('join-duel', (duelId) => {
    socket.join(duelId);
    console.log(`👥 Cliente unido a la sala del duelo: ${duelId}`);
  });
  
  socket.on('get-duel-info', async (duelId) => {
    try {
      const Duel = require('./models/Duel');
      const duel = await Duel.getDuelById(duelId);
      socket.emit('duel-update', duel);
    } catch (error) {
      console.error('Error enviando info del duelo:', error);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado');
  });
});

// Servir Socket.io client
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// Rutas API
app.get('/duel-info/:duelId', async (req, res) => {
  try {
    const Duel = require('./models/Duel');
    const duel = await Duel.getDuelById(req.params.duelId);
    
    // Configurar CORS para esta respuesta
    res.header('Access-Control-Allow-Origin', '*');
    res.json(duel);
  } catch (error) {
    console.error('Error obteniendo información del duelo:', error);
    res.status(500).json({ error: 'Error obteniendo información del duelo' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server funcionando', timestamp: new Date() });
});

app.get('/', async (req, res) => {
  const duelId = req.query.duel;
  
  // Configurar headers CORS
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Content-Type', 'text/html; charset=utf-8');
  
  if (duelId) {
    try {
      const Duel = require('./models/Duel');
      const duel = await Duel.getDuelById(duelId);
      if (duel) {
        return res.send(generateMiniAppHTML(duel));
      }
    } catch (error) {
      console.error('Error loading duel:', error);
    }
  }
  
  res.send(generateMiniAppHTML());
});

// Comandos de Telegram
bot.onText(/\/start$/, (msg) => {
  handleStartCommand(bot, msg);
});

bot.onText(/\/pvp(?:\s+(\d+))?$/, (msg, match) => {
  handlePvpCommand(bot, msg, match);
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

// Manejar callbacks
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data === 'join_duel') {
    handleJoinDuel(bot, callbackQuery);
  } else if (data === 'create_duel') {
    bot.sendMessage(callbackQuery.message.chat.id, 
      'Usa /pvp [cantidad] para crear un duelo. Ejemplo: /pvp 25'
    );
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
  console.log(`🌐 MiniApp disponible en: https://mini-app-jr7n.onrender.com`);
});

// Función para generar HTML de la MiniApp (CORREGIDA)
function generateMiniAppHTML(duel = null) {
  const playerAName = duel?.playerA?.first_name || 'Cargando...';
  const playerBName = duel?.playerB?.first_name || 'Esperando...';
  const duelStatus = duel?.status || 'waiting';
  const betAmount = duel?.betAmount || 0;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>CoinFlip MiniApp</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
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
            padding: 16px;
            min-height: 100vh;
            max-width: 100%;
            overflow-x: hidden;
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 20px;
        }

        .header h1 {
            font-size: 1.5rem;
            margin: 0;
        }

        .players-container {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .player-card {
            flex: 1;
            min-width: 120px;
            background: var(--tg-theme-secondary-bg-color);
            padding: 12px;
            border-radius: var(--border-radius);
            text-align: center;
        }

        .player-card.active {
            background: var(--tg-theme-button-color);
            color: var(--tg-theme-button-text-color);
        }

        .player-card h3 {
            margin: 0 0 8px 0;
            font-size: 0.9rem;
        }

        .player-card p {
            margin: 0;
            font-size: 0.8rem;
            font-weight: bold;
        }

        .coin-section {
            perspective: 600px;
            width: 100px;
            height: 100px;
            margin: 0 auto 20px;
        }

        #coin {
            width: 100%;
            height: 100%;
            position: relative;
            transform-style: preserve-3d;
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
            font-size: 0.8rem;
            background: linear-gradient(145deg, #d4d4d4, #f4f4f4);
            border: 2px solid #c4b16b;
        }

        .front { 
            z-index: 2; 
            background: linear-gradient(145deg, #ffd700, #ffed4e);
        }
        
        .back { 
            transform: rotateY(180deg);
            background: linear-gradient(145deg, #c0c0c0, #e8e8e8);
        }

        .countdown {
            text-align: center;
            font-size: 1.2rem;
            font-weight: bold;
            margin: 15px 0;
            color: var(--tg-theme-button-color);
            display: none;
        }

        .result-section {
            text-align: center;
            margin: 15px 0;
            padding: 12px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
        }

        .result-section h3 {
            margin: 0 0 8px 0;
            font-size: 1.1rem;
        }

        .result-section p {
            margin: 4px 0;
            font-size: 0.9rem;
        }

        .history-section {
            margin-top: 15px;
            padding: 12px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
        }

        .history-section h3 {
            margin: 0 0 10px 0;
            font-size: 1rem;
        }

        .history-item {
            padding: 6px 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            font-size: 0.8rem;
        }

        .history-item:last-child {
            border-bottom: none;
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

        .winner {
            animation: pulse 2s infinite;
            color: #ff9900;
        }

        .flipping {
            animation: flip 2s ease-out forwards;
        }

        @media (max-width: 340px) {
            .players-container {
                flex-direction: column;
            }
            
            .player-card {
                min-width: 100%;
            }
            
            .coin-section {
                width: 80px;
                height: 80px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 CoinFlip Duelo</h1>
        </div>

        <div class="players-container">
            <div class="player-card" id="playerA-card">
                <h3>Jugador A</h3>
                <p id="playerA-name">${playerAName}</p>
            </div>
            <div class="player-card" id="playerB-card">
                <h3>Jugador B</h3>
                <p id="playerB-name">${playerBName}</p>
            </div>
        </div>

        <div class="coin-section">
            <div id="coin">
                <div class="coin-face front"><span id="front-text">A</span></div>
                <div class="coin-face back"><span id="back-text">B</span></div>
            </div>
        </div>

        <div class="countdown" id="countdown">
            ⏰ <span id="countdown-value">15</span>s
        </div>

        <div class="result-section" id="result">
            <p id="status-message">${duelStatus === 'waiting' ? '🔄 Esperando que alguien se una al duelo...' : '⏰ Preparándose...'}</p>
        </div>

        <div class="history-section">
            <h3>📊 Información del Duelo</h3>
            <div class="history-item">💰 Apuesta: ${betAmount} puntos</div>
            <div class="history-item">🔄 Estado: ${getStatusText(duelStatus)}</div>
            <div class="history-item">🆔 ID: ${duel?._id || 'N/A'}</div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const socket = io();
        
        // Inicializar Telegram Web App
        tg.expand();
        tg.enableClosingConfirmation();
        tg.BackButton.show();
        tg.BackButton.onClick(() => {
            tg.close();
        });

        // Obtener ID del duelo desde la URL
        const urlParams = new URLSearchParams(window.location.search);
        const duelId = urlParams.get('duel');

        let countdownInterval;
        let currentDuel = null;

        // Función para obtener texto del estado
        function getStatusText(status) {
            const statusMap = {
                'waiting': '⏳ Esperando jugador',
                'countdown': '⏰ Countdown activo',
                'completed': '✅ Completado',
                'expired': '❌ Expirado'
            };
            return statusMap[status] || status;
        }

        // Conectar con el backend para updates en tiempo real
        async function loadDuelInfo() {
            if (!duelId) {
                document.getElementById('status-message').textContent = '❌ No se especificó ID de duelo';
                return;
            }

            try {
                const response = await fetch(\`https://${window.location.host}/duel-info/\${duelId}\`, {
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(\`Error HTTP: \${response.status}\`);
                }
                
                currentDuel = await response.json();
                updateUI(currentDuel);
                
                // Unirse a la sala WebSocket
                socket.emit('join-duel', duelId);
                
            } catch (error) {
                console.error('Error loading duel info:', error);
                document.getElementById('status-message').textContent = '❌ Error cargando información del duelo';
            }
        }

        function updateUI(duel) {
            if (!duel) return;

            // Actualizar jugadores
            document.getElementById('playerA-name').textContent = duel.playerA?.first_name || 'Desconocido';
            document.getElementById('playerB-name').textContent = duel.playerB?.first_name || 'Esperando...';
            
            // Actualizar estado de los jugadores
            if (duel.playerB) {
                document.getElementById('playerB-card').classList.add('active');
            }

            // Actualizar información del duelo
            document.querySelector('.history-item:nth-child(1)').textContent = \`💰 Apuesta: \${duel.betAmount} puntos\`;
            document.querySelector('.history-item:nth-child(2)').textContent = \`🔄 Estado: \${getStatusText(duel.status)}\`;

            // Manejar diferentes estados
            if (duel.status === 'countdown' && duel.countdownEnd) {
                startCountdown(duel.countdownEnd);
            } else if (duel.status === 'completed') {
                showResult(duel);
            }
        }

        function startCountdown(countdownEnd) {
            const countdownElement = document.getElementById('countdown');
            const countdownValue = document.getElementById('countdown-value');
            countdownElement.style.display = 'block';
            
            document.getElementById('status-message').textContent = '⏰ La moneda girará en...';

            function updateCountdown() {
                const now = new Date();
                const timeLeft = Math.max(0, new Date(countdownEnd) - now);
                const seconds = Math.ceil(timeLeft / 1000);
                
                countdownValue.textContent = seconds;
                
                if (seconds === 0) {
                    clearInterval(countdownInterval);
                    document.getElementById('coin').classList.add('flipping');
                    document.getElementById('status-message').textContent = '🎰 Girando moneda...';
                    
                    // Esperar a que termine la animación
                    setTimeout(() => {
                        loadDuelInfo(); // Recargar para ver el resultado
                    }, 2000);
                }
            }

            updateCountdown();
            countdownInterval = setInterval(updateCountdown, 1000);
        }

        function showResult(duel) {
            clearInterval(countdownInterval);
            document.getElementById('countdown').style.display = 'none';
            document.getElementById('coin').classList.add('flipping');
            
            const resultElement = document.getElementById('result');
            resultElement.innerHTML = \`
                <h3 class="winner">🎉 Ganador: \${duel.winner?.first_name || 'Desconocido'}</h3>
                <p>💰 Premio: \${duel.betAmount * 2} puntos</p>
                <p>🎯 Resultado: \${duel.winner === duel.playerA ? '🟡 Cara' : '⚫ Cruz'}</p>
            \`;
        }

        // Escuchar actualizaciones en tiempo real via WebSocket
        socket.on('duel-update', (duel) => {
            console.log('🔄 Actualización recibida via WebSocket');
            currentDuel = duel;
            updateUI(duel);
        });

        // Manejar errores de WebSocket
        socket.on('connect_error', (error) => {
            console.error('❌ Error de conexión WebSocket:', error);
            document.getElementById('status-message').textContent = '🔌 Reconectando...';
        });

        // Cargar información inicial
        document.addEventListener('DOMContentLoaded', () => {
            loadDuelInfo();
            
            // Polling para updates (fallback)
            setInterval(loadDuelInfo, 5000);
        });
    </script>
</body>
</html>`;

// Función auxiliar para obtener texto del estado
function getStatusText(status) {
    const statusMap = {
        'waiting': '⏳ Esperando jugador',
        'countdown': '⏰ Countdown activo',
        'completed': '✅ Completado',
        'expired': '❌ Expirado'
    };
    return statusMap[status] || status;
}
}