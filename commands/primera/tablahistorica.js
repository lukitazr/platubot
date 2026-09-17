import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import Jugador from '../../models/Jugador.js';
import { generarTablaHistoricaImagen } from '../../utils/visual/tablaHistoricaGenerator.js';
import { buildTablaHistoricaNavigation } from '../../utils/ui/tablaHistoricaNavigation.js';

const PAGE_SIZE = 20;

export default {
  name: 'platubi-tablahistorica',
  aliases: [
    'tablahistorica',
    'historica',
    'rankinghistorico',
    'pltablahistorica',
    'tablahistoricapl',
    'tablahist',
    'tablah'
  ],
  desc: 'Muestra la tabla histórica con todos los jugadores registrados en Platubi. Uso: !tablahistorica [página | nombre_jugador]',
  permisos: [],

  // Data para Slash Commands
  data: new SlashCommandBuilder()
    .setName('platubi-tablahistorica')
    .setDescription('Muestra la tabla histórica con todos los jugadores registrados')
    .addIntegerOption(opt =>
      opt.setName('pagina')
        .setDescription('Número de página a visualizar')
        .setRequired(false)
        .setMinValue(1))
    .addStringOption(opt =>
      opt.setName('jugador')
        .setDescription('Buscar el puesto de un jugador específico')
        .setRequired(false)),

  // Ejecución para Slash Commands
  execute: async (client, interaction) => {
    await interaction.deferReply();

    const sortedPlayers = await getSortedHistoricalPlayers();
    if (!sortedPlayers.length) {
      return interaction.editReply('❌ No hay jugadores registrados en la base de datos.');
    }

    const totalPages = Math.ceil(sortedPlayers.length / PAGE_SIZE) || 1;
    let pageIdx = 0;
    let highlightedSearch = null;

    const paginaOption = interaction.options.getInteger('pagina');
    const jugadorOption = interaction.options.getString('jugador');

    if (paginaOption) {
      pageIdx = Math.max(0, Math.min(paginaOption - 1, totalPages - 1));
    } else if (jugadorOption) {
      const foundIdx = findCandidatePlayerIndex(sortedPlayers, jugadorOption);
      if (foundIdx !== -1) {
        pageIdx = Math.floor(foundIdx / PAGE_SIZE);
        highlightedSearch = sortedPlayers[foundIdx];
      } else {
        return interaction.editReply(`❌ No se encontró ningún jugador registrado que coincida con **"${jugadorOption}"**.`);
      }
    }

    await renderAndSendHistoricalTable(client, interaction, sortedPlayers, pageIdx, highlightedSearch);
  },

  // Ejecución para Prefix Commands
  run: async (client, message, args) => {
    const sortedPlayers = await getSortedHistoricalPlayers();
    if (!sortedPlayers.length) {
      return message.reply('❌ No hay jugadores registrados en la base de datos.');
    }

    const totalPages = Math.ceil(sortedPlayers.length / PAGE_SIZE) || 1;
    let pageIdx = 0;
    let highlightedSearch = null;

    if (args && args.length > 0) {
      const rawArg = args.join(' ').trim();
      const numArg = parseInt(rawArg, 10);

      if (!isNaN(numArg) && numArg >= 1) {
        pageIdx = Math.max(0, Math.min(numArg - 1, totalPages - 1));
      } else {
        const foundIdx = findCandidatePlayerIndex(sortedPlayers, rawArg);
        if (foundIdx !== -1) {
          pageIdx = Math.floor(foundIdx / PAGE_SIZE);
          highlightedSearch = sortedPlayers[foundIdx];
        } else {
          return message.reply(`❌ No se encontró ningún jugador registrado que coincida con **"${rawArg}"**.`);
        }
      }
    }

    await renderAndSendHistoricalTable(client, message, sortedPlayers, pageIdx, highlightedSearch);
  },
};

import { normalizeTitulos } from '../../utils/torneos/titulosHelper.js';

/**
 * Consulta y ordena todos los jugadores de la base de datos según los criterios:
 * 1. Títulos Oficiales DESC (los títulos amistosos se muestran pero no alteran el ranking)
 * 2. Pts Históricos ((PG * 3) - (WO * 2)) DESC (los WO restan peso en la tabla)
 * 3. PG DESC
 * 4. WO ASC (menos WOs)
 * 5. DG DESC
 * 6. GF DESC
 */
async function getSortedHistoricalPlayers() {
  const rawPlayers = await Jugador.find({}).catch(() => []);
  if (!rawPlayers.length) return [];

  const players = rawPlayers.map(j => {
    const norm = normalizeTitulos(j.titulos);
    const titulosOficiales = norm.oficiales.length;
    const titulosAmistosos = norm.amistosos.length;
    const pg = Number(j.partidosGanadosHistorico) || 0;
    const pp = Number(j.partidosPerdidosHistorico) || 0;
    const wo = Number(j.woHistorico) || 0;
    const gf = Number(j.golesAFavorHistorico) || 0;
    const gc = Number(j.golesEnContraHistorico) || 0;
    const dg = gf - gc;
    const pj = pg + pp + wo;
    const pts = (pg * 3) - (wo * 2);

    return {
      id: String(j.id || j.discordId || j._id || j.nombre),
      discordId: j.discordId,
      _id: j._id,
      nombre: j.nombre || 'Jugador Desconocido',
      avatar: j.avatar || '',
      titulosOficiales,
      titulosAmistosos,
      titulos: titulosOficiales,
      pg,
      pp,
      wo,
      gf,
      gc,
      dg,
      pj,
      pts,
    };
  });

  players.sort((a, b) => {
    if (b.titulosOficiales !== a.titulosOficiales) return b.titulosOficiales - a.titulosOficiales;
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.pg !== a.pg) return b.pg - a.pg;
    if (a.wo !== b.wo) return a.wo - b.wo;
    if (b.dg !== a.dg) return b.dg - a.dg;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.nombre.localeCompare(b.nombre);
  });

  return players;
}

/**
 * Busca el índice de un jugador en la lista clasificada por nombre o ID.
 */
function findCandidatePlayerIndex(players, query) {
  if (!query) return -1;
  const q = query.toLowerCase().trim();

  // 1. Coincidencia exacta por ID o Nombre
  let idx = players.findIndex(p =>
    String(p.id).toLowerCase() === q ||
    String(p.discordId).toLowerCase() === q ||
    String(p._id).toLowerCase() === q ||
    p.nombre.toLowerCase().trim() === q
  );
  if (idx !== -1) return idx;

  // 2. Coincidencia parcial por nombre
  idx = players.findIndex(p => p.nombre.toLowerCase().includes(q));
  return idx;
}

/**
 * Renderiza la imagen de la página solicitada y envía el mensaje con componentes interactivos.
 */
async function renderAndSendHistoricalTable(client, context, allPlayers, pageIdx, highlightedPlayer = null, existingMsg = null) {
  const totalPlayers = allPlayers.length;
  const totalPages = Math.ceil(totalPlayers / PAGE_SIZE) || 1;
  const safePageIdx = Math.max(0, Math.min(pageIdx, totalPages - 1));

  const startIdx = safePageIdx * PAGE_SIZE;
  const pagePlayers = allPlayers.slice(startIdx, startIdx + PAGE_SIZE);
  const startRank = startIdx + 1;

  const loadingContent = '<a:loading:1461897825439711468> Generando tabla histórica...';
  const msg = existingMsg
    ? await existingMsg.edit({ content: loadingContent, components: [] })
    : await (context.editReply ? context.editReply({ content: loadingContent }) : context.reply(loadingContent));

  const buffer = await generarTablaHistoricaImagen({
    players: pagePlayers,
    paginaActual: safePageIdx + 1,
    totalPaginas: totalPages,
    totalJugadores: totalPlayers,
    startRank,
  }, client);

  const attachment = new AttachmentBuilder(buffer, { name: 'tabla_historica.png' });

  let content = `🏆 **Tabla Histórica Platubi** — Página **${safePageIdx + 1}/${totalPages}** (${totalPlayers} jugadores registrados)`;
  if (highlightedPlayer) {
    const playerRank = allPlayers.findIndex(p => p.id === highlightedPlayer.id) + 1;
    content += `\n📍 **${highlightedPlayer.nombre}** se encuentra en la posición **#${playerRank}** (Títulos: 🏆 \`${highlightedPlayer.titulosOficiales}\` / 🎖️ \`${highlightedPlayer.titulosAmistosos}\`, PTS: \`${highlightedPlayer.pts}\`, PG: \`${highlightedPlayer.pg}\`, WO: \`${highlightedPlayer.wo}\`).`;
  }

  const components = buildTablaHistoricaNavigation('tablahist', safePageIdx, totalPages, totalPlayers, PAGE_SIZE);

  if (existingMsg) {
    await msg.edit({ content, files: [attachment], components });
  } else if (context.editReply) {
    await context.editReply({ content, files: [attachment], components });
  } else {
    await msg.edit({ content, files: [attachment], components });
  }

  if (totalPages <= 1) return;

  // Manejar interacciones de paginación
  const filter = i => {
    const userId = context.author?.id || context.user?.id;
    return i.user.id === userId && i.customId.startsWith('tablahist_');
  };

  const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

  collector.on('collect', async i => {
    await i.deferUpdate();
    let nextIdx = safePageIdx;

    if (i.customId === 'tablahist_prev') nextIdx--;
    else if (i.customId === 'tablahist_next') nextIdx++;
    else if (i.customId === 'tablahist_first') nextIdx = 0;
    else if (i.customId === 'tablahist_last') nextIdx = totalPages - 1;
    else if (i.customId === 'tablahist_select') nextIdx = parseInt(i.values[0], 10);

    collector.stop();
    await renderAndSendHistoricalTable(client, context, allPlayers, nextIdx, null, msg);
  });
}
