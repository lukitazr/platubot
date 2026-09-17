import { EmbedBuilder, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import { parseAndImportExcel } from '../../utils/excelParser.js';
import { generarTablaImagen } from '../../utils/visual/tablaGenerator.js';
import { generarBracketImagen } from '../../utils/visual/bracketCoppaGenerator.js';

export default {
  name: 'platubi-cargarexcel',
  aliases: ['plcargarexcel', 'cargarexcelpl', 'cargarexcel'],
  desc: 'Importa una liga histórica o torneo de eliminación directa (Coppa) desde un archivo de Excel (.xlsx)',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-cargarexcel')
    .setDescription('Importa una liga o torneo (Coppa) desde un archivo de Excel (.xlsx)')
    .addAttachmentOption(option =>
      option.setName('archivo')
        .setDescription('El archivo .xlsx con el fixture y resultados')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('hoja')
        .setDescription('Nombre de la pestaña/hoja a procesar (opcional)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('ignorar')
        .setDescription('Jugadores a ignorar separados por coma (ej: Pepe, Juan)')
        .setRequired(false)),

  execute: async (client, interaction) => {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment('archivo');
    const sheetName = interaction.options.getString('hoja');
    const ignorar = interaction.options.getString('ignorar');

    if (!attachment || !attachment.name.endsWith('.xlsx')) {
      return interaction.editReply('❌ Por favor adjunta un archivo válido con extensión **.xlsx**.');
    }

    try {
      const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);

      const res = await parseAndImportExcel(buffer, { sheetName, ignorar });

      let embed;
      let files = [];

      if (res.tipo === 'coppa') {
        embed = new EmbedBuilder()
          .setTitle(`🏆 Coppa Cargada: ${res.nombreTorneo || res.coppa.nombre}`)
          .setDescription(
            `✅ **Importación exitosa de Coppa**\n\n` +
            `📊 **Fases procesadas:** ${res.fases.join(' → ')}\n` +
            `⚽ **Partidos procesados:** ${res.totalPartidos}\n` +
            `👥 **Participantes:** ${res.participantes.length}\n` +
            (res.totalWOs > 0 ? `⚠️ **Partidos por W.O.:** ${res.totalWOs}\n` : '') +
            (res.campeon ? `🏆 **Campeón:** **${res.campeon.nombre}**` : '')
          )
          .setColor('#059669')
          .setFooter({ text: 'Los historiales H2H, títulos oficiales y métricas globales fueron actualizados.' });

        try {
          const pngBuffer = await generarBracketImagen(res.coppa, client);
          files.push(new AttachmentBuilder(pngBuffer, { name: 'coppa_bracket.png' }));
        } catch (err) {
          console.error('Error generando bracket visual para cargarexcel:', err);
        }
      } else {
        embed = new EmbedBuilder()
          .setTitle(`🏆 Liga Cargada: ${res.liga.nombreLiga}`)
          .setDescription(
            `✅ **Importación exitosa de Liga**\n\n` +
            `📅 **Fechas procesadas:** ${res.totalFechas}\n` +
            `⚽ **Partidos procesados:** ${res.totalPartidos}\n` +
            `👥 **Jugadores en liga:** ${res.tabla.length}\n` +
            (res.partidosIgnorados > 0 ? `🚫 **Partidos ignorados:** ${res.partidosIgnorados}\n` : '') +
            (res.jugadoresIgnorados?.length > 0 ? `👤 **Jugadores excluidos:** \`${res.jugadoresIgnorados.join(', ')}\`\n` : '') +
            (res.campeon ? `🏆 **Campeón:** **${res.campeon.nombre}** (${res.campeon.puntos} Pts, DG ${res.campeon.dif})` : '')
          )
          .setColor('#2ecc71')
          .setFooter({ text: 'Los historiales H2H y métricas globales fueron actualizados.' });

        try {
          const pngBuffer = await generarTablaImagen(res.liga, client, 'primera');
          files.push(new AttachmentBuilder(pngBuffer, { name: 'tabla_excel.png' }));
        } catch (err) {
          console.error('Error generando tabla visual para cargarexcel:', err);
        }
      }

      await interaction.editReply({ embeds: [embed], files });
    } catch (error) {
      console.error('Error en platubi-cargarexcel:', error);
      await interaction.editReply(`❌ Error al procesar el archivo Excel: **${error.message}**`);
    }
  },

  run: async (client, message, args) => {
    const attachment = message.attachments.first();
    if (!attachment || !attachment.name.endsWith('.xlsx')) {
      return message.reply('❌ Debes adjuntar un archivo con extensión **.xlsx** al mensaje. Ejemplo: `!platubi-cargarexcel` (con el archivo adjunto).');
    }

    let sheetName = null;
    let ignorar = null;

    if (args && args.length > 0) {
      const rawText = args.join(' ').trim();
      const ignoreMatch = rawText.match(/(?:--ignorar|-i|ignorar:)\s*([^]+)/i);
      if (ignoreMatch) {
        ignorar = ignoreMatch[1].trim();
        sheetName = rawText.substring(0, ignoreMatch.index).trim() || null;
      } else {
        sheetName = rawText;
      }
    }

    const loading = await message.reply('<a:loading:1461897825439711468> **Leyendo y procesando archivo Excel...**');

    try {
      const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);

      const res = await parseAndImportExcel(buffer, { sheetName, ignorar });

      let embed;
      let files = [];

      if (res.tipo === 'coppa') {
        embed = new EmbedBuilder()
          .setTitle(`🏆 Coppa Cargada: ${res.nombreTorneo || res.coppa.nombre}`)
          .setDescription(
            `✅ **Importación exitosa de Coppa**\n\n` +
            `📊 **Fases procesadas:** ${res.fases.join(' → ')}\n` +
            `⚽ **Partidos procesados:** ${res.totalPartidos}\n` +
            `👥 **Participantes:** ${res.participantes.length}\n` +
            (res.totalWOs > 0 ? `⚠️ **Partidos por W.O.:** ${res.totalWOs}\n` : '') +
            (res.campeon ? `🏆 **Campeón:** **${res.campeon.nombre}**` : '')
          )
          .setColor('#059669')
          .setFooter({ text: 'Los historiales H2H, títulos oficiales y métricas globales fueron actualizados.' });

        try {
          const pngBuffer = await generarBracketImagen(res.coppa, client);
          files.push(new AttachmentBuilder(pngBuffer, { name: 'coppa_bracket.png' }));
        } catch (err) {
          console.error('Error generando bracket visual para cargarexcel:', err);
        }
      } else {
        embed = new EmbedBuilder()
          .setTitle(`🏆 Liga Cargada: ${res.liga.nombreLiga}`)
          .setDescription(
            `✅ **Importación exitosa de Liga**\n\n` +
            `📅 **Fechas procesadas:** ${res.totalFechas}\n` +
            `⚽ **Partidos procesados:** ${res.totalPartidos}\n` +
            `👥 **Jugadores en liga:** ${res.tabla.length}\n` +
            (res.partidosIgnorados > 0 ? `🚫 **Partidos ignorados:** ${res.partidosIgnorados}\n` : '') +
            (res.jugadoresIgnorados?.length > 0 ? `👤 **Jugadores excluidos:** \`${res.jugadoresIgnorados.join(', ')}\`\n` : '') +
            (res.campeon ? `🏆 **Campeón:** **${res.campeon.nombre}** (${res.campeon.puntos} Pts, DG ${res.campeon.dif})` : '')
          )
          .setColor('#2ecc71')
          .setFooter({ text: 'Los historiales H2H y métricas globales fueron actualizados.' });

        try {
          const pngBuffer = await generarTablaImagen(res.liga, client, 'primera');
          files.push(new AttachmentBuilder(pngBuffer, { name: 'tabla_excel.png' }));
        } catch (err) {
          console.error('Error generando tabla visual para cargarexcel:', err);
        }
      }

      await loading.edit({ content: '', embeds: [embed], files });
    } catch (error) {
      console.error('Error en platubi-cargarexcel (run):', error);
      await loading.edit(`❌ Error al procesar el archivo Excel: **${error.message}**`);
    }
  }
};
