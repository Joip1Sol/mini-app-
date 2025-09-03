const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

class Duel {
  static async createDuel(duelData) {
    const db = getDB();
    const duels = db.collection('duels');
    
    const newDuel = {
      playerA: duelData.playerA,
      playerB: null,
      betAmount: duelData.betAmount,
      status: 'waiting',
      winner: null,
      loser: null,
      chatId: duelData.chatId,
      messageId: duelData.messageId,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutos
      countdownStart: null,
      countdownEnd: null
    };
    
    const result = await duels.insertOne(newDuel);
    return { ...newDuel, _id: result.insertedId };
  }

  static async findActiveDuelByChatId(chatId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    return await duels.findOne({ 
      chatId: chatId,
      status: 'waiting',
      expiresAt: { $gt: new Date() }
    });
  }

  static async joinDuel(duelId, playerB) {
    const db = getDB();
    const duels = db.collection('duels');
    
    const countdownStart = new Date();
    const countdownEnd = new Date(countdownStart.getTime() + 15000);
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          playerB: playerB,
          status: 'countdown',
          countdownStart: countdownStart,
          countdownEnd: countdownEnd,
          updatedAt: new Date()
        } 
      }
    );
    
    return await this.getDuelById(duelId);
  }

  static async completeDuel(duelId, winner) {
    const db = getDB();
    const duels = db.collection('duels');
    
    const duel = await this.getDuelById(duelId);
    const loser = winner.telegramId === duel.playerA.telegramId ? duel.playerB : duel.playerA;
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          winner: winner,
          loser: loser,
          status: 'completed',
          updatedAt: new Date()
        } 
      }
    );
    
    return await this.getDuelById(duelId);
  }

  static async cancelDuel(duelId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          status: 'cancelled',
          updatedAt: new Date()
        } 
      }
    );
  }

  static async getDuelById(duelId) {
    const db = getDB();
    const duels = db.collection('duels');
    return await duels.findOne({ _id: new ObjectId(duelId) });
  }

  static async updateMessageId(duelId, messageId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          messageId: messageId,
          updatedAt: new Date()
        } 
      }
    );
    
    return await this.getDuelById(duelId);
  }

  static async expireDuel(duelId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          status: 'expired',
          updatedAt: new Date()
        } 
      }
    );
  }
}

module.exports = Duel;