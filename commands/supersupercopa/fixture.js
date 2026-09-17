import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, SlashCommandBuilder } from 'discord.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import { generarFixtureSuperligaImagen } from '../../utils/visual/fixtureSuperligaGenerator.js';
import { resolveFilterTarget, matchInvolvesTarget, paginateFilteredMatches } from '../../utils/fixtureFilter.js';
import { buildFixtureNavigation } from '../../utils/ui/fixtureNavigation.js';

export default {
  name: 'supersupercopa-fixture',
  aliases: ['ssc-fixture', 'sscf'],
  desc: 'Fixture de la Supersupercopa (Grupos y Eliminatorias)',

  data: new SlashCommandBuilder()
    .setName('supersupercopa-fixture')
    .setDescription('Muestra el fixture de la Supersupercopa')
    .addStringOption(option =>
      option.setName('filtro')
        .setDescription('Filtrar partidos por equipo o tag/ID de jugador')
        .setRequired(false)),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    const copa = await Supersupercopa.findOne({ estadoGlobal: 'Activa' }) || await Supersupercopa.findOne({ actual: true });
    if (!copa) return interaction.editReply('❌ No hay Supersupercopa activa.');

    const equiposDB = await EquipoSuperliga.find({});
    const filtroArg = interaction.options.getString('filtro');

    if (filtroArg) {
      const filterTarget = await resolveFilterTarget(filtroArg, client);
      if (filterTarget) {
        return await sendFilteredSSC(client, interaction, copa, filterTarget, equiposDB);
      }
    }

    await sendStandardSSC(client, interaction, copa, equiposDB);
  },

  run: async (client, message, args) => {
    const copa = await Supersupercopa.findOne({ estadoGlobal: 'Activa' }) || await Supersupercopa.findOne({ actual: true });
    if (!copa) return message.reply('❌ No hay Supersupercopa activa.');

    const equiposDB = await EquipoSuperliga.find({});

    if (args && args.length > 0) {
      const filterTarget = await resolveFilterTarget(args.join(' '), client);
      if (filterTarget) {
        return await sendFilteredSSC(client, message, copa, filterTarget, equiposDB);
      }
    }

    await sendStandardSSC(client, message, copa, equiposDB);
  }
};

async function sendFilteredSSC(client, context, copa, filterTarget, equiposDB, existingMsg = null, pageIdx = 0) {
  const allFilteredMatches = [];

  // 1. Grupos
  if (copa.grupos && Array.isArray(copa.grupos)) {
    copa.grupos.forEach((g, gIdx) => {
      const gLabel = g.nombre || `Grupo ${String.fromCharCode(65 + gIdx)}`;
      (g.fechas || []).forEach(f => {
        (f.partidos || f.encuentros || []).forEach(p => {
          if (matchInvolvesTarget(p, filterTarget)) {
            allFilteredMatches.push({
              ...p,
              fechaNumero: f.numero,
              fechaLabel: `${gLabel} - Fecha ${f.numero}`
            });
          }
        });
      });
    });
  }

  // 2. Semifinales
  if (copa.semifinales && Array.isArray(copa.semifinales)) {
    copa.semifinales.forEach((ll, sIdx) => {
      const sLabel = `Semi ${sIdx + 1}`;
      const matches = [
        ll.ida ? { ...ll.ida, tipo: 'Ida', fechaLabel: `${sLabel} (Ida)` } : null,
        ll.vuelta ? { ...ll.vuelta, tipo: 'Vuelta', fechaLabel: `${sLabel} (Vuelta)` } : null,
        ll.desempate ? { ...ll.desempate, tipo: 'Desempate', fechaLabel: `${sLabel} (Desempate)` } : null
      ].filter(Boolean);

      matches.forEach(p => {
        if (matchInvolvesTarget(p, filterTarget) || matchInvolvesTarget({ localNombre: ll.localNombre, visitanteNombre: ll.visitanteNombre }, filterTarget)) {
          allFilteredMatches.push(p);
        }
      });
    });
  }

  // 3. Final
  if (copa.final) {
    const ll = copa.final;
    const matches = [
      ll.ida ? { ...ll.ida, tipo: 'Ida', fechaLabel: 'Gran Final (Ida)' } : null,
      ll.vuelta ? { ...ll.vuelta, tipo: 'Vuelta', fechaLabel: 'Gran Final (Vuelta)' } : null,
      ll.desempate ? { ...ll.desempate, tipo: 'Desempate', fechaLabel: 'Gran Final (Desempate)' } : null
    ].filter(Boolean);

    matches.forEach(p => {
      if (matchInvolvesTarget(p, filterTarget) || matchInvolvesTarget({ localNombre: ll.localNombre, visitanteNombre: ll.visitanteNombre }, filterTarget)) {
        allFilteredMatches.push(p);
      }
    });
  }

  if (allFilteredMatches.length === 0) {
    const msg = `ℹ️ No se encontraron partidos para **${filterTarget.nombre}** en la Supersupercopa.`;
    return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
  }

  const pages = paginateFilteredMatches(allFilteredMatches, 10);
  const safePageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const msg = existingMsg
    ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture filtrado...')
    : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture filtrado...') : context.reply('<a:loading:1461897825439711468> Generando fixture filtrado...'));

  const buffer = await generarFixtureSuperligaImagen(
    currentPage.partidos,
    currentPage.label,
    `Supersupercopa — ${filterTarget.nombre}`,
    equiposDB,
    client
  );

  const attachment = new AttachmentBuilder(buffer, { name: 'fixture_ssc_filtro.png' });
  const content = `🏆 **Supersupercopa: Fixture de ${filterTarget.nombre} (${currentPage.label})**`;
  const labels = pages.map((pg, i) => `${pg.label} (Pág. ${i + 1}/${pages.length})`);
  const components = buildFixtureNavigation('ssc_filt', safePageIdx, pages.length, labels);

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
    await sendFilteredSSC(client, context, copa, filterTarget, equiposDB, msg, nextIdx);
  });
}

async function sendStandardSSC(client, context, copa, equiposDB) {
  // Preparar las páginas (fechas de grupos + eliminatorias)
  const pages = [];
  
  // 1. Agregar fechas de grupos
  if (copa.grupos && copa.grupos.length >= 2) {
    const grupoA = copa.grupos[0];
    const grupoB = copa.grupos[1];
    const numFechas = grupoA.fechas.length;
    
    for (let i = 0; i < numFechas; i++) {
      pages.push({
        type: 'grupos',
        label: `Fecha ${i + 1}`,
        title: `Supersupercopa — Grupos`,
        fechas: [grupoA.fechas[i], grupoB.fechas[i]]
      });
    }
  }

  // 2. Agregar Semifinales
  if (copa.semifinales && copa.semifinales.length > 0) {
    pages.push({
      type: 'eliminatoria',
      label: 'Semifinales',
      title: `Supersupercopa — Semifinales (Ida y Vuelta)`,
      llaves: copa.semifinales
    });
  }

  // 3. Agregar Final
  if (copa.final) {
    pages.push({
      type: 'eliminatoria',
      label: 'Final',
      title: `Supersupercopa — Gran Final (Ida y Vuelta)`,
      llaves: [copa.final]
    });
  }

  if (pages.length === 0) {
    const msg = '❌ No hay enfrentamientos cargados en la Supersupercopa.';
    return context.editReply ? context.editReply(msg) : context.reply(msg);
  }

  // Determinar la página inicial basada en la fase actual
  let currentIdx = 0;
  if (copa.fase === 'grupos') {
    const grupoA = copa.grupos[0];
    const idx = grupoA.fechas.findIndex(f => (f.partidos || f.encuentros).some(p => !p.finalizado));
    currentIdx = idx !== -1 ? idx : 0;
  } else if (copa.fase === 'semifinales') {
    currentIdx = pages.findIndex(p => p.label === 'Semifinales');
  } else if (copa.fase === 'final' || copa.fase === 'finalizado') {
    currentIdx = pages.findIndex(p => p.label === 'Final');
  }
  if (currentIdx === -1) currentIdx = 0;

  const typingMsg = context.editReply
    ? await context.editReply('<a:loading:1461897825439711468> Generando fixtures...')
    : await context.reply('<a:loading:1461897825439711468> Generando fixtures...');

  const getAttachments = async (idx) => {
    const page = pages[idx];
    if (page.type === 'grupos') {
      const imgA = await generarFixtureSuperligaImagen(page.fechas[0].partidos, page.fechas[0].numero, `SSC Grupo A`, equiposDB, client);
      const imgB = await generarFixtureSuperligaImagen(page.fechas[1].partidos, page.fechas[1].numero, `SSC Grupo B`, equiposDB, client);
      return [
        new AttachmentBuilder(imgA, { name: 'fixtureA.png' }),
        new AttachmentBuilder(imgB, { name: 'fixtureB.png' })
      ];
    } else if (page.label === 'Semifinales') {
      const attachments = [];
      for (let i = 0; i < page.llaves.length; i++) {
        const ll = page.llaves[i];
        const matches = [ll.ida, ll.vuelta];
        if (ll.desempate) matches.push(ll.desempate);
        
        const img = await generarFixtureSuperligaImagen(matches, `Semi ${i + 1}`, `SSC Semifinal: ${ll.localNombre} vs ${ll.visitanteNombre}`, equiposDB, client);
        attachments.push(new AttachmentBuilder(img, { name: `semi${i + 1}.png` }));
      }
      return attachments;
    } else {
      const flattened = [];
      page.llaves.forEach(ll => {
        flattened.push(ll.ida);
        flattened.push(ll.vuelta);
        if (ll.desempate) flattened.push(ll.desempate);
      });
      const img = await generarFixtureSuperligaImagen(flattened, page.label, page.title, equiposDB, client);
      return [new AttachmentBuilder(img, { name: 'fixture.png' })];
    }
  };

  const getRow = (idx) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('prev_f').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(idx === 0),
    new ButtonBuilder().setCustomId('info_f').setLabel(pages[idx].label).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('next_f').setLabel('▶️').setStyle(ButtonStyle.Secondary).setDisabled(idx >= pages.length - 1),
  );

  const mainMsg = await typingMsg.edit({
    content: `🏆 **${pages[currentIdx].title} — ${pages[currentIdx].label}**`,
    files: await getAttachments(currentIdx),
    components: [getRow(currentIdx)]
  });

  const userId = context.author?.id || context.user?.id;
  const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });
  
  collector.on('collect', async i => {
    if (i.user.id !== userId) return i.reply({ content: '❌ Solo quien usó el comando puede navegar.', flags: 64 });
    await i.deferUpdate();

    if (i.customId === 'prev_f') { currentIdx--; }
    else if (i.customId === 'next_f') { currentIdx++; }

    await mainMsg.edit({ 
      content: `🏆 **${pages[currentIdx].title} — ${pages[currentIdx].label}**`,
      files: await getAttachments(currentIdx), 
      components: [getRow(currentIdx)] 
    });
  });

  collector.on('end', () => mainMsg.edit({ components: [] }).catch(() => {}));
}
