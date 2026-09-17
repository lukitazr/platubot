import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Jugador from '../../models/Jugador.js';
import { editPlayer } from '../../utils/db/editPlayer.js';

export default {
  name: 'platubi-alias',
  aliases: ['alias', 'aliases', 'plalias', 'agregaralias', 'addalias', 'setalias'],
  desc: 'Gestiona los aliases/gamertags en el juego de un jugador para el validador de IA. Uso: !alias <jugador> [agregar/quitar/listar/set] [alias]',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-alias')
    .setDescription('Gestiona los aliases o gamertags en juego de un jugador para el validador IA')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('agregar')
        .setDescription('Agrega uno o varios aliases a un jugador')
        .addStringOption(opt =>
          opt.setName('jugador')
            .setDescription('Nombre o ID del jugador')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('alias')
            .setDescription('Alias o gamertags separados por coma (ej: Sabalero99, sabalero_fc)')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('quitar')
        .setDescription('Quita un alias específico de un jugador')
        .addStringOption(opt =>
          opt.setName('jugador')
            .setDescription('Nombre o ID del jugador')
            .setRequired(true))
        .addStringOption(opt =>
          opt.setName('alias')
            .setDescription('Alias o gamertag a remover')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('listar')
        .setDescription('Muestra todos los aliases registrados de un jugador')
        .addStringOption(opt =>
          opt.setName('jugador')
            .setDescription('Nombre o ID del jugador')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('limpiar')
        .setDescription('Borra todos los aliases de un jugador')
        .addStringOption(opt =>
          opt.setName('jugador')
            .setDescription('Nombre o ID del jugador')
            .setRequired(true))),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para usar este comando.', flags: 64 });
    }

    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const playerIdentifier = interaction.options.getString('jugador');
    const aliasInput = interaction.options.getString('alias');

    const result = await handleAliasAction(playerIdentifier, subcommand, aliasInput, client);

    if (!result.success) {
      return interaction.editReply(`❌ ${result.message}`);
    }

    const embed = buildAliasEmbed(result.playerDoc, result.actionMessage);
    await interaction.editReply({ embeds: [embed] });
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
    }

    if (!args || args.length === 0) {
      return message.reply(
        '❌ **Uso incorrecto del comando.**\n\n' +
        '• `!alias <jugador> agregar <alias1, alias2>` — Agrega aliases\n' +
        '• `!alias <jugador> quitar <alias>` — Quita un alias\n' +
        '• `!alias <jugador> listar` — Muestra los aliases actuales\n' +
        '• `!alias <jugador> limpiar` — Elimina todos los aliases\n\n' +
        '*Ejemplo:* `!alias Sabalero agregar sabalero99, el_saba`'
      );
    }

    const playerIdentifier = args[0];
    let action = 'agregar';
    let aliasInput = '';

    if (args.length === 1) {
      action = 'listar';
    } else {
      const secondArg = args[1].toLowerCase();
      if (['agregar', 'add', '+', 'addalias'].includes(secondArg)) {
        action = 'agregar';
        aliasInput = args.slice(2).join(' ');
      } else if (['quitar', 'remove', 'del', 'delete', '-'].includes(secondArg)) {
        action = 'quitar';
        aliasInput = args.slice(2).join(' ');
      } else if (['listar', 'list', 'ver', 'show'].includes(secondArg)) {
        action = 'listar';
      } else if (['limpiar', 'clear', 'reset'].includes(secondArg)) {
        action = 'limpiar';
      } else {
        // Por defecto, asumir que el segundo argumento en adelante son aliases a agregar
        action = 'agregar';
        aliasInput = args.slice(1).join(' ');
      }
    }

    const loading = await message.reply('<a:loading:1461897825439711468> Procesando aliases del jugador...');

    const result = await handleAliasAction(playerIdentifier, action, aliasInput, client);

    if (!result.success) {
      return loading.edit(`❌ ${result.message}`);
    }

    const embed = buildAliasEmbed(result.playerDoc, result.actionMessage);
    await loading.edit({ content: '', embeds: [embed] });
  }
};

/**
 * Lógica central para agregar, quitar o listar aliases de un jugador.
 */
async function handleAliasAction(playerIdentifier, action, aliasInput = '', client = null) {
  const idStr = String(playerIdentifier).trim();

  const playerDoc = await Jugador.findOne({
    $or: [
      { _id: idStr },
      { id: idStr },
      { discordId: idStr },
      { nombre: new RegExp(`^${idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    ]
  }).catch(() => null);

  if (!playerDoc) {
    return { success: false, message: `No se encontró ningún jugador registrado con "**${playerIdentifier}**".` };
  }

  if (!Array.isArray(playerDoc.aliases)) {
    playerDoc.aliases = [];
  }

  let actionMessage = '';

  if (action === 'agregar') {
    if (!aliasInput || !aliasInput.trim()) {
      return { success: false, message: 'Debes especificar al menos un alias a agregar (ej: `!alias Sabalero agregar sabalero99`).' };
    }

    const incoming = aliasInput.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const set = new Set(playerDoc.aliases);
    const added = [];

    for (const a of incoming) {
      if (!set.has(a)) {
        set.add(a);
        added.push(a);
      }
    }

    playerDoc.aliases = Array.from(set);
    await playerDoc.save();

    actionMessage = added.length > 0
      ? `✅ Se agregaron **${added.length}** alias(es): ${added.map(a => `\`${a}\``).join(', ')}.`
      : `ℹ️ Los aliases especificados ya se encontraban registrados.`;

  } else if (action === 'quitar') {
    if (!aliasInput || !aliasInput.trim()) {
      return { success: false, message: 'Debes especificar el alias que deseas quitar.' };
    }

    const target = aliasInput.trim().toLowerCase();
    const initialLen = playerDoc.aliases.length;
    playerDoc.aliases = playerDoc.aliases.filter(a => a.toLowerCase() !== target);

    if (playerDoc.aliases.length === initialLen) {
      return { success: false, message: `El jugador no tenía el alias \`${aliasInput.trim()}\`.` };
    }

    await playerDoc.save();
    actionMessage = `🗑️ Se eliminó el alias \`${aliasInput.trim()}\`.`;

  } else if (action === 'limpiar') {
    playerDoc.aliases = [];
    await playerDoc.save();
    actionMessage = `🧹 Se han eliminado todos los aliases del jugador.`;

  } else if (action === 'listar') {
    actionMessage = `📋 Consulta de aliases registrados.`;
  }

  return {
    success: true,
    playerDoc,
    actionMessage
  };
}

function buildAliasEmbed(playerDoc, actionMessage) {
  const aliasesList = Array.isArray(playerDoc.aliases) && playerDoc.aliases.length > 0
    ? playerDoc.aliases.map(a => `• \`${a}\``).join('\n')
    : '*No tiene aliases registrados aún.*';

  return new EmbedBuilder()
    .setTitle(`🏷️ Aliases de Juego — ${playerDoc.nombre}`)
    .setColor('#38bdf8')
    .setDescription(
      `${actionMessage}\n\n` +
      `**Nombre Oficial:** \`${playerDoc.nombre}\`\n` +
      `**ID de Jugador:** \`${playerDoc.id || playerDoc._id}\`\n\n` +
      `🎮 **Aliases / Gamertags en juego reconocidos por IA:**\n${aliasesList}`
    )
    .setFooter({ text: 'El sistema de validación con IA (Gemini) usará estos nombres al leer capturas de pantalla.' })
    .setTimestamp();
}
