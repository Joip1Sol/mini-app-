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
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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
  onlyFirstMatch: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

// Variables globales para el duelo activo
let activeDuel = null;
let duelTimeout = null;
let duelResults = new Map();

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

// Función para limpiar el duelo activo
function clearActiveDuel() {
  activeDuel = null;
  
  if (fs.existsSync('current-duel.json')) {
    try {
      fs.unlinkSync('current-duel.json');
      console.log('🗑️ Archivo de duelo eliminado');
    } catch (error) {
      console.error('❌ Error eliminando archivo de duelo:', error);
    }
  }
  
  io.emit('duel-update', null);
  console.log('🔄 Estado del duelo reiniciado');
}

// Función para determinar resultado del duelo
function determineDuelResult(duel) {
  if (!duel) return null;
  
  // Crear semilla determinística basada en el ID
  let seed = 0;
  for (let i = 0; i < duel._id.length; i++) {
    seed = (seed + duel._id.charCodeAt(i)) % 1000;
  }
  
  // Resultado basado en la semilla (0 = Cara/Jugador A, 1 = Cruz/Jugador B)
  const result = seed % 2;
  const winner = result === 0 ? duel.playerA : duel.playerB;
  const loser = result === 0 ? duel.playerB : duel.playerA;
  
  return {
    result,
    winner,
    loser,
    resultText: result === 0 ? 'heads' : 'tails',
    winnings: duel.betAmount * 2
  };
}

// Función para actualizar todos los clientes
function broadcastDuelUpdate(duel) {
  activeDuel = duel;
  
  if (duel) {
    try {
      fs.writeFileSync('current-duel.json', JSON.stringify(duel, null, 2));
    } catch (error) {
      console.error('❌ Error guardando duelo en archivo:', error);
    }
    
    // Precalcular resultado para consistencia
    if (duel.status === 'countdown' && !duelResults.has(duel._id)) {
      const result = determineDuelResult(duel);
      duelResults.set(duel._id, result);
    }
  } else {
    clearActiveDuel();
  }
  
  io.emit('duel-update', duel);
}

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
  
  if (activeDuel) {
    socket.emit('duel-update', activeDuel);
  }
  
  socket.on('request-duel-result', (duelId) => {
    const result = duelResults.get(duelId);
    if (result) {
      socket.emit('duel-result', { ...result, duelId });
    }
  });
  
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
      if (fs.existsSync('current-duel.json')) {
        const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
        
        if (duelData.expiresAt && new Date(duelData.expiresAt) < new Date()) {
          clearActiveDuel();
          return res.json(null);
        }
        
        if (duelData.status === 'completed') {
          clearActiveDuel();
          return res.json(null);
        }
        
        activeDuel = duelData;
        return res.json(activeDuel);
      }
    } catch (error) {
      console.log('❌ Error cargando duelo desde archivo:', error);
      clearActiveDuel();
    }
    
    res.json(null);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo duelo activo' });
  }
});

// API para obtener resultado del duelo
app.get('/api/duel-result/:duelId', async (req, res) => {
  try {
    const duelId = req.params.duelId;
    const result = duelResults.get(duelId);
    
    if (result) {
      res.json({ success: true, result: { ...result, duelId } });
    } else {
      res.json({ success: false, error: 'Resultado no disponible' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API para limpiar el duelo activo
app.post('/api/clear-duel', async (req, res) => {
  try {
    clearActiveDuel();
    res.json({ success: true, message: 'Duelo limpiado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error limpiando duelo' });
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
    activeDuel.countdownEnd = new Date(Date.now() + 10000);
    
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
      if (activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
        clearActiveDuel();
      } else {
        return res.status(400).json({ error: 'Ya hay un duelo en progreso' });
      }
    }

    const { userId, userName, userUsername, betAmount } = req.body;
    
    const user = { 
      telegramId: userId, 
      first_name: userName,
      username: userUsername
    };
    
    activeDuel = {
      _id: `duel_${uuidv4()}`,
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

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/mini-app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Comandos de Telegram
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
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

bot.onText(/\/pvp(?:\s+(\d+))?$/, async (msg, match) => {
  try {
    if (msg.chat.type === 'private') {
      return bot.sendMessage(msg.chat.id, 
        '❌ Este comando solo funciona en grupos. Únete a un grupo y usa /pvp allí.'
      );
    }
    
    if (activeDuel && activeDuel.status !== 'completed') {
      if (activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
        clearActiveDuel();
      } else {
        const replyMarkup = {
          inline_keyboard: [
            [{
              text: '✅ Unirse al Duelo',
              callback_data: `join_duel:${activeDuel._id}`
            }]
          ]
        };
        
        await bot.sendMessage(msg.chat.id, `
❌ *Ya hay un duelo en progreso* 🎮

👤 *Jugador A:* ${activeDuel.playerA.first_name || 'Jugador A'}${activeDuel.playerA.username ? ` (@${activeDuel.playerA.username})` : ''}
💰 *Apuesta:* ${activeDuel.betAmount} puntos
⏰ *Expira en:* ${Math.round((new Date(activeDuel.expiresAt) - new Date()) / 60000)} minutos

¡Presiona "Unirse al Duelo" para unirte al duelo existente!
        `.trim(), {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
          reply_to_message_id: msg.message_id
        });
        return;
      }
    }
    
    await handlePvpCommand(bot, msg, match, broadcastDuelUpdate);
  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo', 
      { reply_to_message_id: msg.message_id }
    );
  }
});

bot.onText(/\/points$/, (msg) => {
  if (msg.chat.type !== 'private') {
    const botUsername = process.env.BOT_USERNAME || 'tu_bot';
    return bot.sendMessage(msg.chat.id, 
      `Para ver tus puntos, por favor escribe /points en mi chat privado: @${botUsername}`,
      { reply_to_message_id: msg.message_id }
    );
  }
  handlePointsCommand(bot, msg);
});

bot.onText(/\/leaderboard$/, async (msg) => {
  try {
    const User = require('./models/User');
    const leaderboard = await User.getLeaderboard(10);
    
    let message = '🏆 *Tabla de Clasificación* 🏆\n\n';
    
    leaderboard.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
      const userName = user.first_name || user.username || 'Jugador';
      message += `${medal} ${index + 1}. ${userName} - ${user.points} puntos\n`;
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

bot.onText(/\/clear$/, (msg) => {
  const allowedUsers = [8032663431, 7617852266];
  if (allowedUsers.includes(msg.from.id)) {
    clearActiveDuel();
    bot.sendMessage(msg.chat.id, '✅ Duelo activo limpiado correctamente',
      { reply_to_message_id: msg.message_id }
    );
  } else {
    bot.sendMessage(msg.chat.id, '❌ No tienes permisos para usar este comando',
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
  
  clearActiveDuel();
  
  try {
    if (fs.existsSync('current-duel.json')) {
      const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
      
      if ((duelData.expiresAt && new Date(duelData.expiresAt) < new Date()) || 
          duelData.status === 'completed') {
        clearActiveDuel();
      } else {
        activeDuel = duelData;
      }
    }
  } catch (error) {
    console.log('❌ Error cargando duelo persistido:', error);
    clearActiveDuel();
  }
});

// Limpiar duelos expirados periódicamente
setInterval(() => {
  if (activeDuel && activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
    console.log('🕒 Limpiando duelo expirado automáticamente');
    clearActiveDuel();
  }
}, 5000);

// Exportar funciones para uso global
global.clearActiveDuel = clearActiveDuel;
global.duelResults = duelResults;