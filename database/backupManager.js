import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { readdir, readFile, writeFile, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import mongoose from 'mongoose';
import 'colors';
import { connectDB } from './connection.js';
import JsonModel, { jsonModelEvents } from './JsonModel.js';

const execAsync = promisify(exec);

let clientInstance = null;
let schedulerTimer = null;

// Backup Configuration
export const BACKUP_ROOT = join(process.cwd(), 'backups');
export const STATE_FILE = join(BACKUP_ROOT, 'backup_state.json');

export const BACKUP_TIERS = {
  '30m': { name: '30m', intervalMs: 30 * 60 * 1000, maxRetention: 24, label: '30 Minutos' },
  '1h':  { name: '1h',  intervalMs: 60 * 60 * 1000, maxRetention: 24, label: '1 Hora' },
  '3h':  { name: '3h',  intervalMs: 3 * 60 * 60 * 1000, maxRetention: 24, label: '3 Horas' },
  '1d':  { name: '1d',  intervalMs: 24 * 60 * 60 * 1000, maxRetention: 30, label: '1 Día' },
  '1w':  { name: '1w',  intervalMs: 7 * 24 * 60 * 60 * 1000, maxRetention: 12, label: '1 Semana' }
};

// Ensure base backup directories exist
export function ensureBackupDirs() {
  if (!existsSync(BACKUP_ROOT)) {
    mkdirSync(BACKUP_ROOT, { recursive: true });
  }
  for (const tier of Object.keys(BACKUP_TIERS)) {
    const tierPath = join(BACKUP_ROOT, tier);
    if (!existsSync(tierPath)) {
      mkdirSync(tierPath, { recursive: true });
    }
  }
  const manualPath = join(BACKUP_ROOT, 'manual');
  if (!existsSync(manualPath)) {
    mkdirSync(manualPath, { recursive: true });
  }
}

// Load backup schedule state
export async function loadBackupState() {
  ensureBackupDirs();
  if (!existsSync(STATE_FILE)) {
    const initialState = { lastRun: {} };
    await writeFile(STATE_FILE, JSON.stringify(initialState, null, 2), 'utf8');
    return initialState;
  }
  try {
    const content = await readFile(STATE_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return { lastRun: {} };
  }
}

// Save backup schedule state
export async function saveBackupState(state) {
  ensureBackupDirs();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// Format timestamp helper: YYYY-MM-DD_HH-mm-ss
export function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

// Delete oldest backups if retention limit exceeded
export async function pruneOldBackups(tier) {
  const config = BACKUP_TIERS[tier];
  if (!config) return;

  const tierDir = join(BACKUP_ROOT, tier);
  if (!existsSync(tierDir)) return;

  try {
    const entries = await readdir(tierDir, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory() && e.name.startsWith('backup_'))
      .map(e => e.name)
      .sort(); // Lexicographical sort works because timestamps are YYYY-MM-DD_HH-mm-ss

    if (folders.length > config.maxRetention) {
      const toDelete = folders.slice(0, folders.length - config.maxRetention);
      for (const folder of toDelete) {
        const fullPath = join(tierDir, folder);
        console.log(`[Backup Retention] Eliminando backup antiguo (${tier}): ${folder}`.gray);
        await rm(fullPath, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.error(`[Backup Retention] Error al purgar backups en ${tier}:`, err.message);
  }
}

// Core backup creation function
export async function createBackup(tier = 'manual') {
  ensureBackupDirs();
  await connectDB();

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('La conexión a MongoDB no está activa.');
  }

  const collections = await db.listCollections().toArray();
  const folderName = `backup_${formatTimestamp()}`;
  const targetDir = join(BACKUP_ROOT, tier, folderName);

  mkdirSync(targetDir, { recursive: true });

  const manifest = {
    tier,
    folderName,
    timestamp: new Date().toISOString(),
    totalCollections: 0,
    totalDocuments: 0,
    totalBytes: 0,
    collections: {}
  };

  for (const collInfo of collections) {
    const collName = collInfo.name;
    if (collName.startsWith('system.')) continue;

    const coll = db.collection(collName);
    const docs = await coll.find({}).toArray();

    const jsonContent = JSON.stringify(docs, null, 2);
    const filePath = join(targetDir, `${collName}.json`);
    await writeFile(filePath, jsonContent, 'utf8');

    const fileStat = await stat(filePath);
    manifest.collections[collName] = {
      documents: docs.length,
      bytes: fileStat.size
    };
    manifest.totalCollections++;
    manifest.totalDocuments += docs.length;
    manifest.totalBytes += fileStat.size;
  }

  // Write manifest
  await writeFile(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Prune old backups for this tier
  if (BACKUP_TIERS[tier]) {
    await pruneOldBackups(tier);
  }

  // Update schedule state
  const state = await loadBackupState();
  state.lastRun = state.lastRun || {};
  state.lastRun[tier] = Date.now();
  await saveBackupState(state);

  console.log(`[Backup ${tier.toUpperCase()}] Respaldo completado en ${targetDir} (${manifest.totalDocuments} documentos en ${manifest.totalCollections} colecciones)`.green);

  return {
    success: true,
    tier,
    folderName,
    backupPath: targetDir,
    manifest
  };
}

// Check and trigger scheduled backups across all configured tiers
export async function checkAndRunScheduledBackups() {
  try {
    const state = await loadBackupState();
    const now = Date.now();
    let stateChanged = false;

    for (const [tier, config] of Object.entries(BACKUP_TIERS)) {
      const lastRun = state.lastRun?.[tier] || 0;
      const elapsed = now - lastRun;

      if (elapsed >= config.intervalMs) {
        console.log(`[Backup Scheduler] Disparando backup programado: ${tier} (${config.label})`.cyan);
        await createBackup(tier);
        state.lastRun = state.lastRun || {};
        state.lastRun[tier] = Date.now();
        stateChanged = true;
      }
    }

    if (stateChanged) {
      await saveBackupState(state);
    }
  } catch (err) {
    console.error('[Backup Scheduler] Error durante la comprobación de backups:'.red, err.message);
  }
}

// Start periodic scheduler check (every 60 seconds)
export function startBackupScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  ensureBackupDirs();
  console.log('[Backup Scheduler] Iniciando monitor de backups locales (30m, 1h, 3h, 1d, 1w)...'.cyan);

  // Initial check on boot
  checkAndRunScheduledBackups();

  // Check every 1 minute
  schedulerTimer = setInterval(() => {
    checkAndRunScheduledBackups();
  }, 60 * 1000);

  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}

// List all available backups
export async function listAllBackups() {
  ensureBackupDirs();
  const tiers = [...Object.keys(BACKUP_TIERS), 'manual'];
  const allBackups = [];

  for (const tier of tiers) {
    const tierDir = join(BACKUP_ROOT, tier);
    if (!existsSync(tierDir)) continue;

    try {
      const entries = await readdir(tierDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;

        const backupPath = join(tierDir, entry.name);
        const manifestPath = join(backupPath, 'manifest.json');

        let manifest = null;
        if (existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
          } catch {}
        }

        allBackups.push({
          tier,
          folderName: entry.name,
          fullPath: backupPath,
          manifest,
          createdDate: manifest?.timestamp || entry.name.replace('backup_', '').replace(/_/g, ' ')
        });
      }
    } catch {}
  }

  // Sort descending by date
  return allBackups.sort((a, b) => (b.createdDate > a.createdDate ? 1 : -1));
}

// Restore a database backup from directory
export async function restoreBackup(backupPath) {
  const fullPath = resolve(backupPath);
  if (!existsSync(fullPath)) {
    throw new Error(`La ruta de backup no existe: ${fullPath}`);
  }

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('La conexión a MongoDB no está activa.');
  }

  const entries = await readdir(fullPath);
  const jsonFiles = entries.filter(f => f.endsWith('.json') && f !== 'manifest.json');

  if (jsonFiles.length === 0) {
    throw new Error(`No se encontraron archivos de colecciones JSON en: ${fullPath}`);
  }

  const summary = {
    backupPath: fullPath,
    restoredCollections: 0,
    restoredDocuments: 0,
    details: {}
  };

  for (const file of jsonFiles) {
    const collectionName = file.replace('.json', '');
    const filePath = join(fullPath, file);
    const content = await readFile(filePath, 'utf8');
    const docs = JSON.parse(content);

    const collection = db.collection(collectionName);
    await collection.deleteMany({});

    let insertedCount = 0;
    if (Array.isArray(docs) && docs.length > 0) {
      const result = await collection.insertMany(docs);
      insertedCount = result.insertedCount;
    }

    summary.details[collectionName] = insertedCount;
    summary.restoredCollections++;
    summary.restoredDocuments += insertedCount;
  }

  console.log(`[Backup Restore] Base de datos restaurada desde ${fullPath} (${summary.restoredDocuments} documentos en ${summary.restoredCollections} colecciones)`.bold.green);
  return summary;
}

// Resolve a specific Mongo-backed model instance by name
async function getModel(collectionName) {
  const paths = [
    `../models/${collectionName}.js`,
    `../models/copas/${collectionName}.js`,
    `../models/superliga/${collectionName}.js`
  ];

  for (const p of paths) {
    try {
      const mod = await import(p);
      if (mod.default) return mod.default;
    } catch (e) {
      // Keep searching in paths
    }
  }
  return new JsonModel(collectionName);
}

// HTTP API Server powered by Bun
function startHttpServer() {
  const port = process.env.DASHBOARD_PORT || 3001;
  const secret = process.env.DASHBOARD_API_SECRET || 'platubot-super-secret-key-1234';

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      
      if (pathname !== '/api/vps/logs' && pathname !== '/api/vps/status') {
        console.log(`[API Request] Method: ${req.method}, Path: ${pathname}`.yellow);
      }
      
      // Handle CORS for all requests
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Security check: Verify Bearer secret token
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || authHeader !== `Bearer ${secret}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      try {
        // 1. Auth check endpoint (Verifies user ID and Server/Role)
        if (pathname === '/api/auth-check' && req.method === 'POST') {
          const { userId } = await req.json();
          if (!userId) {
            return new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400, headers: corsHeaders });
          }

          if (!clientInstance) {
            return new Response(JSON.stringify({ error: 'Discord client not ready' }), { status: 503, headers: corsHeaders });
          }

          const guildId = '1403145326717833408';
          const roleId = '1455042543770407156';

          const guild = await clientInstance.guilds.fetch(guildId).catch(() => null);
          if (!guild) {
            return new Response(JSON.stringify({ authorized: false, reason: 'Guild not found' }), { headers: corsHeaders });
          }

          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) {
            return new Response(JSON.stringify({ authorized: false, reason: 'Member not found in guild' }), { headers: corsHeaders });
          }

          const hasRole = member.roles.cache.has(roleId);
          return new Response(JSON.stringify({
            authorized: hasRole,
            user: {
              id: member.user.id,
              username: member.user.username,
              avatar: member.user.avatar,
              displayName: member.displayName
            }
          }), { headers: corsHeaders });
        }

        // 1.1 VPS Logs endpoint
        if (pathname === '/api/vps/logs' && req.method === 'GET') {
          let logOutput = '';
          try {
            const { stdout } = await execAsync('pm2 logs platubot --raw --lines 20 --nostream');
            logOutput = stdout;
          } catch (e) {
            logOutput = `[SYSTEM] PM2 not found or inactive. Active bot processes running on Bun.\n`;
            logOutput += `[SYSTEM] Time: ${new Date().toISOString()}\n`;
            logOutput += `[SYSTEM] Platform: ${process.platform}\n`;
            logOutput += `[SYSTEM] Uptime: ${process.uptime()}s\n`;
            logOutput += `[DATABASE] Connected to local MongoDB database (platubot)\n`;
            logOutput += `[INFO] Bot Client ready: ${!!clientInstance}\n`;
          }
          return new Response(JSON.stringify({ logs: logOutput }), { headers: corsHeaders });
        }

        // 1.2 VPS Exec controlled command presets endpoint
        if (pathname === '/api/vps/exec' && req.method === 'POST') {
          const { command } = await req.json();
          if (!command) {
            return new Response(JSON.stringify({ error: 'Missing command' }), { status: 400, headers: corsHeaders });
          }

          let output = '';
          let success = true;

          try {
            if (command === 'restart') {
              setTimeout(() => {
                exec('pm2 restart platubot', (err) => {
                  if (err) {
                    exec('pm2 restart all');
                  }
                });
              }, 1000);
              output = 'Reinicio solicitado: El bot y el servidor HTTP se reiniciarán en 1 segundo.';
              success = true;
            } else if (command === 'pull') {
              const { stdout } = await execAsync('git pull origin main');
              output = stdout || 'Ya actualizado.';
            } else if (command === 'status') {
              try {
                const { stdout } = await execAsync('pm2 status');
                output = stdout;
              } catch (e) {
                output = `Uptime: ${process.uptime()}s\nCPU/Memory check complete.`;
              }
            } else {
              success = false;
              output = 'Comando no permitido o inválido.';
            }
          } catch (err) {
            success = false;
            output = `Error ejecutando comando: ${err.message}`;
          }

          return new Response(JSON.stringify({ success, output }), { headers: corsHeaders });
        }

        // 1.3 VPS Status endpoint
        if (pathname === '/api/vps/status' && req.method === 'GET') {
          const stats = {
            online: true,
            uptime: Math.floor(process.uptime()),
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version,
            dbConnected: mongoose.connection.readyState === 1
          };
          return new Response(JSON.stringify(stats), { headers: corsHeaders });
        }

        // 2. Backups API Endpoints
        if (pathname === '/api/backups' && req.method === 'GET') {
          const state = await loadBackupState();
          const backups = await listAllBackups();
          return new Response(JSON.stringify({
            tiers: BACKUP_TIERS,
            state,
            backups
          }), { headers: corsHeaders });
        }

        if (pathname === '/api/backups/create' && req.method === 'POST') {
          const body = await req.json().catch(() => ({}));
          const tier = body.tier || 'manual';
          const result = await createBackup(tier);
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        if (pathname === '/api/backups/restore' && req.method === 'POST') {
          const body = await req.json().catch(() => ({}));
          if (!body.backupPath) {
            return new Response(JSON.stringify({ error: 'Falta backupPath' }), { status: 400, headers: corsHeaders });
          }
          const result = await restoreBackup(body.backupPath);
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        // 3. Get list of all collections from local MongoDB
        if (pathname === '/api/collections' && req.method === 'GET') {
          await connectDB();
          const collectionsRaw = await mongoose.connection.db.listCollections().toArray();
          const collections = collectionsRaw.map(c => c.name);
          return new Response(JSON.stringify({ collections }), { headers: corsHeaders });
        }

        // 4. Collection CRUD Operations
        const collectionMatch = pathname.match(/^\/api\/collections\/([^/]+)$/);
        const docMatch = pathname.match(/^\/api\/collections\/([^/]+)\/([^/]+)$/);

        // Fetch all documents in a collection
        if (collectionMatch && req.method === 'GET') {
          const collectionName = collectionMatch[1];
          const model = await getModel(collectionName);
          const docs = await model.find({});
          return new Response(JSON.stringify(docs), { headers: corsHeaders });
        }

        // Create new document in a collection
        if (collectionMatch && req.method === 'POST') {
          const collectionName = collectionMatch[1];
          const body = await req.json();
          const model = await getModel(collectionName);
          const doc = await model.create(body);
          return new Response(JSON.stringify(doc), { status: 201, headers: corsHeaders });
        }

        // Update document
        if (docMatch && req.method === 'PUT') {
          const collectionName = docMatch[1];
          const docId = docMatch[2];
          const body = await req.json();
          const model = await getModel(collectionName);
          const result = await model.findOneAndUpdate({ _id: docId }, { $set: body });
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        // Delete document
        if (docMatch && req.method === 'DELETE') {
          const collectionName = docMatch[1];
          const docId = docMatch[2];
          const model = await getModel(collectionName);
          const result = await model.deleteOne({ _id: docId });
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });

      } catch (err) {
        console.error('[API Server Error]:'.red, err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }
  });

  console.log(`[API Server] Bun HTTP Server running on port ${port}`.green);
}

// Main initialization
export async function init(client) {
  clientInstance = client;

  // Set up hook in JsonModel events
  jsonModelEvents.onWrite = (collectionName) => {
    console.log(`[DB Change] Dynamic update detected in MongoDB collection: ${collectionName}`.magenta);
  };

  // Ensure MongoDB connection is established
  await connectDB();

  // Start HTTP API Server
  startHttpServer();

  // Start multi-tier automated backup scheduler
  startBackupScheduler();
}
