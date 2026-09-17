import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Jugador from '../../models/Jugador.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';
import Equipos from '../../models/superliga/Equipos.js';
import Superliga from '../../models/superliga/Superliga.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import { getOrCachePlayerAvatar } from '../../utils/visual/avatarCache.js';
import { invalidateCache } from '../../utils/visual/imageCache.js';

export default {
  name: 'platubi-sincronizartorneos',
  aliases: [
    'sincronizartorneos',
    'synctorneos',
    'sincronizarligas',
    'syncligas',
    'sincronizardatos',
    'syncglobal',
    'recalcularglobal',
    'recalculartodo',
    'plsincronizartorneos'
  ],
  desc: 'Recalcula y sobreescribe las estadísticas globales de los jugadores basándose estrictamente en los partidos y torneos reales de la base de datos.',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-sincronizartorneos')
    .setDescription('Recalcula y sincroniza las estadísticas globales de todos los jugadores desde los torneos y ligas.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(opt =>
      opt.setName('limpiar_fantasmas')
        .setDescription('Si es true, resetea a 0 las estadísticas que no tengan partidos registrados en ningún torneo')
        .setRequired(false)),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para usar este comando.', flags: 64 });
    }

    await interaction.deferReply();
    const limpiarFantasmas = interaction.options.getBoolean('limpiar_fantasmas') ?? true;

    const result = await fullSyncAndRecalculateGlobal(client, limpiarFantasmas);
    const embed = buildResultEmbed(result);
    await interaction.editReply({ embeds: [embed] });
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
    }

    const loading = await message.reply('<a:loading:1461897825439711468> **Auditando todos los partidos de torneos/ligas y recalculando estadísticas globales de jugadores...**');

    try {
      const result = await fullSyncAndRecalculateGlobal(client, true);
      const embed = buildResultEmbed(result);
      await loading.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('Error en sincronizartorneos:', error);
      await loading.edit(`❌ Error durante la sincronización: ${error.message}`);
    }
  }
};

/**
 * Escanea todos los torneos, ligas y copas de la base de datos, extrae TODOS los partidos reales
 * jugados/finalizados, y sobreescribe las estadísticas de `Jugador` (PG, PP, WO, GF, GC, Historial H2H)
 * para que coincidan 100% con los datos de partidos reales existentes.
 */
export async function fullSyncAndRecalculateGlobal(client, limpiarFantasmas = true) {
  // 1. Cargar todos los jugadores de MongoDB
  const dbPlayers = await Jugador.find({}).catch(() => []);
  const playerMap = new Map(); // id -> doc

  for (const p of dbPlayers) {
    const pId = String(p.id || p.discordId || p._id || '');
    if (pId) playerMap.set(pId, p);
    if (p.nombre) playerMap.set(p.nombre.toLowerCase().trim(), p);
  }

  // Estructura de cálculo global para cada jugador
  // key = playerDoc._id o id
  const statsCalc = new Map();

  function getOrInitStats(playerDoc) {
    const docKey = String(playerDoc._id || playerDoc.id);
    if (!statsCalc.has(docKey)) {
      statsCalc.set(docKey, {
        doc: playerDoc,
        pg: 0,
        pp: 0,
        wo: 0,
        gf: 0,
        gc: 0,
        historialMap: new Map() // rivalId -> { rivalId, rivalNombre, pj, pg, pe, pp, gf, gc }
      });
    }
    return statsCalc.get(docKey);
  }

  // Inicializar todos los jugadores en 0 si limpiarFantasmas está activo
  for (const p of dbPlayers) {
    getOrInitStats(p);
  }

  function resolvePlayerDoc(id, name) {
    const idKey = id ? String(id).trim() : '';
    if (idKey && playerMap.has(idKey)) return playerMap.get(idKey);
    const nameKey = name ? String(name).toLowerCase().trim() : '';
    if (nameKey && playerMap.has(nameKey)) return playerMap.get(nameKey);
    return null;
  }

  let totalPartidosProcesados = 0;
  let competicionesAuditadas = 0;

  function registrarResultado(localId, localNombre, visId, visNombre, gl, gv, isWO = false, isDoubleWO = false) {
    const pL = resolvePlayerDoc(localId, localNombre);
    const pV = resolvePlayerDoc(visId, visNombre);

    if (!pL || !pV) return;
    if (String(pL._id || pL.id) === String(pV._id || pV.id)) return;

    totalPartidosProcesados++;

    const sL = getOrInitStats(pL);
    const sV = getOrInitStats(pV);

    sL.gf += gl;
    sL.gc += gv;
    sV.gf += gv;
    sV.gc += gl;

    const isEmpate = gl === gv;
    const isLocalWinner = gl > gv;
    const isVisWinner = gv > gl;

    if (isDoubleWO) {
      sL.wo += 1;
      sL.pp += 1;
      sV.wo += 1;
      sV.pp += 1;
    } else if (isWO) {
      if (isLocalWinner) {
        sL.pg += 1;
        sV.pp += 1;
        sV.wo += 1;
      } else if (isVisWinner) {
        sV.pg += 1;
        sL.pp += 1;
        sL.wo += 1;
      }
    } else {
      if (isLocalWinner) {
        sL.pg += 1;
        sV.pp += 1;
      } else if (isVisWinner) {
        sV.pg += 1;
        sL.pp += 1;
      }
    }

    // Historial H2H
    const idL = String(pL.id || pL.discordId || pL._id);
    const idV = String(pV.id || pV.discordId || pV._id);
    const nomL = pL.nombre || localNombre;
    const nomV = pV.nombre || visNombre;

    // H2H en Local
    if (!sL.historialMap.has(idV)) {
      sL.historialMap.set(idV, { rivalId: idV, rivalNombre: nomV, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 });
    }
    const hL = sL.historialMap.get(idV);
    hL.pj += 1;
    hL.gf += gl;
    hL.gc += gv;
    if (isLocalWinner && !isDoubleWO) hL.pg += 1;
    else if (isEmpate && !isDoubleWO) hL.pe += 1;
    else hL.pp += 1;

    // H2H en Visitante
    if (!sV.historialMap.has(idL)) {
      sV.historialMap.set(idL, { rivalId: idL, rivalNombre: nomL, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 });
    }
    const hV = sV.historialMap.get(idL);
    hV.pj += 1;
    hV.gf += gv;
    hV.gc += gl;
    if (isVisWinner && !isDoubleWO) hV.pg += 1;
    else if (isEmpate && !isDoubleWO) hV.pe += 1;
    else hV.pp += 1;
  }

  // 2. Extraer partidos de Ligas Regulares (Primera, Segunda, Tercera)
  const regularModels = [Primera, Segunda, Tercera];
  for (const model of regularModels) {
    const ligas = await model.find({}).catch(() => []);
    for (const liga of ligas) {
      competicionesAuditadas++;
      const schedule = liga.partidos ?? liga.fechas ?? [];
      if (Array.isArray(schedule)) {
        for (const fecha of schedule) {
          const partidos = fecha.partidos ?? fecha.encuentros ?? [];
          if (Array.isArray(partidos)) {
            for (const p of partidos) {
              if (!p.finalizado) continue;
              const gl = parseInt(p.golesLocal) || 0;
              const gv = parseInt(p.golesVisitante) || 0;
              const isDoubleWO = p.isDoubleWO || (p.isWO && gl === 0 && gv === 0);
              const isWO = p.isWO || (gl === 3 && gv === 0) || (gl === 0 && gv === 3);

              registrarResultado(p.localId, p.localNombre, p.visitanteId, p.visitanteNombre, gl, gv, isWO, isDoubleWO);
            }
          }
        }
      }
    }
  }

  // 3. Extraer partidos de Torneos y Copas (Torneo, Coppa)
  const copasModels = [Torneo, Coppa];
  for (const cModel of copasModels) {
    const torneos = await cModel.find({}).catch(() => []);
    for (const t of torneos) {
      competicionesAuditadas++;

      // Enfrentamientos de fase de grupos
      if (Array.isArray(t.enfrentamientosGrupos)) {
        for (const enf of t.enfrentamientosGrupos) {
          if (enf.completado || (enf.resultado && enf.resultado !== 'Pendiente')) {
            const resParts = String(enf.resultado || '').split('-').map(s => parseInt(s.trim(), 10));
            const gl = !isNaN(resParts[0]) ? resParts[0] : (enf.ida?.golesLocal ?? 0);
            const gv = !isNaN(resParts[1]) ? resParts[1] : (enf.ida?.golesVisitante ?? 0);
            const isWO = String(enf.resultado || '').includes('WO');

            registrarResultado(enf.localId, enf.local, enf.visitanteId, enf.visitante, gl, gv, isWO, false);
          }

          // Duelos individuales dentro de encuentros
          if (Array.isArray(enf.duelosIndividuales)) {
            for (const d of enf.duelosIndividuales) {
              if (d.finalizado || (typeof d.golesLocal === 'number' && typeof d.golesVisitante === 'number')) {
                const gl = parseInt(d.golesLocal) || 0;
                const gv = parseInt(d.golesVisitante) || 0;
                registrarResultado(d.localJugador, d.localJugadorNombre, d.visitanteJugador, d.visitanteJugadorNombre, gl, gv, false, false);
              }
            }
          }
        }
      }

      // Llaves eliminatorias (Brackets)
      if (t.llaves && typeof t.llaves === 'object') {
        for (const fase of Object.keys(t.llaves)) {
          const arr = t.llaves[fase];
          if (Array.isArray(arr)) {
            for (const ll of arr) {
              const eq1 = ll.equipo1 || {};
              const eq2 = ll.equipo2 || {};
              if (!eq1.nombre || !eq2.nombre || eq1.nombre === 'BYE' || eq2.nombre === 'BYE') continue;

              // Partido de ida
              if (ll.ida && ll.ida.finalizado) {
                const gl = parseInt(ll.ida.golesLocal) || 0;
                const gv = parseInt(ll.ida.golesVisitante) || 0;
                registrarResultado(eq1.discordId || eq1.id, eq1.nombre, eq2.discordId || eq2.id, eq2.nombre, gl, gv);
              }

              // Partido de vuelta
              if (ll.vuelta && ll.vuelta.finalizado) {
                const gl = parseInt(ll.vuelta.golesLocal) || 0;
                const gv = parseInt(ll.vuelta.golesVisitante) || 0;
                registrarResultado(eq2.discordId || eq2.id, eq2.nombre, eq1.discordId || eq1.id, eq1.nombre, gl, gv);
              }

              // Partido desempate
              if (ll.desempate && ll.desempate.finalizado) {
                const gl = parseInt(ll.desempate.golesLocal) || 0;
                const gv = parseInt(ll.desempate.golesVisitante) || 0;
                registrarResultado(eq1.discordId || ll.equipo1.id, eq1.nombre, eq2.discordId || eq2.id, eq2.nombre, gl, gv);
              }

              // Duelos individuales
              if (Array.isArray(ll.duelosIndividuales)) {
                for (const d of ll.duelosIndividuales) {
                  if (d.finalizado || (typeof d.golesLocal === 'number' && typeof d.golesVisitante === 'number')) {
                    const gl = parseInt(d.golesLocal) || 0;
                    const gv = parseInt(d.golesVisitante) || 0;
                    registrarResultado(d.localJugador, d.localJugadorNombre, d.visitanteJugador, d.visitanteJugadorNombre, gl, gv);
                  }
                }
              }
            }
          }
        }
      }

      if (t.prefix) invalidateCache(t.prefix);
    }
  }

  // 4. Extraer partidos de Superliga
  const superligaDocs = await Superliga.find({}).catch(() => []);
  for (const s of superligaDocs) {
    competicionesAuditadas++;
    if (Array.isArray(s.fechas)) {
      for (const f of s.fechas) {
        if (Array.isArray(f.encuentros)) {
          for (const e of f.encuentros) {
            if (Array.isArray(e.duelosIndividuales)) {
              for (const d of e.duelosIndividuales) {
                if (d.finalizado || (typeof d.golesLocal === 'number' && typeof d.golesVisitante === 'number')) {
                  const gl = parseInt(d.golesLocal) || 0;
                  const gv = parseInt(d.golesVisitante) || 0;
                  registrarResultado(d.localJugador, d.localJugadorNombre, d.visitanteJugador, d.visitanteJugadorNombre, gl, gv);
                }
              }
            }
          }
        }
      }
    }
  }

  // 5. Sobreescribir las estadísticas de cada jugador o eliminar si quedó en 0 sin actividad
  let jugadoresConEstadisticas = 0;
  let jugadoresEliminados = 0;
  const eliminadosNombres = [];

  for (const [docKey, stat] of statsCalc.entries()) {
    const pDoc = stat.doc;
    const targetId = pDoc._id || pDoc.id || docKey;

    const totalPj = stat.pg + stat.pp + stat.wo;
    const totalGoles = stat.gf + stat.gc;
    const tieneTitulos = Boolean(
      (Array.isArray(pDoc.titulos?.oficiales) && pDoc.titulos.oficiales.length > 0) ||
      (Array.isArray(pDoc.titulos?.amistosos) && pDoc.titulos.amistosos.length > 0) ||
      (typeof pDoc.titulos === 'number' && pDoc.titulos > 0)
    );

    // Si el jugador no participó en ningún partido real y sigue en 0 total, se elimina de la DB
    if (totalPj === 0 && totalGoles === 0 && !tieneHistorial && !tieneTitulos) {
      await Jugador.deleteById(targetId);
      jugadoresEliminados++;
      eliminadosNombres.push(pDoc.nombre || targetId);
    } else {
      pDoc.partidosGanadosHistorico = stat.pg;
      pDoc.partidosPerdidosHistorico = stat.pp;
      pDoc.woHistorico = stat.wo;
      pDoc.golesAFavorHistorico = stat.gf;
      pDoc.golesEnContraHistorico = stat.gc;
      pDoc.historial = Array.from(stat.historialMap.values());

      await pDoc.save();
      jugadoresConEstadisticas++;
    }
  }

  return {
    totalJugadoresInicial: dbPlayers.length,
    competicionesAuditadas,
    totalPartidosProcesados,
    jugadoresConEstadisticas,
    jugadoresEliminados,
    eliminadosNombres
  };
}

function buildResultEmbed(result) {
  const embed = new EmbedBuilder()
    .setTitle('🔄 Recálculo Global y Limpieza de Jugadores')
    .setColor('#22c55e')
    .setDescription(
      `Todos los datos de jugadores se setearon a 0 y se recalcularon estrictamente desde los partidos reales de todos los torneos, ligas (Primera/Segunda/Tercera), copas y superliga.\n\n` +
      `🏆 **Competiciones analizadas:** ${result.competicionesAuditadas}\n` +
      `⚽ **Partidos contabilizados:** ${result.totalPartidosProcesados}\n` +
      `👤 **Jugadores con estadísticas reales:** **${result.jugadoresConEstadisticas}**\n` +
      `🗑️ **Jugadores sin partidos eliminados (en 0):** **${result.jugadoresEliminados}**`
    )
    .setTimestamp();

  if (result.jugadoresEliminados > 0) {
    const listPreview = result.eliminadosNombres
      .slice(0, 15)
      .map((n, idx) => `**${idx + 1}.** \`${n}\``)
      .join(', ');
    const extra = result.jugadoresEliminados > 15 ? ` *(y ${result.jugadoresEliminados - 15} más)*` : '';
    embed.addFields({ name: '🗑️ Documentos Removidos por Inactividad (0 partidos)', value: listPreview + extra });
  }

  return embed;
}

