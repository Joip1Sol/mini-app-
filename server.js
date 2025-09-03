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
    
    // Simular la unión al duelo
    const user = { telegramId: userId, first_name: userName };
    
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
  if (deepLinkParam && deepLinkParam.startsWith('duel_')) {
    const duelId = deepLinkParam.replace('duel_', '');
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
      message += `${medal} ${index + 1}. ${user.first_name || 'Usuario'} - ${user.points} puntos\n`;
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
  
  if (data.startsWith('join_duel:')) {
    try {
      await handleJoinDuel(bot, callbackQuery, broadcastDuelUpdate);
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CoinFlip Duelo</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        /* Estilos CSS aquí */
    </style>
</head>
<body>
    <div class="container">
        <!-- Interfaz de usuario aquí -->
    </div>

    <script>
        // Código JavaScript aquí
    </script>
</body>
</html>`;
}