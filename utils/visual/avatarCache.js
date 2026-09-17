import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import Jugador from '../../models/Jugador.js';

const AVATAR_CACHE_DIR = join(process.cwd(), 'cache', 'avatars');

function slugify(str) {
  if (!str) return 'unknown';
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/**
 * Resuelve y devuelve la imagen del avatar en Base64 para un jugador.
 * Si el jugador histórico tiene un ID de Discord configurado en MongoDB o es un Discord ID directo:
 * 1. Lo busca de Discord.
 * 2. Lo guarda físicamente en cache/avatars/<id>.png.
 * 3. Actualiza el campo 'avatar' en la base de datos del jugador.
 * 4. Devuelve la imagen como Data URL Base64.
 */
export async function getOrCachePlayerAvatar(playerIdentifier, client = null, dbPlayerMap = null) {
  if (!playerIdentifier) return null;
  const idStr = String(playerIdentifier).trim();

  if (!existsSync(AVATAR_CACHE_DIR)) {
    mkdirSync(AVATAR_CACHE_DIR, { recursive: true });
  }

  // 1. Buscar jugador en DB o en dbPlayerMap
  let resolvedObj = dbPlayerMap?.get(idStr) || null;
  let jugadorDoc = resolvedObj?.jugadorDoc || resolvedObj;

  if (!jugadorDoc || !jugadorDoc.nombre) {
    jugadorDoc = await Jugador.findOne({
      $or: [
        { _id: idStr },
        { id: idStr },
        { discordId: idStr },
        { nombre: new RegExp(`^${idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      ]
    }).catch(() => null);
  }

  // 2. Extraer el Discord ID si existe en algún campo
  let discordId = resolvedObj?.discordId || null;
  if (!discordId && jugadorDoc) {
    const docObj = jugadorDoc.toJSON ? jugadorDoc.toJSON() : jugadorDoc;
    const rawDisc = docObj.discordId || docObj.id || docObj._id;
    if (rawDisc && typeof rawDisc === 'string' && /^\d{17,20}$/.test(rawDisc)) {
      discordId = rawDisc;
    }
  }
  if (!discordId && /^\d{17,20}$/.test(idStr)) {
    discordId = idStr;
  }

  const cacheKey = discordId || slugify(idStr);
  const cachePath = join(AVATAR_CACHE_DIR, `${cacheKey}.png`);
  const relativePath = `cache/avatars/${cacheKey}.png`;

  // 3. Si ya existe el archivo en la caché local, leerlo y devolver Base64
  if (existsSync(cachePath)) {
    try {
      const buffer = readFileSync(cachePath);
      if (buffer.length > 50 && !buffer.toString('utf8', 0, 10).startsWith('{')) {
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (e) {
      console.error(`[AvatarCache] Error leyendo caché para ${cacheKey}:`, e);
    }
  }

  // 4. Si el documento tiene una URL remota de avatar (http...)
  let urlToDownload = null;
  const currentAvatar = jugadorDoc?.avatar || resolvedObj?.avatar;
  if (currentAvatar && currentAvatar.startsWith('http')) {
    urlToDownload = currentAvatar;
  } else if (discordId && client) {
    try {
      const user = await client.users.fetch(discordId);
      if (user) {
        urlToDownload = user.displayAvatarURL({ extension: 'png', size: 256 });
      }
    } catch (e) {
      // Ignorar si el usuario de Discord no es accesible
    }
  }

  // 5. Descargar, guardar en caché local y actualizar en la base de datos
  if (urlToDownload) {
    try {
      const response = await axios.get(urlToDownload, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
      });
      const buffer = Buffer.from(response.data);
      if (buffer.length > 50 && !buffer.toString('utf8', 0, 10).startsWith('{')) {
        writeFileSync(cachePath, buffer);

        const targetDbId = jugadorDoc?._id || jugadorDoc?.id || resolvedObj?.id || cacheKey;
        if (targetDbId) {
          await Jugador.updateById(targetDbId, { avatar: relativePath }).catch(() => null);
        }
        if (jugadorDoc) jugadorDoc.avatar = relativePath;
        if (resolvedObj) resolvedObj.avatar = relativePath;

        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (e) {
      console.error(`[AvatarCache] Error descargando avatar de ${cacheKey}:`, e.message);
    }
  }

  return null;
}
