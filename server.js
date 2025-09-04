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
  
  // Eliminar el archivo de persistencia si existe
  if (fs.existsSync('current-duel.json')) {
    try {
      fs.unlinkSync('current-duel.json');
      console.log('🗑️ Archivo de duelo eliminado');
    } catch (error) {
      console.error('❌ Error eliminando archivo de duelo:', error);
    }
  }
  
  // Notificar a todos los clientes que el duelo ha terminado
  io.emit('duel-update', null);
  console.log('🔄 Estado del duelo reiniciado');
}

// Función para actualizar todos los clientes
function broadcastDuelUpdate(duel) {
  activeDuel = duel;
  
  // Guardar en archivo para persistencia solo si hay un duelo activo
  if (duel) {
    try {
      fs.writeFileSync('current-duel.json', JSON.stringify(duel, null, 2));
    } catch (error) {
      console.error('❌ Error guardando duelo en archivo:', error);
    }
  } else {
    clearActiveDuel();
  }
  
  io.emit('duel-update', duel);
}

// WebSocket para actualizaciones en tiempo real
io.on('connection', (socket) => {
  console.log('🔗 Cliente conectado a WebSocket');
  
  // Enviar el duelo activo inmediatamente al conectar
  if (activeDuel) {
    socket.emit('duel-update', activeDuel);
  } else {
    socket.emit('duel-update', null);
  }
  
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado');
  });
});

// API para obtener el duelo activo
app.get('/api/active-duel', async (req, res) => {
  try {
    // Si hay un duelo activo en memoria, devolverlo
    if (activeDuel) {
      return res.json(activeDuel);
    }
    
    // Si no hay en memoria, verificar si hay un archivo de duelo
    try {
      if (fs.existsSync('current-duel.json')) {
        const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
        
        // Verificar si el duelo ya expiró
        if (duelData.expiresAt && new Date(duelData.expiresAt) < new Date()) {
          console.log('🕒 Duelo expirado encontrado, limpiando...');
          clearActiveDuel();
          return res.json(null);
        }
        
        // Verificar si el duelo ya está completado
        if (duelData.status === 'completed') {
          console.log('✅ Duelo completado encontrado, limpiando...');
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
    
    // Si no hay duelo activo
    res.json(null);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo duelo activo' });
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
      // Limpiar duelos antiguos que puedan estar atascados
      if (activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
        console.log('🕒 Duelo expirado detectado, limpiando...');
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

// Manejar el comando /start
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

// Comando /pvp - CORREGIDO para reenviar mensaje de duelo activo
bot.onText(/\/pvp(?:\s+(\d+))?$/, async (msg, match) => {
  try {
    if (msg.chat.type === 'private') {
      return bot.sendMessage(msg.chat.id, 
        '❌ Este comando solo funciona en grupos. Únete a un grupo y usa /pvp allí.'
      );
    }
    
    if (activeDuel && activeDuel.status !== 'completed') {
      // Verificar si el duelo actual ya expiró
      if (activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
        console.log('🕒 Duelo expirado detectado, limpiando...');
        clearActiveDuel();
      } else {
        // Reenviar el mensaje del duelo activo en lugar de solo el mensaje de error
        try {
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
        } catch (error) {
          console.error('Error enviando mensaje de duelo activo:', error);
          await bot.sendMessage(msg.chat.id, 
            '❌ Ya hay un duelo en progreso. Espera a que termine para crear uno nuevo.',
            { reply_to_message_id: msg.message_id }
          );
        }
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

// Comando /points
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

// Comando /leaderboard - CORREGIDO
bot.onText(/\/leaderboard$/, async (msg) => {
  try {
    const User = require('./models/User');
    const leaderboard = await User.getLeaderboard(10);
    
    let message = '🏆 *Tabla de Clasificación* 🏆\n\n';
    
    leaderboard.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
      
      // Usar first_name, username o "Jugador" como fallback
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

// Comando /clear para administradores (debug)
bot.onText(/\/clear$/, (msg) => {
  // Verificar si el usuario es administrador o el propietario del bot
  const allowedUsers = [8032663431, 7617852266]; // Reemplaza con los IDs de usuarios permitidos
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
  
  // Limpiar cualquier duelo activo al iniciar el servidor
  clearActiveDuel();
  
  // Verificar si hay un duelo persistido y limpiarlo si es necesario
  try {
    if (fs.existsSync('current-duel.json')) {
      const duelData = JSON.parse(fs.readFileSync('current-duel.json', 'utf8'));
      
      // Verificar si el duelo ya expiró o está completado
      if ((duelData.expiresAt && new Date(duelData.expiresAt) < new Date()) || 
          duelData.status === 'completed') {
        console.log('🕒 Duelo persistido expirado/completado, limpiando...');
        clearActiveDuel();
      } else {
        console.log('✅ Duelo persistido cargado');
        activeDuel = duelData;
      }
    }
  } catch (error) {
    console.log('❌ Error cargando duelo persistido:', error);
    clearActiveDuel();
  }
});

// Función para limpiar duelos expirados periódicamente
setInterval(() => {
  if (activeDuel && activeDuel.expiresAt && new Date(activeDuel.expiresAt) < new Date()) {
    console.log('🕒 Limpiando duelo expirado automáticamente');
    clearActiveDuel();
  }
}, 60000); // Verificar cada minuto