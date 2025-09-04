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
    origin: process.env.WEB_URL || "*",
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
app.use(express.static(path.join(__dirname, 'public')));

// Configurar CORS
app.use((req, res, next) => {
  const allowedOrigins = [
    process.env.WEB_URL,
    'https://telegram.org',
    'https://web.telegram.org',
    'http://localhost:3000'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Conectar a la base de datos
connectDB().then(() => {
  console.log('✅ Base de datos conectada');
}).catch(error => {
  console.error('❌ Error conectando a MongoDB:', error);
});

// Variables globales para el duelo activo
let activeDuel = null;

// Función para actualizar todos los clientes
function broadcastDuelUpdate(duel) {
  activeDuel = duel;
  io.emit('duel-update', duel);
}

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
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
    res.json(activeDuel || null);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo duelo activo' });
  }
});

// API para crear un nuevo duelo (para Telegram)
app.post('/api/telegram/create-duel', async (req, res) => {
  try {
    const { userId, userName, userUsername, betAmount } = req.body;
    
    if (activeDuel && activeDuel.status !== 'completed') {
      return res.status(400).json({ error: 'Ya hay un duelo en progreso' });
    }
    
    const user = { 
      telegramId: userId, 
      first_name: userName, 
      username: userUsername 
    };
    
    activeDuel = {
      _id: 'duel_' + Date.now(),
      playerA: user,
      playerB: null,
      betAmount: betAmount || 10,
      status: 'waiting',
      winner: null,
      loser: null,
      chatId: null,
      messageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      countdownStart: null,
      countdownEnd: null
    };
    
    broadcastDuelUpdate(activeDuel);
    res.json({ success: true, duel: activeDuel });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API para unirse a un duelo (para Telegram)
app.post('/api/telegram/join-duel', async (req, res) => {
  try {
    const { userId, userName, userUsername } = req.body;
    
    if (!activeDuel || activeDuel.status !== 'waiting') {
      return res.status(400).json({ error: 'No hay duelos disponibles' });
    }
    
    if (activeDuel.playerA.telegramId === userId) {
      return res.status(400).json({ error: 'No puedes unirte a tu propio duelo' });
    }
    
    const user = { 
      telegramId: userId, 
      first_name: userName, 
      username: userUsername 
    };
    
    activeDuel.playerB = user;
    activeDuel.status = 'countdown';
    activeDuel.countdownStart = new Date();
    activeDuel.countdownEnd = new Date(Date.now() + 15000);
    
    broadcastDuelUpdate(activeDuel);
    res.json({ success: true, duel: activeDuel });
    
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

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    if (activeDuel && activeDuel.status !== 'completed') {
      return bot.sendMessage(msg.chat.id, 
        '❌ Ya hay un duelo en progreso. Espera a que termine.'
      );
    }
    await handlePvpCommand(bot, msg, match, broadcastDuelUpdate);
  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo');
  }
});

bot.onText(/\/points$/, (msg) => handlePointsCommand(bot, msg));

bot.onText(/\/leaderboard$/, async (msg) => {
  try {
    const User = require('./models/user');
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

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  if (data.startsWith('join_duel:')) {
    await handleJoinDuel(bot, callbackQuery, broadcastDuelUpdate);
  }
});

bot.on('error', (error) => {
  console.error('❌ Error del bot de Telegram:', error);
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`🤖 Bot de Telegram iniciado`);
  console.log(`🌐 Web URL: ${process.env.WEB_URL || 'No configurada'}`);
});