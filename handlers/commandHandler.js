const User = require('../models/User');
const Duel = require('../models/Duel');

// Handler para el comando /start
async function handleStartCommand(bot, msg) {
  try {
    const user = await User.findOrCreate(msg.from);
    
    // Usar la URL de la aplicación en Render
    const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
    
    const welcomeMessage = `
🎮 *Bienvenido a CoinFlip Duel* 🎮

¡Desafia a tus amigos a un duelo de cara o cruz y gana puntos!

*Comandos disponibles:*
/pvp [cantidad] - Crear un nuevo duelo
/points - Ver tus puntos
/leaderboard - Ver tabla de clasificación

*Tu información:*
👤 Nombre: ${user.first_name || 'Usuario'}
💰 Puntos: ${user.points}

📱 *Juega en nuestra Mini App:* ${webAppUrl}
    `.trim();

    await bot.sendMessage(msg.chat.id, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🎮 Abrir Mini App',
            web_app: { url: webAppUrl }
          }]
        ]
      }
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

    // Crear duelo en la base de datos
    const duel = await Duel.createDuel({
      playerA: user,
      betAmount: betAmount,
      chatId: msg.chat.id,
      messageId: null
    });

    // ✅ SOLUCIÓN: Enviar solicitud a la API para crear el duelo en el servidor web
    try {
      const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
      const response = await fetch(`${webAppUrl}/api/create-duel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.telegramId,
          userName: user.first_name,
          userUsername: user.username,
          betAmount: betAmount
        })
      });
      
      if (!response.ok) {
        throw new Error('Error al crear duelo en el servidor web');
      }
    } catch (error) {
      console.error('Error conectando con el servidor web:', error);
    }

    // ✅ SOLUCIÓN: Usar botones con web_app
    const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
    
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '✅ Unirse al Duelo',
          callback_data: `join_duel:${duel._id.toString()}`
        }],
        [{
          text: '🎮 Ver en Mini App',
          web_app: { url: `${webAppUrl}/mini-app?duelId=${duel._id.toString()}` }
        }]
      ]
    };

    // ✅ SOLUCIÓN: Usar first_name en lugar de firstName y verificar si existe
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
    
    // ✅ SOLUCIÓN: Enviar solicitud a la API para unirse al duelo en el servidor web
    try {
      const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
      const response = await fetch(`${webAppUrl}/api/join-duel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.telegramId,
          userName: user.first_name,
          userUsername: user.username
        })
      });
      
      if (!response.ok) {
        throw new Error('Error al unirse al duelo en el servidor web');
      }
    } catch (error) {
      console.error('Error conectando con el servidor web:', error);
    }
    
    // ✅ SOLUCIÓN: Botones con web_app
    const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
    
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Ver Duelo en Mini App',
          web_app: { url: `${webAppUrl}/mini-app?duelId=${duelId}` }
        }]
      ]
    };

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${duel.playerA.first_name || 'Jugador A'}${duel.playerA.username ? ` (@${duel.playerA.username})` : ''}
👤 *Jugador B:* ${user.first_name || 'Jugador B'}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${duel.betAmount} puntos

⏰ *La moneda girará en 15 segundos...*
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

// Handler para callback de unirse al duelo
async function handleJoinDuel(bot, callbackQuery, broadcastDuelUpdate) {
  try {
    const user = await User.findOrCreate(callbackQuery.from);
    const message = callbackQuery.message;
    
    // Obtener el ID del duelo desde el callback_data
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

    // Unirse al duelo
    const updatedDuel = await Duel.joinDuel(duelId, user);
    
    // ✅ SOLUCIÓN: Enviar solicitud a la API para unirse al duelo en el servidor web
    try {
      const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
      const response = await fetch(`${webAppUrl}/api/join-duel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: user.telegramId,
          userName: user.first_name,
          userUsername: user.username
        })
      });
      
      if (!response.ok) {
        throw new Error('Error al unirse al duelo en el servidor web');
      }
    } catch (error) {
      console.error('Error conectando con el servidor web:', error);
    }
    
    // Notificar a todos los clientes conectados
    if (broadcastDuelUpdate) {
      broadcastDuelUpdate(updatedDuel);
    }
    
    // ✅ SOLUCIÓN: Botones con web_app
    const webAppUrl = process.env.WEB_APP_URL || `https://${process.env.RENDER_EXTERNAL_URL || `localhost:${process.env.PORT || 3000}`}`;
    
    const replyMarkup = {
      inline_keyboard: [
        [{
          text: '🎮 Ver Duelo en Mini App',
          web_app: { url: `${webAppUrl}/mini-app?duelId=${duelId}` }
        }]
      ]
    };

    // ✅ SOLUCIÓN: Usar first_name en lugar de firstName y verificar si existe
    const playerAName = duel.playerA.first_name || 'Jugador A';
    const playerBName = user.first_name || 'Jugador B';
    const playerAUsername = duel.playerA.username ? ` (@${duel.playerA.username})` : '';
    const playerBUsername = user.username ? ` (@${user.username})` : '';

    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${playerAName}${playerAUsername}
👤 *Jugador B:* ${playerBName}${playerBUsername}
💰 *Apuesta:* ${duel.betAmount} puntos

⏰ *La moneda girará en 15 segundos...*
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
      await completeDuel(bot, duelId);
    }, 15000);

  } catch (error) {
    console.error('Error uniéndose al duelo:', error);
    bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Error al unirse al duelo',
      show_alert: true
    });
  }
}

// Completar duelo
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

    // ✅ SOLUCIÓN: Usar first_name en lugar de firstName y verificar si existe
    const winnerName = winner.first_name || 'Ganador';
    const loserName = loser.first_name || 'Perdedor';
    const winnerUsername = winner.username ? ` (@${winner.username})` : '';
    const loserUsername = loser.username ? ` (@${loser.username})` : '';

    // Enviar resultado
    await bot.editMessageText(`
🎉 *Duelo Completado* 🎉

👑 *Ganador:* ${winnerName}${winnerUsername}
💔 *Perdedor:* ${loserName}${loserUsername}
💰 *Premio:* ${winnings} puntos
🎯 *Resultado:* ${resultText === 'heads' ? '🟡 Cara' : '⚫ Cruz'}

¡Felicidades ${winnerName}! 🏆
    `.trim(), {
      chat_id: duel.chatId,
      message_id: duel.messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] }
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