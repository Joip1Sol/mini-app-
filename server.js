require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { connectDB } = require('./config/database');
const { handlePvpCommand, handleJoinDuel } = require('./handlers/commandHandler');
const User = require('./models/User');
const Duel = require('./models/Duel');

const app = express();
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

// Ruta principal para la MiniApp
app.get('/', async (req, res) => {
  const duelId = req.query.duel;
  
  if (duelId) {
    try {
      const duel = await Duel.findActiveDuel(duelId);
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
bot.onText(/\/start/, async (msg) => {
  const user = await User.findOrCreate(msg.from);
  
  const keyboard = {
    inline_keyboard: [[{
      text: '🎮 Crear Duelo (/pvp)',
      callback_data: 'create_duel'
    }]]
  };

  bot.sendMessage(msg.chat.id, `
¡Hola ${user.firstName}! 👋

🎯 *CoinFlip Bot* - Sistema de duelos por puntos

✨ *Comandos disponibles:*
/pvp [cantidad] - Crear duelo con apuesta
/points - Ver tus puntos y estadísticas
/leaderboard - Tabla de clasificación

*Tu información:*
💰 Puntos: ${user.points}
🏆 Victorias: ${user.duelsWon}
💔 Derrotas: ${user.duelsLost}
🎯 Ganancias totales: ${user.totalWinnings} puntos
  `.trim(), {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

bot.onText(/\/pvp(?:\s+(\d+))?/, (msg, match) => {
  handlePvpCommand(bot, msg, match);
});

bot.onText(/\/points/, async (msg) => {
  const user = await User.findOrCreate(msg.from);
  
  bot.sendMessage(msg.chat.id, `
📊 *Tus Estadísticas*

👤 ${user.firstName}${user.username ? ` (@${user.username})` : ''}
💰 Puntos: ${user.points}
🏆 Victorias: ${user.duelsWon}
💔 Derrotas: ${user.duelsLost}
🎯 Ganancias totales: ${user.totalWinnings} puntos
  `.trim(), { parse_mode: 'Markdown' });
});

bot.onText(/\/leaderboard/, async (msg) => {
  const leaderboard = await User.getLeaderboard(10);
  
  let message = '🏆 *Tabla de Clasificación* 🏆\n\n';
  
  leaderboard.forEach((user, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
    message += `${medal} ${index + 1}. ${user.firstName} - ${user.points} puntos\n`;
  });
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// Manejar callbacks
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (data.startsWith('join_duel_')) {
    const duelId = data.split('_')[2];
    handleJoinDuel(bot, callbackQuery, duelId);
  }
  
  else if (data === 'create_duel') {
    bot.sendMessage(callbackQuery.message.chat.id, 'Usa /pvp [cantidad] para crear un duelo. Ejemplo: /pvp 25');
  }
});

// Iniciar servidor
app.listen(PORT, () => {
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
    <style>
        /* Estilos igual que tu index.html pero adaptados para MiniApp */
        :root {
            --tg-theme-bg-color: #ffffff;
            --tg-theme-text-color: #222222;
            --tg-theme-button-color: #40a7e3;
            --tg-theme-button-text-color: #ffffff;
            --primary-color: #4a6fa5;
            --secondary-color: #6e9887;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --tg-theme-bg-color: #212121;
                --tg-theme-text-color: #ffffff;
            }
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--tg-theme-bg-color);
            color: var(--tg-theme-text-color);
            padding: 16px;
            margin: 0;
        }

        .container {
            max-width: 100%;
        }

        .players {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .player {
            flex: 1;
            text-align: center;
            padding: 15px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: 12px;
        }

        .coin-container {
            perspective: 1000px;
            width: 150px;
            height: 150px;
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
            background: linear-gradient(145deg, #d4d4d4, #f4f4f4);
            border: 4px solid #c4b16b;
        }

        .front { z-index: 2; }
        .back { transform: rotateY(180deg); }

        .history {
            margin-top: 20px;
            padding: 15px;
            background: var(--tg-theme-secondary-bg-color);
            border-radius: 12px;
        }

        @keyframes flip {
            0% { transform: rotateY(0); }
            100% { transform: rotateY(1800deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 CoinFlip Duelo</h1>
        
        <div class="players">
            <div class="player" id="playerA">
                <h3>Jugador A</h3>
                <p>${duel ? duel.playerA.firstName : 'Esperando...'}</p>
            </div>
            <div class="player" id="playerB">
                <h3>Jugador B</h3>
                <p>${duel && duel.playerB ? duel.playerB.firstName : 'Esperando...'}</p>
            </div>
        </div>

        <div class="coin-container">
            <div id="coin">
                <div class="coin-face front"><span>${duel ? duel.playerA.firstName.charAt(0) : 'A'}</span></div>
                <div class="coin-face back"><span>${duel && duel.playerB ? duel.playerB.firstName.charAt(0) : 'B'}</span></div>
            </div>
        </div>

        <div class="history">
            <h3>📊 Últimos Resultados</h3>
            <div id="history"></div>
        </div>
    </div>

    <script>
        const tg = window.Telegram.WebApp;
        tg.expand();
        
        // Aquí iría la lógica para actualizar la MiniApp en tiempo real
        // cuando el duelo se complete
    </script>
</body>
</html>`;
}