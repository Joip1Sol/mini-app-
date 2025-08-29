const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

class Duel {
  static async create(playerA, betAmount) {
    const db = getDB();
    const duels = db.collection('duels');
    
    const newDuel = {
      playerA,
      playerB: null,
      betAmount,
      status: 'waiting',
      winner: null,
      loser: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutos para expirar
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
    
    await duels.updateOne(
      { _id: new ObjectId(duelId) },
      { 
        $set: { 
          playerB,
          status: 'in-progress',
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

  static async getActiveDuels() {
    const db = getDB();
    const duels = db.collection('duels');
    
    return await duels.find({ 
      status: 'waiting',
      expiresAt: { $gt: new Date() }
    }).toArray();
  }
}

module.exports = Duel;