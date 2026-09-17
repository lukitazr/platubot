import { EmbedBuilder, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import { parseAndImportExcelCoppa } from '../../utils/excelParser.js';
import { generarBracketImagen } from '../../utils/visual/bracketCoppaGenerator.js';

export default {
  name: 'coppa-cargarexcel',
  aliases: ['cargarexcelcoppa', 'coppacargarexcel', 'coppa-importar'],
  desc: 'Importa una Coppa (bracket/eliminatoria directa) desde un archivo de Excel (.xlsx)',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('coppa-cargarexcel')
    .setDescription('Importa una Coppa (bracket) desde un archivo de Excel (.xlsx)')
    .addAttachmentOption(option =>
      option.setName('archivo')
        .setDescription('El archivo .xlsx con el bracket y resultados')
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

      const res = await parseAndImportExcelCoppa(buffer, { sheetName, ignorar });

      const embed = new EmbedBuilder()
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

      let files = [];
      try {
        const pngBuffer = await generarBracketImagen(res.coppa, client);
        files.push(new AttachmentBuilder(pngBuffer, { name: 'coppa_bracket.png' }));
      } catch (err) {
        console.error('Error generando bracket visual para coppa-cargarexcel:', err);
      }

      await interaction.editReply({ embeds: [embed], files });
    } catch (error) {
      console.error('Error en coppa-cargarexcel:', error);
      await interaction.editReply(`❌ Error al procesar la Coppa desde Excel: **${error.message}**`);
    }
  },

  run: async (client, message, args) => {
    const attachment = message.attachments.first();
    if (!attachment || !attachment.name.endsWith('.xlsx')) {
      return message.reply('❌ Debes adjuntar un archivo con extensión **.xlsx** al mensaje. Ejemplo: `!coppa-cargarexcel` (con el archivo adjunto).');
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

    const loading = await message.reply('<a:loading:1461897825439711468> **Leyendo y procesando Coppa desde Excel...**');

    try {
      const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);

      const res = await parseAndImportExcelCoppa(buffer, { sheetName, ignorar });

      const embed = new EmbedBuilder()
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

      let files = [];
      try {
        const pngBuffer = await generarBracketImagen(res.coppa, client);
        files.push(new AttachmentBuilder(pngBuffer, { name: 'coppa_bracket.png' }));
      } catch (err) {
        console.error('Error generando bracket visual para coppa-cargarexcel:', err);
      }

      await loading.edit({ content: '', embeds: [embed], files });
    } catch (error) {
      console.error('Error en coppa-cargarexcel (run):', error);
      await loading.edit(`❌ Error al procesar la Coppa desde Excel: **${error.message}**`);
    }
  }
};
