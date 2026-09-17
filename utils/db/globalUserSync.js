import Jugador from '../../models/Jugador.js';
import Equipos from '../../models/superliga/Equipos.js';
import JugadoresLibres from '../../models/superliga/JugadoresLibres.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';

/**
 * Propaga los cambios de un usuario a través de todos los modelos relacionales por ID.
 */
export async function syncUserGlobal(userId, updates = {}) {
  if (!userId) return null;
  const idStr = String(userId);

  // 1. Actualizar o crear en modelo global Jugador
  let jugador = await Jugador.findById(idStr);
  if (!jugador) {
    jugador = await Jugador.create({ id: idStr, ...updates });
  } else if (Object.keys(updates).length > 0) {
    await jugador.update(updates);
  }

  const nombre = jugador.nombre || updates.nombre;

  // 2. Sincronizar en Equipos de Superliga
  const equipos = await Equipos.find({});
  for (const equipo of equipos) {
    let modified = false;

    // Verificar si es Coach
    if (equipo.coach && (String(equipo.coach.id) === idStr || String(equipo.coach.discordId) === idStr)) {
      if (nombre && equipo.coach.nombre !== nombre) {
        equipo.coach.nombre = nombre;
        modified = true;
      }
    }

    // Verificar si está en la plantilla de jugadores del equipo
    if (Array.isArray(equipo.jugadores)) {
      for (const p of equipo.jugadores) {
        if (String(p.id) === idStr || String(p.discordId) === idStr) {
          if (nombre && p.nombre !== nombre) {
            p.nombre = nombre;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      await equipo.save();
    }
  }

  // 3. Sincronizar en JugadoresLibres
  const libre = await JugadoresLibres.findById(idStr);
  if (libre && nombre && libre.nombre !== nombre) {
    await libre.update({ nombre });
  }

  // 4. Sincronizar en Ligas (Primera, Segunda, Tercera)
  const ligas = [
    { model: Primera, name: 'Primera' },
    { model: Segunda, name: 'Segunda' },
    { model: Tercera, name: 'Tercera' }
  ];

  for (const { model } of ligas) {
    const docs = await model.find({});
    for (const doc of docs) {
      let modified = false;
      if (Array.isArray(doc.jugadores)) {
        for (const j of doc.jugadores) {
          if (String(j.id) === idStr || String(j.discordId) === idStr) {
            if (nombre && j.nombre !== nombre) {
              j.nombre = nombre;
              modified = true;
            }
          }
        }
      }
      if (modified) {
        await doc.save();
      }
    }
  }

  return jugador;
}

/**
 * Registra un resultado de partido y actualiza automáticamente:
 * - Stats históricas globales (W/L/GF/GC/H2H) en el modelo Jugador de ambos usuarios.
 * - Sincronización relacional a través de todos los modelos vinculados.
 */
export async function recordMatchResultGlobal({
  localUserId,
  visitanteUserId,
  localNombre = 'Local',
  visitanteNombre = 'Visitante',
  golesLocal = 0,
  golesVisitante = 0,
  context = ''
}) {
  if (!localUserId || !visitanteUserId) {
    return { success: false, reason: 'IDs de usuario no especificados' };
  }

  const gl = parseInt(golesLocal) || 0;
  const gv = parseInt(golesVisitante) || 0;

  // 1. Obtener o crear usuarios globales
  const localPlayer = await syncUserGlobal(localUserId, { nombre: localNombre });
  const visitantePlayer = await syncUserGlobal(visitanteUserId, { nombre: visitanteNombre });

  // 2. Determinar resultado
  const isLocalWinner = gl > gv;
  const isVisitanteWinner = gv > gl;
  const isEmpate = gl === gv;

  // 3. Actualizar stats de jugador Local
  localPlayer.golesAFavorHistorico = (localPlayer.golesAFavorHistorico || 0) + gl;
  localPlayer.golesEnContraHistorico = (localPlayer.golesEnContraHistorico || 0) + gv;

  if (isLocalWinner) localPlayer.partidosGanadosHistorico = (localPlayer.partidosGanadosHistorico || 0) + 1;
  else if (isVisitanteWinner) localPlayer.partidosPerdidosHistorico = (localPlayer.partidosPerdidosHistorico || 0) + 1;

  // H2H Historial en Local
  if (!Array.isArray(localPlayer.historial)) localPlayer.historial = [];
  let h2hLocal = localPlayer.historial.find(h => String(h.rivalId) === String(visitanteUserId));
  if (!h2hLocal) {
    h2hLocal = { rivalId: String(visitanteUserId), rivalNombre: visitanteNombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
    localPlayer.historial.push(h2hLocal);
  }
  h2hLocal.pj += 1;
  h2hLocal.gf += gl;
  h2hLocal.gc += gv;
  if (isLocalWinner) h2hLocal.pg += 1;
  else if (isEmpate) h2hLocal.pe += 1;
  else h2hLocal.pp += 1;

  await localPlayer.save();

  // 4. Actualizar stats de jugador Visitante
  visitantePlayer.golesAFavorHistorico = (visitantePlayer.golesAFavorHistorico || 0) + gv;
  visitantePlayer.golesEnContraHistorico = (visitantePlayer.golesEnContraHistorico || 0) + gl;

  if (isVisitanteWinner) visitantePlayer.partidosGanadosHistorico = (visitantePlayer.partidosGanadosHistorico || 0) + 1;
  else if (isLocalWinner) visitantePlayer.partidosPerdidosHistorico = (visitantePlayer.partidosPerdidosHistorico || 0) + 1;

  // H2H Historial en Visitante
  if (!Array.isArray(visitantePlayer.historial)) visitantePlayer.historial = [];
  let h2hVisitante = visitantePlayer.historial.find(h => String(h.rivalId) === String(localUserId));
  if (!h2hVisitante) {
    h2hVisitante = { rivalId: String(localUserId), rivalNombre: localNombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
    visitantePlayer.historial.push(h2hVisitante);
  }
  h2hVisitante.pj += 1;
  h2hVisitante.gf += gv;
  h2hVisitante.gc += gl;
  if (isVisitanteWinner) h2hVisitante.pg += 1;
  else if (isEmpate) h2hVisitante.pe += 1;
  else h2hVisitante.pp += 1;

  await visitantePlayer.save();

  console.log(`[Global Sync] Partido registrado: ${localNombre} (${gl}) vs (${gv}) ${visitanteNombre} [Contexto: ${context}]`.green);

  return {
    success: true,
    localPlayer,
    visitantePlayer
  };
}

/**
 * Procesa un partido completo asentando:
 * 1. El estado en la tabla/partido del documento de liga o torneo.
 * 2. La tabla de posiciones interna del documento de liga (puntos, pJ, pG, pE, pP, gF, gC, dif).
 * 3. Las estadísticas globales (W/L/GF/GC/H2H) en el modelo Jugador.
 * 4. Las estadísticas de equipos de Superliga si aplica.
 */
export async function processMatchResultAndSyncStandings({
  localId,
  visitanteId,
  localNombre,
  visitanteNombre,
  golesLocal,
  golesVisitante,
  ligaDoc,
  partidoId,
  tipoPartido = 'unico', // 'unico', 'ida', 'vuelta', 'desempate'
  context = ''
}) {
  const gl = parseInt(golesLocal) || 0;
  const gv = parseInt(golesVisitante) || 0;

  // 1. Asentar partido finalizado en el documento de liga/torneo si se especifica ligaDoc y partidoId
  if (ligaDoc && partidoId) {
    // 1a. Torneos Personalizados (enfrentamientosGrupos / llaves / equipos)
    if (Array.isArray(ligaDoc.enfrentamientosGrupos) || (ligaDoc.llaves && typeof ligaDoc.llaves === 'object')) {
      let partidoEncontrado = null;
      let dueloEncontrado = null;
      let esGrupos = false;

      // Buscar en enfrentamientosGrupos
      for (const p of (ligaDoc.enfrentamientosGrupos || [])) {
        if (String(p.id || p._id || `${p.local}_vs_${p.visitante}`) === String(partidoId)) {
          partidoEncontrado = p;
          esGrupos = true;
          break;
        }
        if (Array.isArray(p.duelosIndividuales)) {
          p.duelosIndividuales.forEach((d, idx) => {
            const duelIdStr = String(d.id || d._id || `${p.local}_vs_${p.visitante}_d${idx}`);
            if (duelIdStr === String(partidoId)) {
              partidoEncontrado = p;
              dueloEncontrado = d;
              esGrupos = true;
            }
          });
        }
        if (partidoEncontrado) break;
      }

      // Buscar en llaves si no se encontró en grupos
      if (!partidoEncontrado && ligaDoc.llaves) {
        for (const fase of Object.keys(ligaDoc.llaves)) {
          const arr = ligaDoc.llaves[fase];
          if (!Array.isArray(arr)) continue;
          for (const ll of arr) {
            if (String(ll.id || ll._id) === String(partidoId)) {
              partidoEncontrado = ll;
              break;
            }
            if (Array.isArray(ll.duelosIndividuales)) {
              ll.duelosIndividuales.forEach((d, idx) => {
                const duelIdStr = String(d.id || d._id || `${ll.id || fase}_d${idx}`);
                if (duelIdStr === String(partidoId)) {
                  partidoEncontrado = ll;
                  dueloEncontrado = d;
                }
              });
            }
            if (partidoEncontrado) break;
          }
          if (partidoEncontrado) break;
        }
      }

      if (dueloEncontrado) {
        // Actualizar duelo individual
        const dLocalId = String(dueloEncontrado.localJugador || dueloEncontrado.localId || dueloEncontrado.localDiscordId || '');
        if (dLocalId === String(localId)) {
          dueloEncontrado.golesLocal = gl;
          dueloEncontrado.golesVisitante = gv;
        } else {
          dueloEncontrado.golesLocal = gv;
          dueloEncontrado.golesVisitante = gl;
        }
        dueloEncontrado.finalizado = true;

        // Recalcular estado del partido padre
        if (partidoEncontrado && Array.isArray(partidoEncontrado.duelosIndividuales)) {
          let setsL = 0, setsV = 0;
          let duelosTerminados = 0;
          partidoEncontrado.duelosIndividuales.forEach(d => {
            if (d.finalizado) {
              duelosTerminados++;
              if (d.golesLocal > d.golesVisitante) setsL++;
              else if (d.golesVisitante > d.golesLocal) setsV++;
            }
          });

          const totalDuelos = partidoEncontrado.duelosIndividuales.length;
          if (duelosTerminados === totalDuelos || setsL > Math.floor(totalDuelos / 2) || setsV > Math.floor(totalDuelos / 2)) {
            partidoEncontrado.completado = true;
            partidoEncontrado.resultado = `${setsL}-${setsV}`;
            const localName = partidoEncontrado.local || partidoEncontrado.equipo1?.nombre;
            const visitanteName = partidoEncontrado.visitante || partidoEncontrado.equipo2?.nombre;
            partidoEncontrado.ganador = setsL > setsV ? localName : (setsV > setsL ? visitanteName : 'Empate');

            // Actualizar tabla de posiciones de equipos
            if (esGrupos && Array.isArray(ligaDoc.equipos)) {
              const eqL = ligaDoc.equipos.find(e => e.nombre === localName);
              const eqV = ligaDoc.equipos.find(e => e.nombre === visitanteName);
              if (eqL && eqV) {
                eqL.pj = (eqL.pj || 0) + 1; eqV.pj = (eqV.pj || 0) + 1;
                eqL.gf = (eqL.gf || 0) + setsL; eqL.gc = (eqL.gc || 0) + setsV;
                eqV.gf = (eqV.gf || 0) + setsV; eqV.gc = (eqV.gc || 0) + setsL;
                if (setsL > setsV) { eqL.pg = (eqL.pg || 0) + 1; eqL.puntos = (eqL.puntos || 0) + 3; eqV.pp = (eqV.pp || 0) + 1; }
                else if (setsV > setsL) { eqV.pg = (eqV.pg || 0) + 1; eqV.puntos = (eqV.puntos || 0) + 3; eqL.pp = (eqL.pp || 0) + 1; }
                else { eqL.pe = (eqL.pe || 0) + 1; eqV.pe = (eqV.pe || 0) + 1; eqL.puntos = (eqL.puntos || 0) + 1; eqV.puntos = (eqV.puntos || 0) + 1; }
              }
            }
          }
        }
      } else if (partidoEncontrado) {
        // Partido directo sin duelos o ida/vuelta
        if (esGrupos) {
          partidoEncontrado.golesLocal = gl;
          partidoEncontrado.golesVisitante = gv;
          partidoEncontrado.resultado = `${gl}-${gv}`;
          partidoEncontrado.completado = true;
          partidoEncontrado.ganador = gl > gv ? partidoEncontrado.local : (gv > gl ? partidoEncontrado.visitante : 'Empate');

          if (Array.isArray(ligaDoc.equipos)) {
            const eqL = ligaDoc.equipos.find(e => e.nombre === partidoEncontrado.local);
            const eqV = ligaDoc.equipos.find(e => e.nombre === partidoEncontrado.visitante);
            if (eqL && eqV) {
              eqL.pj = (eqL.pj || 0) + 1; eqV.pj = (eqV.pj || 0) + 1;
              eqL.gf = (eqL.gf || 0) + gl; eqL.gc = (eqL.gc || 0) + gv;
              eqV.gf = (eqV.gf || 0) + gv; eqV.gc = (eqV.gc || 0) + gl;
              if (gl > gv) { eqL.pg = (eqL.pg || 0) + 1; eqL.puntos = (eqL.puntos || 0) + 3; eqV.pp = (eqV.pp || 0) + 1; }
              else if (gv > gl) { eqV.pg = (eqV.pg || 0) + 1; eqV.puntos = (eqV.puntos || 0) + 3; eqL.pp = (eqL.pp || 0) + 1; }
              else { eqL.pe = (eqL.pe || 0) + 1; eqV.pe = (eqV.pe || 0) + 1; eqL.puntos = (eqL.puntos || 0) + 1; eqV.puntos = (eqV.puntos || 0) + 1; }
            }
          }
        } else {
          // Llave de eliminatoria
          const tipoEfectivo = tipoPartido || 'unico';
          let matchSub = partidoEncontrado.ida || partidoEncontrado;
          if (tipoEfectivo === 'vuelta' && partidoEncontrado.vuelta) matchSub = partidoEncontrado.vuelta;
          else if (tipoEfectivo === 'desempate' && partidoEncontrado.desempate) matchSub = partidoEncontrado.desempate;

          matchSub.golesLocal = gl;
          matchSub.golesVisitante = gv;
          matchSub.finalizado = true;

          const tipoEncuentroTorneo = ligaDoc.tipoEncuentro || 'unico';
          if (tipoEncuentroTorneo === 'unico' || !partidoEncontrado.vuelta) {
            partidoEncontrado.ganador = gl > gv ? (partidoEncontrado.equipo1.discordId || partidoEncontrado.equipo1.nombre) : (partidoEncontrado.equipo2.discordId || partidoEncontrado.equipo2.nombre);
            partidoEncontrado.resultado = `${gl}-${gv}`;
            partidoEncontrado.completado = true;
          } else {
            const { determinarGanadorLlave } = await import('../generarBracket.js');
            const ganador = determinarGanadorLlave(partidoEncontrado);
            if (ganador) {
              partidoEncontrado.ganador = ganador;
              partidoEncontrado.completado = true;
            }
          }
        }
      }
    } else if (Array.isArray(ligaDoc.grupos)) {
      // 1b. Supersupercopa (Grupos, Semifinales, Final)
      let matchFound = false;

      // Buscar en fase de grupos
      for (let gi = 0; gi < (ligaDoc.grupos || []).length; gi++) {
        const g = ligaDoc.grupos[gi];
        for (let fi = 0; fi < (g.fechas || []).length; fi++) {
          const f = g.fechas[fi];
          const fNum = f.numero || fi + 1;
          const pArray = f.partidos ?? f.encuentros ?? [];
          for (let pi = 0; pi < pArray.length; pi++) {
            const matchRef = pArray[pi];
            let duelFound = null;

            if (Array.isArray(matchRef.duelosIndividuales)) {
              for (let idx = 0; idx < matchRef.duelosIndividuales.length; idx++) {
                const d = matchRef.duelosIndividuales[idx];
                const dId = String(d._id || d.id || `ssc_g_${gi}_f${fi}_p${pi}_d${idx}`);
                const expectedPosId = `ssc_g_${gi}_f${fi}_p${pi}_d${idx}`;
                const expectedNamedId = `ssc_g_${g.nombre}_f${fNum}_p${pi}_d${idx}`;
                if (dId === String(partidoId) || expectedPosId === String(partidoId) || expectedNamedId === String(partidoId) || (d._id && String(d._id) === String(partidoId)) || (d.id && String(d.id) === String(partidoId))) {
                  duelFound = d;
                  break;
                }
              }
            }

            if (duelFound) {
              const dLocId = String(duelFound.localJugadorId || duelFound.localId || '');
              if (dLocId === String(localId) || String(duelFound.localJugadorNombre || '').toLowerCase() === String(localNombre).toLowerCase()) {
                duelFound.golesLocal = gl;
                duelFound.golesVisitante = gv;
              } else {
                duelFound.golesLocal = gv;
                duelFound.golesVisitante = gl;
              }
              duelFound.finalizado = true;

              // Calcular cambio de media
              if (gl !== gv && duelFound.localJugadorId && duelFound.visitanteJugadorId) {
                try {
                  const { aplicarCambioMediaDuelo } = await import('./mediaCalculator.js');
                  const winId = gl > gv ? duelFound.localJugadorId : duelFound.visitanteJugadorId;
                  const losId = gl > gv ? duelFound.visitanteJugadorId : duelFound.localJugadorId;
                  const resMedia = await aplicarCambioMediaDuelo(winId, losId, Math.max(gl, gv), Math.min(gl, gv));
                  if (resMedia) {
                    duelFound.logMedia = `📈 **${resMedia.ganadorNombre}**: ${resMedia.nuevaMediaGanador} (+${resMedia.delta})\n📉 **${resMedia.perdedorNombre}**: ${resMedia.nuevaMediaPerdedor} (-${resMedia.delta})`;
                  }
                } catch (e) {}
              }

              // Recalcular agregados
              let pml = 0, pmv = 0, gtl = 0, gtv = 0;
              for (const d of matchRef.duelosIndividuales) {
                if (d.finalizado) {
                  gtl += (d.golesLocal || 0);
                  gtv += (d.golesVisitante || 0);
                  if (d.golesLocal > d.golesVisitante) pml++;
                  else if (d.golesVisitante > d.golesLocal) pmv++;
                }
              }
              matchRef.puntosMiniLocal = pml;
              matchRef.puntosMiniVisitante = pmv;
              matchRef.golesTotalLocal = gtl;
              matchRef.golesTotalVisitante = gtv;
              matchRef.golesLocal = pml;
              matchRef.golesVisitante = pmv;

              const allFinished = matchRef.duelosIndividuales.every(d => d.finalizado);
              if (allFinished || pml >= 2 || pmv >= 2) {
                matchRef.finalizado = true;
              }
              matchFound = true;
              break;
            } else if (String(matchRef._id || matchRef.id) === String(partidoId) || `ssc_g_${gi}_f${fi}_p${pi}` === String(partidoId) || `${matchRef.localNombre}_vs_${matchRef.visitanteNombre}` === String(partidoId)) {
              matchRef.golesLocal = gl;
              matchRef.golesVisitante = gv;
              matchRef.finalizado = true;
              matchFound = true;
              break;
            }
          }
          if (matchFound) break;
        }
        if (matchFound) break;
      }

      // Buscar en semifinales
      if (!matchFound && Array.isArray(ligaDoc.semifinales)) {
        for (let sIdx = 0; sIdx < ligaDoc.semifinales.length; sIdx++) {
          const semi = ligaDoc.semifinales[sIdx];
          if (String(semi._id || semi.id || `ssc_semi_${sIdx}`) === String(partidoId)) {
            const subM = tipoPartido === 'vuelta' ? semi.vuelta : (tipoPartido === 'desempate' ? semi.desempate : semi.ida);
            if (subM) {
              subM.golesLocal = gl;
              subM.golesVisitante = gv;
              subM.finalizado = true;
            }
            if (semi.ida?.finalizado && semi.vuelta?.finalizado) {
              const totL = (semi.ida.golesLocal || 0) + (semi.vuelta.golesVisitante || 0);
              const totV = (semi.ida.golesVisitante || 0) + (semi.vuelta.golesLocal || 0);
              if (totL !== totV) {
                semi.ganadorId = totL > totV ? semi.localId : semi.visitanteId;
                semi.finalizado = true;
              } else if (semi.desempate?.finalizado) {
                semi.ganadorId = semi.desempate.golesLocal > semi.desempate.golesVisitante ? semi.localId : semi.visitanteId;
                semi.finalizado = true;
              }
            }
            matchFound = true;
            break;
          }
        }
      }

      // Buscar en final
      if (!matchFound && ligaDoc.final && String(ligaDoc.final._id || ligaDoc.final.id || 'ssc_final') === String(partidoId)) {
        const fin = ligaDoc.final;
        const subM = tipoPartido === 'vuelta' ? fin.vuelta : (tipoPartido === 'desempate' ? fin.desempate : fin.ida);
        if (subM) {
          subM.golesLocal = gl;
          subM.golesVisitante = gv;
          subM.finalizado = true;
        }
        if (fin.ida?.finalizado && fin.vuelta?.finalizado) {
          const totL = (fin.ida.golesLocal || 0) + (fin.vuelta.golesVisitante || 0);
          const totV = (fin.ida.golesVisitante || 0) + (fin.vuelta.golesLocal || 0);
          if (totL !== totV) {
            fin.ganadorId = totL > totV ? fin.localId : fin.visitanteId;
            fin.finalizado = true;
          } else if (fin.desempate?.finalizado) {
            fin.ganadorId = fin.desempate.golesLocal > fin.desempate.golesVisitante ? fin.localId : fin.visitanteId;
            fin.finalizado = true;
          }
        }
      }
    } else {
      // 1c. Ligas Regulares y Superliga (fechas/partidos/encuentros)
      let matchFound = false;
      const schedule = ligaDoc.fechas ?? ligaDoc.partidos ?? [];
      for (let fi = 0; fi < schedule.length; fi++) {
        const fecha = schedule[fi];
        const fNum = fecha.numero || fi + 1;
        const pArray = fecha.partidos ?? fecha.encuentros ?? [];
        for (let pi = 0; pi < pArray.length; pi++) {
          const matchRef = pArray[pi];
          let duelFound = null;

          if (Array.isArray(matchRef.duelosIndividuales)) {
            for (let idx = 0; idx < matchRef.duelosIndividuales.length; idx++) {
              const d = matchRef.duelosIndividuales[idx];
              const dId = String(d._id || d.id || `sl_f${fNum}_p${pi}_d${idx}`);
              const expectedPosId = `sl_f${fNum}_p${pi}_d${idx}`;
              if (dId === String(partidoId) || expectedPosId === String(partidoId) || (d._id && String(d._id) === String(partidoId)) || (d.id && String(d.id) === String(partidoId))) {
                duelFound = d;
                break;
              }
            }
          }

          if (duelFound) {
            const dLocId = String(duelFound.localJugadorId || duelFound.localId || '');
            if (dLocId === String(localId) || String(duelFound.localJugadorNombre || '').toLowerCase() === String(localNombre).toLowerCase()) {
              duelFound.golesLocal = gl;
              duelFound.golesVisitante = gv;
            } else {
              duelFound.golesLocal = gv;
              duelFound.golesVisitante = gl;
            }
            duelFound.finalizado = true;

            // Calcular cambio de media
            if (gl !== gv && duelFound.localJugadorId && duelFound.visitanteJugadorId) {
              try {
                const { aplicarCambioMediaDuelo } = await import('./mediaCalculator.js');
                const winId = gl > gv ? duelFound.localJugadorId : duelFound.visitanteJugadorId;
                const losId = gl > gv ? duelFound.visitanteJugadorId : duelFound.localJugadorId;
                const resMedia = await aplicarCambioMediaDuelo(winId, losId, Math.max(gl, gv), Math.min(gl, gv));
                if (resMedia) {
                  duelFound.logMedia = `📈 **${resMedia.ganadorNombre}**: ${resMedia.nuevaMediaGanador} (+${resMedia.delta})\n📉 **${resMedia.perdedorNombre}**: ${resMedia.nuevaMediaPerdedor} (-${resMedia.delta})`;
                }
              } catch (e) {}
            }

            // Recalcular agregados
            let pml = 0, pmv = 0, gtl = 0, gtv = 0;
            for (const d of matchRef.duelosIndividuales) {
              if (d.finalizado) {
                gtl += (d.golesLocal || 0);
                gtv += (d.golesVisitante || 0);
                if (d.golesLocal > d.golesVisitante) pml++;
                else if (d.golesVisitante > d.golesLocal) pmv++;
              }
            }
            matchRef.puntosMiniLocal = pml;
            matchRef.puntosMiniVisitante = pmv;
            matchRef.golesTotalLocal = gtl;
            matchRef.golesTotalVisitante = gtv;
            matchRef.golesLocal = pml;
            matchRef.golesVisitante = pmv;

            const allFinished = matchRef.duelosIndividuales.every(d => d.finalizado);
            if (allFinished || pml >= 2 || pmv >= 2) {
              matchRef.finalizado = true;
            }
            matchFound = true;
            break;
          } else if (String(matchRef._id || matchRef.id) === String(partidoId) || `sl_f${fNum}_p${pi}` === String(partidoId) || `${matchRef.localNombre}_vs_${matchRef.visitanteNombre}` === String(partidoId)) {
            matchRef.golesLocal = gl;
            matchRef.golesVisitante = gv;
            matchRef.finalizado = true;
            matchFound = true;
            break;
          }
        }
        if (matchFound) break;
      }
    }

    // 2. Actualizar la tabla de posiciones interna en ligaDoc.jugadores (si aplica)
    if (Array.isArray(ligaDoc.jugadores)) {
      const updatePlayerInTable = (pId, pNombre, gf, gc, won, drawn, lost) => {
        let entry = ligaDoc.jugadores.find(j => String(j.id) === String(pId) || String(j.discordId) === String(pId));
        if (!entry) {
          entry = {
            id: String(pId),
            nombre: pNombre,
            pj: 0,
            pg: 0,
            pe: 0,
            pp: 0,
            gf: 0,
            gc: 0,
            dif: 0,
            puntos: 0
          };
          ligaDoc.jugadores.push(entry);
        }

        entry.pj = (entry.pj || 0) + 1;
        entry.gf = (entry.gf || 0) + gf;
        entry.gc = (entry.gc || 0) + gc;
        entry.dif = entry.gf - entry.gc;

        if (won) {
          entry.pg = (entry.pg || 0) + 1;
          entry.puntos = (entry.puntos || 0) + 3;
        } else if (drawn) {
          entry.pe = (entry.pe || 0) + 1;
          entry.puntos = (entry.puntos || 0) + 1;
        } else if (lost) {
          entry.pp = (entry.pp || 0) + 1;
        }
      };

      const isLocalWinner = gl > gv;
      const isVisitanteWinner = gv > gl;
      const isEmpate = gl === gv;

      updatePlayerInTable(localId, localNombre, gl, gv, isLocalWinner, isEmpate, isVisitanteWinner);
      updatePlayerInTable(visitanteId, visitanteNombre, gv, gl, isVisitanteWinner, isEmpate, isLocalWinner);

      // Re-ordenar la tabla de posiciones por puntos desc, dif desc, gf desc
      ligaDoc.jugadores.sort((a, b) => {
        if ((b.puntos || 0) !== (a.puntos || 0)) return (b.puntos || 0) - (a.puntos || 0);
        if ((b.dif || 0) !== (a.dif || 0)) return (b.dif || 0) - (a.dif || 0);
        return (b.gf || 0) - (a.gf || 0);
      });
    }

    // Guardar ligaDoc por ID con Active-Record
    await ligaDoc.save();
  }

  // 3. Registrar stats globales y H2H en el modelo Jugador y propagar
  const globalResult = await recordMatchResultGlobal({
    localUserId: localId,
    visitanteUserId: visitanteId,
    localNombre,
    visitanteNombre,
    golesLocal: gl,
    golesVisitante: gv,
    context
  });

  // 4. Si aplica a Superliga o Supersupercopa, actualizar stats de Equipos
  if (context.toLowerCase().includes('superliga') || context.toLowerCase().includes('supersupercopa') || context.toLowerCase().includes('supercopa')) {
    const Equipos = (await import('../../models/superliga/Equipos.js')).default;
    const equipos = await Equipos.find({}).catch(() => []);
    for (const eq of equipos) {
      const eqIdStr = String(eq._id);
      const eqNom = (eq.nombre || '').toLowerCase().trim();
      const coachId = eq.coach ? String(eq.coach.id || eq.coach.discordId || '') : '';
      const coachNom = eq.coach ? String(eq.coach.nombre || '').toLowerCase().trim() : '';

      const isLocalTeam = eqIdStr === String(localId) || eqNom === String(localNombre).toLowerCase().trim() || (coachId && coachId === String(localId)) || (coachNom && coachNom === String(localNombre).toLowerCase().trim());
      const isVisitanteTeam = eqIdStr === String(visitanteId) || eqNom === String(visitanteNombre).toLowerCase().trim() || (coachId && coachId === String(visitanteId)) || (coachNom && coachNom === String(visitanteNombre).toLowerCase().trim());

      if (isLocalTeam) {
        if (!eq.tablaHistorica) eq.tablaHistorica = { puntosAcumulados: 0, partidosGanados: 0, partidosPerdidos: 0, diferenciaGoles: 0, titulosTotales: 0 };
        eq.tablaHistorica.diferenciaGoles += (gl - gv);
        if (eq.coach) {
          eq.coach.golesAFavor = (eq.coach.golesAFavor || 0) + gl;
          eq.coach.golesEnContra = (eq.coach.golesEnContra || 0) + gv;
        }
        if (gl > gv) {
          eq.tablaHistorica.puntosAcumulados += 3;
          eq.tablaHistorica.partidosGanados += 1;
          if (eq.coach) eq.coach.partidosGanados = (eq.coach.partidosGanados || 0) + 1;
          eq.dinero = (eq.dinero || 0) + 100000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 100000;
        } else if (gl < gv) {
          eq.tablaHistorica.partidosPerdidos += 1;
          if (eq.coach) eq.coach.partidosPerdidos = (eq.coach.partidosPerdidos || 0) + 1;
          eq.dinero = (eq.dinero || 0) + 25000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 25000;
        } else {
          eq.tablaHistorica.puntosAcumulados += 1;
          eq.dinero = (eq.dinero || 0) + 50000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 50000;
        }
        await eq.save();
      }

      if (isVisitanteTeam) {
        if (!eq.tablaHistorica) eq.tablaHistorica = { puntosAcumulados: 0, partidosGanados: 0, partidosPerdidos: 0, diferenciaGoles: 0, titulosTotales: 0 };
        eq.tablaHistorica.diferenciaGoles += (gv - gl);
        if (eq.coach) {
          eq.coach.golesAFavor = (eq.coach.golesAFavor || 0) + gv;
          eq.coach.golesEnContra = (eq.coach.golesEnContra || 0) + gl;
        }
        if (gv > gl) {
          eq.tablaHistorica.puntosAcumulados += 3;
          eq.tablaHistorica.partidosGanados += 1;
          if (eq.coach) eq.coach.partidosGanados = (eq.coach.partidosGanados || 0) + 1;
          eq.dinero = (eq.dinero || 0) + 100000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 100000;
        } else if (gv < gl) {
          eq.tablaHistorica.partidosPerdidos += 1;
          if (eq.coach) eq.coach.partidosPerdidos = (eq.coach.partidosPerdidos || 0) + 1;
          eq.dinero = (eq.dinero || 0) + 25000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 25000;
        } else {
          eq.tablaHistorica.puntosAcumulados += 1;
          eq.dinero = (eq.dinero || 0) + 50000;
          eq.ingresosPartidos = (eq.ingresosPartidos || 0) + 50000;
        }
        await eq.save();
      }
    }

    try {
      const { invalidateCache } = await import('../visual/imageCache.js');
      invalidateCache('superliga');
      invalidateCache('supersupercopa');
      invalidateCache('ssc');
    } catch (e) {}
  }

  return {
    success: true,
    globalResult
  };
}

/**
 * Revierte las estadísticas globales e historial H2H de un resultado anulado.
 */
export async function revertMatchResultGlobal({
  localUserId,
  visitanteUserId,
  localNombre = 'Local',
  visitanteNombre = 'Visitante',
  golesLocal = 0,
  golesVisitante = 0,
  context = ''
}) {
  if (!localUserId || !visitanteUserId) {
    return { success: false, reason: 'IDs de usuario no especificados' };
  }

  const gl = parseInt(golesLocal) || 0;
  const gv = parseInt(golesVisitante) || 0;

  const localPlayer = await syncUserGlobal(localUserId, { nombre: localNombre });
  const visitantePlayer = await syncUserGlobal(visitanteUserId, { nombre: visitanteNombre });

  const isLocalWinner = gl > gv;
  const isVisitanteWinner = gv > gl;
  const isEmpate = gl === gv;

  if (localPlayer) {
    localPlayer.golesAFavorHistorico = Math.max(0, (localPlayer.golesAFavorHistorico || 0) - gl);
    localPlayer.golesEnContraHistorico = Math.max(0, (localPlayer.golesEnContraHistorico || 0) - gv);
    if (isLocalWinner) localPlayer.partidosGanadosHistorico = Math.max(0, (localPlayer.partidosGanadosHistorico || 0) - 1);
    else if (isVisitanteWinner) localPlayer.partidosPerdidosHistorico = Math.max(0, (localPlayer.partidosPerdidosHistorico || 0) - 1);

    if (Array.isArray(localPlayer.historial)) {
      const h2hLocal = localPlayer.historial.find(h => String(h.rivalId) === String(visitanteUserId));
      if (h2hLocal) {
        h2hLocal.pj = Math.max(0, (h2hLocal.pj || 0) - 1);
        h2hLocal.gf = Math.max(0, (h2hLocal.gf || 0) - gl);
        h2hLocal.gc = Math.max(0, (h2hLocal.gc || 0) - gv);
        if (isLocalWinner) h2hLocal.pg = Math.max(0, (h2hLocal.pg || 0) - 1);
        else if (isEmpate) h2hLocal.pe = Math.max(0, (h2hLocal.pe || 0) - 1);
        else h2hLocal.pp = Math.max(0, (h2hLocal.pp || 0) - 1);
      }
    }
    await localPlayer.save();
  }

  if (visitantePlayer) {
    visitantePlayer.golesAFavorHistorico = Math.max(0, (visitantePlayer.golesAFavorHistorico || 0) - gv);
    visitantePlayer.golesEnContraHistorico = Math.max(0, (visitantePlayer.golesEnContraHistorico || 0) - gl);
    if (isVisitanteWinner) visitantePlayer.partidosGanadosHistorico = Math.max(0, (visitantePlayer.partidosGanadosHistorico || 0) - 1);
    else if (isLocalWinner) visitantePlayer.partidosPerdidosHistorico = Math.max(0, (visitantePlayer.partidosPerdidosHistorico || 0) - 1);

    if (Array.isArray(visitantePlayer.historial)) {
      const h2hVisitante = visitantePlayer.historial.find(h => String(h.rivalId) === String(localUserId));
      if (h2hVisitante) {
        h2hVisitante.pj = Math.max(0, (h2hVisitante.pj || 0) - 1);
        h2hVisitante.gf = Math.max(0, (h2hVisitante.gf || 0) - gv);
        h2hVisitante.gc = Math.max(0, (h2hVisitante.gc || 0) - gl);
        if (isVisitanteWinner) h2hVisitante.pg = Math.max(0, (h2hVisitante.pg || 0) - 1);
        else if (isEmpate) h2hVisitante.pe = Math.max(0, (h2hVisitante.pe || 0) - 1);
        else h2hVisitante.pp = Math.max(0, (h2hVisitante.pp || 0) - 1);
      }
    }
    await visitantePlayer.save();
  }

  console.log(`[Global Sync] Partido revertido: ${localNombre} (${gl}) vs (${gv}) ${visitanteNombre} [Contexto: ${context}]`.yellow);

  return {
    success: true,
    localPlayer,
    visitantePlayer
  };
}

/**
 * Anula/cancela un partido jugado revirtiendo:
 * 1. El estado del partido en el documento de liga o torneo (finalizado = false, goles = null).
 * 2. La tabla de posiciones interna en ligaDoc.jugadores o torneo.equipos.
 * 3. Las estadísticas globales (W/L/GF/GC/H2H) en el modelo Jugador.
 * 4. Las estadísticas de equipos de Superliga si aplica.
 */
export async function revertMatchResultAndSyncStandings({
  localId,
  visitanteId,
  localNombre,
  visitanteNombre,
  golesLocal,
  golesVisitante,
  ligaDoc,
  partidoId,
  tipoPartido = 'unico',
  context = ''
}) {
  const gl = parseInt(golesLocal) || 0;
  const gv = parseInt(golesVisitante) || 0;

  // 1. Revertir partido en el documento de liga o torneo
  if (ligaDoc && partidoId) {
    if (Array.isArray(ligaDoc.enfrentamientosGrupos) || (ligaDoc.llaves && typeof ligaDoc.llaves === 'object')) {
      let partidoEncontrado = null;
      let dueloEncontrado = null;
      let esGrupos = false;

      for (const p of (ligaDoc.enfrentamientosGrupos || [])) {
        if (String(p.id || p._id || `${p.local}_vs_${p.visitante}`) === String(partidoId)) {
          partidoEncontrado = p;
          esGrupos = true;
          break;
        }
        if (Array.isArray(p.duelosIndividuales)) {
          p.duelosIndividuales.forEach((d, idx) => {
            const duelIdStr = String(d.id || d._id || `${p.local}_vs_${p.visitante}_d${idx}`);
            if (duelIdStr === String(partidoId)) {
              partidoEncontrado = p;
              dueloEncontrado = d;
              esGrupos = true;
            }
          });
        }
        if (partidoEncontrado) break;
      }

      if (!partidoEncontrado && ligaDoc.llaves) {
        for (const fase of Object.keys(ligaDoc.llaves)) {
          const arr = ligaDoc.llaves[fase];
          if (!Array.isArray(arr)) continue;
          for (const ll of arr) {
            if (String(ll.id || ll._id) === String(partidoId)) {
              partidoEncontrado = ll;
              break;
            }
            if (Array.isArray(ll.duelosIndividuales)) {
              ll.duelosIndividuales.forEach((d, idx) => {
                const duelIdStr = String(d.id || d._id || `${ll.id || fase}_d${idx}`);
                if (duelIdStr === String(partidoId)) {
                  partidoEncontrado = ll;
                  dueloEncontrado = d;
                }
              });
            }
            if (partidoEncontrado) break;
          }
          if (partidoEncontrado) break;
        }
      }

      if (dueloEncontrado) {
        dueloEncontrado.golesLocal = null;
        dueloEncontrado.golesVisitante = null;
        dueloEncontrado.finalizado = false;

        if (partidoEncontrado) {
          partidoEncontrado.completado = false;
          partidoEncontrado.resultado = 'Pendiente';
          partidoEncontrado.ganador = null;
        }
      } else if (partidoEncontrado) {
        if (esGrupos) {
          partidoEncontrado.golesLocal = null;
          partidoEncontrado.golesVisitante = null;
          partidoEncontrado.resultado = 'Pendiente';
          partidoEncontrado.completado = false;
          partidoEncontrado.ganador = null;

          if (Array.isArray(ligaDoc.equipos)) {
            const eqL = ligaDoc.equipos.find(e => e.nombre === partidoEncontrado.local);
            const eqV = ligaDoc.equipos.find(e => e.nombre === partidoEncontrado.visitante);
            if (eqL && eqV) {
              eqL.pj = Math.max(0, (eqL.pj || 0) - 1); eqV.pj = Math.max(0, (eqV.pj || 0) - 1);
              eqL.gf = Math.max(0, (eqL.gf || 0) - gl); eqL.gc = Math.max(0, (eqL.gc || 0) - gv);
              eqV.gf = Math.max(0, (eqV.gf || 0) - gv); eqV.gc = Math.max(0, (eqV.gc || 0) - gl);
              if (gl > gv) { eqL.pg = Math.max(0, (eqL.pg || 0) - 1); eqL.puntos = Math.max(0, (eqL.puntos || 0) - 3); eqV.pp = Math.max(0, (eqV.pp || 0) - 1); }
              else if (gv > gl) { eqV.pg = Math.max(0, (eqV.pg || 0) - 1); eqV.puntos = Math.max(0, (eqV.puntos || 0) - 3); eqL.pp = Math.max(0, (eqL.pp || 0) - 1); }
              else { eqL.pe = Math.max(0, (eqL.pe || 0) - 1); eqV.pe = Math.max(0, (eqV.pe || 0) - 1); eqL.puntos = Math.max(0, (eqL.puntos || 0) - 1); eqV.puntos = Math.max(0, (eqV.puntos || 0) - 1); }
            }
          }
        } else {
          const tipoEfectivo = tipoPartido || 'unico';
          let matchSub = partidoEncontrado.ida || partidoEncontrado;
          if (tipoEfectivo === 'vuelta' && partidoEncontrado.vuelta) matchSub = partidoEncontrado.vuelta;
          else if (tipoEfectivo === 'desempate' && partidoEncontrado.desempate) matchSub = partidoEncontrado.desempate;

          matchSub.golesLocal = null;
          matchSub.golesVisitante = null;
          matchSub.finalizado = false;

          partidoEncontrado.ganador = null;
          partidoEncontrado.resultado = null;
          partidoEncontrado.completado = false;
        }
      }
    } else {
      // Ligas Regulares (fechas / partidos)
      const schedule = ligaDoc.fechas ?? ligaDoc.partidos ?? [];
      for (const fecha of schedule) {
        const pArray = fecha.partidos ?? fecha.encuentros ?? [];
        const matchRef = pArray.find(p => String(p._id || p.id) === String(partidoId));
        if (matchRef) {
          matchRef.golesLocal = null;
          matchRef.golesVisitante = null;
          matchRef.finalizado = false;
          matchRef.imagenResultado = null;
          break;
        }
      }
    }

    // 2. Revertir puntos y goles en ligaDoc.jugadores
    if (Array.isArray(ligaDoc.jugadores)) {
      const revertPlayerInTable = (pId, gf, gc, won, drawn, lost) => {
        let entry = ligaDoc.jugadores.find(j => String(j.id) === String(pId) || String(j.discordId) === String(pId));
        if (!entry) return;

        entry.pj = Math.max(0, (entry.pj || 0) - 1);
        entry.gf = Math.max(0, (entry.gf || 0) - gf);
        entry.gc = Math.max(0, (entry.gc || 0) - gc);
        entry.dif = (entry.gf || 0) - (entry.gc || 0);

        if (won) {
          entry.pg = Math.max(0, (entry.pg || 0) - 1);
          entry.puntos = Math.max(0, (entry.puntos || 0) - 3);
        } else if (drawn) {
          entry.pe = Math.max(0, (entry.pe || 0) - 1);
          entry.puntos = Math.max(0, (entry.puntos || 0) - 1);
        } else if (lost) {
          entry.pp = Math.max(0, (entry.pp || 0) - 1);
        }
      };

      const isLocalWinner = gl > gv;
      const isVisitanteWinner = gv > gl;
      const isEmpate = gl === gv;

      revertPlayerInTable(localId, gl, gv, isLocalWinner, isEmpate, isVisitanteWinner);
      revertPlayerInTable(visitanteId, gv, gl, isVisitanteWinner, isEmpate, isLocalWinner);

      // Re-ordenar la tabla de posiciones
      ligaDoc.jugadores.sort((a, b) => {
        if ((b.puntos || 0) !== (a.puntos || 0)) return (b.puntos || 0) - (a.puntos || 0);
        if ((b.dif || 0) !== (a.dif || 0)) return (b.dif || 0) - (a.dif || 0);
        return (b.gf || 0) - (a.gf || 0);
      });
    }

    await ligaDoc.save();
  }

  // 3. Revertir stats globales en Jugador
  const globalResult = await revertMatchResultGlobal({
    localUserId: localId,
    visitanteUserId: visitanteId,
    localNombre,
    visitanteNombre,
    golesLocal: gl,
    golesVisitante: gv,
    context
  });

  // 4. Si aplica a Superliga, revertir tablaHistorica
  if (context.toLowerCase().includes('superliga')) {
    const equipos = await Equipos.find({});
    for (const eq of equipos) {
      let isLocalTeam = eq.coach && (String(eq.coach.id) === String(localId) || String(eq.coach.discordId) === String(localId));
      let isVisitanteTeam = eq.coach && (String(eq.coach.id) === String(visitanteId) || String(eq.coach.discordId) === String(visitanteId));

      if (isLocalTeam && eq.tablaHistorica) {
        eq.tablaHistorica.diferenciaGoles -= (gl - gv);
        if (gl > gv) {
          eq.tablaHistorica.puntosAcumulados = Math.max(0, eq.tablaHistorica.puntosAcumulados - 3);
          eq.tablaHistorica.partidosGanados = Math.max(0, eq.tablaHistorica.partidosGanados - 1);
        } else if (gl < gv) {
          eq.tablaHistorica.partidosPerdidos = Math.max(0, eq.tablaHistorica.partidosPerdidos - 1);
        } else {
          eq.tablaHistorica.puntosAcumulados = Math.max(0, eq.tablaHistorica.puntosAcumulados - 1);
        }
        await eq.save();
      }

      if (isVisitanteTeam && eq.tablaHistorica) {
        eq.tablaHistorica.diferenciaGoles -= (gv - gl);
        if (gv > gl) {
          eq.tablaHistorica.puntosAcumulados = Math.max(0, eq.tablaHistorica.puntosAcumulados - 3);
          eq.tablaHistorica.partidosGanados = Math.max(0, eq.tablaHistorica.partidosGanados - 1);
        } else if (gv < gl) {
          eq.tablaHistorica.partidosPerdidos = Math.max(0, eq.tablaHistorica.partidosPerdidos - 1);
        } else {
          eq.tablaHistorica.puntosAcumulados = Math.max(0, eq.tablaHistorica.puntosAcumulados - 1);
        }
        await eq.save();
      }
    }
  }

  return {
    success: true,
    globalResult
  };
}
