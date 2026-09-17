import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Jugador from '../../models/Jugador.js';
import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import Tercera from '../../models/Tercera.js';
import Torneo from '../../models/copas/Torneo.js';
import Coppa from '../../models/copas/Coppa.js';
import Equipos from '../../models/superliga/Equipos.js';
import Superliga from '../../models/superliga/Superliga.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import { getOrCachePlayerAvatar } from '../../utils/visual/avatarCache.js';

export default {
  name: 'platubi-sincronizarparticipantes',
  aliases: [
    'sincronizarparticipantes',
    'syncparticipantes',
    'syncjugadores',
    'sincronizarjugadores',
    'plsincronizarparticipantes'
  ],
  desc: 'Escanea todas las ligas y torneos activos y registra a los participantes que no estén en la base de datos de jugadores.',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-sincronizarparticipantes')
    .setDescription('Escanea todas las ligas/torneos y registra en la base de datos a los participantes faltantes.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('competicion')
        .setDescription('Filtrar por nombre o prefijo de una liga/torneo específico (opcional)')
        .setRequired(false)),

  execute: async (client, interaction) => {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Necesitas permisos de Administrador para usar este comando.', flags: 64 });
    }

    await interaction.deferReply();
    const query = interaction.options.getString('competicion');

    const result = await syncAllParticipants(client, query);

    const embed = buildResultEmbed(result, query);
    await interaction.editReply({ embeds: [embed] });
  },

  run: async (client, message, args) => {
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Necesitas permisos de Administrador para usar este comando.');
    }

    const query = args && args.length > 0 ? args.join(' ').trim() : null;
    const loading = await message.reply('<a:loading:1461897825439711468> **Escaneando competiciones y sincronizando participantes en la base de datos...**');

    try {
      const result = await syncAllParticipants(client, query);
      const embed = buildResultEmbed(result, query);
      await loading.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('Error en sincronizarparticipantes:', error);
      await loading.edit(`❌ Error durante la sincronización: ${error.message}`);
    }
  }
};

/**
 * Escanea todas las competiciones y asegura que cada participante exista en el modelo `Jugador`.
 */
async function syncAllParticipants(client, query = null) {
  const normQuery = query ? query.toLowerCase().trim() : null;

  // 1. Obtener todos los jugadores actuales en DB
  const currentDbPlayers = await Jugador.find({}).catch(() => []);
  const playerMap = new Map(); // id/discordId/nombre -> JugadorDoc

  for (const p of currentDbPlayers) {
    const pId = String(p.id || p.discordId || p._id || '');
    if (pId) playerMap.set(pId, p);
    if (p.nombre) playerMap.set(p.nombre.toLowerCase().trim(), p);
  }

  // Candidatos extraídos: Map<id, { id, nombre, ligaContext, avatar }
  const candidates = new Map();

  function addCandidate(id, nombre, contextName, avatar = null) {
    if (!id && !nombre) return;
    const cleanId = id ? String(id).trim() : null;
    const cleanNombre = nombre ? String(nombre).trim() : (cleanId ? `Usuario (${cleanId.slice(-4)})` : 'Desconocido');
    const key = cleanId || cleanNombre.toLowerCase();

    if (!candidates.has(key)) {
      candidates.set(key, {
        id: cleanId,
        nombre: cleanNombre,
        contextName: contextName || 'Sin Liga',
        avatar: avatar || null
      });
    }
  }

  let competicionesEscaneadas = 0;

  // 2. Escanear Ligas Regulares (Primera, Segunda, Tercera)
  const regularModels = [
    { model: Primera, name: 'Primera' },
    { model: Segunda, name: 'Segunda' },
    { model: Tercera, name: 'Tercera' }
  ];

  for (const { model, name } of regularModels) {
    const docs = await model.find({}).catch(() => []);
    for (const doc of docs) {
      const leagueName = doc.nombreLiga || name;
      if (normQuery && !leagueName.toLowerCase().includes(normQuery)) continue;

      competicionesEscaneadas++;

      // Jugadores de la lista/tabla
      if (Array.isArray(doc.jugadores)) {
        for (const j of doc.jugadores) {
          const jId = typeof j === 'string' ? j : (j.id || j.discordId);
          const jName = typeof j === 'object' ? j.nombre : null;
          addCandidate(jId, jName, leagueName);
        }
      }

      // Jugadores de los partidos
      const schedule = doc.partidos ?? doc.fechas ?? [];
      if (Array.isArray(schedule)) {
        for (const fecha of schedule) {
          const matchArray = fecha.partidos ?? fecha.encuentros ?? [];
          if (Array.isArray(matchArray)) {
            for (const p of matchArray) {
              if (p.localId || p.localNombre) addCandidate(p.localId, p.localNombre, leagueName);
              if (p.visitanteId || p.visitanteNombre) addCandidate(p.visitanteId, p.visitanteNombre, leagueName);
            }
          }
        }
      }
    }
  }

  // 3. Escanear Torneos y Copas (Torneo, Coppa)
  const copasModels = [Torneo, Coppa];
  for (const cModel of copasModels) {
    const torneos = await cModel.find({}).catch(() => []);
    for (const t of torneos) {
      const torneoName = t.nombre || t.prefix || 'Torneo';
      const tPrefix = t.prefix || '';
      if (normQuery && !torneoName.toLowerCase().includes(normQuery) && !tPrefix.toLowerCase().includes(normQuery)) {
        continue;
      }

      competicionesEscaneadas++;

      if (Array.isArray(t.equipos)) {
        for (const eq of t.equipos) {
          // Si es individual (users)
          if (eq.discordId) {
            addCandidate(eq.discordId, eq.nombre, torneoName, eq.avatar);
          }
          if (eq.propietario) {
            addCandidate(eq.propietario, eq.nombre, torneoName);
          }
          // Miembros (duos/equipos)
          if (Array.isArray(eq.miembros)) {
            for (const m of eq.miembros) {
              const mId = typeof m === 'string' ? m : m.discordId;
              const mName = typeof m === 'object' ? (m.nombre || m.username) : null;
              const mAvatar = typeof m === 'object' ? m.avatar : null;
              addCandidate(mId, mName, torneoName, mAvatar);
            }
          }
        }
      }

      // Duelos individuales en grupos o llaves
      if (Array.isArray(t.enfrentamientosGrupos)) {
        for (const enf of t.enfrentamientosGrupos) {
          if (Array.isArray(enf.duelosIndividuales)) {
            for (const d of enf.duelosIndividuales) {
              if (d.localJugador) addCandidate(d.localJugador, d.localJugadorNombre || d.localNombre, torneoName);
              if (d.visitanteJugador) addCandidate(d.visitanteJugador, d.visitanteJugadorNombre || d.visitanteNombre, torneoName);
            }
          }
        }
      }

      if (t.llaves && typeof t.llaves === 'object') {
        for (const fase of Object.keys(t.llaves)) {
          const arr = t.llaves[fase];
          if (Array.isArray(arr)) {
            for (const ll of arr) {
              if (Array.isArray(ll.duelosIndividuales)) {
                for (const d of ll.duelosIndividuales) {
                  if (d.localJugador) addCandidate(d.localJugador, d.localJugadorNombre || d.localNombre, torneoName);
                  if (d.visitanteJugador) addCandidate(d.visitanteJugador, d.visitanteJugadorNombre || d.visitanteNombre, torneoName);
                }
              }
            }
          }
        }
      }
    }
  }

  // 4. Escanear Superliga y Equipos
  const superligaDocs = await Superliga.find({}).catch(() => []);
  for (const s of superligaDocs) {
    const sName = s.nombre || 'Superliga';
    if (normQuery && !sName.toLowerCase().includes(normQuery)) continue;
    competicionesEscaneadas++;
  }

  const equiposDocs = await Equipos.find({}).catch(() => []);
  for (const eq of equiposDocs) {
    if (eq.coach) {
      const cId = typeof eq.coach === 'string' ? eq.coach : (eq.coach.id || eq.coach.discordId);
      const cName = typeof eq.coach === 'object' ? eq.coach.nombre : null;
      addCandidate(cId, cName, 'Superliga');
    }
    if (Array.isArray(eq.jugadores)) {
      for (const j of eq.jugadores) {
        const jId = typeof j === 'string' ? j : (j.id || j.discordId);
        const jName = typeof j === 'object' ? j.nombre : null;
        addCandidate(jId, jName, 'Superliga');
      }
    }
  }

  // 5. Filtrar e insertar los que no estén en la base de datos
  const newlyCreated = [];
  const alreadyExisting = [];

  for (const cand of candidates.values()) {
    const idKey = cand.id ? String(cand.id) : null;
    const nameKey = cand.nombre ? cand.nombre.toLowerCase().trim() : null;

    let exists = false;
    if (idKey && playerMap.has(idKey)) exists = true;
    if (!exists && nameKey && playerMap.has(nameKey)) exists = true;

    if (exists) {
      alreadyExisting.push(cand);
      continue;
    }

    // Determinar ID para el nuevo registro
    let targetId = cand.id;
    let targetDiscordId = null;

    if (targetId && /^\d{17,20}$/.test(targetId)) {
      targetDiscordId = targetId;
    } else if (!targetId) {
      // Slugify del nombre
      targetId = cand.nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '') || `jugador_${Date.now()}`;
    }

    // Si tiene Discord ID y client está disponible, intentar resolver avatar y nombre actualizado
    let finalAvatar = cand.avatar || '';
    let finalNombre = cand.nombre;

    if (targetDiscordId && client) {
      try {
        const u = await client.users.fetch(targetDiscordId).catch(() => null);
        if (u) {
          finalNombre = u.displayName || u.username;
          finalAvatar = u.displayAvatarURL({ extension: 'png', size: 256 });
        }
      } catch (e) { }
    }

    // Crear el documento con atributo 'id' garantizado
    const newDoc = await Jugador.create({
      id: targetId,
      discordId: targetDiscordId,
      nombre: finalNombre,
      avatar: finalAvatar,
      ligaActual: cand.contextName || 'Sin Liga',
      titulos: 0,
      partidosGanadosHistorico: 0,
      partidosPerdidosHistorico: 0,
      woHistorico: 0,
      golesAFavorHistorico: 0,
      golesEnContraHistorico: 0,
      historial: []
    });

    // Cachear avatar
    if (targetDiscordId && client) {
      getOrCachePlayerAvatar(targetDiscordId, client).catch(() => {});
    }

    playerMap.set(String(targetId), newDoc);
    if (finalNombre) playerMap.set(finalNombre.toLowerCase().trim(), newDoc);

    newlyCreated.push({
      id: targetId,
      nombre: finalNombre,
      context: cand.contextName
    });
  }

  return {
    competicionesEscaneadas,
    totalCandidatos: candidates.size,
    registradosNuevos: newlyCreated,
    yaExistentes: alreadyExisting.length
  };
}

function buildResultEmbed(result, query) {
  const embed = new EmbedBuilder()
    .setTitle('🔄 Sincronización de Participantes')
    .setColor(result.registradosNuevos.length > 0 ? '#2ecc71' : '#3498db')
    .setDescription(
      `Se escanearon las competiciones activas y se sincronizaron los participantes en la base de datos de jugadores.\n\n` +
      `🏆 **Competiciones analizadas:** ${result.competicionesEscaneadas}` + (query ? ` *(Filtro: "${query}")*` : '') + `\n` +
      `👥 **Total de participantes detectados:** ${result.totalCandidatos}\n` +
      `✅ **Jugadores que ya existían:** ${result.yaExistentes}\n` +
      `➕ **Jugadores agregados a la DB:** **${result.registradosNuevos.length}**`
    )
    .setTimestamp();

  if (result.registradosNuevos.length > 0) {
    const listPreview = result.registradosNuevos
      .slice(0, 15)
      .map((p, idx) => `**${idx + 1}.** \`${p.nombre}\` (ID: \`${p.id}\` — *${p.context}*)`)
      .join('\n');

    const extra = result.registradosNuevos.length > 15 ? `\n*...y ${result.registradosNuevos.length - 15} más.*` : '';
    embed.addFields({ name: '🆕 Nuevos Jugadores Registrados', value: listPreview + extra });
  }

  return embed;
}
