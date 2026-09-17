import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';
import Superliga from '../../models/superliga/Superliga.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import Equipos from '../../models/superliga/Equipos.js';
import Jugador from '../../models/Jugador.js';
import { invalidateCache } from '../../utils/visual/imageCache.js';
import { determinarGanadorLlave } from '../../utils/generarBracket.js';

export default {
  name: 'platubi-sincronizarfixture',
  aliases: [
    'sincronizarfixture',
    'syncfixture',
    'sincronizarcompetencias',
    'synccompetencias',
    'recalcularfixture',
    'recalcularcompetencias',
    'sync-fixture',
    'sincronizar-fixture',
    'plsincronizarfixture'
  ],
  desc: 'Recalcula y sincroniza las tablas de posiciones, apartados de equipos y estados de las competencias desde su fixture actual.',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-sincronizarfixture')
    .setDescription('Recalcula y sincroniza las tablas de posiciones y equipos de las competencias desde sus fixtures.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('competencia')
        .setDescription('Nombre o prefijo de una competencia específica (opcional, por defecto todas)')
        .setRequired(false))
    .addBooleanOption(opt =>
      opt.setName('sync_global')
        .setDescription('Si es true, sincroniza también estadísticas históricas globales de jugadores')
        .setRequired(false)),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para usar este comando.', flags: 64 });
    }

    await interaction.deferReply();
    const query = interaction.options.getString('competencia');
    const syncGlobal = interaction.options.getBoolean('sync_global') ?? true;

    try {
      const result = await syncCompetitionsFromFixture(client, query, syncGlobal);
      const embed = buildResultEmbed(result, query);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error en sincronizarfixture:', error);
      await interaction.editReply(`❌ Error durante la sincronización: ${error.message}`);
    }
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
    }

    const query = args && args.length > 0 ? args.join(' ').trim() : null;
    const loading = await message.reply('<a:loading:1461897825439711468> **Auditando fixtures y sincronizando apartados de equipos y tablas...**');

    try {
      const result = await syncCompetitionsFromFixture(client, query, true);
      const embed = buildResultEmbed(result, query);
      await loading.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('Error en sincronizarfixture:', error);
      await loading.edit(`❌ Error durante la sincronización: ${error.message}`);
    }
  }
};

/**
 * Sincroniza y reconstruye el apartado de equipos y llaves de un Torneo Personalizado específico.
 */
export async function syncTournament(t, client = null) {
  const isIndividual = t.tipoCompeticion === 'individual' || t.tipoJugadores === 'users';
  const dbPlayers = await Jugador.find({}).catch(() => []);
  const dbPlayerMap = new Map();

  for (const p of dbPlayers) {
    const docObj = p.toJSON ? p.toJSON() : p;
    if (docObj.id) dbPlayerMap.set(String(docObj.id), docObj);
    if (docObj.discordId) dbPlayerMap.set(String(docObj.discordId), docObj);
    if (docObj._id) dbPlayerMap.set(String(docObj._id), docObj);
    if (docObj.nombre) dbPlayerMap.set(docObj.nombre.toLowerCase().trim(), docObj);
  }

  // 1. Inicializar mapa de equipos
  const eqMap = new Map();

  function getOrInitTeam(id, name, grupo = null, avatar = null) {
    const cleanId = id ? String(id).trim() : null;
    const cleanName = name ? String(name).trim() : 'TBD';
    if (!cleanId && (!cleanName || cleanName === 'TBD' || cleanName === 'BYE')) return null;

    const key = cleanId || cleanName.toLowerCase();
    if (!eqMap.has(key)) {
      eqMap.set(key, {
        id: cleanId,
        discordId: cleanId && /^\d{17,20}$/.test(cleanId) ? cleanId : null,
        nombre: cleanName,
        avatar: avatar || null,
        grupo: grupo || null,
        pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dif: 0, puntos: 0
      });
    }
    return eqMap.get(key);
  }

  // Pre-poblar con los equipos existentes en t.equipos
  if (Array.isArray(t.equipos)) {
    for (const eq of t.equipos) {
      const eqId = eq.id || eq.discordId || eq._id;
      const tObj = getOrInitTeam(eqId, eq.nombre, eq.grupo, eq.avatar);
      if (tObj) {
        if (eq.propietario) tObj.propietario = eq.propietario;
        if (eq.miembros) tObj.miembros = eq.miembros;
        if (eq.grupo) tObj.grupo = eq.grupo;
        if (eq.avatar) tObj.avatar = eq.avatar;
        tObj.pj = 0; tObj.pg = 0; tObj.pe = 0; tObj.pp = 0;
        tObj.gf = 0; tObj.gc = 0; tObj.dif = 0; tObj.puntos = 0;
      }
    }
  }

  // Sincronizar nombres y avatares actualizados desde Jugador
  for (const eq of eqMap.values()) {
    const lookupKey = String(eq.discordId || eq.propietario || eq.id || '');
    const pDoc = dbPlayerMap.get(lookupKey) || dbPlayerMap.get(eq.nombre.toLowerCase().trim());
    if (pDoc) {
      if (isIndividual && pDoc.nombre) eq.nombre = pDoc.nombre;
      if (isIndividual && pDoc.avatar) eq.avatar = pDoc.avatar;
    }
    if (Array.isArray(eq.miembros)) {
      for (const m of eq.miembros) {
        const mId = String(typeof m === 'string' ? m : (m.discordId || m.id || m._id || ''));
        const mDoc = dbPlayerMap.get(mId) || (m.nombre ? dbPlayerMap.get(m.nombre.toLowerCase().trim()) : null);
        if (mDoc && typeof m === 'object') {
          if (mDoc.nombre) m.nombre = mDoc.nombre;
          if (mDoc.avatar) m.avatar = mDoc.avatar;
        }
      }
    }
  }

  let tMatches = 0;
  let tFinalized = 0;

  // 2. Procesar enfrentamientos de grupos o formato liga
  if (Array.isArray(t.enfrentamientosGrupos) && t.enfrentamientosGrupos.length > 0) {
    for (const enf of t.enfrentamientosGrupos) {
      tMatches++;
      const lName = enf.local || enf.equipo1?.nombre;
      const vName = enf.visitante || enf.equipo2?.nombre;
      const lId = enf.localId || enf.equipo1?.discordId || enf.equipo1?.id;
      const vId = enf.visitanteId || enf.equipo2?.discordId || enf.equipo2?.id;

      const eqL = getOrInitTeam(lId, lName, enf.grupo) || (lName ? eqMap.get(lName.toLowerCase()) : null);
      const eqV = getOrInitTeam(vId, vName, enf.grupo) || (vName ? eqMap.get(vName.toLowerCase()) : null);
      if (!eqL || !eqV) continue;

      // Duelos individuales
      if (Array.isArray(enf.duelosIndividuales) && enf.duelosIndividuales.length > 0) {
        let setsL = 0, setsV = 0, duelosTerminados = 0;
        for (const d of enf.duelosIndividuales) {
          if (d.finalizado || (typeof d.golesLocal === 'number' && typeof d.golesVisitante === 'number')) {
            duelosTerminados++;
            if (d.golesLocal > d.golesVisitante) setsL++;
            else if (d.golesVisitante > d.golesLocal) setsV++;
          }
        }

        const totalDuelos = enf.duelosIndividuales.length;
        if (duelosTerminados === totalDuelos || setsL > Math.floor(totalDuelos / 2) || setsV > Math.floor(totalDuelos / 2)) {
          enf.completado = true;
          enf.resultado = `${setsL}-${setsV}`;
          enf.ganador = setsL > setsV ? (eqL.nombre || lName) : (setsV > setsL ? (eqV.nombre || vName) : 'Empate');

          tFinalized++;
          eqL.pj++; eqV.pj++;
          eqL.gf += setsL; eqL.gc += setsV;
          eqV.gf += setsV; eqV.gc += setsL;

          if (setsL > setsV) { eqL.pg++; eqL.puntos += 3; eqV.pp++; }
          else if (setsV > setsL) { eqV.pg++; eqV.puntos += 3; eqL.pp++; }
          else { eqL.pe++; eqL.puntos += 1; eqV.pe++; eqV.puntos += 1; }
        }
      } else if (enf.completado || (enf.resultado && enf.resultado !== 'Pendiente')) {
        tFinalized++;
        const resStr = String(enf.resultado || '');
        const isDoubleWO = enf.isDoubleWO || resStr === 'WO - WO' || resStr === 'X-X';
        const resClean = resStr.replace(/\s*\([^)]*\)/g, '');
        const resParts = resClean.split('-').map(s => parseInt(s.trim(), 10));
        const gl = !isNaN(resParts[0]) ? resParts[0] : (enf.ida?.golesLocal ?? 0);
        const gv = !isNaN(resParts[1]) ? resParts[1] : (enf.ida?.golesVisitante ?? 0);
        const isWO = enf.isWO || resStr.includes('WO') || (gl === 3 && gv === 0) || (gl === 0 && gv === 3);

        eqL.pj++; eqV.pj++;

        if (isDoubleWO) {
          eqL.pp++; eqL.pe++; eqL.gc += 3; eqL.puntos -= 2;
          eqV.pp++; eqV.pe++; eqV.gc += 3; eqV.puntos -= 2;
        } else {
          eqL.gf += gl; eqL.gc += gv;
          eqV.gf += gv; eqV.gc += gl;

          if (gl > gv) {
            eqL.pg++; eqL.puntos += 3; eqV.pp++;
            if (isWO) {
              eqV.pe++; eqV.puntos -= 2;
            }
          } else if (gv > gl) {
            eqV.pg++; eqV.puntos += 3; eqL.pp++;
            if (isWO) {
              eqL.pe++; eqL.puntos -= 2;
            }
          } else {
            eqL.pe++; eqL.puntos += 1; eqV.pe++; eqV.puntos += 1;
          }
        }
      }
    }
  }

  // 3. Procesar llaves eliminatorias (Brackets)
  if (t.llaves && typeof t.llaves === 'object') {
    const esEliminacionPura = t.formatoPreset === 'directa' || t.formatoPreset === 'eliminacion_directa';

    for (const fase of Object.keys(t.llaves)) {
      const arr = t.llaves[fase];
      if (Array.isArray(arr)) {
        for (const ll of arr) {
          tMatches++;
          const eq1 = ll.equipo1 || {};
          const eq2 = ll.equipo2 || {};
          if (!eq1.nombre || !eq2.nombre || eq1.nombre === 'BYE' || eq2.nombre === 'BYE') continue;

          const team1 = getOrInitTeam(eq1.discordId || eq1.id, eq1.nombre, null, eq1.avatar);
          const team2 = getOrInitTeam(eq2.discordId || eq2.id, eq2.nombre, null, eq2.avatar);

          let matchPlayedInLlave = false;

          // Partido ida
          if (ll.ida && ll.ida.finalizado) {
            matchPlayedInLlave = true;
            if (esEliminacionPura && team1 && team2) {
              const gl = parseInt(ll.ida.golesLocal) || 0;
              const gv = parseInt(ll.ida.golesVisitante) || 0;
              team1.pj++; team2.pj++;
              team1.gf += gl; team1.gc += gv;
              team2.gf += gv; team2.gc += gl;
              if (gl > gv) { team1.pg++; team1.puntos += 3; team2.pp++; }
              else if (gv > gl) { team2.pg++; team2.puntos += 3; team1.pp++; }
              else { team1.pe++; team1.puntos += 1; team2.pe++; team2.puntos += 1; }
            }
          }

          // Partido vuelta
          if (ll.vuelta && ll.vuelta.finalizado) {
            matchPlayedInLlave = true;
            if (esEliminacionPura && team1 && team2) {
              const gl = parseInt(ll.vuelta.golesLocal) || 0;
              const gv = parseInt(ll.vuelta.golesVisitante) || 0;
              team2.pj++; team1.pj++;
              team2.gf += gl; team2.gc += gv;
              team1.gf += gv; team1.gc += gl;
              if (gl > gv) { team2.pg++; team2.puntos += 3; team1.pp++; }
              else if (gv > gl) { team1.pg++; team1.puntos += 3; team2.pp++; }
              else { team2.pe++; team2.puntos += 1; team1.pe++; team1.puntos += 1; }
            }
          }

          // Partido desempate
          if (ll.desempate && ll.desempate.finalizado) {
            matchPlayedInLlave = true;
            if (esEliminacionPura && team1 && team2) {
              const gl = parseInt(ll.desempate.golesLocal) || 0;
              const gv = parseInt(ll.desempate.golesVisitante) || 0;
              team1.pj++; team2.pj++;
              team1.gf += gl; team1.gc += gv;
              team2.gf += gv; team2.gc += gl;
              if (gl > gv) { team1.pg++; team1.puntos += 3; team2.pp++; }
              else if (gv > gl) { team2.pg++; team2.puntos += 3; team1.pp++; }
              else { team1.pe++; team1.puntos += 1; team2.pe++; team2.puntos += 1; }
            }
          }

          if (matchPlayedInLlave || ll.ganador) {
            tFinalized++;
            const ganador = determinarGanadorLlave(ll);
            if (ganador) {
              ll.ganador = ganador;
              ll.completado = true;
            }
          }
        }
      }
    }
  }

  // 4. Calcular diferencia de gol y ordenar equipos
  const updatedEquipos = Array.from(new Set(Array.from(eqMap.values()))).map(e => {
    e.dif = (e.gf || 0) - (e.gc || 0);
    return e;
  });

  updatedEquipos.sort((a, b) => {
    if (a.grupo && b.grupo && a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo);
    if ((b.puntos || 0) !== (a.puntos || 0)) return (b.puntos || 0) - (a.puntos || 0);
    if ((b.dif || 0) !== (a.dif || 0)) return (b.dif || 0) - (a.dif || 0);
    if ((b.gf || 0) !== (a.gf || 0)) return (b.gf || 0) - (a.gf || 0);
    return (b.pg || 0) - (a.pg || 0);
  });

  t.equipos = updatedEquipos;
  await t.save();
  if (t.prefix) invalidateCache(t.prefix);

  return {
    equiposCount: updatedEquipos.length,
    matchesTotal: tMatches,
    matchesFinalized: tFinalized
  };
}

/**
 * Función principal que recorre todas las competencias y reconstruye las tablas desde el fixture real.
 */
async function syncCompetitionsFromFixture(client, query = null, syncGlobal = true) {
  const normQuery = query ? query.toLowerCase().trim() : null;

  const summary = {
    competicionesSincronizadas: 0,
    partidosAuditados: 0,
    detalles: [],
    syncGlobalEjecutado: false
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Ligas Regulares (Primera, Segunda, Tercera)
  // ───────────────────────────────────────────────────────────────────────────
  const regularConfigs = [
    { model: Primera, defaultName: 'Primera', cacheKey: 'primera' },
    { model: Segunda, defaultName: 'Segunda', cacheKey: 'segunda' },
    { model: Tercera, defaultName: 'Tercera', cacheKey: 'tercera' }
  ];

  for (const { model, defaultName, cacheKey } of regularConfigs) {
    const ligas = await model.find({}).catch(() => []);
    for (const liga of ligas) {
      const leagueName = liga.nombreLiga || defaultName;
      if (normQuery && !leagueName.toLowerCase().includes(normQuery) && !defaultName.toLowerCase().includes(normQuery)) {
        continue;
      }

      summary.competicionesSincronizadas++;

      // Mapa de jugadores para recálculo
      const playerMap = new Map();

      // Inicializar jugadores existentes en la lista
      if (Array.isArray(liga.jugadores)) {
        for (const j of liga.jugadores) {
          const jId = String(j.id || j.discordId || j._id);
          playerMap.set(jId, {
            id: jId,
            nombre: j.nombre || 'Jugador',
            avatar: j.avatar || '',
            pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dif: 0, puntos: 0
          });
        }
      }

      const schedule = liga.partidos ?? liga.fechas ?? [];
      let matchesInLeague = 0;
      let finalizedInLeague = 0;

      if (Array.isArray(schedule)) {
        for (const fecha of schedule) {
          const matchArray = fecha.partidos ?? fecha.encuentros ?? [];
          if (Array.isArray(matchArray)) {
            for (const p of matchArray) {
              matchesInLeague++;

              // Asegurar que ambos participantes existan en el mapa
              const lId = p.localId ? String(p.localId) : (p.localNombre ? p.localNombre.toLowerCase().trim() : null);
              const vId = p.visitanteId ? String(p.visitanteId) : (p.visitanteNombre ? p.visitanteNombre.toLowerCase().trim() : null);

              if (lId && !playerMap.has(lId)) {
                playerMap.set(lId, {
                  id: lId,
                  nombre: p.localNombre || 'Local',
                  avatar: '',
                  pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dif: 0, puntos: 0
                });
              }
              if (vId && !playerMap.has(vId)) {
                playerMap.set(vId, {
                  id: vId,
                  nombre: p.visitanteNombre || 'Visitante',
                  avatar: '',
                  pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dif: 0, puntos: 0
                });
              }

              if (!p.finalizado) continue;
              finalizedInLeague++;
              summary.partidosAuditados++;

              const pL = playerMap.get(lId);
              const pV = playerMap.get(vId);
              if (!pL || !pV) continue;

              const gl = parseInt(p.golesLocal) || 0;
              const gv = parseInt(p.golesVisitante) || 0;

              pL.pj++;
              pV.pj++;
              pL.gf += gl;
              pL.gc += gv;
              pV.gf += gv;
              pV.gc += gl;

              const isDoubleWO = p.isDoubleWO || (p.isWO && gl === 0 && gv === 0);
              const isWO = p.isWO || (gl === 3 && gv === 0) || (gl === 0 && gv === 3);

              if (isDoubleWO) {
                pL.pe++;
                pL.puntos -= 2;
                pL.pp++;
                pV.pe++;
                pV.puntos -= 2;
                pV.pp++;
              } else if (gl > gv) {
                pL.pg++;
                pL.puntos += 3;
                pV.pp++;
                if (isWO) {
                  pV.pe++;
                  pV.puntos -= 2;
                }
              } else if (gv > gl) {
                pV.pg++;
                pV.puntos += 3;
                pL.pp++;
                if (isWO) {
                  pL.pe++;
                  pL.puntos -= 2;
                }
              } else {
                pL.pe++;
                pL.puntos += 1;
                pV.pe++;
                pV.puntos += 1;
              }
            }
          }
        }
      }

      // Calcular diferencia de goles y ordenar
      const updatedPlayers = Array.from(playerMap.values()).map(p => {
        p.dif = p.gf - p.gc;
        return p;
      });

      updatedPlayers.sort((a, b) => {
        if ((b.puntos || 0) !== (a.puntos || 0)) return (b.puntos || 0) - (a.puntos || 0);
        if ((b.dif || 0) !== (a.dif || 0)) return (b.dif || 0) - (a.dif || 0);
        if ((b.gf || 0) !== (a.gf || 0)) return (b.gf || 0) - (a.gf || 0);
        return (b.pg || 0) - (a.pg || 0);
      });

      liga.jugadores = updatedPlayers;
      await liga.save();
      invalidateCache(cacheKey);

      summary.detalles.push({
        tipo: 'Liga Regular',
        nombre: leagueName,
        participantes: updatedPlayers.length,
        partidosTotal: matchesInLeague,
        partidosJugados: finalizedInLeague
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Torneos y Copas Dinámicas (Torneo)
  // ───────────────────────────────────────────────────────────────────────────
  const torneos = await Torneo.find({}).catch(() => []);
  for (const t of torneos) {
    const tNombre = t.nombre || t.prefix || 'Torneo';
    const tPrefix = t.prefix || '';
    if (normQuery && !tNombre.toLowerCase().includes(normQuery) && !tPrefix.toLowerCase().includes(normQuery)) {
      continue;
    }

    summary.competicionesSincronizadas++;
    const tRes = await syncTournament(t, client);
    summary.partidosAuditados += tRes.matchesFinalized;

    summary.detalles.push({
      tipo: 'Torneo Personalizado',
      nombre: tNombre,
      participantes: tRes.equiposCount,
      partidosTotal: tRes.matchesTotal,
      partidosJugados: tRes.matchesFinalized
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Coppa (Eliminatoria Directa)
  // ───────────────────────────────────────────────────────────────────────────
  const coppas = await Coppa.find({}).catch(() => []);
  for (const c of coppas) {
    const cNombre = c.nombre || 'Coppa';
    if (normQuery && !cNombre.toLowerCase().includes(normQuery) && !'coppa'.includes(normQuery)) {
      continue;
    }

    summary.competicionesSincronizadas++;
    let cMatches = 0;
    let cFinalized = 0;

    if (c.llaves && typeof c.llaves === 'object') {
      for (const fase of Object.keys(c.llaves)) {
        const arr = c.llaves[fase];
        if (Array.isArray(arr)) {
          for (const ll of arr) {
            cMatches++;
            if ((ll.ida && ll.ida.finalizado) || (ll.vuelta && ll.vuelta.finalizado)) {
              cFinalized++;
              summary.partidosAuditados++;
              const ganador = determinarGanadorLlave(ll);
              if (ganador) {
                ll.ganador = ganador;
              }
            }
          }
        }
      }
    }

    await c.save();
    invalidateCache('coppa');

    summary.detalles.push({
      tipo: 'Coppa',
      nombre: cNombre,
      participantes: c.equipos?.length || 16,
      partidosTotal: cMatches,
      partidosJugados: cFinalized
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Superliga
  // ───────────────────────────────────────────────────────────────────────────
  const superligas = await Superliga.find({}).catch(() => []);
  for (const s of superligas) {
    const sNombre = `Superliga (${s.temporada || 'Actual'})`;
    if (normQuery && !sNombre.toLowerCase().includes(normQuery) && !'superliga'.includes(normQuery)) {
      continue;
    }

    summary.competicionesSincronizadas++;
    let sMatches = 0;
    let sFinalized = 0;

    if (Array.isArray(s.fechas)) {
      for (const f of s.fechas) {
        const matches = f.encuentros || f.partidos || [];
        for (const p of matches) {
          sMatches++;
          if (Array.isArray(p.duelosIndividuales)) {
            let pml = 0, pmv = 0, gtl = 0, gtv = 0, duelosFinalizados = 0;
            for (const d of p.duelosIndividuales) {
              if (d.finalizado) {
                duelosFinalizados++;
                gtl += d.golesLocal || 0;
                gtv += d.golesVisitante || 0;
                if (d.golesLocal > d.golesVisitante) pml++;
                else if (d.golesVisitante > d.golesLocal) pmv++;
              }
            }

            p.puntosMiniLocal = pml;
            p.puntosMiniVisitante = pmv;
            p.golesTotalLocal = gtl;
            p.golesTotalVisitante = gtv;

            if (duelosFinalizados === 3) {
              p.finalizado = true;
              sFinalized++;
              summary.partidosAuditados++;
            }
          }
        }
      }
    }

    await s.save();
    invalidateCache('superliga');

    summary.detalles.push({
      tipo: 'Superliga',
      nombre: sNombre,
      participantes: s.equipos?.length || 0,
      partidosTotal: sMatches,
      partidosJugados: sFinalized
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Supersupercopa
  // ───────────────────────────────────────────────────────────────────────────
  const sscs = await Supersupercopa.find({}).catch(() => []);
  for (const ssc of sscs) {
    const sscNombre = `Supersupercopa (${ssc.temporada || 'Actual'})`;
    if (normQuery && !sscNombre.toLowerCase().includes(normQuery) && !'supersupercopa'.includes(normQuery) && !'ssc'.includes(normQuery)) {
      continue;
    }

    summary.competicionesSincronizadas++;
    let sscMatches = 0;
    let sscFinalized = 0;

    // Grupos
    if (Array.isArray(ssc.grupos)) {
      for (const g of ssc.grupos) {
        if (Array.isArray(g.fechas)) {
          for (const f of g.fechas) {
            for (const p of (f.partidos || [])) {
              sscMatches++;
              if (p.finalizado) {
                sscFinalized++;
                summary.partidosAuditados++;
              }
            }
          }
        }
      }
    }

    // Playoff
    const playoffs = [...(ssc.semifinales || []), ...(ssc.final ? [ssc.final] : [])];
    for (const ll of playoffs) {
      sscMatches += 2;
      if (ll.ida?.finalizado) { sscFinalized++; summary.partidosAuditados++; }
      if (ll.vuelta?.finalizado) { sscFinalized++; summary.partidosAuditados++; }
    }

    await ssc.save();
    invalidateCache('ssc');

    summary.detalles.push({
      tipo: 'Supersupercopa',
      nombre: sscNombre,
      participantes: (ssc.grupos?.[0]?.equipos?.length || 0) + (ssc.grupos?.[1]?.equipos?.length || 0),
      partidosTotal: sscMatches,
      partidosJugados: sscFinalized
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Sincronización Global de Estadísticas en Modelo Jugador
  // ───────────────────────────────────────────────────────────────────────────
  if (syncGlobal) {
    try {
      const { fullSyncAndRecalculateGlobal } = await import('./sincronizartorneos.js');
      if (typeof fullSyncAndRecalculateGlobal === 'function') {
        await fullSyncAndRecalculateGlobal(client, false);
        summary.syncGlobalEjecutado = true;
      }
    } catch (e) {
      console.error('Error al invocar recálculo global:', e.message);
    }
  }

  return summary;
}

function buildResultEmbed(result, query) {
  const embed = new EmbedBuilder()
    .setTitle('🔄 Sincronización de Competencias desde Fixture')
    .setColor('#22c55e')
    .setDescription(
      `Se auditaron los fixtures y se reconstruyeron los apartados de equipos, tablas de posiciones y llaves con total exactitud.\n\n` +
      `🏆 **Competencias sincronizadas:** **${result.competicionesSincronizadas}**` + (query ? ` *(Filtro: "${query}")*` : '') + `\n` +
      `⚽ **Partidos finalizados computados:** **${result.partidosAuditados}**\n` +
      `👥 **Apartados de equipos:** Sincronizados y vinculados\n` +
      `🌐 **Cachés visuales de tablas:** Actualizadas y limpias\n` +
      `👤 **Sincronización global de jugadores:** ${result.syncGlobalEjecutado ? '✅ Realizada' : 'Omitida'}`
    )
    .setTimestamp();

  if (result.detalles.length > 0) {
    const listPreview = result.detalles
      .slice(0, 10)
      .map(d => `• **${d.nombre}** (\`${d.tipo}\`): ${d.partidosJugados}/${d.partidosTotal} partidos computados — ${d.participantes} participantes`)
      .join('\n');

    const extra = result.detalles.length > 10 ? `\n*...y ${result.detalles.length - 10} competencias más.*` : '';
    embed.addFields({ name: '📊 Detalle de Competencias Reconstruidas', value: listPreview + extra });
  }

  return embed;
}
