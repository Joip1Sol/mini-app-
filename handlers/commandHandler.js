const User = require('../models/User');
const Duel = require('../models/Duel');

async function handlePvpCommand(bot, msg, match) {
  try {
    const user = await User.findOrCreate(msg.from);
    const betAmount = match && match[1] ? parseInt(match[1]) : 10;

    if (user.points < betAmount) {
      return bot.sendMessage(msg.chat.id, 
        `❌ No tienes suficientes puntos.\nTienes: ${user.points} | Apuesta: ${betAmount}`
      );
    }

    const duel = await Duel.create(user, betAmount);
    
    const keyboard = {
      inline_keyboard: [
        [{
          text: '✅ Unirse al duelo',
          callback_data: `join_duel_${duel._id}`
        }],
        [{
          text: '🎮 Ver en MiniApp',
          web_app: { url: `https://your-render-app.onrender.com?duel=${duel._id}` }
        }]
      ]
    };

    const message = await bot.sendMessage(msg.chat.id, `
🎮 *Nuevo Duelo de CoinFlip* 🎮

👤 *Desafiante:* ${user.first_name}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${betAmount} puntos
⏰ *La moneda girará en 15 segundos*

¡Inicia la MiniApp para ver la animación en vivo! 👇
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

    // Programar el duelo automático después de 15 segundos
    setTimeout(async () => {
      try {
        const currentDuel = await Duel.findActiveDuel(duel._id.toString());
        
        if (currentDuel && currentDuel.status === 'waiting') {
          await Duel.expireDuel(duel._id.toString());
          await bot.editMessageText(`❌ Duelo expirado: Nadie se unió`, {
            chat_id: msg.chat.id,
            message_id: message.message_id
          });
        }
      } catch (error) {
        console.error('Error expirando duelo:', error);
      }
    }, 15000);

  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo');
  }
}

async function handleJoinDuel(bot, callbackQuery, duelId) {
  try {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '🔄 Uniéndote al duelo...'
    });

    const user = await User.findOrCreate(callbackQuery.from);
    const duel = await Duel.findActiveDuel(duelId);

    if (!duel) {
      return bot.editMessageText('❌ Este duelo ya no está disponible', {
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id
      });
    }

    if (user.points < duel.betAmount) {
      return bot.answerCallbackQuery(callbackQuery.id, {
        text: `❌ No tienes suficientes puntos (Necesitas: ${duel.betAmount})`,
        show_alert: true
      });
    }

    const updatedDuel = await Duel.joinDuel(duelId, user);
    
    // Realizar el coinflip automáticamente
    const result = Math.random() > 0.5 ? 0 : 1;
    const winner = result === 0 ? duel.playerA : user;
    const loser = result === 0 ? user : duel.playerA;
    const resultText = result === 0 ? 'heads' : 'tails';

    // Actualizar puntos
    const winnings = duel.betAmount * 2;
    await User.updatePoints(winner.telegramId, duel.betAmount, winnings);
    await User.updatePoints(loser.telegramId, -duel.betAmount, 0);
    await Duel.completeDuel(duelId, winner, loser);

    // Enviar resultado
    await bot.editMessageText(`
🎉 *Duelo Completado* 🎉

👑 *Ganador:* ${winner.firstName}${winner.username ? ` (@${winner.username})` : ''}
💔 *Perdedor:* ${loser.firstName}${loser.username ? ` (@${loser.username})` : ''}
💰 *Premio:* ${winnings} puntos
🎯 *Resultado:* ${resultText === 'heads' ? '🟡 Cara' : '⚫ Cruz'}

¡Felicidades ${winner.firstName}! 🏆
    `.trim(), {
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Error uniéndose al duelo:', error);
    bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Error al unirse al duelo',
      show_alert: true
    });
  }
}

module.exports = { handlePvpCommand, handleJoinDuel };