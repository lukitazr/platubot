import Jugador from '../../models/Jugador.js';

/**
 * Asegura que un usuario tenga un registro guardado en la colección global `Jugador`.
 * @param {Object|string} user - Objeto User de Discord o ID de usuario.
 * @param {Object} [client] - Cliente de DiscordJS si solo se provee un ID string.
 * @returns {Promise<Object>} Documento de Jugador.
 */
export async function ensureUserRegistered(user, client = null) {
  let userId = typeof user === 'string' ? user : user?.id;
  if (!userId || !/^\d{17,20}$/.test(userId)) return null;

  let jugador = await Jugador.findById(userId).catch(() => null);

  let discordUser = typeof user === 'object' && user?.username ? user : null;
  if (!discordUser && client) {
    discordUser = await client.users.fetch(userId).catch(() => null);
  }

  const username = discordUser?.displayName || discordUser?.username || discordUser?.tag;
  const avatar = discordUser?.displayAvatarURL ? discordUser.displayAvatarURL({ extension: 'png', size: 128 }) : null;

  if (!jugador) {
    jugador = await Jugador.create({
      id: userId,
      nombre: username || `Usuario ${userId.slice(-4)}`,
      avatar: avatar || null
    });
  } else {
    let updates = {};
    if (username && jugador.nombre !== username) updates.nombre = username;
    if (avatar && jugador.avatar !== avatar) updates.avatar = avatar;

    if (Object.keys(updates).length > 0) {
      await jugador.update(updates);
    }
  }

  return jugador;
}

/**
 * Resuelve una lista de IDs de usuario consultando la base de datos `Jugador`.
 * Retorna un objeto Map con los datos unificados { id, nombre, avatar }.
 * @param {Array<string>|Set<string>} userIds - Lista de IDs de Discord.
 * @param {Object} [client] - Cliente de DiscordJS opcional para fallback de usuarios no registrados.
 * @returns {Promise<Map<string, { id: string, nombre: string, avatar: string }>>}
 */
export async function resolvePlayers(userIds, client = null) {
  const map = new Map();
  if (!userIds) return map;

  const idsArray = Array.from(userIds).filter(id => id && (typeof id === 'string' || typeof id === 'number'));
  if (idsArray.length === 0) return map;

  const uniqueIds = [...new Set(idsArray.map(id => String(id).trim()))];

  // 1. Consultar todos los jugadores en la base de datos `Jugador`
  const dbPlayers = await Jugador.find({}).catch(() => []);
  const dbPlayersMap = new Map();

  dbPlayers.forEach(p => {
    const docObj = p.toJSON ? p.toJSON() : p;
    const keys = [
      String(docObj._id || ''),
      String(docObj.id || ''),
      String(docObj.discordId || ''),
      (docObj.nombre || '').toLowerCase().trim()
    ].filter(Boolean);

    keys.forEach(k => dbPlayersMap.set(k, docObj));
  });

  const missingIds = [];

  for (const id of uniqueIds) {
    const normKey = id.toLowerCase().trim();
    const p = dbPlayersMap.get(id) || dbPlayersMap.get(normKey);

    if (p && p.nombre) {
      const discordId = [p.discordId, p.id, p._id].find(val => val && typeof val === 'string' && /^\d{17,20}$/.test(val)) || null;
      map.set(id, {
        id,
        nombre: p.nombre,
        avatar: p.avatar || null,
        discordId,
        jugadorDoc: p
      });
    } else if (/^\d{17,20}$/.test(id)) {
      missingIds.push(id);
    } else {
      map.set(id, { id, nombre: id, avatar: null, discordId: null });
    }
  }

  // 2. Si hay IDs numéricos faltantes y cliente de Discord, registrar
  if (missingIds.length > 0 && client) {
    await Promise.all(missingIds.map(async id => {
      try {
        const u = await client.users.fetch(id);
        if (u) {
          const reg = await ensureUserRegistered(u);
          if (reg) {
            map.set(id, {
              id,
              nombre: reg.nombre,
              avatar: reg.avatar || u.displayAvatarURL({ extension: 'png', size: 128 }),
              discordId: id,
              jugadorDoc: reg
            });
          }
        }
      } catch {
        map.set(id, { id, nombre: `Jugador (${id.slice(-4)})`, avatar: null, discordId: id });
      }
    }));
  }

  return map;
}

/**
 * Obtiene el nombre resuelto de un usuario a partir de su ID o de un objeto con fallback.
 */
export function getResolvedName(idOrObj, playerMap, defaultName = 'Desconocido') {
  if (!idOrObj) return defaultName;
  if (typeof idOrObj === 'object') {
    if (idOrObj.nombre) return idOrObj.nombre;
    if (idOrObj.discordId && playerMap?.has(idOrObj.discordId)) return playerMap.get(idOrObj.discordId).nombre;
    if (idOrObj.id && playerMap?.has(idOrObj.id)) return playerMap.get(idOrObj.id).nombre;
  }
  const idStr = String(idOrObj);
  if (playerMap?.has(idStr)) {
    return playerMap.get(idStr).nombre;
  }
  return defaultName;
}

/**
 * Obtiene el avatar resuelto de un usuario a partir de su ID o de un objeto con fallback.
 */
export function getResolvedAvatar(idOrObj, playerMap, defaultAvatar = null) {
  if (!idOrObj) return defaultAvatar;
  if (typeof idOrObj === 'object') {
    if (idOrObj.avatar) return idOrObj.avatar;
    if (idOrObj.discordId && playerMap?.has(idOrObj.discordId)) return playerMap.get(idOrObj.discordId).avatar;
    if (idOrObj.id && playerMap?.has(idOrObj.id)) return playerMap.get(idOrObj.id).avatar;
  }
  const idStr = String(idOrObj);
  if (playerMap?.has(idStr)) {
    return playerMap.get(idStr).avatar || defaultAvatar;
  }
  return defaultAvatar;
}
