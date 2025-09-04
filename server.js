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
app.use(express.static('public')); // Servir archivos estáticos desde la carpeta public

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
  
  // También guardar en archivo para persistencia
  if (duel) {
    const fs = require('fs');
    fs.writeFileSync('current-duel.json', JSON.stringify(duel, null, 2));
  }
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
    // Primero intentar obtener de memoria
    if (activeDuel) {
      return res.json(activeDuel);
    }
    
    // Si no hay en memoria, intentar cargar desde archivo
    try {
      const fs = require('fs');
      if (fs.existsSync('current-duel.json')) {
        const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
        activeDuel = duelData;
        return res.json(activeDuel);
      }
    } catch (error) {
      console.log('No se pudo cargar duelo desde archivo');
    }
    
    // Si no hay duelo activo
    res.json(null);
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

    const { userId, userName, userUsername } = req.body;
    
    // Verificar si el usuario ya está en el duelo
    if (activeDuel.playerA && activeDuel.playerA.telegramId === userId) {
      return res.status(400).json({ error: 'Ya eres el jugador A en este duelo' });
    }
    
    if (activeDuel.playerB && activeDuel.playerB.telegramId === userId) {
      return res.status(400).json({ error: 'Ya eres el jugador B en este duelo' });
    }

    // Simular la unión al duelo
    const user = { 
      telegramId: userId, 
      first_name: userName,
      username: userUsername
    };
    
    // Actualizar el duelo activo
    activeDuel.playerB = user;
    activeDuel.status = 'countdown';
    
    // Configurar tiempo de expiración del countdown
    activeDuel.countdownEnd = new Date(Date.now() + 15000);
    
    // Notificar a todos los clientes
    broadcastDuelUpdate(activeDuel);
    
    res.json({ success: true, duel: activeDuel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API para crear un nuevo duelo
app.post('/api/create-duel', async (req, res) => {
  try {
    if (activeDuel && activeDuel.status !== 'completed') {
      return res.status(400).json({ error: 'Ya hay un duelo en progreso' });
    }

    const { userId, userName, userUsername, betAmount } = req.body;
    
    const user = { 
      telegramId: userId, 
      first_name: userName,
      username: userUsername
    };
    
    // Crear nuevo duelo
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
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutos
      countdownStart: null,
      countdownEnd: null
    };
    
    // Notificar a todos los clientes
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

// Ruta principal - Usa tu index.html existente
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Nueva ruta para el mini app
app.get('/mini-app', (req, res) => {
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
    // Si ya hay un duelo activo, no permitir crear otro
    if (activeDuel && activeDuel.status !== 'completed') {
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
  console.log(`📱 Mini App disponible en: http://localhost:${PORT}/mini-app`);
  
  // Cargar duelo activo desde archivo al iniciar
  try {
    const fs = require('fs');
    if (fs.existsSync('current-duel.json')) {
      const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
      activeDuel = duelData;
      console.log('✅ Duelo activo cargado desde archivo');
    }
  } catch (error) {
    console.log('ℹ️ No se encontró duelo activo para cargar');
  }
});