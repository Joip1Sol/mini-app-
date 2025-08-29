require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { connectDB } = require('./config/database');
const { handlePvpCommand, handleJoinDuel } = require('./handlers/commandHandler');
const User = require('./models/User');
const Duel = require('./models/Duel');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Configurar bot de Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Conectar a la base de datos
connectDB().then(() => {
  console.log('✅ Base de datos conectada');
});

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
  
  socket.on('join-duel', (duelId) => {
    socket.join(duelId);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado');
  });
});

// Rutas API
app.get('/duel-info/:duelId', async (req, res) => {
  try {
    const duel = await Duel.getDuelById(req.params.duelId);
    res.json(duel);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo información del duelo' });
  }
});

app.get('/', async (req, res) => {
  const duelId = req.query.duel;
  
  if (duelId) {
    try {
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
bot.onText(/\/pvp(?:\s+(\d+))?/, (msg, match) => {
  handlePvpCommand(bot, msg, match);
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data === 'join_duel') {
    handleJoinDuel(bot, callbackQuery);
  }
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`🤖 Bot de Telegram iniciado`);
});

// Función para generar HTML de la MiniApp
function generateMiniAppHTML(duel = null) {
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
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 20px;
        }

        .players-container {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }

        .player-card {
            flex: 1;
            background: var(--tg-theme-secondary-bg-color);
            padding: 15px;
            border-radius: var(--border-radius);
            text-align: center;
            transition: all 0.3s ease;
        }

        .player-card.active {
            background: var(--tg-theme-button-color);
            color: var(--tg-theme-button-text-color);
        }

        .coin-section {
            perspective: 1000px;
            width: 120px;
            height: 120px;
            margin: 0 auto 20px;
        }

        #coin {
            width: 100%;
            height: 100%;
            position: relative;
            transform-style: preserve-3d;
            transition: transform 2s ease-out;
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
            background: linear-gradient(145deg, #d4d4d4, #f4f4f4);
            border: 3px solid #c4b16b;
        }

        .front { z-index: 2; }
        .back { transform: rotateY(180deg); }

        .countdown {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            margin: 20px 0;
            color: var(--tg-theme-button-color);
        }

        .result-section {
            text-align: center;
            margin: 20px 0;
            padding: 15px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: var(--border-radius);
        }

        .history-section {
            margin-top: 20px;
        }

        .history-item {
            padding: 10px;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            font-size: 14px;
        }

        @keyframes flip {
            0% { transform: rotateY(0); }
            100% { transform: rotateY(1800deg); }
        }

        .winner {
            animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
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
                <p id="playerA-name">Cargando...</p>
            </div>
            <div class="player-card" id="playerB-card">
                <h3>Jugador B</h3>
                <p id="playerB-name">Esperando...</p>
            </div>
        </div>

        <div class="coin-section">
            <div id="coin">
                <div class="coin-face front"><span id="front-text">A</span></div>
                <div class="coin-face back"><span id="back-text">B</span></div>
            </div>
        </div>

        <div class="countdown" id="countdown" style="display: none;">
            ⏰ <span id="countdown-value">15</span>s
        </div>

        <div class="result-section" id="result">
            <p>🔄 Esperando que alguien se una al duelo...</p>
        </div>

        <div class="history-section">
            <h3>📊 Historial</h3>
            <div id="history-items"></div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        const socket = io();
        
        tg.expand();
        tg.enableClosingConfirmation();

        // Obtener ID del duelo desde la URL
        const urlParams = new URLSearchParams(window.location.search);
        const duelId = urlParams.get('duel');

        let countdownInterval;
        let currentDuel = null;

        // Conectar con el backend para updates en tiempo real
        async function loadDuelInfo() {
            if (!duelId) return;

            try {
                const response = await fetch(\`/duel-info/\${duelId}\`);
                currentDuel = await response.json();
                updateUI(currentDuel);
                
                // Unirse a la sala WebSocket
                socket.emit('join-duel', duelId);
                
            } catch (error) {
                console.error('Error loading duel info:', error);
            }
        }

        function updateUI(duel) {
            // Actualizar jugadores
            document.getElementById('playerA-name').textContent = 
                duel.playerA?.first_name || 'Cargando...';
            
            if (duel.playerB) {
                document.getElementById('playerB-name').textContent = 
                    duel.playerB.first_name;
                document.getElementById('playerB-card').classList.add('active');
            }

            // Manejar diferentes estados
            if (duel.status === 'countdown') {
                startCountdown(duel.countdownEnd);
            } else if (duel.status === 'completed') {
                showResult(duel);
            }
        }

        function startCountdown(countdownEnd) {
            const countdownElement = document.getElementById('countdown');
            const countdownValue = document.getElementById('countdown-value');
            countdownElement.style.display = 'block';
            
            document.getElementById('result').innerHTML = 
                '<p>⏰ La moneda girará en...</p>';

            function updateCountdown() {
                const now = new Date();
                const timeLeft = Math.max(0, countdownEnd - now);
                const seconds = Math.ceil(timeLeft / 1000);
                
                countdownValue.textContent = seconds;
                
                if (seconds === 0) {
                    clearInterval(countdownInterval);
                    document.getElementById('coin').style.animation = 'flip 2s ease-out forwards';
                    
                    // Esperar a que termine la animación y mostrar resultado
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
            
            const resultElement = document.getElementById('result');
            resultElement.innerHTML = \`
                <h3 class="winner">🎉 Ganador: \${duel.winner.first_name}</h3>
                <p>💰 Premio: \${duel.betAmount * 2} puntos</p>
                <p>🎯 Resultado: \${duel.winner === duel.playerA ? '🟡 Cara' : '⚫ Cruz'}</p>
            \`;
        }

        // Escuchar actualizaciones en tiempo real via WebSocket
        socket.on('duel-update', (duel) => {
            currentDuel = duel;
            updateUI(duel);
        });

        // Cargar información inicial
        loadDuelInfo();
        
        // Polling para updates (fallback)
        setInterval(loadDuelInfo, 3000);
    </script>
</body>
</html>`;
}