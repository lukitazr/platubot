import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import Primera from '../../models/Primera.js';
import { generarTablaImagen } from '../../utils/visual/tablaGenerator.js';

export default {
  name: 'platubi-tabla',
  aliases: ['pltabla', 'tablapl', 'tablaplatubi'],
  desc: 'Muestra la tabla de posiciones de la Platubi. Uso: !platubi-tabla [nombre_o_número_liga]',
  permisos: [],

  // Data para Slash Commands
  data: new SlashCommandBuilder()
    .setName('platubi-tabla')
    .setDescription('Muestra la tabla de posiciones de la Platubi')
    .addStringOption(option =>
      option.setName('temporada')
        .setDescription('Nombre o número de la temporada (histórica o actual)')
        .setRequired(false)),

  // Ejecución para Slash Commands
  execute: async (client, interaction) => {
    await interaction.deferReply();
    
    const temporadaArg = interaction.options.getString('temporada');
    const ligas = await Primera.find({}).catch(() => []);
    ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));

    if (!ligas.length) {
      return interaction.editReply('❌ No hay ninguna temporada registrada en Platubi');
    }

    let liga = null;

    if (temporadaArg) {
      const query = temporadaArg.toLowerCase().trim();
      
      // Buscar primero por coincidencia de nombre
      liga = ligas.find(l => (l.nombreLiga ?? '').toLowerCase().includes(query));

      if (!liga) {
        const num = parseInt(query);
        if (!isNaN(num) && num >= 1 && num <= ligas.length) {
          liga = ligas[num - 1]; // 1 = más reciente
        }
      }

      if (!liga) {
        return interaction.editReply(`❌ No se encontró ninguna temporada que coincida con **"${temporadaArg}"**.`);
      }
    } else {
      liga = ligas[0];
    }

    if (!liga.jugadores?.length) {
      return interaction.editReply(`❌ La temporada **${liga.nombreLiga}** no tiene jugadores inscritos.`);
    }

    try {
      const pngBuffer = await generarTablaImagen(liga, client, 'primera');
      const attachment = new AttachmentBuilder(pngBuffer, { name: 'tabla_primera.png' });
      await interaction.editReply({ content: `🏆 Tabla de posiciones: **${liga.nombreLiga}**`, files: [attachment] });
    } catch (error) {
      console.error('Error generando tabla:', error);
      await interaction.editReply('❌ Error al generar la tabla de posiciones.');
    }
  },

  // Ejecución para Comandos de Texto (Legacy)
  run: async (client, message, args) => {
    const ligas = await Primera.find({}).catch(() => []);
    ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));

    if (!ligas.length) {
      return message.reply('❌ No hay ninguna temporada registrada en Platubi.');
    }

    let liga = null;

    if (args && args.length > 0) {
      const query = args.join(' ').toLowerCase().trim();

      // Buscar por nombre de liga
      liga = ligas.find(l => (l.nombreLiga ?? '').toLowerCase().includes(query));

      if (!liga) {
        const num = parseInt(query);
        if (!isNaN(num) && num >= 1 && num <= ligas.length) {
          liga = ligas[num - 1]; // 1 = más reciente
        }
      }

      if (!liga) {
        return message.reply(`❌ No se encontró ninguna temporada que coincida con **"${args.join(' ')}"**.`);
      }
    } else {
      // Sin parámetro → temporada más reciente
      liga = ligas[0];
    }

    if (!liga.jugadores?.length) {
      return message.reply(`❌ La temporada **${liga.nombreLiga}** no tiene jugadores inscritos.`);
    }

    const loading = await message.reply(`<a:loading:1461897825439711468> Generando tabla de **${liga.nombreLiga}**...`);

    try {
      const pngBuffer = await generarTablaImagen(liga, client, 'primera');
      const attachment = new AttachmentBuilder(pngBuffer, { name: 'tabla_primera.png' });
      await loading.edit({ content: '', files: [attachment] });
    } catch (error) {
      console.error('Error generando tabla:', error);
      await loading.edit('❌ Error al generar la tabla de posiciones.');
    }
  },
};
