import './polyfill.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/platubot';

let isConnected = false;

export async function connectDB() {
  if (isConnected) return mongoose.connection;

  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log(`[MongoDB] Conectado exitosamente a ${MONGODB_URI}`.green);
    return mongoose.connection;
  } catch (error) {
    console.error(`[MongoDB] Error al conectar a la base de datos:`.red, error.message);
    throw error;
  }
}

export function getDB() {
  return mongoose.connection;
}

export default connectDB;
