const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let client;
let database;

const connectDB = async () => {
  try {
    client = new MongoClient(uri);
    await client.connect();
    database = client.db();
    console.log('✅ Conectado a MongoDB Atlas');
    return database;
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
};

const getDB = () => {
  if (!database) throw new Error('La base de datos no ha sido inicializada');
  return database;
};

const closeDB = async () => {
  if (client) await client.close();
};

module.exports = { connectDB, getDB, closeDB };