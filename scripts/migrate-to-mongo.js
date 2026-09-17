import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import 'colors';
import { connectDB } from '../database/connection.js';

const DATA_DIR = join(process.cwd(), 'data');

function normalizeDocument(data) {
  if (Array.isArray(data)) {
    return data.map(item => normalizeDocument(item));
  } else if (data !== null && typeof data === 'object') {
    if (data.$oid) return data.$oid;
    if (data.$date) {
      if (typeof data.$date === 'string') return data.$date;
      if (data.$date.$numberLong) return new Date(parseInt(data.$date.$numberLong)).toISOString();
      return data.$date;
    }
    if (data.$numberInt !== undefined) return parseInt(data.$numberInt);
    if (data.$numberLong !== undefined) return parseInt(data.$numberLong);

    const normalized = {};
    for (const key in data) {
      normalized[key] = normalizeDocument(data[key]);
    }
    return normalized;
  }
  return data;
}

export async function migrateData() {
  console.log(`[Migración] Iniciando migración de datos desde ${DATA_DIR} a MongoDB...`.cyan);
  
  await connectDB();
  const db = mongoose.connection.db;

  if (!existsSync(DATA_DIR)) {
    console.log(`[Migración] No se encontró el directorio ${DATA_DIR}. Nada para migrar.`.yellow);
    return;
  }

  const files = await readdir(DATA_DIR);
  const jsonFiles = files.filter(file => file.endsWith('.json') && file !== 'backup_state.json');

  let totalMigratedDocs = 0;

  for (const file of jsonFiles) {
    const collectionName = file.replace('.json', '');
    const filePath = join(DATA_DIR, file);

    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const docs = normalizeDocument(parsed);

      if (!Array.isArray(docs) || docs.length === 0) {
        console.log(`[Migración] Colección ${collectionName}: 0 documentos para importar.`.yellow);
        continue;
      }

      const collection = db.collection(collectionName);

      // Limpiar datos previos e insertar documentos
      await collection.deleteMany({});
      const result = await collection.insertMany(docs);

      console.log(`[Migración] Colección ${collectionName}: ${result.insertedCount} documentos migrados con éxito.`.green);
      totalMigratedDocs += result.insertedCount;
    } catch (err) {
      console.error(`[Migración] Error migrando ${file}:`.red, err.message);
    }
  }

  console.log(`[Migración] Migración completada. Total de documentos migrados: ${totalMigratedDocs}`.bold.green);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('migrate-to-mongo.js')) {
  migrateData().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('Error fatal en la migración:', err);
    process.exit(1);
  });
}
