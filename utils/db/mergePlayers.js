import '../../database/polyfill.js';
import Jugador from '../../models/Jugador.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Equipos from '../../models/superliga/Equipos.js';
import JugadoresLibres from '../../models/superliga/JugadoresLibres.js';
import Superliga from '../../models/superliga/Superliga.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';

/**
 * Fusiona dos perfiles de jugador en el bot:
 * - targetId (mergeador): El jugador que SE QUEDA y recibe todas las estadísticas y referencias.
 * - sourceId (mergeado): El jugador que SE FUSIONA y cuyo perfil original es eliminado/limpiado.
 */
export async function mergePlayers(targetIdentifier, sourceIdentifier) {
  if (!targetIdentifier || !sourceIdentifier) {
    return { success: false, reason: 'Debes especificar el ID del jugador destino (mergeador) y el ID del jugador origen (mergeado).' };
  }

  const findDoc = async (identifier) => {
    const idStr = String(identifier).trim();
    const query = {
      $or: [
        { _id: idStr },
        { id: idStr },
        { discordId: idStr },
        { nombre: new RegExp(`^${idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      ]
    };
    return await Jugador.findOne(query).catch(() => null);
  };

  const targetDoc = await findDoc(targetIdentifier);
  const sourceDoc = await findDoc(sourceIdentifier);

  if (!targetDoc) {
    return { success: false, reason: `No se encontró ningún jugador destino que coincida con "${targetIdentifier}".` };
  }
  if (!sourceDoc) {
    return { success: false, reason: `No se encontró ningún jugador origen que coincida con "${sourceIdentifier}".` };
  }

  const realTargetId = String(targetDoc.id || targetDoc._id);
  const realSourceId = String(sourceDoc.id || sourceDoc._id);

  if (realTargetId === realSourceId || String(targetDoc._id) === String(sourceDoc._id)) {
    return { success: false, reason: 'No se puede fusionar un jugador consigo mismo.' };
  }

  const sourceName = sourceDoc.nombre;
  const targetName = targetDoc.nombre;

  const getDocIds = (doc) => {
    const dObj = doc.toJSON ? doc.toJSON() : doc;
    return [
      String(dObj._id || ''),
      String(dObj.id || ''),
      String(dObj.discordId || '')
    ].filter(Boolean);
  };

  const sourceIds = getDocIds(sourceDoc);
  const targetIds = getDocIds(targetDoc);

  // 1. Fusionar Estadísticas Globales en targetDoc
  const { normalizeTitulos } = await import('../torneos/titulosHelper.js');
  const targetTitulos = normalizeTitulos(targetDoc.titulos);
  const sourceTitulos = normalizeTitulos(sourceDoc.titulos);
  targetDoc.titulos = {
    oficiales: [...targetTitulos.oficiales, ...sourceTitulos.oficiales],
    amistosos: [...targetTitulos.amistosos, ...sourceTitulos.amistosos]
  };
  targetDoc.partidosGanadosHistorico = (targetDoc.partidosGanadosHistorico || 0) + (sourceDoc.partidosGanadosHistorico || 0);
  targetDoc.partidosPerdidosHistorico = (targetDoc.partidosPerdidosHistorico || 0) + (sourceDoc.partidosPerdidosHistorico || 0);
  targetDoc.woHistorico = (targetDoc.woHistorico || 0) + (sourceDoc.woHistorico || 0);
  targetDoc.golesAFavorHistorico = (targetDoc.golesAFavorHistorico || 0) + (sourceDoc.golesAFavorHistorico || 0);
  targetDoc.golesEnContraHistorico = (targetDoc.golesEnContraHistorico || 0) + (sourceDoc.golesEnContraHistorico || 0);

  if (!targetDoc.avatar && sourceDoc.avatar) {
    targetDoc.avatar = sourceDoc.avatar;
  }
  if (!targetDoc.discordId && sourceDoc.discordId) {
    targetDoc.discordId = sourceDoc.discordId;
  }

  // 2. Fusionar Historiales H2H (head-to-head)
  if (!Array.isArray(targetDoc.historial)) targetDoc.historial = [];
  const sourceHistorial = Array.isArray(sourceDoc.historial) ? sourceDoc.historial : [];

  for (const h of sourceHistorial) {
    const rivalIdStr = String(h.rivalId || '');
    if (sourceIds.includes(rivalIdStr) || targetIds.includes(rivalIdStr)) {
      continue; // Enfrentamientos directos entre ellos
    }

    let existingH2H = targetDoc.historial.find(entry => String(entry.rivalId) === rivalIdStr);
    if (!existingH2H) {
      existingH2H = {
        rivalId: rivalIdStr,
        rivalNombre: h.rivalNombre || 'Rival',
        pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
      };
      targetDoc.historial.push(existingH2H);
    }

    existingH2H.pj = (existingH2H.pj || 0) + (h.pj || 0);
    existingH2H.pg = (existingH2H.pg || 0) + (h.pg || 0);
    existingH2H.pe = (existingH2H.pe || 0) + (h.pe || 0);
    existingH2H.pp = (existingH2H.pp || 0) + (h.pp || 0);
    existingH2H.gf = (existingH2H.gf || 0) + (h.gf || 0);
    existingH2H.gc = (existingH2H.gc || 0) + (h.gc || 0);
  }

  // Actualizar H2H en otros jugadores de la base de datos
  const allOtherPlayers = await Jugador.find({}).catch(() => []);
  for (const otherP of allOtherPlayers) {
    const oId = String(otherP._id || otherP.id);
    if (sourceIds.includes(oId) || targetIds.includes(oId)) continue;

    if (Array.isArray(otherP.historial) && otherP.historial.length > 0) {
      let modified = false;
      const newHistorial = [];

      for (const h of otherP.historial) {
        const rId = String(h.rivalId || '');
        if (sourceIds.includes(rId)) {
          // Cambiar referencia al targetDoc
          h.rivalId = realTargetId;
          h.rivalNombre = targetName;
          modified = true;
        }

        // Combinar si ahora hay duplicados de rivalId
        const existingInNew = newHistorial.find(x => String(x.rivalId) === String(h.rivalId));
        if (existingInNew) {
          existingInNew.pj = (existingInNew.pj || 0) + (h.pj || 0);
          existingInNew.pg = (existingInNew.pg || 0) + (h.pg || 0);
          existingInNew.pe = (existingInNew.pe || 0) + (h.pe || 0);
          existingInNew.pp = (existingInNew.pp || 0) + (h.pp || 0);
          existingInNew.gf = (existingInNew.gf || 0) + (h.gf || 0);
          existingInNew.gc = (existingInNew.gc || 0) + (h.gc || 0);
        } else {
          newHistorial.push(h);
        }
      }

      if (modified) {
        otherP.historial = newHistorial;
        await otherP.save();
      }
    }
  }

  let affectedLigas = 0;
  let affectedPartidos = 0;

  // 3. Re-linkear referencias en Ligas Regulares (Primera, Segunda, Tercera)
  const regularLigaModels = [
    { model: Primera, name: 'Primera' },
    { model: Segunda, name: 'Segunda' },
    { model: Tercera, name: 'Tercera' }
  ];

  for (const { model } of regularLigaModels) {
    const ligas = await model.find({}).catch(() => []);
    for (const ligaDoc of ligas) {
      let modified = false;

      // a) Re-linkear en ligaDoc.jugadores
      if (Array.isArray(ligaDoc.jugadores)) {
        const sourceIndex = ligaDoc.jugadores.findIndex(j => sourceIds.includes(String(j.id || j.discordId || '')));
        const targetIndex = ligaDoc.jugadores.findIndex(j => targetIds.includes(String(j.id || j.discordId || '')));

        if (sourceIndex !== -1 && targetIndex !== -1) {
          // Ambos participaban en la misma temporada -> Fusionar stats de esa temporada
          const sJ = ligaDoc.jugadores[sourceIndex];
          const tJ = ligaDoc.jugadores[targetIndex];

          tJ.pj = (tJ.pj || 0) + (sJ.pj || 0);
          tJ.pg = (tJ.pg || 0) + (sJ.pg || 0);
          tJ.pe = (tJ.pe || 0) + (sJ.pe || 0);
          tJ.pp = (tJ.pp || 0) + (sJ.pp || 0);
          tJ.gf = (tJ.gf || 0) + (sJ.gf || 0);
          tJ.gc = (tJ.gc || 0) + (sJ.gc || 0);
          tJ.dif = tJ.gf - tJ.gc;
          tJ.puntos = (tJ.puntos || 0) + (sJ.puntos || 0);

          ligaDoc.jugadores.splice(sourceIndex, 1);
          modified = true;
        } else if (sourceIndex !== -1) {
          // Solo el origen estaba -> Cambiar ID y nombre al destino
          const sJ = ligaDoc.jugadores[sourceIndex];
          sJ.id = realTargetId;
          sJ.nombre = targetName;
          if (targetDoc.discordId) sJ.discordId = targetDoc.discordId;
          modified = true;
        }

        if (modified) {
          ligaDoc.jugadores.sort((a, b) => (b.puntos || 0) - (a.puntos || 0) || (b.dif || 0) - (a.dif || 0) || (b.gf || 0) - (a.gf || 0));
        }
      }

      // b) Re-linkear en ligaDoc.partidos
      const schedule = ligaDoc.partidos ?? ligaDoc.fechas ?? [];
      if (Array.isArray(schedule)) {
        for (const fecha of schedule) {
          const partidos = fecha.partidos ?? fecha.encuentros ?? [];
          if (Array.isArray(partidos)) {
            for (const p of partidos) {
              if (sourceIds.includes(String(p.localId || '')) || (p.localNombre && p.localNombre.toLowerCase().trim() === sourceName.toLowerCase().trim())) {
                p.localId = realTargetId;
                p.localNombre = targetName;
                affectedPartidos++;
                modified = true;
              }
              if (sourceIds.includes(String(p.visitanteId || '')) || (p.visitanteNombre && p.visitanteNombre.toLowerCase().trim() === sourceName.toLowerCase().trim())) {
                p.visitanteId = realTargetId;
                p.visitanteNombre = targetName;
                affectedPartidos++;
                modified = true;
              }
            }
          }
        }
      }

      if (modified) {
        affectedLigas++;
        await ligaDoc.save();
      }
    }
  }

  // 4. Re-linkear referencias en Superliga (Equipos y JugadoresLibres)
  const equipos = await Equipos.find({}).catch(() => []);
  for (const eq of equipos) {
    let eqMod = false;
    if (eq.coach && sourceIds.includes(String(eq.coach.id || eq.coach.discordId || ''))) {
      eq.coach.id = realTargetId;
      eq.coach.nombre = targetName;
      eqMod = true;
    }
    if (Array.isArray(eq.jugadores)) {
      for (const j of eq.jugadores) {
        if (sourceIds.includes(String(j.id || j.discordId || ''))) {
          j.id = realTargetId;
          j.nombre = targetName;
          eqMod = true;
        }
      }
    }
    if (eqMod) await eq.save();
  }

  const libres = await JugadoresLibres.find({}).catch(() => []);
  for (const lib of libres) {
    if (sourceIds.includes(String(lib._id || lib.id))) {
      await lib.delete();
    }
  }

  // 5. Re-linkear referencias en Copas y Torneos (Torneo, Coppa)
  const copasModels = [Torneo, Coppa];
  for (const cModel of copasModels) {
    const torneos = await cModel.find({}).catch(() => []);
    for (const tDoc of torneos) {
      let tMod = false;

      // Re-linkear equipos / participantes
      if (Array.isArray(tDoc.equipos)) {
        for (const eq of tDoc.equipos) {
          if (sourceIds.includes(String(eq.id || eq.discordId || '')) || (eq.nombre && eq.nombre.toLowerCase().trim() === sourceName.toLowerCase().trim())) {
            eq.id = realTargetId;
            eq.nombre = targetName;
            tMod = true;
          }
        }
      }

      // Re-linkear enfrentamientos de grupos
      if (Array.isArray(tDoc.enfrentamientosGrupos)) {
        for (const enf of tDoc.enfrentamientosGrupos) {
          if (sourceIds.includes(String(enf.localId || '')) || (enf.local && enf.local.toLowerCase().trim() === sourceName.toLowerCase().trim())) {
            enf.localId = realTargetId;
            enf.local = targetName;
            tMod = true;
          }
          if (sourceIds.includes(String(enf.visitanteId || '')) || (enf.visitante && enf.visitante.toLowerCase().trim() === sourceName.toLowerCase().trim())) {
            enf.visitanteId = realTargetId;
            enf.visitante = targetName;
            tMod = true;
          }
        }
      }

      if (tMod) await tDoc.save();
    }
  }

  // 6. Guardar jugador destino y eliminar jugador origen
  await targetDoc.save();
  await sourceDoc.delete();

  return {
    success: true,
    targetName,
    sourceName,
    realTargetId,
    realSourceId,
    affectedLigas,
    affectedPartidos,
    targetDoc
  };
}
