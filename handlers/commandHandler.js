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

    const keyboard = {
      inline_keyboard: [[{
        text: '✅ Unirse al duelo',
        callback_data: `join_duel`
      }]]
    };

    const message = await bot.sendMessage(msg.chat.id, `
🎮 *Nuevo Duelo de CoinFlip* 🎮

👤 *Desafiante:* ${user.first_name}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${betAmount} puntos
⏰ *Dispone de 2 minutos para unirse*

¡Haz clic en "Unirse al duelo" para participar! 👇
    `.trim(), {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

    // Crear duelo después de enviar el mensaje
    const duel = await Duel.create(user, betAmount, msg.chat.id, message.message_id);

    // Programar expiración
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
    }, 120000); // 2 minutos

  } catch (error) {
    console.error('Error en /pvp:', error);
    bot.sendMessage(msg.chat.id, '❌ Error al crear el duelo');
  }
}

async function handleJoinDuel(bot, callbackQuery) {
  try {
    const user = await User.findOrCreate(callbackQuery.from);
    const message = callbackQuery.message;
    
    // Buscar duelos activos en este chat
    const db = require('../config/database').getDB();
    const duels = db.collection('duels');
    
    const activeDuel = await duels.findOne({
      chatId: message.chat.id,
      status: 'waiting',
      expiresAt: { $gt: new Date() }
    });

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
    
    // Actualizar mensaje original
    await bot.editMessageText(`
🎮 *Duelo en Progreso* 🎮

👤 *Jugador A:* ${activeDuel.playerA.first_name}${activeDuel.playerA.username ? ` (@${activeDuel.playerA.username})` : ''}
👤 *Jugador B:* ${user.first_name}${user.username ? ` (@${user.username})` : ''}
💰 *Apuesta:* ${activeDuel.betAmount} puntos

⏰ *La moneda girará en 15 segundos...*

[Ver animación en MiniApp](https://your-render-app.onrender.com?duel=${activeDuel._id})
    `.trim(), {
      chat_id: message.chat.id,
      message_id: message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{
          text: '🎮 Ver en MiniApp',
          web_app: { url: `https://your-render-app.onrender.com?duel=${activeDuel._id}` }
        }]]
      }
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
    await User.updatePoints(winner.telegramId, duel.betAmount, winnings);
    await User.updatePoints(loser.telegramId, -duel.betAmount, 0);
    await Duel.completeDuel(duelId, winner, loser);

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
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('Error completando duelo:', error);
  }
}

module.exports = { handlePvpCommand, handleJoinDuel, completeDuel };