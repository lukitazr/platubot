import { AttachmentBuilder, SlashCommandBuilder, ActionRowBuilder } from 'discord.js';
import Coppa from '../../models/copas/Coppa.js';
import { generarFixtureImagen } from '../../utils/visual/fixtureGenerator.js';
import { buildFixtureNavigation } from '../../utils/ui/fixtureNavigation.js';
import { resolveFilterTarget, matchInvolvesTarget, paginateFilteredMatches } from '../../utils/fixtureFilter.js';

export default {
  name: 'coppa-fixture',
  aliases: ['fixturecoppa'],
  desc: 'Muestra los enfrentamientos de la Coppa (Soporta filtrado por jugador/equipo)',
  permisos: [],

  data: new SlashCommandBuilder()
    .setName('coppa-fixture')
    .setDescription('Muestra los enfrentamientos de la Coppa')
    .addStringOption(option =>
      option.setName('jugador')
        .setDescription('Filtrar por tag/ID/nombre de jugador o equipo')
        .setRequired(false)),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    const coppa = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null)
      || await Coppa.findOne({ estado: 'Finalizado' }).catch(() => null);
    if (!coppa) return interaction.editReply('❌ No hay una **Coppa** registrada.');

    const jugadorOption = interaction.options.getString('jugador');
    if (jugadorOption) {
      const filterTarget = await resolveFilterTarget(jugadorOption, client);
      if (filterTarget) {
        return await sendFilteredCoppa(client, interaction, coppa, filterTarget);
      }
    }

    await sendFixture(client, interaction, coppa);
  },

  run: async (client, message, args) => {
    const coppa = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null)
      || await Coppa.findOne({ estado: 'Finalizado' }).catch(() => null);
    if (!coppa) return message.reply('❌ No hay una **Coppa** registrada.');

    if (args && args.length > 0) {
      const filterTarget = await resolveFilterTarget(args.join(' '), client);
      if (filterTarget) {
        return await sendFilteredCoppa(client, message, coppa, filterTarget);
      }
    }

    await sendFixture(client, message, coppa);
  },
};

async function sendFilteredCoppa(client, context, coppa, filterTarget, existingMsg = null, pageIdx = 0) {
  const allFilteredMatches = [];
  const fases = coppa.fasesEliminatoria || Object.keys(coppa.llaves || {});

  for (const fase of fases) {
    const llaves = coppa.llaves?.[fase] || [];
    for (const l of llaves) {
      if (matchInvolvesTarget(l, filterTarget)) {
        allFilteredMatches.push({
          ...l,
          fechaLabel: fase
        });
      }
    }
  }

  if (allFilteredMatches.length === 0) {
    const msg = `ℹ️ No se encontraron partidos para **${filterTarget.nombre}** en la Coppa.`;
    return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
  }

  const pages = paginateFilteredMatches(allFilteredMatches, 10);
  const safePageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const msg = existingMsg
    ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture filtrado...')
    : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture filtrado...') : context.reply('<a:loading:1461897825439711468> Generando fixture filtrado...'));

  const partidosRender = await Promise.all(currentPage.partidos.map(async l => {
    const user1 = l.equipo1?.discordId ? await client.users.fetch(l.equipo1.discordId).catch(() => null) : null;
    const user2 = l.equipo2?.discordId ? await client.users.fetch(l.equipo2.discordId).catch(() => null) : null;

    let resText = 'Pendiente';
    if (l.ganador) {
      const idaStr = l.ida?.finalizado ? `${l.ida.golesLocal}-${l.ida.golesVisitante}` : '?-?';
      const vueltaStr = l.vuelta?.finalizado ? `${l.vuelta.golesLocal}-${l.vuelta.golesVisitante}` : '?-?';
      resText = `${idaStr} / ${vueltaStr}`;
      if (l.desempate?.finalizado) resText += ` (D: ${l.desempate.golesLocal}-${l.desempate.golesVisitante})`;
    } else if (l.ida?.finalizado) {
      resText = `${l.ida.golesLocal}-${l.ida.golesVisitante} (Ida)`;
    }

    const ganadorNombre = l.ganador 
      ? (l.ganador === l.equipo1?.discordId ? l.equipo1?.nombre : l.equipo2?.nombre)
      : null;

    return {
      local: l.equipo1?.nombre || 'TBD',
      visitante: l.equipo2?.nombre || 'TBD',
      resultado: resText,
      ganador: ganadorNombre,
      avatarL: user1?.displayAvatarURL({ extension: 'png' }),
      avatarV: user2?.displayAvatarURL({ extension: 'png' }),
      ida: l.ida,
      vuelta: l.vuelta,
      desempate: l.desempate,
      fechaLabel: l.fechaLabel
    };
  }));

  const buffer = await generarFixtureImagen({
    titulo: `Coppa — ${filterTarget.nombre}`,
    subtitulo: currentPage.label,
    partidos: partidosRender,
    tema: coppa.tema
  });

  const attachment = new AttachmentBuilder(buffer, { name: 'fixture_coppa_filtro.png' });
  const content = `📅 **Fixture: Coppa — Partidos de ${filterTarget.nombre} (${currentPage.label})**`;
  const labels = pages.map((pg, i) => `${pg.label} (Pág. ${i + 1}/${pages.length})`);
  const components = buildFixtureNavigation('coppa_filt', safePageIdx, pages.length, labels);

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
    const freshCoppa = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null)
      || await Coppa.findOne({ estado: 'Finalizado' }).catch(() => null);
    if (!freshCoppa) return;
    await sendFilteredCoppa(client, context, freshCoppa, filterTarget, msg, nextIdx);
  });
}

async function sendFixture(client, context, coppa) {
    const labels = coppa.fasesEliminatoria;
    const currentIdx = coppa.faseActual;

    await renderAndSendFixtureCoppa(client, context, coppa, currentIdx, labels);
}

async function renderAndSendFixtureCoppa(client, context, coppa, phaseIdx, labels, existingMsg = null) {
    const faseActual = labels[phaseIdx];
    const llaves = coppa.llaves[faseActual] || [];

    if (!llaves.length) {
        const msg = `❌ No hay llaves registradas para la fase **${faseActual}**.`;
        return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
    }

    const partidosRender = await Promise.all(llaves.map(async l => {
        const user1 = await client.users.fetch(l.equipo1.discordId).catch(() => null);
        const user2 = await client.users.fetch(l.equipo2.discordId).catch(() => null);
        
        let resText = 'Pendiente';
        if (l.ganador) {
            const idaStr = l.ida.finalizado ? `${l.ida.golesLocal}-${l.ida.golesVisitante}` : '?-?';
            const vueltaStr = l.vuelta.finalizado ? `${l.vuelta.golesLocal}-${l.vuelta.golesVisitante}` : '?-?';
            resText = `${idaStr} / ${vueltaStr}`;
            if (l.desempate?.finalizado) resText += ` (D: ${l.desempate.golesLocal}-${l.desempate.golesVisitante})`;
        } else if (l.ida.finalizado) {
            resText = `${l.ida.golesLocal}-${l.ida.golesVisitante} (Ida)`;
        }

        const ganadorNombre = l.ganador 
            ? (l.ganador === l.equipo1.discordId ? l.equipo1.nombre : l.equipo2.nombre)
            : null;

        return {
            local: l.equipo1.nombre,
            visitante: l.equipo2.nombre,
            resultado: resText,
            ganador: ganadorNombre,
            avatarL: user1?.displayAvatarURL({ extension: 'png' }),
            avatarV: user2?.displayAvatarURL({ extension: 'png' }),
            ida: l.ida,
            vuelta: l.vuelta,
            desempate: l.desempate
        };
    }));

    const buffer = await generarFixtureImagen({
        titulo: `Coppa — ${faseActual}`,
        subtitulo: 'Fase Eliminatoria',
        partidos: partidosRender,
        tema: coppa.tema
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'fixture_coppa.png' });
    const content = `📅 **Fixture: Coppa — ${faseActual}**`;
    const components = buildFixtureNavigation('coppa', phaseIdx, labels.length, labels);

    let msg;
    if (existingMsg) {
        msg = await existingMsg.edit({ content, files: [attachment], components });
    } else if (context.editReply) {
        msg = await context.editReply({ content, files: [attachment], components });
    } else {
        msg = await context.reply({ content, files: [attachment], components });
    }

    const userId = context.author?.id || context.user?.id;
    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async i => {
        await i.deferUpdate();
        let nextIdx = phaseIdx;

        if (i.customId.endsWith('_fix_prev')) nextIdx--;
        else if (i.customId.endsWith('_fix_next')) nextIdx++;
        else if (i.customId.endsWith('_fix_select')) nextIdx = parseInt(i.values[0]);

        collector.stop();
        const freshCoppa = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null);
        if (!freshCoppa) return;
        await renderAndSendFixtureCoppa(client, context, freshCoppa, nextIdx, labels, msg);
    });
}
