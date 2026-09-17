import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder } from 'discord.js';
import Superliga from '../../models/superliga/Superliga.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import { generarFixtureSuperligaImagen } from '../../utils/visual/fixtureSuperligaGenerator.js';
import { resolveFilterTarget, matchInvolvesTarget, paginateFilteredMatches } from '../../utils/fixtureFilter.js';
import { buildFixtureNavigation } from '../../utils/ui/fixtureNavigation.js';

export default {
  name: 'superliga-fixture',
  aliases: ['sl-fixture', 'slf'],
  desc: 'Muestra el fixture gráfico de la Superliga (Soporta filtrado por equipo/jugador y múltiples imágenes)',

  data: new SlashCommandBuilder()
    .setName('superliga-fixture')
    .setDescription('Muestra el fixture de la Superliga')
    .addIntegerOption(option =>
      option.setName('fecha')
        .setDescription('Número de la fecha a mostrar')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('filtro')
        .setDescription('Filtrar partidos por equipo o tag/ID de jugador')
        .setRequired(false)),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    const liga = await Superliga.findOne({ actual: true });
    if (!liga) return interaction.editReply('❌ No hay una temporada de Superliga activa.');

    const equiposDB = await EquipoSuperliga.find({});
    const nFechaArg = interaction.options.getInteger('fecha');
    const filtroArg = interaction.options.getString('filtro');

    if (filtroArg) {
      const filterTarget = await resolveFilterTarget(filtroArg, client);
      if (filterTarget) {
        return await sendFilteredSuperliga(client, interaction, liga, filterTarget, equiposDB);
      }
    }

    await sendStandardSuperliga(client, interaction, liga, nFechaArg, equiposDB);
  },

  run: async (client, message, args) => {
    const liga = await Superliga.findOne({ actual: true });
    if (!liga) return message.reply('❌ No hay una temporada de Superliga activa.');

    const equiposDB = await EquipoSuperliga.find({});
    
    let nFechaArg = null;
    let filterTarget = null;

    if (args && args.length > 0) {
      const mentionOrId = args.find(a => /^<@!?\d{17,20}>$/.test(a) || /^\d{17,20}$/.test(a));
      if (mentionOrId) {
        filterTarget = await resolveFilterTarget(mentionOrId, client);
      } else {
        const numArg = parseInt(args[0]);
        if (!isNaN(numArg)) {
          nFechaArg = numArg;
        } else {
          filterTarget = await resolveFilterTarget(args.join(' '), client);
        }
      }
    }

    if (filterTarget) {
      return await sendFilteredSuperliga(client, message, liga, filterTarget, equiposDB);
    }

    await sendStandardSuperliga(client, message, liga, nFechaArg, equiposDB);
  }
};

async function sendFilteredSuperliga(client, context, liga, filterTarget, equiposDB, existingMsg = null, pageIdx = 0) {
  // 1. Recolectar todos los partidos que involucran al jugador o equipo
  const allFilteredMatches = [];
  for (const fechaObj of (liga.fechas || [])) {
    const partidos = fechaObj.partidos ?? fechaObj.encuentros ?? [];
    for (const p of partidos) {
      if (matchInvolvesTarget(p, filterTarget)) {
        allFilteredMatches.push({
          ...p,
          fechaNumero: fechaObj.numero,
          fechaLabel: `Fecha ${fechaObj.numero}`
        });
      }
    }
  }

  if (allFilteredMatches.length === 0) {
    const msg = `ℹ️ No se encontraron partidos para **${filterTarget.nombre}** en la Superliga actual.`;
    return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
  }

  // 2. Paginar cada 10 fechas
  const pages = paginateFilteredMatches(allFilteredMatches, 10);
  const safePageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const msg = existingMsg
    ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture filtrado...')
    : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture filtrado...') : context.reply('<a:loading:1461897825439711468> Generando fixture filtrado...'));

  const buffer = await generarFixtureSuperligaImagen(
    currentPage.partidos,
    currentPage.label,
    `Fixture — ${filterTarget.nombre}`,
    equiposDB,
    client
  );

  const attachment = new AttachmentBuilder(buffer, { name: 'fixture_superliga_filtro.png' });
  const content = `🏆 **Superliga: Fixture de ${filterTarget.nombre} (${currentPage.label})**`;
  const labels = pages.map((pg, i) => `${pg.label} (Pág. ${i + 1}/${pages.length})`);
  const components = buildFixtureNavigation('sl_filt', safePageIdx, pages.length, labels);

  if (existingMsg) {
    await msg.edit({ content, files: [attachment], components });
  } else if (context.editReply) {
    await msg.editReply({ content, files: [attachment], components });
  } else {
    await msg.edit({ content, files: [attachment], components });
  }

  const userId = context.author?.id || context.user?.id;
  const filter = i => i.user.id === userId;
  const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

  collector.on('collect', async i => {
    await i.deferUpdate();
    let nextIdx = safePageIdx;

    if (i.customId.endsWith('_fix_prev')) nextIdx--;
    else if (i.customId.endsWith('_fix_next')) nextIdx++;
    else if (i.customId.endsWith('_fix_select')) nextIdx = parseInt(i.values[0]);

    collector.stop();
    await sendFilteredSuperliga(client, context, liga, filterTarget, equiposDB, msg, nextIdx);
  });
}

async function sendStandardSuperliga(client, context, liga, nFechaArg, equiposDB) {
  let currentIdx = 0;
  if (nFechaArg) {
    currentIdx = liga.fechas.findIndex(f => f.numero === nFechaArg);
    if (currentIdx === -1) currentIdx = 0;
  } else {
    currentIdx = liga.fechas.findIndex(f => (f.partidos ?? f.encuentros).some(p => !p.finalizado));
    if (currentIdx === -1) currentIdx = liga.fechas.length - 1;
  }

  const totalFechas = liga.fechas.length;

  const renderFixtureImages = async (idx) => {
    const fechaObj = liga.fechas[idx];
    const partidos = fechaObj.partidos ?? fechaObj.encuentros ?? [];
    const attachments = [];

    if (partidos.length <= 2) {
      const buffer = await generarFixtureSuperligaImagen(partidos, fechaObj.numero, liga.temporada || 'Actual', equiposDB, client);
      attachments.push(new AttachmentBuilder(buffer, { name: `fixture-f${fechaObj.numero}.png` }));
    } else {
      const mitad = Math.ceil(partidos.length / 2);
      const p1 = partidos.slice(0, mitad);
      const p2 = partidos.slice(mitad);

      const b1 = await generarFixtureSuperligaImagen(p1, fechaObj.numero, liga.temporada || 'Actual', equiposDB, client, 1, 2);
      const b2 = await generarFixtureSuperligaImagen(p2, fechaObj.numero, liga.temporada || 'Actual', equiposDB, client, 2, 2);

      attachments.push(new AttachmentBuilder(b1, { name: `fixture-f${fechaObj.numero}-p1.png` }));
      attachments.push(new AttachmentBuilder(b2, { name: `fixture-f${fechaObj.numero}-p2.png` }));
    }
    return attachments;
  };

  const getNavRow = (idx) => {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev_f').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(idx === 0),
      new ButtonBuilder().setCustomId('info_f').setLabel(`Fecha ${liga.fechas[idx].numero} / ${totalFechas}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('next_f').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(idx === totalFechas - 1)
    );
  };

  const typingMsg = context.editReply
    ? await context.editReply('<a:loading:1461897825439711468> Generando fixture de la **Superliga**..')
    : await context.reply('<a:loading:1461897825439711468> Generando fixture de la **Superliga**..');

  try {
    const initialAttachments = await renderFixtureImages(currentIdx);
    const mainMsg = await typingMsg.edit({ 
      content: null, 
      files: initialAttachments, 
      components: totalFechas > 1 ? [getNavRow(currentIdx)] : [] 
    });

    if (totalFechas <= 1) return;

    const userId = context.author?.id || context.user?.id;
    const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId) return i.reply({ content: '❌ No puedes navegar.', flags: 64 });
      
      await i.deferUpdate();
      if (i.customId === 'prev_f') currentIdx--;
      if (i.customId === 'next_f') currentIdx++;

      const newAttachments = await renderFixtureImages(currentIdx);
      await mainMsg.edit({ files: newAttachments, components: [getNavRow(currentIdx)] });
    });

    collector.on('end', () => mainMsg.edit({ components: [] }).catch(() => {}));

  } catch (error) {
    console.error('Error fixture:', error);
    await typingMsg.edit('❌ Error al generar las imágenes.');
  }
}
