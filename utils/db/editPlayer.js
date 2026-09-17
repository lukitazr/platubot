import '../../database/polyfill.js';
import Jugador from '../../models/Jugador.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Equipos from '../../models/superliga/Equipos.js';
import JugadoresLibres from '../../models/superliga/JugadoresLibres.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';
import { getOrCachePlayerAvatar } from '../visual/avatarCache.js';

/**
 * Edita la información y estadísticas globales de un jugador.
 * Si se modifica el ID o el nombre, re-linkea automáticamente todas las referencias
 * en ligas, torneos y copas. Finalmente descargará y cacheará el avatar del jugador.
 */
export async function editPlayer(playerIdentifier, fieldUpdates = {}, client = null) {
  if (!playerIdentifier) {
    return { success: false, reason: 'Debes especificar el ID o nombre del jugador a editar.' };
  }

  const idStr = String(playerIdentifier).trim();
  const playerDoc = await Jugador.findOne({
    $or: [
      { _id: idStr },
      { id: idStr },
      { discordId: idStr },
      { nombre: new RegExp(`^${idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    ]
  }).catch(() => null);

  if (!playerDoc) {
    return { success: false, reason: `No se encontró ningún jugador registrado con "${playerIdentifier}".` };
  }

  const oldName = playerDoc.nombre;
  const oldId = String(playerDoc.id || playerDoc._id);
  const oldDiscordId = playerDoc.discordId;

  const oldIds = [
    String(playerDoc._id || ''),
    String(playerDoc.id || ''),
    String(playerDoc.discordId || ''),
    oldId,
    oldDiscordId
  ].filter(Boolean);

  let updatedId = false;
  let updatedName = false;

  // 1. Aplicar cambios de campos
  if (fieldUpdates.nombre && typeof fieldUpdates.nombre === 'string') {
    const newName = fieldUpdates.nombre.trim();
    if (newName && newName !== oldName) {
      playerDoc.nombre = newName;
      updatedName = true;
    }
  }

  if (fieldUpdates.discordId !== undefined || fieldUpdates.newId !== undefined || fieldUpdates.id !== undefined) {
    const rawNewId = String(fieldUpdates.discordId ?? fieldUpdates.newId ?? fieldUpdates.id).trim();
    if (rawNewId) {
      if (/^\d{17,20}$/.test(rawNewId)) {
        playerDoc.discordId = rawNewId;
      }
      playerDoc.id = rawNewId;
      updatedId = true;
    }
  }

  if (fieldUpdates.titulos !== undefined || fieldUpdates.titulosOficiales !== undefined || fieldUpdates.titulosAmistosos !== undefined) {
    const { normalizeTitulos } = await import('../torneos/titulosHelper.js');
    const currentTitulos = normalizeTitulos(playerDoc.titulos);

    if (fieldUpdates.titulosOficiales !== undefined) {
      const count = Math.max(0, parseInt(fieldUpdates.titulosOficiales, 10) || 0);
      currentTitulos.oficiales = Array.from({ length: count }, (_, i) => `Título Oficial #${i + 1}`);
    } else if (fieldUpdates.titulos !== undefined) {
      if (typeof fieldUpdates.titulos === 'object' && !Array.isArray(fieldUpdates.titulos)) {
        currentTitulos.oficiales = normalizeTitulos(fieldUpdates.titulos).oficiales;
        currentTitulos.amistosos = normalizeTitulos(fieldUpdates.titulos).amistosos;
      } else {
        const count = Math.max(0, parseInt(fieldUpdates.titulos, 10) || 0);
        currentTitulos.oficiales = Array.from({ length: count }, (_, i) => `Título Oficial #${i + 1}`);
      }
    }

    if (fieldUpdates.titulosAmistosos !== undefined) {
      const count = Math.max(0, parseInt(fieldUpdates.titulosAmistosos, 10) || 0);
      currentTitulos.amistosos = Array.from({ length: count }, (_, i) => `Título Amistoso #${i + 1}`);
    }

    playerDoc.titulos = currentTitulos;
  }
  if (fieldUpdates.pg !== undefined || fieldUpdates.partidosGanadosHistorico !== undefined) {
    playerDoc.partidosGanadosHistorico = Math.max(0, parseInt(fieldUpdates.pg ?? fieldUpdates.partidosGanadosHistorico, 10) || 0);
  }
  if (fieldUpdates.pp !== undefined || fieldUpdates.partidosPerdidosHistorico !== undefined) {
    playerDoc.partidosPerdidosHistorico = Math.max(0, parseInt(fieldUpdates.pp ?? fieldUpdates.partidosPerdidosHistorico, 10) || 0);
  }
  if (fieldUpdates.wo !== undefined || fieldUpdates.woHistorico !== undefined) {
    playerDoc.woHistorico = Math.max(0, parseInt(fieldUpdates.wo ?? fieldUpdates.woHistorico, 10) || 0);
  }
  if (fieldUpdates.gf !== undefined || fieldUpdates.golesAFavorHistorico !== undefined) {
    playerDoc.golesAFavorHistorico = Math.max(0, parseInt(fieldUpdates.gf ?? fieldUpdates.golesAFavorHistorico, 10) || 0);
  }
  if (fieldUpdates.gc !== undefined || fieldUpdates.golesEnContraHistorico !== undefined) {
    playerDoc.golesEnContraHistorico = Math.max(0, parseInt(fieldUpdates.gc ?? fieldUpdates.golesEnContraHistorico, 10) || 0);
  }
  if (fieldUpdates.aliases !== undefined) {
    let newAliases = [];
    if (Array.isArray(fieldUpdates.aliases)) {
      newAliases = fieldUpdates.aliases.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof fieldUpdates.aliases === 'string') {
      newAliases = fieldUpdates.aliases.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    }
    // Combinar o asignar según si se pasa add_alias o replace
    if (fieldUpdates.appendAlias && Array.isArray(playerDoc.aliases)) {
      const set = new Set([...playerDoc.aliases, ...newAliases]);
      playerDoc.aliases = Array.from(set);
    } else {
      playerDoc.aliases = Array.from(new Set(newAliases));
    }
  }

  await playerDoc.save();

  const finalId = String(playerDoc.id || playerDoc._id);
  const finalName = playerDoc.nombre;

  let affectedCompeticiones = 0;
  let affectedPartidos = 0;

  // 2. Si cambió el nombre o el ID, re-linkear en todas las referencias del bot
  if (updatedName || updatedId || finalId !== oldId || finalName !== oldName) {
    const regularLigaModels = [Primera, Segunda, Tercera];

    for (const model of regularLigaModels) {
      const ligas = await model.find({}).catch(() => []);
      for (const ligaDoc of ligas) {
        let modified = false;

        if (Array.isArray(ligaDoc.jugadores)) {
          for (const j of ligaDoc.jugadores) {
            if (oldIds.includes(String(j.id || j.discordId || '')) || (oldName && j.nombre?.toLowerCase().trim() === oldName.toLowerCase().trim())) {
              j.id = finalId;
              j.nombre = finalName;
              if (playerDoc.discordId) j.discordId = playerDoc.discordId;
              modified = true;
            }
          }
        }

        const schedule = ligaDoc.partidos ?? ligaDoc.fechas ?? [];
        if (Array.isArray(schedule)) {
          for (const fecha of schedule) {
            const partidos = fecha.partidos ?? fecha.encuentros ?? [];
            if (Array.isArray(partidos)) {
              for (const p of partidos) {
                if (oldIds.includes(String(p.localId || '')) || (oldName && p.localNombre?.toLowerCase().trim() === oldName.toLowerCase().trim())) {
                  p.localId = finalId;
                  p.localNombre = finalName;
                  affectedPartidos++;
                  modified = true;
                }
                if (oldIds.includes(String(p.visitanteId || '')) || (oldName && p.visitanteNombre?.toLowerCase().trim() === oldName.toLowerCase().trim())) {
                  p.visitanteId = finalId;
                  p.visitanteNombre = finalName;
                  affectedPartidos++;
                  modified = true;
                }
              }
            }
          }
        }

        if (modified) {
          affectedCompeticiones++;
          await ligaDoc.save();
        }
      }
    }

    // Re-linkear en Equipos / Superliga
    const equipos = await Equipos.find({}).catch(() => []);
    for (const eq of equipos) {
      let eqMod = false;
      if (eq.coach && (oldIds.includes(String(eq.coach.id || '')) || (oldName && eq.coach.nombre?.toLowerCase() === oldName.toLowerCase()))) {
        eq.coach.id = finalId;
        eq.coach.nombre = finalName;
        eqMod = true;
      }
      if (Array.isArray(eq.jugadores)) {
        for (const j of eq.jugadores) {
          if (oldIds.includes(String(j.id || '')) || (oldName && j.nombre?.toLowerCase() === oldName.toLowerCase())) {
            j.id = finalId;
            j.nombre = finalName;
            eqMod = true;
          }
        }
      }
      if (eqMod) await eq.save();
    }

    // Re-linkear en Copas y Torneos
    const copasModels = [Torneo, Coppa];
    for (const cModel of copasModels) {
      const torneos = await cModel.find({}).catch(() => []);
      for (const tDoc of torneos) {
        let tMod = false;
        if (Array.isArray(tDoc.equipos)) {
          for (const eq of tDoc.equipos) {
            if (oldIds.includes(String(eq.id || '')) || (oldName && eq.nombre?.toLowerCase() === oldName.toLowerCase())) {
              eq.id = finalId;
              eq.nombre = finalName;
              tMod = true;
            }
          }
        }
        if (Array.isArray(tDoc.enfrentamientosGrupos)) {
          for (const enf of tDoc.enfrentamientosGrupos) {
            if (oldIds.includes(String(enf.localId || '')) || (oldName && enf.local?.toLowerCase() === oldName.toLowerCase())) {
              enf.localId = finalId;
              enf.local = finalName;
              tMod = true;
            }
            if (oldIds.includes(String(enf.visitanteId || '')) || (oldName && enf.visitante?.toLowerCase() === oldName.toLowerCase())) {
              enf.visitanteId = finalId;
              enf.visitante = finalName;
              tMod = true;
            }
          }
        }
        if (tMod) {
          affectedCompeticiones++;
          await tDoc.save();
        }
      }
    }

    // Actualizar rivalNombre en los historiales H2H de otros jugadores
    const allOtherPlayers = await Jugador.find({}).catch(() => []);
    for (const otherP of allOtherPlayers) {
      if (String(otherP._id || otherP.id) === finalId) continue;
      if (Array.isArray(otherP.historial)) {
        let hMod = false;
        for (const h of otherP.historial) {
          if (oldIds.includes(String(h.rivalId || ''))) {
            h.rivalId = finalId;
            h.rivalNombre = finalName;
            hMod = true;
          }
        }
        if (hMod) await otherP.save();
      }
    }
  }

  // 3. Descargar y cachear avatar si cliente disponible o si tiene discordId
  const avatarResult = await getOrCachePlayerAvatar(finalId, client);

  return {
    success: true,
    playerDoc,
    finalId,
    finalName,
    affectedCompeticiones,
    affectedPartidos,
    hasCachedAvatar: !!avatarResult
  };
}
