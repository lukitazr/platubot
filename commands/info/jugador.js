import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import Jugador from '../../models/Jugador.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import Superliga from '../../models/superliga/Superliga.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import { normalizeTitulos } from '../../utils/torneos/titulosHelper.js';
import { getOrCachePlayerAvatar } from '../../utils/visual/avatarCache.js';
import { resolvePlayers, ensureUserRegistered } from '../../utils/db/userResolver.js';
import { generarTarjetaJugadorInfo } from '../../utils/visual/jugadorInfoGenerator.js';

export default {
  name: 'platubi-jugador',
  aliases: ['jugador', 'perfil', 'player', 'pinfo', 'jinfo', 'pl-jugador'],
  desc: 'Muestra la tarjeta de información y estadísticas de un jugador (títulos oficiales/amistosos, club, historial H2H, competiciones). Uso: !jugador [id | @mencion | nombre]',
  permisos: [],

  data: new SlashCommandBuilder()
    .setName('jugador')
    .setDescription('Muestra la tarjeta de información y estadísticas de un jugador.')
    .addStringOption(opt =>
      opt.setName('buscar')
        .setDescription('ID, mención o nombre del jugador (deja vacío para ver tu perfil)')
        .setRequired(false)
    ),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    const query = interaction.options.getString('buscar');
    await handlePlayerInfo(client, interaction, query, true);
  },

  run: async (client, message, args) => {
    let query = args.join(' ').trim();
    // Si usó !jugador info <nombre>, remover 'info'
    if (query.toLowerCase().startsWith('info ')) {
      query = query.slice(5).trim();
    } else if (query.toLowerCase() === 'info') {
      query = '';
    }

    await handlePlayerInfo(client, message, query, false);
  }
};

/**
 * Busca al jugador, recopila todas sus estadísticas y genera la tarjeta visual.
 */
async function handlePlayerInfo(client, context, rawQuery, isInteraction) {
  const authorId = isInteraction ? context.user.id : context.author.id;
  const authorUser = isInteraction ? context.user : context.author;

  let targetId = '';
  let targetName = '';

  // 1. Extraer identificador
  if (!rawQuery) {
    targetId = authorId;
  } else {
    const mentionMatch = rawQuery.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
      targetId = mentionMatch[1];
    } else if (/^\d{17,20}$/.test(rawQuery)) {
      targetId = rawQuery;
    } else {
      targetName = rawQuery;
    }
  }

  // 2. Buscar documento en Jugador
  let playerDoc = null;
  if (targetId) {
    playerDoc = await Jugador.findOne({
      $or: [
        { id: targetId },
        { discordId: targetId },
        { _id: targetId }
      ]
    }).catch(() => null);
  } else if (targetName) {
    const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    playerDoc = await Jugador.findOne({
      $or: [
        { nombre: new RegExp(`^${escaped}$`, 'i') },
        { aliases: new RegExp(`^${escaped}$`, 'i') }
      ]
    }).catch(() => null);

    if (!playerDoc) {
      // Búsqueda parcial por nombre
      playerDoc = await Jugador.findOne({
        nombre: new RegExp(escaped, 'i')
      }).catch(() => null);
    }
  }

  // Si no se encontró y la consulta correspondía al propio autor o un ID de Discord
  if (!playerDoc && targetId) {
    try {
      const userObj = targetId === authorId ? authorUser : await client.users.fetch(targetId).catch(() => null);
      if (userObj) {
        playerDoc = await ensureUserRegistered(userObj, client);
      }
    } catch { }
  }

  if (!playerDoc) {
    const notFoundMsg = `❌ No se encontró ningún jugador registrado con **"${rawQuery || targetId}"**.`;
    if (isInteraction) return context.editReply(notFoundMsg);
    return context.reply(notFoundMsg);
  }

  const loadingMsg = !isInteraction
    ? await context.reply('<a:loading:1461897825439711468> Generando tarjeta del jugador, por favor espera...')
    : null;

  try {
    const playerId = String(playerDoc.id || playerDoc.discordId || playerDoc._id || '');
    const playerNombre = playerDoc.nombre || 'Jugador';

    // 3. Normalizar títulos (Oficiales y Amistosos)
    const normTitulos = normalizeTitulos(playerDoc.titulos);
    const titulosOficiales = normTitulos.oficiales;
    const titulosAmistosos = normTitulos.amistosos;
    const titulosOficialesCount = titulosOficiales.length;

    // 4. Calcular estadísticas globales del jugador
    const pg = Number(playerDoc.partidosGanadosHistorico) || 0;
    const pp = Number(playerDoc.partidosPerdidosHistorico) || 0;
    const wo = Number(playerDoc.woHistorico) || 0;
    const gf = Number(playerDoc.golesAFavorHistorico) || 0;
    const gc = Number(playerDoc.golesEnContraHistorico) || 0;
    const pj = pg + pp + wo;
    const pts = (pg * 3) - (wo * 2);
    const dg = gf - gc;
    const winrate = pj > 0 ? Math.round((pg / pj) * 100) : 0;

    const stats = { pts, pj, pg, pp, wo, gf, gc, dg, winrate };

    // 5. Calcular Ranking Histórico de todos los jugadores
    const allDbPlayers = await Jugador.find({}).catch(() => []);
    const sortedRanking = allDbPlayers.map(p => {
      const pNorm = normalizeTitulos(p.titulos);
      const pOfi = pNorm.oficiales.length;
      const pPg = Number(p.partidosGanadosHistorico) || 0;
      const pPp = Number(p.partidosPerdidosHistorico) || 0;
      const pWo = Number(p.woHistorico) || 0;
      const pGf = Number(p.golesAFavorHistorico) || 0;
      const pGc = Number(p.golesEnContraHistorico) || 0;
      const pPts = (pPg * 3) - (pWo * 2);
      const pDg = pGf - pGc;

      return {
        id: String(p.id || p.discordId || p._id),
        titulosOficiales: pOfi,
        pts: pPts,
        pg: pPg,
        wo: pWo,
        dg: pDg,
        gf: pGf,
        nombre: p.nombre || ''
      };
    });

    sortedRanking.sort((a, b) => {
      if (b.titulosOficiales !== a.titulosOficiales) return b.titulosOficiales - a.titulosOficiales;
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.pg !== a.pg) return b.pg - a.pg;
      if (a.wo !== b.wo) return a.wo - b.wo;
      if (b.dg !== a.dg) return b.dg - a.dg;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.nombre.localeCompare(b.nombre);
    });

    const rankIdx = sortedRanking.findIndex(p => p.id === playerId);
    const rankingHistorico = rankIdx !== -1 ? rankIdx + 1 : sortedRanking.length;

    // 6. Equipo actual de Superliga
    const equiposSuperliga = await EquipoSuperliga.find({}).catch(() => []);
    let equipoSuperligaData = null;

    for (const eq of equiposSuperliga) {
      if (eq.coach?.id === playerId || eq.coach?.nombre?.toLowerCase() === playerNombre.toLowerCase()) {
        equipoSuperligaData = {
          nombre: eq.nombre,
          escudo: eq.escudo,
          rol: 'Coach'
        };
        break;
      }
      const inTeam = eq.jugadores?.find(j => j.id === playerId || j.nombre?.toLowerCase() === playerNombre.toLowerCase());
      if (inTeam) {
        equipoSuperligaData = {
          nombre: eq.nombre,
          escudo: eq.escudo,
          rol: 'Jugador'
        };
        break;
      }
    }

    // 7. Cantidad total de competiciones en las que participó
    const competicionesUnicas = new Set();
    const allPlayerIds = [playerId, playerDoc.id, playerDoc.discordId, String(playerDoc._id), playerNombre.toLowerCase()].filter(Boolean);

    const matchesPlayer = (val) => {
      if (!val) return false;
      const str = String(val).toLowerCase().trim();
      return allPlayerIds.some(idCandidate => idCandidate && String(idCandidate).toLowerCase().trim() === str);
    };

    // Primera, Segunda, Tercera
    const regularModels = [Primera, Segunda, Tercera];
    for (const model of regularModels) {
      const ligas = await model.find({}).catch(() => []);
      for (const liga of ligas) {
        const ligaKey = `regular_${liga._id || liga.nombreLiga || liga.temporada}`;
        const inJugadores = Array.isArray(liga.jugadores) && liga.jugadores.some(j => matchesPlayer(j.id) || matchesPlayer(j.discordId) || matchesPlayer(j.nombre));
        if (inJugadores) {
          competicionesUnicas.add(ligaKey);
          continue;
        }
        const schedule = liga.partidos ?? liga.fechas ?? [];
        let played = false;
        if (Array.isArray(schedule)) {
          for (const f of schedule) {
            const matches = f.partidos ?? f.encuentros ?? [];
            if (Array.isArray(matches) && matches.some(m => matchesPlayer(m.localId) || matchesPlayer(m.localNombre) || matchesPlayer(m.visitanteId) || matchesPlayer(m.visitanteNombre))) {
              played = true;
              break;
            }
          }
        }
        if (played) competicionesUnicas.add(ligaKey);
      }
    }

    // Copas y Torneos dinámicos
    const copasModels = [Torneo, Coppa];
    for (const cModel of copasModels) {
      const torneos = await cModel.find({}).catch(() => []);
      for (const t of torneos) {
        const tKey = `copa_${t._id || t.prefix || t.nombre}`;
        const inEquipos = Array.isArray(t.equipos) && t.equipos.some(e =>
          matchesPlayer(e.id) || matchesPlayer(e.discordId) || matchesPlayer(e.propietario) || matchesPlayer(e.nombre) ||
          (Array.isArray(e.miembros) && e.miembros.some(m => matchesPlayer(m) || matchesPlayer(m?.id) || matchesPlayer(m?.discordId) || matchesPlayer(m?.nombre)))
        );
        if (inEquipos) {
          competicionesUnicas.add(tKey);
          continue;
        }
        // Enfrentamientos
        if (Array.isArray(t.enfrentamientosGrupos) && t.enfrentamientosGrupos.some(e => matchesPlayer(e.localId) || matchesPlayer(e.local) || matchesPlayer(e.visitanteId) || matchesPlayer(e.visitante))) {
          competicionesUnicas.add(tKey);
          continue;
        }
      }
    }

    // Superliga & Supersupercopa
    const superligaDocs = await Superliga.find({}).catch(() => []);
    for (const s of superligaDocs) {
      const sKey = `sl_${s._id || s.temporada}`;
      let playedSL = false;
      if (Array.isArray(s.fechas)) {
        for (const f of s.fechas) {
          if (Array.isArray(f.encuentros)) {
            for (const e of f.encuentros) {
              if (Array.isArray(e.duelosIndividuales) && e.duelosIndividuales.some(d => matchesPlayer(d.localJugador) || matchesPlayer(d.localJugadorNombre) || matchesPlayer(d.visitanteJugador) || matchesPlayer(d.visitanteJugadorNombre))) {
                playedSL = true;
                break;
              }
            }
          }
          if (playedSL) break;
        }
      }
      if (playedSL) competicionesUnicas.add(sKey);
    }

    const totalCompeticiones = Math.max(competicionesUnicas.size, (titulosOficiales.length + titulosAmistosos.length > 0 ? 1 : 0));

    // 8. Top 3 Historiales (H2H)
    const rawHistorial = Array.isArray(playerDoc.historial) ? playerDoc.historial : [];
    const validHistorial = rawHistorial.filter(h => Number(h.pj) > 0);
    validHistorial.sort((a, b) => (Number(b.pj) || 0) - (Number(a.pj) || 0));

    const top3Raw = validHistorial.slice(0, 3);
    const rivalIds = top3Raw.map(h => String(h.rivalId || h.rivalNombre)).filter(Boolean);
    const rivalPlayerMap = await resolvePlayers(rivalIds, client).catch(() => new Map());

    const topHistorial = await Promise.all(top3Raw.map(async (h) => {
      const rId = String(h.rivalId || '');
      const rInfo = rivalPlayerMap.get(rId) || rivalPlayerMap.get(h.rivalNombre) || {};
      const rivalNombre = rInfo.nombre || h.rivalNombre || 'Rival';
      const rivalAvatar = await getOrCachePlayerAvatar(rId || rivalNombre, client, rivalPlayerMap).catch(() => null);

      const hPj = Number(h.pj) || 0;
      const hPg = Number(h.pg) || 0;
      const hPe = Number(h.pe) || 0;
      const hPp = Number(h.pp) || 0;
      const hGf = Number(h.gf) || 0;
      const hGc = Number(h.gc) || 0;

      let estado = 'EQUITATIVO';
      if (hPg > hPp) estado = 'POSITIVO';
      else if (hPp > hPg) estado = 'NEGATIVO';

      return {
        rivalNombre,
        rivalAvatar,
        pj: hPj,
        pg: hPg,
        pe: hPe,
        pp: hPp,
        gf: hGf,
        gc: hGc,
        estado
      };
    }));

    // 9. Avatar del jugador
    const playerMap = new Map();
    if (playerDoc) playerMap.set(playerId, playerDoc);
    const avatarBase64 = await getOrCachePlayerAvatar(playerId, client, playerMap).catch(() => null);

    // 10. Renderizar la tarjeta visual
    const pngBuffer = await generarTarjetaJugadorInfo({
      nombre: playerNombre,
      id: playerDoc.discordId || playerId,
      avatarBase64,
      rankingHistorico,
      totalJugadores: allDbPlayers.length,
      equipoSuperliga: equipoSuperligaData,
      totalCompeticiones,
      titulosOficiales,
      titulosAmistosos,
      stats,
      topHistorial
    });

    const attachment = new AttachmentBuilder(pngBuffer, { name: `perfil_${playerId}.png` });

    if (isInteraction) {
      await context.editReply({ files: [attachment] });
    } else if (loadingMsg) {
      await loadingMsg.delete().catch(() => { });
      await context.reply({ files: [attachment] });
    } else {
      await context.reply({ files: [attachment] });
    }
  } catch (error) {
    console.error('Error generando tarjeta de jugador:', error);
    const errMsg = `❌ Ocurrió un error al generar la tarjeta del jugador: ${error.message}`;
    if (isInteraction) {
      await context.editReply(errMsg).catch(() => { });
    } else if (loadingMsg) {
      await loadingMsg.edit(errMsg).catch(() => { });
    } else {
      await context.reply(errMsg).catch(() => { });
    }
  }
}
