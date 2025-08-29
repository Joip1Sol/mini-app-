const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

class Duel {
  static async create(playerA, betAmount, chatId, messageId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    const newDuel = {
      playerA,
      playerB: null,
      betAmount,
      status: 'waiting',
      winner: null,
      loser: null,
      chatId,
      messageId,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      countdownStart: null,
      countdownEnd: null
    };
    
    const result = await duels.insertOne(newDuel);
    return { ...newDuel, _id: result.insertedId };
  }

  static async findActiveDuel(duelId) {
    const db = getDB();
    const duels = db.collection('duels');
    
    return await duels.findOne({ 
      _id: new ObjectId(duelId), 
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
          playerB,
          status: 'countdown',
          countdownStart,
          countdownEnd,
          updatedAt: new Date()
        } 
      }
    );
    
    return await duels.findOne({ _id: new ObjectId(duelId) });
  }

  static async completeDuel(duelId, winner, loser) {
    const db = getDB();
    const duels = db.collection('duels');
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          winner,
          loser,
          status: 'completed',
          updatedAt: new Date()
        } 
      }
    );
    
    return await duels.findOne({ _id: new ObjectId(duelId) });
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

  static async getDuelById(duelId) {
    const db = getDB();
    const duels = db.collection('duels');
    return await duels.findOne({ _id: new ObjectId(duelId) });
  }

  static async updateDuel(duelId, updateData) {
    const db = getDB();
    const duels = db.collection('duels');
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { $set: { ...updateData, updatedAt: new Date() } }
    );
    
    return await duels.findOne({ _id: new ObjectId(duelId) });
  }
}

module.exports = Duel;