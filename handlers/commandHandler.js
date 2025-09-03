const User = require('../models/User');
const Duel = require('../models/Duel');

// Handler para el comando /start
async function handleStartCommand(bot, msg) {
  try {
    const user = await User.findOrCreate(msg.from);
    
    const welcomeMessage = `
🎮 *Bienvenido a CoinFlip Duel* 🎮

¡Desafia a tus amigos a un duelo de cara o cruz y gana puntos!

*Comandos disponibles:*
/pvp [cantidad] - Crear un nuevo duelo
/points - Ver tus puntos
/leaderboard - Ver tabla de clasificación

*Tu información:*
👤 Nombre: ${user.first_name}
💰 Puntos: ${user.points}
    `.trim();

    await bot.sendMessage(msg.chat.id, welcomeMessage, {
      parse_mode: 'Markdown'
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

    // Validaciones
    if (betAmount < 1) {
      return await bot.sendMessage(msg.chat.id, '❌ La apuesta debe ser al menos 1 punto');
    }

    if (user.points < betAmount) {
      return await bot.sendMessage(msg.chat.id, 
        `❌ No tienes suficientes puntos. Tienes: ${user.points}, Necesitas: ${betAmount}`
      );
    }

    // Crear duelo
    const duel = await Duel.createDuel({
      playerA: user,
      betAmount: betAmount,
      chatId: msg.chat.id,
      messageId: null // Se actualizará después
    });

    // ✅ CORRECCIÓN: Codificar correctamente la URL para el botón web_app
    const webAppUrl = `https://mini-app-jr7n.onrender.com?duel=${encodeURIComponent(duel._id.toString())}`;
    
    // ✅ CORRECCIÓN: Formato correcto para el botón web_app
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '✅ Unirse al Duelo',
          callback_data: 'join_duel'
        }],
        [{
          text: '🎮 Ver en MiniApp',
          web_app: { url: webAppUrl }
        }]
      ]
    };

    const message = await bot.sendMessage(msg.chat.id, `
🎮 *Nuevo Duelo Creado* 🎮

👤 *Jugador A:* ${user.first_name}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${betAmount} puntos
⏰ *Expira en:* 2 minutos

¡Presiona "Unirse al Duelo" para desafiar a ${user.first_name}!
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    // Actualizar el duelo con el messageId
    await Duel.updateMessageId(duel._id.toString(), message.message_id);

    // Notificar a todos los clientes conectados
    if (broadcastDuelUpdate) {
      const updatedDuel = await Duel.getDuelById(duel._id.toString());
      broadcastDuelUpdate(updatedDuel);
    }

    // Configurar expiración después de 2 minutos
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

        // Notificar a todos los clientes conectados
        if (broadcastDuelUpdate) {
          broadcastDuelUpdate(null);
        }
      }
    }, 2 * 60 * 1000);

  } catch (error) {
    console.error('Error en pvp command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo');
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

    // Unirse al duelo
    const updatedDuel = await Duel.joinDuel(duelId, user);
    
    // ✅ CORRECCIÓN: Codificar correctamente la URL para el botón web_app
    const webAppUrl = `https://mini-app-jr7n.onrender.com?duel=${encodeURIComponent(duelId)}`;
    
    // ✅ CORRECCIÓN: Formato correcto para el botón web_app
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Ver en MiniApp',
          web_app: { url: webAppUrl }
        }]
      ]
    };

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${duel.playerA.first_name}${duel.playerA.username ? ` (@${duel.playerA.username})` : ''}
👤 *Jugador B:* ${user.first_name}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${duel.betAmount} puntos

⏰ *La moneda girará en 15 segundos...*

[Ver animación en MiniApp](${webAppUrl})
    `.trim(), {
      chat_id: duel.chatId,
      message_id: duel.messageId,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    await bot.sendMessage(msg.chat.id, '✅ Te has unido al duelo exitosamente!');

    // Iniciar countdown de 15 segundos
    setTimeout(async () => {
      await completeDuel(bot, duelId);
    }, 15000);

  } catch (error) {
    console.error('Error en deep link join:', error);
    await bot.sendMessage(msg.chat.id, '❌ Error al unirse al duelo');
  }
}

async function handleJoinDuel(bot, callbackQuery, broadcastDuelUpdate) {
  try {
    const user = await User.findOrCreate(callbackQuery.from);
    const message = callbackQuery.message;
    
    // Buscar duelos activos en este chat
    const activeDuel = await Duel.findActiveDuelByChatId(message.chat.id);

    if (!activeDuel) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ No hay duelos activos en este chat',
        show_alert: true
      });
    }

    if (activeDuel.playerA.telegramId === user.telegramId) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ No puedes unirte a tu propio duelo',
        show_alert: true
      });
    }

    if (user.points < activeDuel.betAmount) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: `❌ No tienes suficientes puntos (Necesitas: ${activeDuel.betAmount})`,
        show_alert: true
      });
    }

    // Unirse al duelo
    const updatedDuel = await Duel.joinDuel(activeDuel._id.toString(), user);
    
    // Notificar a todos los clientes conectados
    if (broadcastDuelUpdate) {
      broadcastDuelUpdate(updatedDuel);
    }
    
    // ✅ CORRECCIÓN: Codificar correctamente la URL para el botón web_app
    const webAppUrl = `https://mini-app-jr7n.onrender.com?duel=${encodeURIComponent(activeDuel._id.toString())}`;
    
    // ✅ CORRECCIÓN: Formato correcto para el botón web_app
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Ver en MiniApp',
          web_app: { url: webAppUrl }
        }]
      ]
    };

    // ✅ CORRECCIÓN: Usar first_name en lugar de firstName
    const playerAName = activeDuel.playerA.first_name || 'Jugador A';
    const playerBName = user.first_name || 'Jugador B';
    const playerAUsername = activeDuel.playerA.username ? ` (@${activeDuel.playerA.username})` : '';
    const playerBUsername = user.username ? ` (@${user.username})` : '';

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${playerAName}${playerAUsername}
👤 *Jugador B:* ${playerBName}${playerBUsername}
💰 *Apuesta:* ${activeDuel.betAmount} puntos

⏰ *La moneda girará en 15 segundos...*

[Ver animación en MiniApp](${webAppUrl})
    `.trim(), {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });

    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '✅ Te has unido al duelo!'
    });

    // Iniciar countdown de 15 segundos
    setTimeout(async () => {
      await completeDuel(bot, activeDuel._id.toString());
    }, 15000);

  } catch (error) {
    console.error('Error uniéndose al duelo:', error);
    bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Error al unirse al duelo',
      show_alert: true
    });
  }
}

async function completeDuel(bot, duelId) {
  try {
    const duel = await Duel.getDuelById(duelId);
    
    if (!duel || duel.status !== 'countdown') return;

    // Realizar el coinflip
    const result = Math.random() > 0.5 ? 0 : 1;
    const winner = result === 0 ? duel.playerA : duel.playerB;
    const loser = result === 0 ? duel.playerB : duel.playerA;
    const resultText = result === 0 ? 'heads' : 'tails';

    // Actualizar puntos
    const winnings = duel.betAmount * 2;
    await User.updatePoints(winner.telegramId, winnings);
    await User.updatePoints(loser.telegramId, -duel.betAmount);
    await Duel.completeDuel(duelId, winner);

    // Enviar resultado
    await bot.editMessageText(`
🎉 *Duelo Completado* 🎉

👑 *Ganador:* ${winner.first_name}${winner.username ? ` (@${winner.username})` : ''}
💔 *Perdedor:* ${loser.first_name}${loser.username ? ` (@${loser.username})` : ''}
💰 *Premio:* ${winnings} puntos
🎯 *Resultado:* ${resultText === 'heads' ? '🟡 Cara' : '⚫ Cruz'}

¡Felicidades ${winner.first_name}! 🏆
    `.trim(), {
      chat_id: duel.chatId,
      message_id: duel.messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] } // Remover botones después del duelo
    });

  } catch (error) {
    console.error('Error completando duelo:', error);
  }
}

module.exports = { 
  handleStartCommand, 
  handlePointsCommand, 
  handlePvpCommand, 
  handleJoinDuel, 
  handleDeepLinkJoin,
  completeDuel 
};