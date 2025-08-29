const { getDB } = require('../config/database');

class User {
  static async findOrCreate(telegramUser) {
    const db = getDB();
    const users = db.collection('users');
    
    let user = await users.findOne({ telegramId: telegramUser.id });
    
    if (!user) {
      const newUser = {
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name || 'Usuario',
        username: telegramUser.username,
        points: 100,
        duelsWon: 0,
        duelsLost: 0,
        totalWinnings: 0,
        createdAt: new Date()
      };
      
      const result = await users.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    }
    
    return user;
  }

  static async updatePoints(telegramId, pointsChange, winnings = 0) {
    const db = getDB();
    const users = db.collection('users');
    
    const updateData = {
      $inc: { 
        points: pointsChange,
        totalWinnings: winnings,
        ...(pointsChange > 0 ? { duelsWon: 1 } : { duelsLost: 1 })
      }
    };
    
    await users.updateOne({ telegramId }, updateData);
    return await users.findOne({ telegramId });
  }

  static async getLeaderboard(limit = 10) {
    const db = getDB();
    const users = db.collection('users');
    
    return await users.find()
      .sort({ points: -1 })
      .limit(limit)
      .toArray();
  }
}

module.exports = User;