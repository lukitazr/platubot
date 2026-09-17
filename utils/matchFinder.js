import Primera from '../models/Primera.js';
import Segunda from '../models/Segunda.js';
import Tercera from '../models/Tercera.js';
import Superliga from '../models/superliga/Superliga.js';
import Coppa from '../models/copas/Coppa.js';
import Torneo from '../models/copas/Torneo.js';
import { resolvePlayers } from './db/userResolver.js';

/**
 * Busca todos los partidos pendientes de un usuario agrupados a través de todas las competiciones
 * activas asociadas a un canal de resultados específico (o globales para el usuario).
 */
function isValidParticipant(id, name) {
  const idStr = String(id || '').trim();
  const nameStr = String(name || '').trim();
  if (!idStr && !nameStr) return false;
  const upper = (idStr + ' ' + nameStr).toUpperCase();
  if (
    upper.includes('TBD') ||
    upper.includes('BYE') ||
    upper.includes('POR DEFINIR') ||
    upper.includes('VACIO') ||
    upper.includes('LIBRE') ||
    upper.includes('DESCONOCIDO')
  ) {
    return false;
  }
  return true;
}

/**
 * Busca todos los partidos pendientes de un usuario agrupados a través de todas las competiciones
 * activas asociadas a un canal de resultados específico (o globales para el usuario).
 */
export async function findPendingMatchesForUser(userId, channelId = null, client = null) {
  if (!userId) return [];
  const idStr = String(userId).trim();
  const candidates = [];

  const isChannelCompatible = (targetChannelId, envVarName) => {
    if (!channelId) return true;
    if (targetChannelId && String(targetChannelId) === String(channelId)) return true;
    if (envVarName && process.env[envVarName] && String(process.env[envVarName]) === String(channelId)) return true;
    if (!targetChannelId && (!envVarName || !process.env[envVarName])) return true;
    return true;
  };

  // 1. Ligas Regulares (Primera, Segunda, Tercera)
  const leagueConfigs = [
    { model: Primera, name: 'Primera División', envChannel: 'CANAL_RESULTADOS_PRIMERA', code: 'primera' },
    { model: Segunda, name: 'Segunda División', envChannel: 'CANAL_RESULTADOS_SEGUNDA', code: 'segunda' },
    { model: Tercera, name: 'Tercera División', envChannel: 'CANAL_RESULTADOS_TERCERA', code: 'tercera' }
  ];

  for (const { model, name, envChannel, code } of leagueConfigs) {
    if (!isChannelCompatible(null, envChannel)) continue;

    const ligas = await model.find({}).catch(() => []);
    for (const liga of ligas) {
      const canalResultados = liga.canalResultados || (envChannel && process.env[envChannel] ? process.env[envChannel] : null) || null;
      const schedule = liga.partidos ?? liga.fechas ?? [];
      for (const fecha of schedule) {
        const partidos = fecha.partidos ?? fecha.encuentros ?? [];
        for (const p of partidos) {
          if (!p || p.finalizado) continue;

          const locId = String(p.localId || p.localDiscordId || '').trim();
          const visId = String(p.visitanteId || p.visitanteDiscordId || '').trim();
          const locNom = String(p.localNombre || '').trim();
          const visNom = String(p.visitanteNombre || '').trim();

          // Solo partidos definidos
          if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

          // Solo del usuario que mandó la imagen
          const isLocal = locId === idStr;
          const isVisitante = visId === idStr;
          if (isLocal || isVisitante) {
            candidates.push({
              matchId: String(p._id || p.id),
              competicionNombre: `${name} (${liga.nombreLiga || 'Temporada Actual'})`,
              competicionCodigo: code,
              canalResultados: canalResultados ? String(canalResultados) : null,
              etiqueta: `F${fecha.numero || 1}: ${p.localNombre} vs ${p.visitanteNombre}`,
              localId: locId,
              visitanteId: visId,
              localNombre: p.localNombre,
              visitanteNombre: p.visitanteNombre,
              modelDoc: liga,
              partidoRef: p
            });
          }
        }
      }
    }
  }

  // 2. Superliga
  if (isChannelCompatible(null, 'CANAL_RESULTADOS_SUPERLIGA')) {
    const superligas = await Superliga.find({ actual: true }).catch(() => []);
    for (const superliga of superligas) {
      const canalResultados = superliga.canalResultados || process.env.CANAL_RESULTADOS_SUPERLIGA || null;
      const schedule = superliga.fechas ?? [];
      for (const fecha of schedule) {
        const encuentros = fecha.encuentros ?? fecha.partidos ?? [];
        for (let pIdx = 0; pIdx < encuentros.length; pIdx++) {
          const p = encuentros[pIdx];
          if (!p || p.finalizado) continue;

          // Si el partido tiene 3 mini encuentros (duelosIndividuales)
          if (Array.isArray(p.duelosIndividuales) && p.duelosIndividuales.length > 0) {
            for (let dIdx = 0; dIdx < p.duelosIndividuales.length; dIdx++) {
              const d = p.duelosIndividuales[dIdx];
              if (!d || d.finalizado) continue;

              const locJugId = String(d.localJugadorId || d.localId || '').trim();
              const visJugId = String(d.visitanteJugadorId || d.visitanteId || '').trim();
              const locJugNom = String(d.localJugadorNombre || d.localNombre || p.localNombre || 'Local').trim();
              const visJugNom = String(d.visitanteJugadorNombre || d.visitanteNombre || p.visitanteNombre || 'Visitante').trim();

              // Solo minipartidos DEFINIDOS
              if (!isValidParticipant(locJugId, locJugNom) || !isValidParticipant(visJugId, visJugNom)) continue;

              // Solo del usuario que mandó la imagen
              const isUserDuel = locJugId === idStr || visJugId === idStr;
              if (isUserDuel) {
                const matchId = String(d._id || d.id || `sl_f${fecha.numero}_p${pIdx}_d${dIdx}`);
                candidates.push({
                  matchId,
                  competicionNombre: `Superliga (Temporada ${superliga.temporada || 'Actual'})`,
                  competicionCodigo: 'superliga',
                  canalResultados: canalResultados ? String(canalResultados) : null,
                  etiqueta: `F${fecha.numero} [Mini ${dIdx + 1}]: ${locJugNom} vs ${visJugNom} (${p.localNombre} vs ${p.visitanteNombre})`,
                  localId: locJugId,
                  visitanteId: visJugId,
                  localNombre: locJugNom,
                  visitanteNombre: visJugNom,
                  modelDoc: superliga,
                  partidoRef: p,
                  dueloRef: d,
                  duelIdx: dIdx,
                  fechaNum: fecha.numero
                });
              }
            }
          } else {
            // Partido 1v1 sin duelos
            const locId = String(p.localId || p.localDiscordId || '').trim();
            const visId = String(p.visitanteId || p.visitanteDiscordId || '').trim();
            const locNom = String(p.localNombre || '').trim();
            const visNom = String(p.visitanteNombre || '').trim();

            if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

            const isUserMatch = locId === idStr || visId === idStr;
            if (isUserMatch) {
              const matchId = String(p._id || p.id || `sl_f${fecha.numero}_p${pIdx}`);
              candidates.push({
                matchId,
                competicionNombre: `Superliga (Temporada ${superliga.temporada || 'Actual'})`,
                competicionCodigo: 'superliga',
                canalResultados: canalResultados ? String(canalResultados) : null,
                etiqueta: `F${fecha.numero || 1}: ${p.localNombre} vs ${p.visitanteNombre}`,
                localId: locId,
                visitanteId: visId,
                localNombre: p.localNombre,
                visitanteNombre: p.visitanteNombre,
                modelDoc: superliga,
                partidoRef: p,
                fechaNum: fecha.numero
              });
            }
          }
        }
      }
    }
  }

  // 2b. Supersupercopa
  if (isChannelCompatible(null, 'CANAL_RESULTADOS_SUPERSUPERCOPA') || isChannelCompatible(null, 'CANAL_RESULTADOS_SUPERCOPA') || isChannelCompatible(null, 'CANAL_RESULTADOS_SUPERLIGA')) {
    const Supersupercopa = (await import('../models/superliga/Supersupercopa.js')).default;
    const copas = await Supersupercopa.find({ $or: [{ actual: true }, { estadoGlobal: 'Activa' }, { estado: 'EnCurso' }] }).catch(() => []);
    if (!copas.length) {
      const latest = await Supersupercopa.findOne({}).catch(() => null);
      if (latest && latest.estadoGlobal !== 'Finalizada') copas.push(latest);
    }

    for (const copa of copas) {
      const canalResultados = copa.canalResultados || process.env.CANAL_RESULTADOS_SUPERSUPERCOPA || process.env.CANAL_RESULTADOS_SUPERCOPA || process.env.CANAL_RESULTADOS_SUPERLIGA || null;
      const sscCompNombre = `Supersupercopa (Temporada ${copa.temporada || 'Actual'})`;

      // Fase de grupos
      if (copa.fase === 'grupos' || (copa.grupos && Array.isArray(copa.grupos))) {
        for (let gIdx = 0; gIdx < copa.grupos.length; gIdx++) {
          const g = copa.grupos[gIdx];
          const fechas = g.fechas || [];
          for (let fIdx = 0; fIdx < fechas.length; fIdx++) {
            const f = fechas[fIdx];
            const partidos = f.partidos ?? f.encuentros ?? [];
            for (let pIdx = 0; pIdx < partidos.length; pIdx++) {
              const p = partidos[pIdx];
              if (!p || p.finalizado) continue;

              if (Array.isArray(p.duelosIndividuales) && p.duelosIndividuales.length > 0) {
                for (let dIdx = 0; dIdx < p.duelosIndividuales.length; dIdx++) {
                  const d = p.duelosIndividuales[dIdx];
                  if (!d || d.finalizado) continue;

                  const locJugId = String(d.localJugadorId || d.localId || '').trim();
                  const visJugId = String(d.visitanteJugadorId || d.visitanteId || '').trim();
                  const locJugNom = String(d.localJugadorNombre || d.localNombre || p.localNombre || 'Local').trim();
                  const visJugNom = String(d.visitanteJugadorNombre || d.visitanteNombre || p.visitanteNombre || 'Visitante').trim();

                  // Solo minipartidos DEFINIDOS
                  if (!isValidParticipant(locJugId, locJugNom) || !isValidParticipant(visJugId, visJugNom)) continue;

                  // Solo del usuario que mandó la imagen
                  const isUserDuel = locJugId === idStr || visJugId === idStr;
                  if (isUserDuel) {
                    const matchId = String(d._id || d.id || `ssc_g_${gIdx}_f${fIdx}_p${pIdx}_d${dIdx}`);
                    candidates.push({
                      matchId,
                      competicionNombre: sscCompNombre,
                      competicionCodigo: 'supersupercopa',
                      canalResultados: canalResultados ? String(canalResultados) : null,
                      etiqueta: `Grupo ${g.nombre || (gIdx === 0 ? 'A' : 'B')} - F${f.numero || fIdx + 1} [Mini ${dIdx + 1}]: ${locJugNom} vs ${visJugNom} (${p.localNombre} vs ${p.visitanteNombre})`,
                      localId: locJugId,
                      visitanteId: visJugId,
                      localNombre: locJugNom,
                      visitanteNombre: visJugNom,
                      modelDoc: copa,
                      partidoRef: p,
                      dueloRef: d,
                      duelIdx: dIdx,
                      grupoIdx: gIdx,
                      fechaNum: f.numero || fIdx + 1
                    });
                  }
                }
              } else {
                const locId = String(p.localId || p.localDiscordId || '').trim();
                const visId = String(p.visitanteId || p.visitanteDiscordId || '').trim();
                const locNom = String(p.localNombre || '').trim();
                const visNom = String(p.visitanteNombre || '').trim();

                if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

                const isUserMatch = locId === idStr || visId === idStr;
                if (isUserMatch) {
                  const matchId = String(p._id || p.id || `ssc_g_${gIdx}_f${fIdx}_p${pIdx}`);
                  candidates.push({
                    matchId,
                    competicionNombre: sscCompNombre,
                    competicionCodigo: 'supersupercopa',
                    canalResultados: canalResultados ? String(canalResultados) : null,
                    etiqueta: `Grupo ${g.nombre || (gIdx === 0 ? 'A' : 'B')} - F${f.numero || fIdx + 1}: ${p.localNombre} vs ${p.visitanteNombre}`,
                    localId: locId,
                    visitanteId: visId,
                    localNombre: p.localNombre,
                    visitanteNombre: p.visitanteNombre,
                    modelDoc: copa,
                    partidoRef: p,
                    grupoIdx: gIdx,
                    fechaNum: f.numero || fIdx + 1
                  });
                }
              }
            }
          }
        }
      }

      // Fase de semifinales
      if (copa.fase === 'semifinales' && Array.isArray(copa.semifinales)) {
        for (let sIdx = 0; sIdx < copa.semifinales.length; sIdx++) {
          const llave = copa.semifinales[sIdx];
          if (llave && !llave.finalizado) {
            const locId = String(llave.localId || '').trim();
            const visId = String(llave.visitanteId || '').trim();
            const locNom = String(llave.localNombre || '').trim();
            const visNom = String(llave.visitanteNombre || '').trim();

            if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

            const isUserMatch = locId === idStr || visId === idStr;
            if (isUserMatch) {
              const matchId = String(llave._id || llave.id || `ssc_semi_${sIdx}`);
              candidates.push({
                matchId,
                competicionNombre: sscCompNombre,
                competicionCodigo: 'supersupercopa',
                canalResultados: canalResultados ? String(canalResultados) : null,
                etiqueta: `Semi ${sIdx + 1}: ${llave.localNombre} vs ${llave.visitanteNombre}`,
                localId: locId,
                visitanteId: visId,
                localNombre: llave.localNombre,
                visitanteNombre: llave.visitanteNombre,
                modelDoc: copa,
                partidoRef: llave,
                isIdaVuelta: true
              });
            }
          }
        }
      }

      // Fase de final
      if (copa.fase === 'final' && copa.final && !copa.final.finalizado) {
        const llave = copa.final;
        const locId = String(llave.localId || '').trim();
        const visId = String(llave.visitanteId || '').trim();
        const locNom = String(llave.localNombre || '').trim();
        const visNom = String(llave.visitanteNombre || '').trim();

        if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

        const isUserMatch = locId === idStr || visId === idStr;
        if (isUserMatch) {
          const matchId = String(llave._id || llave.id || 'ssc_final');
          candidates.push({
            matchId,
            competicionNombre: sscCompNombre,
            competicionCodigo: 'supersupercopa',
            canalResultados: canalResultados ? String(canalResultados) : null,
            etiqueta: `Final: ${llave.localNombre} vs ${llave.visitanteNombre}`,
            localId: locId,
            visitanteId: visId,
            localNombre: llave.localNombre,
            visitanteNombre: llave.visitanteNombre,
            modelDoc: copa,
            partidoRef: llave,
            isIdaVuelta: true
          });
        }
      }
    }
  }

  // 3. Coppa (Eliminatoria Directa)
  if (isChannelCompatible(null, 'CANAL_RESULTADOS_COPPA')) {
    const coppas = await Coppa.find({ estado: 'EnCurso' }).catch(() => []);
    for (const coppa of coppas) {
      const canalResultados = coppa.canalResultados || process.env.CANAL_RESULTADOS_COPPA || null;
      const faseActual = coppa.fasesEliminatoria[coppa.faseActual] || 'Fase Actual';
      const llaves = coppa.llaves[faseActual] ?? [];
      for (const llave of llaves) {
        if (!llave.ganador) {
          const eq1 = llave.equipo1 ?? {};
          const eq2 = llave.equipo2 ?? {};
          const locId = String(eq1.discordId || eq1.id || '').trim();
          const visId = String(eq2.discordId || eq2.id || '').trim();
          const locNom = String(eq1.nombre || '').trim();
          const visNom = String(eq2.nombre || '').trim();

          if (!isValidParticipant(locId, locNom) || !isValidParticipant(visId, visNom)) continue;

          const isUserMatch = locId === idStr || visId === idStr;
          if (isUserMatch) {
            candidates.push({
              matchId: String(llave.id || llave._id),
              competicionNombre: `Coppa (${faseActual})`,
              competicionCodigo: 'coppa',
              canalResultados: canalResultados ? String(canalResultados) : null,
              etiqueta: `${faseActual}: ${eq1.nombre} vs ${eq2.nombre}`,
              localId: locId,
              visitanteId: visId,
              localNombre: eq1.nombre,
              visitanteNombre: eq2.nombre,
              modelDoc: coppa,
              partidoRef: llave
            });
          }
        }
      }
    }
  }

  // 4. Torneos Personalizados (Individuales y Equipos)
  const torneos = await Torneo.find({}).catch(() => []);
  for (const torneo of torneos) {
    if (torneo.estado === 'Finalizado') continue;
    const canalResultados = torneo.canalResultados || process.env.CANAL_RESULTADOS_TORNEO || null;

    const equipos = torneo.equipos || [];
    const playerIdsToResolve = new Set();

    const extractPlayerId = (val) => {
      if (!val) return '';
      if (typeof val === 'string') return val;
      if (typeof val === 'object') return String(val.discordId || val.id || val._id || val.userId || '');
      return String(val);
    };

    const getDuelLocalId = (d) => extractPlayerId(d.localJugador) || extractPlayerId(d.jugadorLocalId) || extractPlayerId(d.localJugadorId);
    const getDuelVisitanteId = (d) => extractPlayerId(d.visitanteJugador) || extractPlayerId(d.jugadorVisitanteId) || extractPlayerId(d.visitanteJugadorId);

    // Recolectar IDs de duelos para resolución de nombres relacionales
    (torneo.enfrentamientosGrupos || []).forEach(p => {
      if (Array.isArray(p.duelosIndividuales)) {
        p.duelosIndividuales.forEach(d => {
          const l = getDuelLocalId(d);
          const v = getDuelVisitanteId(d);
          if (l) playerIdsToResolve.add(l);
          if (v) playerIdsToResolve.add(v);
        });
      }
    });
    const playerMap = await resolvePlayers(playerIdsToResolve, client);

    const partidosGrupos = torneo.enfrentamientosGrupos ?? [];
    partidosGrupos.forEach((partido) => {
      if (!partido.completado && partido.resultado === 'Pendiente') {
        const localTeam = equipos.find(eq => eq.nombre === partido.local || String(eq.id) === String(partido.localId));
        const visitanteTeam = equipos.find(eq => eq.nombre === partido.visitante || String(eq.id) === String(partido.visitanteId));

        const isLocalOwner = String(partido.localId || partido.localDiscordId || partido.localOwner || localTeam?.propietario || localTeam?.discordId || '') === idStr;
        const isVisitanteOwner = String(partido.visitanteId || partido.visitanteDiscordId || partido.visitanteOwner || visitanteTeam?.propietario || visitanteTeam?.discordId || '') === idStr;

        const isLocalMember = isLocalOwner || localTeam?.miembros?.some(m => String(typeof m === 'string' ? m : m.discordId) === idStr);
        const isVisitanteMember = isVisitanteOwner || visitanteTeam?.miembros?.some(m => String(typeof m === 'string' ? m : m.discordId) === idStr);

        const isLocalCoach = isLocalOwner || (localTeam?.coach && String(localTeam.coach.id || localTeam.coach.discordId || '') === idStr);
        const isVisitanteCoach = isVisitanteOwner || (visitanteTeam?.coach && String(visitanteTeam.coach.id || visitanteTeam.coach.discordId || '') === idStr);

        // Búsqueda en duelos individuales por equipo
        if (Array.isArray(partido.duelosIndividuales) && partido.duelosIndividuales.length > 0) {
          partido.duelosIndividuales.forEach((duelo, dIdx) => {
            if (!duelo.finalizado) {
              const dLocalId = getDuelLocalId(duelo);
              const dVisId = getDuelVisitanteId(duelo);

              const pL = playerMap.get(dLocalId);
              const pV = playerMap.get(dVisId);
              const lName = pL?.nombre || duelo.localJugadorNombre || duelo.localNombre || (dLocalId ? `Jugador (${dLocalId.slice(-4)})` : 'Local');
              const vName = pV?.nombre || duelo.visitanteJugadorNombre || duelo.visitanteNombre || (dVisId ? `Jugador (${dVisId.slice(-4)})` : 'Visitante');

              // Solo duelos DEFINIDOS
              if (!isValidParticipant(dLocalId, lName) || !isValidParticipant(dVisId, vName)) return;

              // Solo del usuario que mandó la imagen
              const isPlayerDuel = (dLocalId && dLocalId === idStr) || (dVisId && dVisId === idStr);
              if (isPlayerDuel) {
                const compTipo = torneo.formatoPreset === 'liga' ? 'Liga' : 'Grupos';
                const grupoLabel = partido.grupo ? `Grupo ${partido.grupo}: ` : '';

                candidates.push({
                  matchId: String(duelo.id || duelo._id || `${partido.local}_vs_${partido.visitante}_d${dIdx}`),
                  competicionNombre: `Torneo ${torneo.nombre} (${compTipo} - Duelo ${dIdx + 1})`,
                  competicionCodigo: `torneo_${torneo.prefix || 'custom'}`,
                  canalResultados: canalResultados ? String(canalResultados) : null,
                  etiqueta: `${grupoLabel}${partido.local} vs ${partido.visitante} (${lName} vs ${vName})`,
                  localId: dLocalId,
                  visitanteId: dVisId,
                  localNombre: lName,
                  visitanteNombre: vName,
                  modelDoc: torneo,
                  partidoRef: duelo,
                  parentMatchRef: partido,
                  duelIdx: dIdx
                });
              }
            }
          });
        } else {
          const locId = String(localTeam?.propietario || localTeam?.discordId || partido.localId || '').trim();
          const visId = String(visitanteTeam?.propietario || visitanteTeam?.discordId || partido.visitanteId || '').trim();
          const locNom = String(partido.local || partido.localNombre || '').trim();
          const visNom = String(partido.visitante || partido.visitanteNombre || '').trim();

          if (isValidParticipant(locId, locNom) && isValidParticipant(visId, visNom)) {
            const isUserMatch = locId === idStr || visId === idStr;
            if (isUserMatch) {
              const compTipo = torneo.formatoPreset === 'liga' ? 'Liga' : 'Grupos';
              const grupoLabel = partido.grupo ? `Grupo ${partido.grupo}: ` : '';

              candidates.push({
                matchId: String(partido.id || partido._id || `${partido.local}_vs_${partido.visitante}`),
                competicionNombre: `Torneo ${torneo.nombre} (${compTipo})`,
                competicionCodigo: `torneo_${torneo.prefix || 'custom'}`,
                canalResultados: canalResultados ? String(canalResultados) : null,
                etiqueta: `${grupoLabel}${partido.local} vs ${partido.visitante}`,
                localId: locId,
                visitanteId: visId,
                localNombre: locNom,
                visitanteNombre: visNom,
                modelDoc: torneo,
                partidoRef: partido
              });
            }
          }
        }
      }
    });

    const llavesObj = torneo.llaves ?? {};
    for (const fase in llavesObj) {
      const llavesArray = llavesObj[fase] ?? [];
      for (const llave of llavesArray) {
        if (!llave.ganador) {
          const eq1 = llave.equipo1 ?? {};
          const eq2 = llave.equipo2 ?? {};

          const team1 = equipos.find(e => e.nombre === eq1.nombre || String(e.discordId || e.id) === String(eq1.discordId || eq1.id));
          const team2 = equipos.find(e => e.nombre === eq2.nombre || String(e.discordId || e.id) === String(eq2.discordId || eq2.id));

          if (Array.isArray(llave.duelosIndividuales) && llave.duelosIndividuales.length > 0) {
            llave.duelosIndividuales.forEach((duelo, dIdx) => {
              if (!duelo.finalizado) {
                const dLocalId = getDuelLocalId(duelo);
                const dVisId = getDuelVisitanteId(duelo);

                const pL = playerMap.get(dLocalId);
                const pV = playerMap.get(dVisId);
                const lName = pL?.nombre || duelo.localJugadorNombre || 'Local';
                const vName = pV?.nombre || duelo.visitanteJugadorNombre || 'Visitante';

                if (!isValidParticipant(dLocalId, lName) || !isValidParticipant(dVisId, vName)) return;

                const isPlayerDuel = (dLocalId && dLocalId === idStr) || (dVisId && dVisId === idStr);
                if (isPlayerDuel) {
                  candidates.push({
                    matchId: String(duelo.id || duelo._id || `${llave.id || fase}_d${dIdx}`),
                    competicionNombre: `Torneo ${torneo.nombre} (${fase} - Duelo ${dIdx + 1})`,
                    competicionCodigo: `torneo_${torneo.prefix || 'custom'}`,
                    canalResultados: canalResultados ? String(canalResultados) : null,
                    etiqueta: `${fase}: ${eq1.nombre} vs ${eq2.nombre} (${lName} vs ${vName})`,
                    localId: dLocalId,
                    visitanteId: dVisId,
                    localNombre: lName,
                    visitanteNombre: vName,
                    modelDoc: torneo,
                    partidoRef: duelo,
                    parentMatchRef: llave,
                    duelIdx: dIdx
                  });
                }
              }
            });
          } else {
            const locId = String(eq1.discordId || eq1.id || team1?.propietario || '').trim();
            const visId = String(eq2.discordId || eq2.id || team2?.propietario || '').trim();
            const locNom = String(eq1.nombre || '').trim();
            const visNom = String(eq2.nombre || '').trim();

            if (isValidParticipant(locId, locNom) && isValidParticipant(visId, visNom)) {
              const isUserMatch = locId === idStr || visId === idStr;
              if (isUserMatch) {
                candidates.push({
                  matchId: String(llave.id || llave._id),
                  competicionNombre: `Torneo ${torneo.nombre} (${fase})`,
                  competicionCodigo: `torneo_${torneo.prefix || 'custom'}`,
                  canalResultados: canalResultados ? String(canalResultados) : null,
                  etiqueta: `${fase}: ${eq1.nombre} vs ${eq2.nombre}`,
                  localId: locId,
                  visitanteId: visId,
                  localNombre: locNom,
                  visitanteNombre: visNom,
                  modelDoc: torneo,
                  partidoRef: llave
                });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}
