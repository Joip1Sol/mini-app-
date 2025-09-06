const User = require('../models/User');
const Duel = require('../models/Duel');

// Handler para el comando /start
async function handleStartCommand(bot, msg) {
  try {
    const user = await User.findOrCreate(msg.from);
    
    const webAppUrl = process.env.WEB_APP_URL;
    
    const welcomeMessage = `
🎮 *Bienvenido a CoinFlip Duel* 🎮

¡Desafia a tus amigos a un duelo de cara o cruz y gana puntos!

*Comandos disponibles:*
/pvp [cantidad] - Crear un nuevo duelo (solo en grupos)
/points - Ver tus puntos
/leaderboard - Ver tabla de clasificación

*Tu información:*
👤 Nombre: ${user.first_name || 'Usuario'}
💰 Puntos: ${user.points}
    `.trim();

    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Ver Duelos Activos',
          url: webAppUrl
        }],
        [{
          text: '📊 Ver Mi Puntuación',
          callback_data: 'show_points'
        }]
      ]
    };

    await bot.sendMessage(msg.chat.id, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  } catch (error) {
    console.error('Error en start command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al procesar el comando');
  }
}

// Handler para el comando /points
async function handlePointsCommand(bot, msg) {
  try {
    const user = await User.findOrCreate(msg.from);
    
    await bot.sendMessage(msg.chat.id, 
      `💰 *Tus puntos:* ${user.points}\n\n¡Sigue jugando para ganar más! 🎯`, 
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error en points command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al obtener tus puntos');
  }
}

// Handler para el comando /pvp
async function handlePvpCommand(bot, msg, match, broadcastDuelUpdate) {
  try {
    const user = await User.findOrCreate(msg.from);
    const betAmount = match[1] ? parseInt(match[1]) : 10;

    if (betAmount < 1) {
      return await bot.sendMessage(msg.chat.id, '❌ La apuesta debe ser al menos 1 punto',
        { reply_to_message_id: msg.message_id }
      );
    }

    if (user.points < betAmount) {
      return await bot.sendMessage(msg.chat.id, 
        `❌ No tienes suficientes puntos. Tienes: ${user.points}, Necesitas: ${betAmount}`,
        { reply_to_message_id: msg.message_id }
      );
    }

    const duel = await Duel.createDuel({
      playerA: user,
      betAmount: betAmount,
      chatId: msg.chat.id,
      messageId: null
    });

    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '✅ Unirse al Duelo',
          callback_data: `join_duel:${duel._id.toString()}`
        }]
      ]
    };

    const playerName = user.first_name || 'Jugador';
    const usernameText = user.username ? ` (@${user.username})` : '';

    const message = await bot.sendMessage(msg.chat.id, `
🎮 *Nuevo Duelo Creado* 🎮

👤 *Jugador A:* ${playerName}${usernameText}
💰 *Apuesta:* ${betAmount} puntos
⏰ *Expira en:* 2 minutos

¡Presiona "Unirse al Duelo" para desafiar a ${playerName}!
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    await Duel.updateMessageId(duel._id.toString(), message.message_id);

    if (broadcastDuelUpdate) {
      const updatedDuel = await Duel.getDuelById(duel._id.toString());
      broadcastDuelUpdate(updatedDuel);
    }

    setTimeout(async () => {
      const currentDuel = await Duel.getDuelById(duel._id.toString());
      if (currentDuel && currentDuel.status === 'waiting') {
        await Duel.cancelDuel(duel._id.toString());
        await bot.editMessageText('❌ *Duelo expirado* - Nadie se unió al duelo', {
          chat_id: msg.chat.id,
          message_id: message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] }
        });

        if (broadcastDuelUpdate) {
          broadcastDuelUpdate(null);
        }
      }
    }, 2 * 60 * 1000);

  } catch (error) {
    console.error('Error en pvp command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo',
      { reply_to_message_id: msg.message_id }
    );
  }
}

// Handler para deep links (start con parámetros)
async function handleDeepLinkJoin(bot, msg, duelId) {
  try {
    const user = await User.findOrCreate(msg.from);
    const duel = await Duel.getDuelById(duelId);

    if (!duel) {
      return await bot.sendMessage(msg.chat.id, '❌ Duelo no encontrado');
    }

    if (duel.status !== 'waiting') {
      return await bot.sendMessage(msg.chat.id, '❌ Este duelo ya no está disponible');
    }

    if (duel.playerA.telegramId === user.telegramId) {
      return await bot.sendMessage(msg.chat.id, '❌ No puedes unirte a tu propio duelo');
    }

    if (user.points < duel.betAmount) {
      return await bot.sendMessage(msg.chat.id, 
        `❌ No tienes suficientes puntos. Necesitas: ${duel.betAmount}, Tienes: ${user.points}`
      );
    }

    const updatedDuel = await Duel.joinDuel(duelId, user);
    
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Míralo aquí',
          url: 'https://t.me/IMPRENTA_ROBOT/CoinFlip'
        }]
      ]
    };

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${duel.playerA.first_name || 'Jugador A'}${duel.playerA.username ? ` (@${duel.playerA.username})` : ''}
👤 *Jugador B:* ${user.first_name || 'Jugador B'}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${duel.betAmount} puntos

⏰ *La moneda girará en 10 segundos...*
    `.trim(), {
      chat_id: duel.chatId,
      message_id: duel.messageId,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    await bot.sendMessage(msg.chat.id, '✅ Te has unido al duelo exitosamente!');

    // Notificar al servidor para que inicie el countdown
    if (typeof global.io !== 'undefined') {
      global.io.emit('duel-joined', { duelId });
    }

  } catch (error) {
    console.error('Error en deep link join:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al unirse al duelo');
  }
}

// Handler para callback de unirse al duelo
async function handleJoinDuel(bot, callbackQuery, broadcastDuelUpdate) {
  try {
    const user = await User.findOrCreate(callbackQuery.from);
    const message = callbackQuery.message;
    
    const duelId = callbackQuery.data.split(':')[1];
    const duel = await Duel.getDuelById(duelId);

    if (!duel) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Duelo no encontrado',
        show_alert: true
      });
    }

    if (duel.status !== 'waiting') {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Este duelo ya no está disponible',
        show_alert: true
      });
    }

    if (duel.playerA.telegramId === user.telegramId) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ No puedes unirte a tu propio duelo',
        show_alert: true
      });
    }

    if (user.points < duel.betAmount) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: `❌ No tienes suficientes puntos (Necesitas: ${duel.betAmount})`,
        show_alert: true
      });
    }

    const updatedDuel = await Duel.joinDuel(duelId, user);
    
    if (broadcastDuelUpdate) {
      broadcastDuelUpdate(updatedDuel);
    }
    
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Míralo aquí',
          url: 'https://t.me/IMPRENTA_ROBOT/CoinFlip'
        }]
      ]
    };

    const playerAName = duel.playerA.first_name || 'Jugador A';
    const playerBName = user.first_name || 'Jugador B';
    const playerAUsername = duel.playerA.username ? ` (@${duel.playerA.username})` : '';
    const playerBUsername = user.username ? ` (@${user.username})` : '';

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${playerAName}${playerAUsername}
👤 *Jugador B:* ${playerBName}${playerBUsername}
💰 *Apuesta:* ${duel.betAmount} puntos

⏰ *La moneda girará en 10 segundos...*
    `.trim(), {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '✅ Te has unido al duelo!'
    });

    // Notificar al servidor para que inicie el countdown
    if (typeof global.io !== 'undefined') {
      global.io.emit('duel-joined', { duelId });
    }

  } catch (error) {
    console.error('Error uniéndose al duelo:', error);
    bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Error al unirse al duelo',
      show_alert: true
    });
  }
}

module.exports = { 
  handleStartCommand, 
  handlePointsCommand, 
  handlePvpCommand, 
  handleJoinDuel, 
  handleDeepLinkJoin
};