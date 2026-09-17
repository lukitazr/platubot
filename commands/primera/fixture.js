import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import Primera from '../../models/Primera.js';
import { generarFixtureImagen } from '../../utils/visual/fixtureGenerator.js';
import { buildFixtureNavigation } from '../../utils/ui/fixtureNavigation.js';
import { getOrCachePlayerAvatar } from '../../utils/visual/avatarCache.js';
import { resolveFilterTarget, sendFilteredLeagueFixture } from '../../utils/fixtureFilter.js';

export default {
  name: 'platubi-fixture',
  aliases: ['plfixture', 'fixturepl', 'fixtureplatubi'],
  desc: 'Muestra el fixture de la Platubi. Uso: !platubi-fixture [liga] [fecha/jugador]',
  permisos: [],

  data: new SlashCommandBuilder()
    .setName('platubi-fixture')
    .setDescription('Muestra el fixture de la Platubi')
    .addStringOption(option =>
      option.setName('liga')
        .setDescription('Nombre o búsqueda de la liga (histórica o actual)')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('fecha')
        .setDescription('Número de la fecha a mostrar')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('jugador')
        .setDescription('Filtrar partidos por tag/ID/nombre de jugador')
        .setRequired(false)),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    
    const ligas = await getAllLigasSorted();
    if (!ligas.length) return interaction.editReply('❌ No hay ninguna temporada registrada.');

    const ligaQuery = interaction.options.getString('liga');
    const fechaOption = interaction.options.getInteger('fecha');
    const jugadorOption = interaction.options.getString('jugador');

    let liga = ligas[0]; // Por defecto la más reciente

    if (ligaQuery) {
      const q = ligaQuery.toLowerCase().trim();
      const found = ligas.find(l => (l.nombreLiga || '').toLowerCase().includes(q));
      if (!found) {
        return interaction.editReply(`❌ No se encontró ninguna liga que coincida con **"${ligaQuery}"**.`);
      }
      liga = found;
    }

    if (jugadorOption) {
      const filterTarget = await resolveFilterTarget(jugadorOption, client);
      if (filterTarget) {
        return await sendFilteredLeagueFixture({ client, context: interaction, liga, filterTarget, div: 'primera' });
      }
    }

    await sendFixture(client, interaction, liga, fechaOption, 'primera');
  },

  run: async (client, message, args) => {
    const ligas = await getAllLigasSorted();
    if (!ligas.length) return message.reply('❌ No hay ninguna temporada registrada.');

    let liga = null;
    let fechaNum = null;
    let filterTarget = null;

    if (args && args.length > 0) {
      // 1. Detectar si algún argumento es mención o ID numérico
      const mentionOrIdIdx = args.findIndex(a => /^<@!?\d{17,20}>$/.test(a) || /^\d{17,20}$/.test(a));
      if (mentionOrIdIdx !== -1) {
        const rawTarget = args[mentionOrIdIdx];
        filterTarget = await resolveFilterTarget(rawTarget, client);
        args = args.filter((_, i) => i !== mentionOrIdIdx);
      }

      if (args.length > 0) {
        const fullText = args.join(' ').trim();
        const firstArgAsNum = parseInt(args[0]);
        const lastToken = args[args.length - 1];
        const lastTokenNum = parseInt(lastToken);
        const hasNumericLastToken = args.length > 1 && !isNaN(lastTokenNum);

        let candidateName = fullText;
        if (hasNumericLastToken) {
          candidateName = args.slice(0, -1).join(' ').trim();
        }

        // Buscar por nombre de liga
        let matchLiga = ligas.find(l => (l.nombreLiga || '').toLowerCase().includes(candidateName.toLowerCase()));

        if (matchLiga) {
          liga = matchLiga;
          if (hasNumericLastToken) {
            fechaNum = lastTokenNum;
          }
        } else if (!isNaN(firstArgAsNum)) {
          liga = ligas[0];
          fechaNum = firstArgAsNum;
        } else {
          // Probar si el texto restante corresponde a un nombre de jugador
          if (!filterTarget) {
            const possiblePlayer = await resolveFilterTarget(fullText, client);
            if (possiblePlayer && (possiblePlayer.jugadorDoc || possiblePlayer.teamDoc)) {
              filterTarget = possiblePlayer;
              liga = ligas[0];
            } else {
              matchLiga = ligas.find(l => (l.nombreLiga || '').toLowerCase().includes(fullText.toLowerCase()));
              if (matchLiga) {
                liga = matchLiga;
              } else if (possiblePlayer) {
                filterTarget = possiblePlayer;
                liga = ligas[0];
              } else {
                return message.reply(`❌ No se encontró ninguna liga ni jugador que coincida con **"${fullText}"**.`);
              }
            }
          } else {
            matchLiga = ligas.find(l => (l.nombreLiga || '').toLowerCase().includes(fullText.toLowerCase()));
            if (matchLiga) liga = matchLiga;
          }
        }
      }
    }

    if (!liga) liga = ligas[0];

    if (filterTarget) {
      return await sendFilteredLeagueFixture({ client, context: message, liga, filterTarget, div: 'primera' });
    }

    await sendFixture(client, message, liga, fechaNum, 'primera');
  },
};

async function getAllLigasSorted() {
  const ligas = await Primera.find({}).catch(() => []);
  ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));
  return ligas;
}

async function sendFixture(client, context, liga, fechaNum, div) {
  if (!liga.partidos?.length) {
    const msg = `❌ El fixture aún no ha sido generado para la temporada **${liga.nombreLiga}**.`;
    return context.editReply ? context.editReply(msg) : context.reply(msg);
  }

  // Determinar qué fecha mostrar
  let fechaIdx = 0;
  if (fechaNum) {
    fechaIdx = liga.partidos.findIndex(f => f.numero === fechaNum);
    if (fechaIdx === -1) {
      const msg = `❌ No se encontró la fecha **${fechaNum}** en **${liga.nombreLiga}**. Total de fechas: **${liga.partidos.length}**.`;
      return context.editReply ? context.editReply(msg) : context.reply(msg);
    }
  } else {
    // Por defecto: la primera fecha con partidos pendientes, o la primera fecha (0) si todas están jugadas
    const idx = liga.partidos.findIndex(f => f.partidos.some(p => !p.finalizado));
    fechaIdx = idx !== -1 ? idx : 0;
  }

  await renderAndSend(client, context, liga, fechaIdx, div);
}

async function renderAndSend(client, context, liga, fechaIdx, div, existingMsg = null) {
  const fecha = liga.partidos[fechaIdx];
  const totalFechas = liga.partidos.length;

  const msg = existingMsg
    ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture...')
    : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture...') : context.reply('<a:loading:1461897825439711468> Generando fixture...'));

  const partidosRender = await Promise.all(
    fecha.partidos.map(async p => {
      const avatarL = await getOrCachePlayerAvatar(p.localId || p.localNombre, client);
      const avatarV = await getOrCachePlayerAvatar(p.visitanteId || p.visitanteNombre, client);

      let resText = 'Pendiente';
      if (p.finalizado) {
        if (p.isDoubleWO) resText = 'WO - WO';
        else resText = `${p.golesLocal}-${p.golesVisitante}${p.isWO ? ' (WO)' : ''}`;
      }

      let ganadorText = null;
      if (p.finalizado) {
        if (p.isDoubleWO) ganadorText = 'Sin Ganador';
        else if (p.golesLocal > p.golesVisitante) ganadorText = p.localNombre;
        else if (p.golesVisitante > p.golesLocal) ganadorText = p.visitanteNombre;
        else ganadorText = 'Empate';
      }

      return {
        local: p.localNombre,
        visitante: p.visitanteNombre,
        resultado: resText,
        ganador: ganadorText,
        avatarL,
        avatarV,
      };
    })
  );

  const tema =
    div === 'primera'
      ? { primario: '#1a0505', secundario: '#2e0909', acento: '#ff4d4d', borde: '#450f0f' }
      : { primario: '#1a0d00', secundario: '#2e1800', acento: '#ffaa60', borde: '#452400' };

  const buffer = await generarFixtureImagen({
    titulo: `${liga.nombreLiga || 'Liga'}`,
    subtitulo: `Fecha ${fecha.numero} de ${totalFechas}`,
    partidos: partidosRender,
    tema,
  });

  const attachment = new AttachmentBuilder(buffer, { name: 'fixture.png' });
  const content = `📅 **Fixture: ${liga.nombreLiga} — Fecha ${fecha.numero}**`;
  const labels = liga.partidos.map(f => `Fecha ${f.numero}`);
  const components = buildFixtureNavigation(div, fechaIdx, totalFechas, labels);

  if (existingMsg) {
    await msg.edit({ content, files: [attachment], components });
  } else if (context.editReply) {
    await msg.editReply({ content, files: [attachment], components });
  } else {
    await msg.edit({ content, files: [attachment], components });
  }

  const filter = i => i.user.id === (context.author?.id || context.user?.id);
  const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

  collector.on('collect', async i => {
    await i.deferUpdate();
    let nextIdx = fechaIdx;

    if (i.customId.endsWith('_fix_prev')) nextIdx--;
    else if (i.customId.endsWith('_fix_next')) nextIdx++;
    else if (i.customId.endsWith('_fix_select')) nextIdx = parseInt(i.values[0]);

    collector.stop();
    await renderAndSend(client, context, liga, nextIdx, div, msg);
  });
}
