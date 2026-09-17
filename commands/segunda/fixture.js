import { AttachmentBuilder, SlashCommandBuilder, ActionRowBuilder } from 'discord.js';
import Segunda from '../../models/Segunda.js';
import { generarFixtureImagen } from '../../utils/visual/fixtureGenerator.js';
import { buildFixtureNavigation } from '../../utils/ui/fixtureNavigation.js';
import { resolveFilterTarget, sendFilteredLeagueFixture } from '../../utils/fixtureFilter.js';

export default {
  name: 'palubi-fixture',
  aliases: ['palubif', 'fixturepalubi', 'fixturepa'],
  desc: 'Muestra el fixture de la Palubi. Uso: !palubi-fixture [fecha/jugador]',
  permisos: [],

  data: new SlashCommandBuilder()
    .setName('palubi-fixture')
    .setDescription('Muestra el fixture de la Palubi')
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
    const liga = await getLatestLiga();
    if (!liga) return interaction.editReply('❌ No hay ninguna temporada registrada.');
    
    const fechaNum = interaction.options.getInteger('fecha');
    const jugadorOption = interaction.options.getString('jugador');

    if (jugadorOption) {
      const filterTarget = await resolveFilterTarget(jugadorOption, client);
      if (filterTarget) {
        return await sendFilteredLeagueFixture({ client, context: interaction, liga, filterTarget, div: 'segunda' });
      }
    }

    await sendFixture(client, interaction, liga, fechaNum, 'segunda');
  },

  run: async (client, message, args) => {
    const liga = await getLatestLiga();
    if (!liga) return message.reply('❌ No hay ninguna temporada registrada.');
    
    let fechaNum = null;
    let filterTarget = null;

    if (args && args.length > 0) {
      const mentionOrId = args.find(a => /^<@!?\d{17,20}>$/.test(a) || /^\d{17,20}$/.test(a));
      if (mentionOrId) {
        filterTarget = await resolveFilterTarget(mentionOrId, client);
      } else {
        const numArg = parseInt(args[0]);
        if (!isNaN(numArg)) {
          fechaNum = numArg;
        } else {
          filterTarget = await resolveFilterTarget(args.join(' '), client);
        }
      }
    }

    if (filterTarget) {
      return await sendFilteredLeagueFixture({ client, context: message, liga, filterTarget, div: 'segunda' });
    }

    await sendFixture(client, message, liga, fechaNum, 'segunda');
  },
};

async function getLatestLiga() {
    const ligas = await Segunda.find({}).catch(() => []);
    ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));
    return ligas[0] || null;
}

async function sendFixture(client, context, liga, fechaNum, div) {
    if (!liga.partidos?.length) {
        const msg = '❌ El fixture aún no ha sido generado para esta temporada.';
        return context.editReply ? context.editReply(msg) : context.reply(msg);
    }

    let fechaIdx = 0;
    if (fechaNum) {
        fechaIdx = liga.partidos.findIndex(f => f.numero === fechaNum);
        if (fechaIdx === -1) {
            const msg = `❌ No se encontró la fecha **${fechaNum}**. Total de fechas: **${liga.partidos.length}**.`;
            return context.editReply ? context.editReply(msg) : context.reply(msg);
        }
    } else {
        const idx = liga.partidos.findIndex(f => f.partidos.some(p => !p.finalizado));
        fechaIdx = idx !== -1 ? idx : liga.partidos.length - 1;
    }

    await renderAndSend(client, context, liga, fechaIdx, div);
}

async function renderAndSend(client, context, liga, fechaIdx, div, existingMsg = null) {
    const fecha = liga.partidos[fechaIdx];
    const totalFechas = liga.partidos.length;

    // Usar un mensaje temporal para esperar la carga
    const msg = existingMsg
        ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture...')
        : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture...') : context.reply('<a:loading:1461897825439711468> Generando fixture...'));

    const partidosRender = await Promise.all(fecha.partidos.map(async p => {
        const userL = await client.users.fetch(p.localId).catch(() => null);
        const userV = await client.users.fetch(p.visitanteId).catch(() => null);
        
        return {
            local: p.localNombre,
            visitante: p.visitanteNombre,
            resultado: p.finalizado ? `${p.golesLocal}-${p.golesVisitante}` : 'Pendiente',
            ganador: p.finalizado ? (p.golesLocal > p.golesVisitante ? p.localNombre : p.golesLocal < p.golesVisitante ? p.visitanteNombre : 'Empate') : null,
            avatarL: userL?.displayAvatarURL({ extension: 'png' }),
            avatarV: userV?.displayAvatarURL({ extension: 'png' })
        };
    }));

    const tema = { primario: '#1a0d00', secundario: '#2e1800', acento: '#ffaa60', borde: '#452400' };

    const buffer = await generarFixtureImagen({
        titulo: `${liga.nombreLiga || 'Liga'}`,
        subtitulo: `Fecha ${fecha.numero} de ${totalFechas}`,
        partidos: partidosRender,
        tema
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

    const filter = i => (i.user.id === (context.author?.id || context.user?.id));
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

