const { getDB } = require('../config/database');

class User {
  static async findOrCreate(telegramUser) {
    const db = getDB();
    const users = db.collection('users');
    
    let user = await users.findOne({ telegramId: telegramUser.id });
    
    if (!user) {
      const newUser = {
        telegramId: telegramUser.id,
        first_name: telegramUser.first_name || 'Usuario',
        username: telegramUser.username,
        points: 100,
        duelsWon: 0,
        duelsLost: 0,
        totalWinnings: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      const result = await users.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    }
    
    return user;
  }

  static async updatePoints(telegramId, pointsChange) {
    const db = getDB();
    const users = db.collection('users');
    
    const user = await users.findOne({ telegramId: telegramId });
    if (!user) return null;

    const updateData = {
      $inc: { 
        points: pointsChange,
        totalWinnings: pointsChange > 0 ? pointsChange : 0
      },
      $set: { updatedAt: new Date() }
    };

    // Actualizar contadores de duelos ganados/perdidos
    if (pointsChange > 0) {
      updateData.$inc.duelsWon = 1;
    } else if (pointsChange < 0) {
      updateData.$inc.duelsLost = 1;
    }
    
    await users.updateOne({ telegramId: telegramId }, updateData);
    return await users.findOne({ telegramId: telegramId });
  }

  static async getLeaderboard(limit = 10) {
    const db = getDB();
    const users = db.collection('users');
    
    return await users.find()
      .sort({ points: -1 })
      .limit(limit)
      .toArray();
  }

  static async getUser(telegramId) {
    const db = getDB();
    const users = db.collection('users');
    return await users.findOne({ telegramId: telegramId });
  }
}

module.exports = User;