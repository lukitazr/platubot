import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { mergePlayers } from '../../utils/db/mergePlayers.js';

export default {
  name: 'platubi-merge',
  aliases: ['merge', 'plmerge', 'mergepl', 'platubimerge'],
  desc: 'Fusiona dos perfiles de jugador (estadísticas, H2H y referencias en competiciones). Uso: !merge <id_destino> <id_origen>',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-merge')
    .setDescription('Fusiona dos perfiles de jugador (estadísticas, H2H y referencias en competiciones).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('destino')
        .setDescription('ID o nombre del jugador destino (el que SE QUEDA y suma los datos)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('origen')
        .setDescription('ID o nombre del jugador origen (el que SE FUSIONA y elimina)')
        .setRequired(true)),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para usar este comando.', flags: 64 });
    }

    await interaction.deferReply();

    const targetId = interaction.options.getString('destino');
    const sourceId = interaction.options.getString('origen');

    const result = await mergePlayers(targetId, sourceId);

    if (!result.success) {
      return interaction.editReply(`❌ **Error en la fusión:** ${result.reason}`);
    }

    await interaction.editReply(
      `🔀 **Fusión completada con éxito**\n\n` +
      `• **Jugador Destino (Mergeador):** \`${result.targetName}\` (\`${result.realTargetId}\`)\n` +
      `• **Jugador Origen (Mergeado):** \`${result.sourceName}\` (\`${result.realSourceId}\`)\n` +
      `• **Competiciones Actualizadas:** ${result.affectedLigas}\n` +
      `• **Partidos Actualizados:** ${result.affectedPartidos}\n\n` +
      `✅ *Las estadísticas globales, el historial H2H y todas las referencias de torneos fueron unificadas en ${result.targetName}.*`
    );
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
    }

    if (args.length < 2) {
      return message.reply('❌ **Uso incorrecto.** Formato: `!merge <id_destino> <id_origen>`\nEjemplo: `!merge 751663890441699409 ters`');
    }

    const targetId = args[0];
    const sourceId = args[1];

    const loading = await message.reply('🔄 Fusionando estadísticas y referencias del jugador...');
    const result = await mergePlayers(targetId, sourceId);

    if (!result.success) {
      return loading.edit(`❌ **Error en la fusión:** ${result.reason}`);
    }

    await loading.edit(
      `🔀 **Fusión completada con éxito**\n\n` +
      `• **Jugador Destino (Mergeador):** \`${result.targetName}\` (\`${result.realTargetId}\`)\n` +
      `• **Jugador Origen (Mergeado):** \`${result.sourceName}\` (\`${result.realSourceId}\`)\n` +
      `• **Competiciones Actualizadas:** ${result.affectedLigas}\n` +
      `• **Partidos Actualizados:** ${result.affectedPartidos}\n\n` +
      `✅ *Las estadísticas globales, el historial H2H y todas las referencias de torneos fueron unificadas en ${result.targetName}.*`
    );
  }
};
