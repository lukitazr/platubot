import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { editPlayer } from '../../utils/db/editPlayer.js';

export default {
  name: 'platubi-editarjugador',
  aliases: ['editarjugador', 'editjugador', 'pleditarjugador', 'editarjugadorpl'],
  desc: 'Edita los datos de un jugador (nombre, ID, stats, títulos, avatares y re-linkea referencias). Uso: !editarjugador <id_o_nombre> <campo> <nuevo_valor>',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-editarjugador')
    .setDescription('Edita los datos globales de un jugador (ID, nombre, stats, títulos).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('jugador')
        .setDescription('ID o nombre actual del jugador a editar')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('nombre')
        .setDescription('Nuevo nombre del jugador'))
    .addStringOption(opt =>
      opt.setName('discord_id')
        .setDescription('Nuevo ID de Discord o ID único'))
    .addIntegerOption(opt =>
      opt.setName('titulos')
        .setDescription('Cantidad de títulos'))
    .addIntegerOption(opt =>
      opt.setName('pg')
        .setDescription('Partidos ganados históricos'))
    .addIntegerOption(opt =>
      opt.setName('pp')
        .setDescription('Partidos perdidos históricos'))
    .addIntegerOption(opt =>
      opt.setName('wo')
        .setDescription('Walk Overs (WO) históricos'))
    .addIntegerOption(opt =>
      opt.setName('gf')
        .setDescription('Goles a favor históricos'))
    .addIntegerOption(opt =>
      opt.setName('gc')
        .setDescription('Goles en contra históricos'))
    .addStringOption(opt =>
      opt.setName('aliases')
        .setDescription('Aliases/gamertags del jugador en el juego (separados por coma)')),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para editar jugadores.', flags: 64 });
    }

    await interaction.deferReply();

    const playerIdentifier = interaction.options.getString('jugador');
    const updates = {};

    const nombre = interaction.options.getString('nombre');
    const discordId = interaction.options.getString('discord_id');
    const titulos = interaction.options.getInteger('titulos');
    const pg = interaction.options.getInteger('pg');
    const pp = interaction.options.getInteger('pp');
    const wo = interaction.options.getInteger('wo');
    const gf = interaction.options.getInteger('gf');
    const gc = interaction.options.getInteger('gc');
    const aliases = interaction.options.getString('aliases');

    if (nombre !== null) updates.nombre = nombre;
    if (discordId !== null) updates.discordId = discordId;
    if (titulos !== null) updates.titulos = titulos;
    if (pg !== null) updates.pg = pg;
    if (pp !== null) updates.pp = pp;
    if (wo !== null) updates.wo = wo;
    if (gf !== null) updates.gf = gf;
    if (gc !== null) updates.gc = gc;
    if (aliases !== null) updates.aliases = aliases;

    if (Object.keys(updates).length === 0) {
      return interaction.editReply('❌ Debes especificar al menos un campo para modificar (ej: `nombre`, `discord_id`, `titulos`, `pg`, `pp`, `wo`, `gf`, `gc`, `aliases`).');
    }

    const result = await editPlayer(playerIdentifier, updates, client);

    if (!result.success) {
      return interaction.editReply(`❌ **Error al editar:** ${result.reason}`);
    }

    const doc = result.playerDoc;
    const aliasesStr = Array.isArray(doc.aliases) && doc.aliases.length > 0 ? doc.aliases.map(a => `\`${a}\``).join(', ') : 'Ninguno';
    const titulosOfi = Array.isArray(doc.titulos?.oficiales) ? doc.titulos.oficiales.length : (typeof doc.titulos === 'number' ? doc.titulos : 0);
    const titulosAmi = Array.isArray(doc.titulos?.amistosos) ? doc.titulos.amistosos.length : 0;
    await interaction.editReply(
      `✏️ **Perfil de Jugador Actualizado Correctamente**\n\n` +
      `• **Nombre:** \`${doc.nombre}\`\n` +
      `• **ID / Discord ID:** \`${doc.discordId || doc.id || doc._id}\`\n` +
      `• **Aliases en Juego (IA):** ${aliasesStr}\n` +
      `• **Títulos:** 🏆 ${titulosOfi} Oficiales | 🎖️ ${titulosAmi} Amistosos\n` +
      `• **PG:** ${doc.partidosGanadosHistorico ?? 0} | **PP:** ${doc.partidosPerdidosHistorico ?? 0} | **WO:** ${doc.woHistorico ?? 0}\n` +
      `• **GF:** ${doc.golesAFavorHistorico ?? 0} | **GC:** ${doc.golesEnContraHistorico ?? 0}\n` +
      `• **Avatar:** ${doc.avatar ? `\`${doc.avatar}\`` : 'No asignado'}\n\n` +
      `🔄 **Referencias Re-linkeadas:** ${result.affectedCompeticiones} competiciones y ${result.affectedPartidos} partidos actualizados.\n` +
      `🖼️ **Caché de Avatar:** ${result.hasCachedAvatar ? '✅ Avatar procesado y cacheado' : 'Sin cambios'}`
    );
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para editar jugadores.');
    }

    if (args.length < 3) {
      return message.reply(
        `❌ **Uso incorrecto.**\n` +
        `Formato: \`!editarjugador <id_o_nombre> <campo1> <valor1> [campo2] [valor2] ...\`\n\n` +
        `**Campos disponibles:**\n` +
        `• \`nombre\` : Nuevo nombre de usuario\n` +
        `• \`id\` o \`discordid\` : Nuevo ID único o Discord ID\n` +
        `• \`aliases\` o \`alias\` : Aliases o gamertags en juego (separados por coma)\n` +
        `• \`titulos\` o \`titulos_oficiales\` : Cantidad de títulos oficiales\n` +
        `• \`titulos_amistosos\` : Cantidad de títulos amistosos\n` +
        `• \`pg\` : Partidos ganados históricos\n` +
        `• \`pp\` : Partidos perdidos históricos\n` +
        `• \`wo\` : Walk overs históricos\n` +
        `• \`gf\` : Goles a favor históricos\n` +
        `• \`gc\` : Goles en contra históricos\n\n` +
        `*Ejemplos:* \n` +
        `• \`!editarjugador Sabalero pg 15 pp 3 titulos 2\`\n` +
        `• \`!editarjugador Sabalero aliases sabalero99, el_saba titulos 4 pg 20\``
      );
    }

    const playerIdentifier = args[0];
    const rawTokens = args.slice(1);

    const updates = parseMultiFieldUpdates(rawTokens);

    if (Object.keys(updates).length === 0) {
      return message.reply('❌ No se pudo reconocer ningún campo válido para editar. Revisa la sintaxis e intenta de nuevo.');
    }

    const loading = await message.reply('🔄 Actualizando perfil de jugador, re-linkeando referencias y cacheando avatar...');
    const result = await editPlayer(playerIdentifier, updates, client);

    if (!result.success) {
      return loading.edit(`❌ **Error al editar:** ${result.reason}`);
    }

    const doc = result.playerDoc;
    const aliasesStr = Array.isArray(doc.aliases) && doc.aliases.length > 0 ? doc.aliases.map(a => `\`${a}\``).join(', ') : 'Ninguno';
    const titulosOfiRun = Array.isArray(doc.titulos?.oficiales) ? doc.titulos.oficiales.length : (typeof doc.titulos === 'number' ? doc.titulos : 0);
    const titulosAmiRun = Array.isArray(doc.titulos?.amistosos) ? doc.titulos.amistosos.length : 0;
    await loading.edit(
      `✏️ **Perfil de Jugador Actualizado Correctamente**\n\n` +
      `• **Nombre:** \`${doc.nombre}\`\n` +
      `• **ID / Discord ID:** \`${doc.discordId || doc.id || doc._id}\`\n` +
      `• **Aliases en Juego (IA):** ${aliasesStr}\n` +
      `• **Títulos:** 🏆 ${titulosOfiRun} Oficiales | 🎖️ ${titulosAmiRun} Amistosos\n` +
      `• **PG:** ${doc.partidosGanadosHistorico ?? 0} | **PP:** ${doc.partidosPerdidosHistorico ?? 0} | **WO:** ${doc.woHistorico ?? 0}\n` +
      `• **GF:** ${doc.golesAFavorHistorico ?? 0} | **GC:** ${doc.golesEnContraHistorico ?? 0}\n` +
      `• **Avatar:** ${doc.avatar ? `\`${doc.avatar}\`` : 'No asignado'}\n\n` +
      `🔄 **Referencias Re-linkeadas:** ${result.affectedCompeticiones} competiciones y ${result.affectedPartidos} partidos actualizados.\n` +
      `🖼️ **Caché de Avatar:** ${result.hasCachedAvatar ? '✅ Avatar procesado y cacheado' : 'Sin cambios'}`
    );
  }
};

/**
 * Parsea múltiples pares <campo> <valor> de los argumentos de comando con prefijo.
 * En el caso de `aliases` o `alias`, acumula los valores separados por coma y solo corta
 * para un nuevo campo cuando encuentra un nombre de campo clave después de un espacio que no termine en coma.
 */
function parseMultiFieldUpdates(tokens) {
  const KNOWN_FIELDS = new Set([
    'nombre',
    'id', 'discordid', 'discord_id',
    'alias', 'aliases',
    'titulos', 'titulo',
    'pg', 'pp', 'wo', 'gf', 'gc'
  ]);

  const updates = {};
  let i = 0;

  while (i < tokens.length) {
    const rawField = tokens[i].toLowerCase();

    if (!KNOWN_FIELDS.has(rawField)) {
      i++;
      continue;
    }

    const fieldKey = rawField;
    i++; // Avanzar al valor

    const valueTokens = [];

    while (i < tokens.length) {
      const currentToken = tokens[i];
      const lowerToken = currentToken.toLowerCase();

      // Si encontramos otra palabra clave de campo
      if (KNOWN_FIELDS.has(lowerToken)) {
        // En el caso de alias/aliases, solo considerar que es un nuevo campo si el token anterior NO terminaba en coma
        if (fieldKey === 'alias' || fieldKey === 'aliases') {
          const lastToken = valueTokens[valueTokens.length - 1] || '';
          if (lastToken.endsWith(',')) {
            // El token anterior terminó en coma (ej: "sabalero99,"), por lo que este token es parte del alias
            valueTokens.push(currentToken);
            i++;
            continue;
          }
        }
        // Es el inicio de un nuevo campo
        break;
      }

      valueTokens.push(currentToken);
      i++;
    }

    const valStr = valueTokens.join(' ').trim();
    if (!valStr) continue;

    switch (fieldKey) {
      case 'nombre':
        updates.nombre = valStr;
        break;
      case 'id':
      case 'discordid':
      case 'discord_id':
        updates.discordId = valStr;
        break;
      case 'alias':
      case 'aliases':
        updates.aliases = valStr;
        break;
      case 'titulos':
      case 'titulo':
      case 'titulos_oficiales':
      case 'titulosoficiales':
      case 'oficiales':
        updates.titulosOficiales = parseInt(valStr, 10);
        break;
      case 'titulos_amistosos':
      case 'titulosamistosos':
      case 'amistosos':
        updates.titulosAmistosos = parseInt(valStr, 10);
        break;
      case 'pg':
        updates.pg = parseInt(valStr, 10);
        break;
      case 'pp':
        updates.pp = parseInt(valStr, 10);
        break;
      case 'wo':
        updates.wo = parseInt(valStr, 10);
        break;
      case 'gf':
        updates.gf = parseInt(valStr, 10);
        break;
      case 'gc':
        updates.gc = parseInt(valStr, 10);
        break;
    }
  }

  return updates;
}

