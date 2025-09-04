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

// Configurar bot de Telegram - Usar polling en Render
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
  polling: true,
  onlyFirstMatch: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4 // Usar IPv4 para evitar problemas en Render
    }
  }
});

// Variables globales para el duelo activo
let activeDuel = null;
let duelTimeout = null;

// Middleware
app.use(express.json());
app.use(express.static('public'));

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
    if (activeDuel) {
      return res.json(activeDuel);
    }
    
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
    
    if (activeDuel.playerA && activeDuel.playerA.telegramId === userId) {
      return res.status(400).json({ error: 'Ya eres el jugador A en este duelo' });
    }
    
    if (activeDuel.playerB && activeDuel.playerB.telegramId === userId) {
      return res.status(400).json({ error: 'Ya eres el jugador B en este duelo' });
    }

    const user = { 
      telegramId: userId, 
      first_name: userName,
      username: userUsername
    };
    
    activeDuel.playerB = user;
    activeDuel.status = 'countdown';
    activeDuel.countdownEnd = new Date(Date.now() + 15000);
    
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

// Ruta para el mini app
app.get('/mini-app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejar el comando /start - SOLUCIÓN PARA GRUPOS
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  // En grupos, el comando /start no funciona igual que en chats privados
  // Verificar si es un grupo y redirigir al chat privado
  if (msg.chat.type !== 'private') {
    const botUsername = process.env.BOT_USERNAME || 'tu_bot';
    return bot.sendMessage(msg.chat.id, 
      `¡Hola! Para usar este bot, por favor inicia una conversación privada conmigo: @${botUsername}\n\nLuego podrás usar los comandos en este grupo.`,
      { reply_to_message_id: msg.message_id }
    );
  }
  
  const deepLinkParam = match && match[1];
  if (deepLinkParam && deepLinkParam.startsWith('duel_')) {
    const duelId = deepLinkParam.replace('duel_', '');
    handleDeepLinkJoin(bot, msg, duelId);
  } else {
    handleStartCommand(bot, msg);
  }
});

// Comando /pvp - SOLUCIÓN PARA GRUPOS
bot.onText(/\/pvp(?:\s+(\d+))?$/, async (msg, match) => {
  try {
    // Verificar si es un grupo
    if (msg.chat.type === 'private') {
      return bot.sendMessage(msg.chat.id, 
        '❌ Este comando solo funciona en grupos. Únete a un grupo y usa /pvp allí.'
      );
    }
    
    // Si ya hay un duelo activo, no permitir crear otro
    if (activeDuel && activeDuel.status !== 'completed') {
      return bot.sendMessage(msg.chat.id, 
        '❌ Ya hay un duelo en progreso. Espera a que termine para crear uno nuevo.',
        { reply_to_message_id: msg.message_id }
      );
    }
    
    await handlePvpCommand(bot, msg, match, broadcastDuelUpdate);
  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo', 
      { reply_to_message_id: msg.message_id }
    );
  }
});

// Comando /points - SOLUCIÓN PARA GRUPOS
bot.onText(/\/points$/, (msg) => {
  // En grupos, redirigir al chat privado
  if (msg.chat.type !== 'private') {
    const botUsername = process.env.BOT_USERNAME || 'tu_bot';
    return bot.sendMessage(msg.chat.id, 
      `Para ver tus puntos, por favor escribe /points en mi chat privado: @${botUsername}`,
      { reply_to_message_id: msg.message_id }
    );
  }
  handlePointsCommand(bot, msg);
});

// Comando /leaderboard - SOLUCIÓN PARA GRUPOS
bot.onText(/\/leaderboard$/, async (msg) => {
  try {
    const User = require('./models/User');
    const leaderboard = await User.getLeaderboard(10);
    
    let message = '🏆 *Tabla de Clasificación* 🏆\n\n';
    
    leaderboard.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
      message += `${medal} ${index + 1}. ${user.first_name || 'Usuario'} - ${user.points} puntos\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, { 
      parse_mode: 'Markdown',
      reply_to_message_id: msg.message_id 
    });
  } catch (error) {
    console.error('Error en /leaderboard:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al cargar la tabla de clasificación',
      { reply_to_message_id: msg.message_id }
    );
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