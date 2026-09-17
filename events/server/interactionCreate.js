import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
  ActionRowBuilder,
  ButtonStyle,
  ButtonBuilder,
  FileUploadBuilder,
  LabelBuilder
} from 'discord.js';

import Primera from '../../models/Primera.js';
import Segunda from '../../models/Segunda.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import descargarImagen from '../../utils/descargarImagen.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function getModel(type) {
  if (type === 'primera' || type === 'platubi') return Primera;
  if (type === 'segunda' || type === 'palubi') return Segunda;
  return null;
}

async function getLigaActual(Modelo) {
  const ligas = await Modelo.find({}).catch(() => []);
  return ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio))[0] ?? null;
}

function findPartido(liga, matchId) {
  for (const fecha of liga.partidos) {
    const idx = fecha.partidos.findIndex(p => p._id === matchId);
    if (idx !== -1) return { fecha, idx, partido: fecha.partidos[idx] };
  }
  return null;
}

// ── Evento ─────────────────────────────────────────────────────────────────

export default {
  name: Events.InteractionCreate,

  run: async (client, interaction) => {
    // 1. Manejar Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        if (command.execute) await command.execute(client, interaction);
        else await interaction.reply({ content: '❌ Solo message commands.', flags: 64 });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: '❌ Error.', flags: 64 });
      }
      return;
    }

    // 2. Manejar Botones
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Botón para abrir modal de creación de equipo
      if (customId === 'btn_crear_equipo_modal') {
        const modal = new ModalBuilder()
          .setCustomId('modal_crear_equipo')
          .setTitle('Crear Equipo');

        const nLabel = new LabelBuilder()
          .setLabel('Nombre del Equipo')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('n')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Ej: Platense')
              .setRequired(true)
          );

        const fileInput = new FileUploadBuilder()
          .setCustomId('e')
          .setRequired(true);

        const inputLabel = new LabelBuilder()
          .setLabel("Escudo del Equipo")
          .setFileUploadComponent(fileInput);

        modal.addLabelComponents(nLabel, inputLabel);

        return interaction.showModal(modal);
      }

      // Handlers de revisión de IA por Administración
      if (customId.startsWith('btn_admin_aprv_ai|') || customId.startsWith('btn_admin_edit_ai|') || customId.startsWith('btn_admin_deny_ai|')) {
        const parts = customId.split('|');
        const action = parts[0];
        const matchId = parts[1];

        if (action === 'btn_admin_deny_ai') {
          const userId = parts[2];
          const tipoPartido = parts[3] || 'unico';

          let targetMatch = null;
          if (userId) {
            const { findPendingMatchesForUser } = await import('../../utils/matchFinder.js');
            const pending = await findPendingMatchesForUser(userId);
            targetMatch = pending.find(m => m.matchId === matchId);
          }

          const denyEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setTitle('❌ Partido Rechazado por Administración')
            .setColor('Red')
            .setFooter({ text: `Rechazado por @${interaction.user.username}` });

          await interaction.update({ embeds: [denyEmbed], components: [] });

          if (targetMatch && targetMatch.canalResultados && userId) {
            const resultsChannel = await interaction.client.channels.fetch(targetMatch.canalResultados).catch(() => null);
            if (resultsChannel) {
              const tipoLabel = (tipoPartido && tipoPartido !== 'unico') ? ` (${tipoPartido.toUpperCase()})` : '';
              await resultsChannel.send({
                content: `❌ <@${userId}>, tu captura para **${targetMatch.localNombre} vs ${targetMatch.visitanteNombre}**${tipoLabel} fue **rechazada** por administración.`
              }).catch(() => { });
            }
          }
          return;
        }

        if (action === 'btn_admin_aprv_ai') {
          // New format: btn_admin_aprv_ai|{matchId}|{userId}|{tipoPartido}|{gl}|{gv}
          // Legacy format: btn_admin_aprv_ai|{matchId}|{gl}|{gv}|{userId}
          let gl, gv, userId, tipoPartido;
          if (parts.length >= 6 && (parts[3] === 'ida' || parts[3] === 'vuelta' || parts[3] === 'desempate' || parts[3] === 'unico')) {
            // New format
            userId = parts[2];
            tipoPartido = parts[3];
            gl = parseInt(parts[4]);
            gv = parseInt(parts[5]);
          } else {
            // Legacy format
            gl = parseInt(parts[2]);
            gv = parseInt(parts[3]);
            userId = parts[4];
            tipoPartido = 'unico';
          }

          const { processMatchResultAndSyncStandings } = await import('../../utils/db/globalUserSync.js');
          const { findPendingMatchesForUser } = await import('../../utils/matchFinder.js');

          const pending = await findPendingMatchesForUser(userId);
          const targetMatch = pending.find(m => m.matchId === matchId);

          if (!targetMatch) {
            return interaction.reply({ content: '❌ No se encontró el partido pendiente en la base de datos (quizá ya fue finalizado).', flags: 64 });
          }

          // Asentar resultado de forma inmediata y persistente
          await processMatchResultAndSyncStandings({
            localId: targetMatch.localId,
            visitanteId: targetMatch.visitanteId,
            localNombre: targetMatch.localNombre,
            visitanteNombre: targetMatch.visitanteNombre,
            golesLocal: gl,
            golesVisitante: gv,
            ligaDoc: targetMatch.modelDoc,
            partidoId: targetMatch.matchId,
            tipoPartido: tipoPartido || 'unico',
            context: targetMatch.competicionNombre
          });

          const tipoLabel = (tipoPartido && tipoPartido !== 'unico') ? ` (${tipoPartido.toUpperCase()})` : '';
          const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setTitle(`✅ Partido${tipoLabel} Aprobado por Administración`)
            .setColor('Green')
            .setFields([
              { name: 'Competición', value: targetMatch.competicionNombre, inline: true },
              { name: `Resultado${tipoLabel}`, value: `**${targetMatch.localNombre} ${gl} - ${gv} ${targetMatch.visitanteNombre}**`, inline: true },
              { name: 'Aprobado por', value: `<@${interaction.user.id}>`, inline: true }
            ]);

          await interaction.update({ embeds: [approvedEmbed], components: [] });

          // Dar feedback en el canal de resultados del torneo
          if (targetMatch.canalResultados && userId) {
            const resultsChannel = await interaction.client.channels.fetch(targetMatch.canalResultados).catch(() => null);
            if (resultsChannel) {
              await resultsChannel.send({
                content: `✅ <@${userId}>, tu captura para **${targetMatch.localNombre} vs ${targetMatch.visitanteNombre}**${tipoLabel} fue **aprobada** por administración: **${targetMatch.localNombre} ${gl} - ${gv} ${targetMatch.visitanteNombre}**`
              }).catch(() => { });
            }
          }
          return;
        }

        if (action === 'btn_admin_edit_ai') {
          // New format: btn_admin_edit_ai|{matchId}|{userId}|{tipoPartido}
          // Legacy format: btn_admin_edit_ai|{matchId}|{userId}
          const userId = parts[2];
          const tipoPartido = parts[3] || 'unico';
          const { findPendingMatchesForUser } = await import('../../utils/matchFinder.js');
          const pending = await findPendingMatchesForUser(userId);
          const targetMatch = pending.find(m => m.matchId === matchId);

          const localNom = targetMatch?.localNombre || 'Local';
          const visitanteNom = targetMatch?.visitanteNombre || 'Visitante';
          const tipoLabel = tipoPartido !== 'unico' ? ` (${tipoPartido.toUpperCase()})` : '';

          const modal = new ModalBuilder()
            .setCustomId(`m_admin_edit_ai|${matchId}|${userId}|${tipoPartido}`)
            .setTitle(`Cargar Resultado${tipoLabel}`.slice(0, 45));

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('gl')
                .setLabel(`Goles de ${localNom}`.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('0')
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('gv')
                .setLabel(`Goles de ${visitanteNom}`.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('0')
                .setRequired(true)
            )
          );

          return interaction.showModal(modal);
        }
      }

      // Handlers de aprobación
      if (customId.startsWith('aprv|superliga|') || customId.startsWith('deny|superliga|')) {
        const parts = customId.split('|');
        const action = parts[0];
        const val = parts[2];
        const duelIdx = parts[3] ? parseInt(parts[3]) : -1;
        const reporterId = parts[parts.length - 1];

        if (action === 'deny') {
          await interaction.update({ content: '❌ Resultado denegado.', embeds: [], components: [] });
          return;
        }

        // Impedir que el mismo que reportó valide el resultado (excepto si es admin)
        const isAdmin = interaction.member.permissions.has('Administrator');
        if (interaction.user.id === reporterId && !isAdmin) {
          return interaction.reply({ content: '❌ No puedes validar tu propio reporte. Debe hacerlo tu rival o un administrador.', flags: 64 });
        }

        const Superliga = (await import('../../models/superliga/Superliga.js')).default;
        const Supersupercopa = (await import('../../models/superliga/Supersupercopa.js')).default;

        const liga = await Superliga.findOne({ actual: true });
        const ssc = await Supersupercopa.findOne({ actual: true }) || await Supersupercopa.findOne({ estadoGlobal: 'Activa' });

        let partido = null;
        if (val.startsWith('sl_')) {
          if (!liga) return interaction.reply({ content: '❌ No hay temporada de Superliga activa.', flags: 64 });
          const [, fi, pi] = val.split('_').map(Number);
          const fechaObj = liga.fechas[fi];
          const encuentros = fechaObj.encuentros ?? fechaObj.partidos;
          partido = encuentros?.[pi];
        } else if (val.startsWith('ssc_g_')) {
          if (!ssc) return interaction.reply({ content: '❌ No hay Supersupercopa activa.', flags: 64 });
          const [, , gi, fi, pi] = val.split('_').map(Number);
          partido = ssc.grupos[gi]?.fechas[fi]?.partidos[pi];
        } else if (val.startsWith('ssc_e_')) {
          if (!ssc) return interaction.reply({ content: '❌ No hay Supersupercopa activa.', flags: 64 });
          const [, , li, tipo] = val.split('_');
          const llave = ssc.fase === 'semifinales' ? ssc.semifinales[parseInt(li)] : ssc.final;
          partido = llave[tipo];
        }

        if (!partido) return interaction.reply({ content: '❌ Partido no encontrado.', flags: 64 });

        const duelo = duelIdx !== -1 ? partido.duelosIndividuales?.[duelIdx] : null;
        if (duelo && duelo.finalizado) return interaction.reply({ content: '⚠️ Este duelo ya fue validado.', flags: 64 });
        if (!duelo && partido.finalizado) return interaction.reply({ content: '⚠️ Este partido ya fue validado.', flags: 64 });

        const modalGoles = new ModalBuilder().setCustomId(`m_aprv_sl|${val}|${duelIdx}`).setTitle((duelo ? `Duelo ${duelIdx + 1}: ${duelo.localJugadorNombre} vs ${duelo.visitanteJugadorNombre}` : 'Validar Resultado').slice(0, 45));

        const labelL = duelo ? (duelo.localJugadorNombre || 'Local') : (partido.localNombre || 'Local');
        const labelV = duelo ? (duelo.visitanteJugadorNombre || 'Visitante') : (partido.visitanteNombre || 'Visitante');

        modalGoles.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles ${labelL}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 5').setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles ${labelV}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 3').setRequired(true))
        );
        await interaction.showModal(modalGoles);
      }

      // Aprobación Ligas (Platubi / Palubi)
      if (customId.startsWith('aprv|platubi|') || customId.startsWith('deny|platubi|') ||
        customId.startsWith('aprv|palubi|') || customId.startsWith('deny|palubi|')) {
        const parts = customId.split('|');
        const action = parts[0];
        const ligaType = parts[1];
        const matchId = parts[2];
        const reporterId = parts[3];

        if (action === 'deny') {
          return interaction.update({ content: '❌ Resultado denegado.', embeds: [], components: [] });
        }

        const isAdmin = interaction.member.permissions.has('Administrator');
        if (interaction.user.id === reporterId && !isAdmin) {
          return interaction.reply({ content: '❌ No puedes validar tu propio reporte. Debe hacerlo tu rival o un administrador.', flags: 64 });
        }

        const Modelo = getModel(ligaType);
        const liga = await getLigaActual(Modelo);
        if (!liga) return interaction.reply({ content: '❌ No hay temporada activa.', flags: 64 });

        const matchInfo = findPartido(liga, matchId);
        if (!matchInfo) return interaction.reply({ content: '❌ Partido no encontrado.', flags: 64 });

        const modal = new ModalBuilder().setCustomId(`m_aprv_liga|${ligaType}|${matchId}`).setTitle('Validar Resultado');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles de ${matchInfo.partido.localNombre}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles de ${matchInfo.partido.visitanteNombre}`).setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // Aprobación Torneos
      if (customId.startsWith('aprv|torneo|') || customId.startsWith('deny|torneo|')) {
        const parts = customId.split('|');
        const action = parts[0];
        const prefix = parts[2];
        const reporterId = parts[parts.length - 1];

        if (action === 'deny') {
          return interaction.update({ content: '❌ Resultado denegado.', embeds: [], components: [] });
        }

        const isAdmin = interaction.member.permissions.has('Administrator');
        if (interaction.user.id === reporterId && !isAdmin) {
          return interaction.reply({ content: '❌ No puedes validar tu propio reporte. Debe hacerlo tu rival o un administrador.', flags: 64 });
        }

        const Torneo = (await import('../../models/copas/Torneo.js')).default;
        const torneo = await Torneo.findOne({ prefix });
        if (!torneo) return interaction.reply({ content: '❌ Torneo no encontrado.', flags: 64 });

        const tipo = parts[3];
        const val1 = parts[4];
        const val2 = parts[5];
        const tipoMatch = tipo === 'bracket' ? parts[6] : null;

        let lName = 'Local', vName = 'Visitante';
        if (tipo === 'grupo') { lName = val1; vName = val2; }
        else {
          const ll = torneo.llaves[val1].find(x => x.id === val2);
          if (ll) {
            lName = (tipoMatch === 'vuelta') ? ll.equipo2.nombre : ll.equipo1.nombre;
            vName = (tipoMatch === 'vuelta') ? ll.equipo1.nombre : ll.equipo2.nombre;
          }
        }

        const modal = new ModalBuilder().setCustomId(`m_aprv_tor|${prefix}|${tipo}|${val1}|${val2}${tipoMatch ? '|' + tipoMatch : ''}`).setTitle('Validar Torneo');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles de ${lName}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles de ${vName}`).setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // Aprobación Coppa
      if (customId.startsWith('aprv|coppa|') || customId.startsWith('deny|coppa|')) {
        const parts = customId.split('|');
        const action = parts[0];
        const llaveId = parts[2];
        const tipoMatch = parts[3];
        const reporterId = parts[4];

        if (action === 'deny') {
          return interaction.update({ content: '❌ Resultado denegado.', embeds: [], components: [] });
        }

        const isAdmin = interaction.member.permissions.has('Administrator');
        if (interaction.user.id === reporterId && !isAdmin) {
          return interaction.reply({ content: '❌ No puedes validar tu propio reporte.', flags: 64 });
        }

        const Coppa = (await import('../../models/copas/Coppa.js')).default;
        const coppa = await Coppa.findOne({ estado: 'EnCurso' });
        if (!coppa) return interaction.reply({ content: '❌ Coppa no encontrada.', flags: 64 });

        const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
        const llave = coppa.llaves[faseActual]?.find(l => l.id === llaveId);
        if (!llave) return interaction.reply({ content: '❌ Llave no encontrada.', flags: 64 });

        const lName = tipoMatch === 'vuelta' ? llave.equipo2.nombre : llave.equipo1.nombre;
        const vName = tipoMatch === 'vuelta' ? llave.equipo1.nombre : llave.equipo2.nombre;

        const modal = new ModalBuilder().setCustomId(`m_aprv_cop|${llaveId}|${tipoMatch}`).setTitle('Validar Coppa');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles de ${lName}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles de ${vName}`).setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      // Autojoin Torneo
      if (customId.startsWith('autojoin_')) {
        const prefix = customId.split('_')[1];
        const Torneo = (await import('../../models/copas/Torneo.js')).default;
        const torneo = await Torneo.findOne({ prefix }).catch(() => null);
        if (!torneo) {
          return interaction.reply({ content: '❌ Torneo no encontrado.', flags: 64 });
        }

        const genericCmd = client.commands.get('torneo-generic');
        if (!genericCmd) {
          return interaction.reply({ content: '❌ Error: Comando genérico de gestión no encontrado.', flags: 64 });
        }

        const mockMessage = {
          guild: interaction.guild,
          channel: interaction.channel,
          author: interaction.user,
          member: interaction.member,
          reply: async (options) => {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp(options);
              return await interaction.fetchReply();
            }
            await interaction.reply(options);
            return await interaction.fetchReply();
          }
        };

        try {
          await genericCmd.runGeneric(client, mockMessage, [], torneo, 'inscribirme');
        } catch (err) {
          console.error('Error in autojoin button handler:', err);
          await interaction.reply({ content: '❌ Hubo un error al procesar tu auto-inscripción.', flags: 64 }).catch(() => { });
        }
        return;
      }
    }

    // 3. Manejar Modales
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('m_admin_edit_ai|')) {
        const parts = interaction.customId.split('|');
        const matchId = parts[1];
        const userId = parts[2];
        const tipoPartido = parts[3] || 'unico';

        const gl = parseInt(interaction.fields.getTextInputValue('gl'));
        const gv = parseInt(interaction.fields.getTextInputValue('gv'));

        if (isNaN(gl) || isNaN(gv)) {
          return interaction.reply({ content: '❌ Ingresa números válidos para los goles.', flags: 64 });
        }

        await interaction.deferUpdate();

        const { processMatchResultAndSyncStandings } = await import('../../utils/db/globalUserSync.js');
        const { findPendingMatchesForUser } = await import('../../utils/matchFinder.js');

        const pending = await findPendingMatchesForUser(userId);
        const targetMatch = pending.find(m => m.matchId === matchId);

        if (!targetMatch) {
          return interaction.editReply('❌ No se encontró el partido pendiente en la base de datos.');
        }

        await processMatchResultAndSyncStandings({
          localId: targetMatch.localId,
          visitanteId: targetMatch.visitanteId,
          localNombre: targetMatch.localNombre,
          visitanteNombre: targetMatch.visitanteNombre,
          golesLocal: gl,
          golesVisitante: gv,
          ligaDoc: targetMatch.modelDoc,
          partidoId: targetMatch.matchId,
          tipoPartido,
          context: targetMatch.competicionNombre
        });

        const tipoLabel = tipoPartido !== 'unico' ? ` (${tipoPartido.toUpperCase()})` : '';
        const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setTitle(`✅ Partido${tipoLabel} Editado y Aprobado por Administración`)
          .setColor('Green')
          .setFields([
            { name: 'Competición', value: targetMatch.competicionNombre, inline: true },
            { name: `Resultado${tipoLabel}`, value: `**${targetMatch.localNombre} ${gl} - ${gv} ${targetMatch.visitanteNombre}**`, inline: true },
            { name: 'Cargado por', value: `<@${interaction.user.id}>`, inline: true }
          ]);

        await interaction.editReply({ embeds: [approvedEmbed], components: [] });

        if (targetMatch.canalResultados && userId) {
          const resultsChannel = await interaction.client.channels.fetch(targetMatch.canalResultados).catch(() => null);
          if (resultsChannel) {
            await resultsChannel.send({
              content: `✅ <@${userId}>, tu captura para **${targetMatch.localNombre} vs ${targetMatch.visitanteNombre}**${tipoLabel} fue **editada y aprobada** por administración: **${targetMatch.localNombre} ${gl} - ${gv} ${targetMatch.visitanteNombre}**`
            }).catch(() => { });
          }
        }
        return;
      }

      if (interaction.customId === 'modal_crear_equipo') {
        await interaction.deferReply({ flags: 64 });
        const nombre = interaction.fields.getTextInputValue('n');
        try {
          // 1. Comprobar si ya es coach de un equipo
          const esCoach = await EquipoSuperliga.findOne({ 'coach.id': interaction.user.id });
          if (esCoach) return interaction.editReply(`❌ Ya eres el coach del equipo **${esCoach.nombre}**. No puedes crear otro.`);

          // 2. Comprobar si el nombre del equipo ya existe (insensible a mayúsculas y acentos)
          const todosLosEquipos = await EquipoSuperliga.find({});
          const normalizar = (str) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const nombreNuevoNorm = normalizar(nombre);

          const existeNombre = todosLosEquipos.some(e => normalizar(e.nombre) === nombreNuevoNorm);
          if (existeNombre) return interaction.editReply('❌ Ya existe un equipo con ese nombre (o uno muy similar).');

          // 3. Si era jugador en otro equipo, eliminarlo de ahí
          const equiposComoJugador = await EquipoSuperliga.find({ 'jugadores.id': interaction.user.id });
          for (const eq of equiposComoJugador) {
            const nuevosJugadores = eq.jugadores.filter(j => j.id !== interaction.user.id);
            await EquipoSuperliga.update({ _id: eq._id }, { jugadores: nuevosJugadores });
          }

          // 4. Si estaba en la lista de agentes libres, eliminarlo
          const JugadorLibre = (await import('../../models/superliga/JugadoresLibres.js')).default;
          await JugadorLibre.deleteOne({ id: interaction.user.id });

          // 5. Descargar escudo y crear equipo
          const attachmentField = interaction.fields.getField('e');
          const url = attachmentField?.attachments.first()?.url;
          if (!url) return interaction.editReply('❌ No se ha subido ninguna imagen para el escudo.');

          const ext = url.split('.').pop().split('?')[0] || 'png';
          const fileName = `${nombre.toLowerCase().replace(/ /g, '_')}_${Date.now()}.${ext}`;
          const localPath = await descargarImagen(url, fileName, 'equipos');

          await EquipoSuperliga.create({
            nombre,
            escudo: localPath,
            coach: {
              nombre: interaction.user.username,
              id: interaction.user.id,
              pais: 'Argentina'
            }
          });

          await ensureUserRegistered(interaction.user, client);

          await interaction.editReply(`✅ Equipo **${nombre}** creado con éxito. Se han actualizado tus registros (eliminado de otros equipos o agentes libres si correspondía).`);
        } catch (e) {
          console.error(e);
          await interaction.editReply('❌ Error al procesar la creación del equipo.');
        }
      }

      // Modal Ligas
      if (interaction.customId.startsWith('m_aprv_liga|')) {
        const [, ligaType, matchId] = interaction.customId.split('|');
        const gl = parseInt(interaction.fields.getTextInputValue('gl'));
        const gv = parseInt(interaction.fields.getTextInputValue('gv'));
        if (isNaN(gl) || isNaN(gv)) return interaction.reply({ content: '❌ Goles inválidos.', flags: 64 });

        await interaction.deferUpdate();
        const Modelo = getModel(ligaType);
        const liga = await getLigaActual(Modelo);
        if (!liga) return interaction.editReply('❌ Temporada no encontrada.');

        const matchInfo = findPartido(liga, matchId);
        if (!matchInfo) return interaction.editReply('❌ Partido no encontrado.');
        const { partido } = matchInfo;
        if (partido.finalizado) return interaction.editReply('⚠️ Ya fue validado.');

        partido.golesLocal = gl; partido.golesVisitante = gv; partido.finalizado = true;

        const jL = liga.jugadores.find(j => j.id === partido.localId);
        const jV = liga.jugadores.find(j => j.id === partido.visitanteId);
        if (jL && jV) {
          [jL, jV].forEach(j => {
            if (j.pj == null) { j.pj = 0; j.pg = 0; j.pe = 0; j.pp = 0; j.gf = 0; j.gc = 0; j.puntos = 0; }
          });
          jL.pj++; jV.pj++; jL.gf += gl; jL.gc += gv; jV.gf += gv; jV.gc += gl;
          if (gl > gv) { jL.pg++; jL.puntos += 3; jV.pp++; }
          else if (gv > gl) { jV.pg++; jV.puntos += 3; jL.pp++; }
          else { jL.pe++; jV.pe++; jL.puntos++; jV.puntos++; }
        }
        await liga.save();

        const e = EmbedBuilder.from(interaction.message.embeds[0]).setTitle(`✅ Confirmado — ${ligaType}`).setDescription(`**${partido.localNombre} ${gl} - ${gv} ${partido.visitanteNombre}**\nValidado por <@${interaction.user.id}>`).setColor('Green');
        return (
          await interaction.editReply({ content: '', embeds: [e], components: [] }),
          await client.channels.fetch((ligaType === 'primera' || ligaType === 'platubi') ? process.env.CANAL_RESULTADOS_PRIMERA : process.env.CANAL_RESULTADOS_SEGUNDA)
            .then(channel => channel.send({ content: '', embeds: [e], components: [] }))
            .catch(() => { })
        );
      }

      // Modal Torneo
      if (interaction.customId.startsWith('m_aprv_tor|')) {
        const parts = interaction.customId.split('|');
        const prefix = parts[1];
        const tipo = parts[2];
        const val1 = parts[3];
        const val2 = parts[4];
        const tipoMatch = parts[5];

        const gl = parseInt(interaction.fields.getTextInputValue('gl'));
        const gv = parseInt(interaction.fields.getTextInputValue('gv'));
        if (isNaN(gl) || isNaN(gv)) return interaction.reply({ content: '❌ Goles inválidos.', flags: 64 });

        await interaction.deferUpdate();
        const Torneo = (await import('../../models/copas/Torneo.js')).default;
        const torneo = await Torneo.findOne({ prefix });
        if (!torneo) return interaction.editReply('❌ Torneo no encontrado.');

        let pName = '';
        let isOverallFinished = false;
        let ll = null;

        if (tipoMatch === 'duelo') {
          const duelIdx = parseInt(parts[6]);
          let matchObj = null;
          if (tipo === 'grupo') {
            matchObj = torneo.enfrentamientosGrupos.find(x => x.local === val1 && x.visitante === val2);
          } else {
            matchObj = torneo.llaves[val1].find(x => x.id === val2);
            ll = matchObj;
          }
          if (!matchObj || !matchObj.duelosIndividuales?.[duelIdx]) return interaction.editReply('❌ Duelo no encontrado.');

          const d = matchObj.duelosIndividuales[duelIdx];
          if (d.finalizado) return interaction.editReply('⚠️ Este duelo ya ha sido validado.');

          d.golesLocal = gl;
          d.golesVisitante = gv;
          d.finalizado = true;

          pName = `Duelo: ${d.localJugadorNombre || d.localJugador} ${gl} - ${gv} ${d.visitanteJugadorNombre || d.visitanteJugador}`;

          // Registrar en historial el duelo
          if (!torneo.historialResultados) torneo.historialResultados = [];
          torneo.historialResultados.push({
            accion: 'resultado',
            partido: `${d.localJugadorNombre || d.localJugador} vs ${d.visitanteJugadorNombre || d.visitanteJugador} (Duelo en ${val1} vs ${val2})`,
            resultado: `${gl}-${gv}`,
            tipo: 'duelo',
            cargadoPor: interaction.user.id,
            timestamp: new Date().toISOString()
          });

          // Calcular si se decidió el ganador general del partido/enfrentamiento
          const finalizados = matchObj.duelosIndividuales.filter(du => du.finalizado);
          let winsLocal = 0, winsVisitante = 0;
          for (const du of finalizados) {
            if (du.golesLocal > du.golesVisitante) winsLocal++;
            else if (du.golesVisitante > du.golesLocal) winsVisitante++;
          }

          const majority = Math.ceil(matchObj.duelosIndividuales.length / 2);
          let winner = null;
          if (winsLocal >= majority) winner = 'local';
          else if (winsVisitante >= majority) winner = 'visitante';
          else if (finalizados.length === matchObj.duelosIndividuales.length) {
            if (winsLocal > winsVisitante) winner = 'local';
            else if (winsVisitante > winsLocal) winner = 'visitante';
            else winner = 'Empate';
          }

          if (winner) {
            isOverallFinished = true;
            let totGL = 0, totGV = 0;
            matchObj.duelosIndividuales.forEach(du => {
              totGL += du.golesLocal || 0;
              totGV += du.golesVisitante || 0;
            });

            if (tipo === 'grupo') {
              matchObj.resultado = `${totGL}-${totGV}`;
              matchObj.completado = true;
              matchObj.ganador = winner === 'local' ? val1 : (winner === 'visitante' ? val2 : 'Empate');

              const tL = torneo.equipos.find(eq => eq.nombre === val1);
              const tV = torneo.equipos.find(eq => eq.nombre === val2);
              if (tL && tV) {
                tL.pj++; tV.pj++; tL.gf += totGL; tL.gc += totGV; tV.gf += totGV; tV.gc += totGL;
                if (winner === 'local') { tL.pg++; tL.puntos += 3; tV.pp++; }
                else if (winner === 'visitante') { tV.pg++; tV.puntos += 3; tL.pp++; }
                else { tL.pe++; tV.pe++; tL.puntos++; tV.puntos++; }
              }
            } else {
              matchObj.resultado = `${totGL}-${totGV}`;
              matchObj.ganador = winner === 'local' ? (matchObj.equipo1.discordId || matchObj.equipo1.nombre) : (matchObj.equipo2.discordId || matchObj.equipo2.nombre);
              matchObj.ida.finalizado = true;
              matchObj.completado = true;
            }

            // Registrar resultado global en historial
            torneo.historialResultados.push({
              accion: 'resultado',
              partido: `${val1} vs ${val2} (Global Equipos)`,
              resultado: `${totGL}-${totGV}`,
              tipo: tipo === 'grupo' ? 'grupo' : 'bracket',
              cargadoPor: interaction.user.id,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          if (tipo === 'grupo') {
            const m = torneo.enfrentamientosGrupos.find(x => x.local === val1 && x.visitante === val2);
            if (!m) return interaction.editReply('❌ Partido no encontrado.');
            if (m.completado) return interaction.editReply('⚠️ Ya validado.');
            m.resultado = `${gl}-${gv}`; m.completado = true;
            if (gl > gv) m.ganador = val1; else if (gv > gl) m.ganador = val2; else m.ganador = 'Empate';
            const tL = torneo.equipos.find(eq => eq.nombre === val1); const tV = torneo.equipos.find(eq => eq.nombre === val2);
            if (tL && tV) {
              tL.pj++; tV.pj++; tL.gf += gl; tL.gc += gv; tV.gf += gv; tV.gc += gl;
              if (gl > gv) { tL.pg++; tL.puntos += 3; tV.pp++; }
              else if (gv > gl) { tV.pg++; tV.puntos += 3; tL.pp++; }
              else { tL.pe++; tV.pe++; tL.puntos++; tV.puntos++; }
            }
            pName = `${val1} vs ${val2}`;
            isOverallFinished = true;
          } else {
            ll = torneo.llaves[val1].find(x => x.id === val2);
            if (!ll) return interaction.editReply('❌ Partido no encontrado.');
            if (ll.ganador) return interaction.editReply('⚠️ Ya validado.');

            let matchObj = null;
            if (!tipoMatch || tipoMatch === 'unico' || tipoMatch === 'ida') matchObj = ll.ida;
            else if (tipoMatch === 'vuelta') matchObj = ll.vuelta;
            else if (tipoMatch === 'desempate') matchObj = ll.desempate;

            if (!matchObj || matchObj.finalizado) return interaction.editReply('⚠️ Ya validado.');

            matchObj.golesLocal = gl; matchObj.golesVisitante = gv; matchObj.finalizado = true;
            ll.resultado = `${gl}-${gv}`; // Legacy string

            if (!tipoMatch || tipoMatch === 'unico') {
              if (gl > gv) ll.ganador = ll.equipo1.discordId || ll.equipo1.nombre; else if (gv > gl) ll.ganador = ll.equipo2.discordId || ll.equipo2.nombre; else ll.ganador = ll.equipo1.discordId || ll.equipo1.nombre;
              isOverallFinished = true;
            } else {
              const { determinarGanadorLlave } = await import('../../utils/generarBracket.js');
              const ganador = determinarGanadorLlave(ll);
              if (ganador) {
                ll.ganador = ganador;
                isOverallFinished = true;
              }
            }

            const lName = (tipoMatch === 'vuelta') ? ll.equipo2.nombre : ll.equipo1.nombre;
            const vName = (tipoMatch === 'vuelta') ? ll.equipo1.nombre : ll.equipo2.nombre;
            pName = `${lName} vs ${vName}`;
          }

          // Registrar en historial
          if (!torneo.historialResultados) torneo.historialResultados = [];
          torneo.historialResultados.push({
            accion: 'resultado',
            partido: pName,
            resultado: `${gl}-${gv}`,
            tipo: tipoMatch || 'unico',
            cargadoPor: interaction.user.id,
            timestamp: new Date().toISOString()
          });
        }

        await torneo.save();
        const e = EmbedBuilder.from(interaction.message.embeds[0]).setTitle('✅ Confirmado — Torneo').setDescription(`**${pName}**\nResultado: ${gl} - ${gv}\nValidado por <@${interaction.user.id}>`).setColor('Green');

        let newComponents = interaction.message.components;
        if (isOverallFinished) {
          newComponents = [];
        }

        return interaction.editReply({ content: '', embeds: [e], components: newComponents });
      }

      // Modal Coppa
      if (interaction.customId.startsWith('m_aprv_cop|')) {
        const [, llaveId, tipoMatch] = interaction.customId.split('|');
        const gl = parseInt(interaction.fields.getTextInputValue('gl'));
        const gv = parseInt(interaction.fields.getTextInputValue('gv'));
        if (isNaN(gl) || isNaN(gv)) return interaction.reply({ content: '❌ Goles inválidos.', flags: 64 });

        await interaction.deferUpdate();
        const Coppa = (await import('../../models/copas/Coppa.js')).default;
        const coppa = await Coppa.findOne({ estado: 'EnCurso' });
        if (!coppa) return interaction.editReply('❌ Coppa no encontrada.');

        const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
        const llave = coppa.llaves[faseActual]?.find(l => l.id === llaveId);
        if (!llave) return interaction.editReply('❌ Llave no encontrada.');

        let matchObj = null;
        if (tipoMatch === 'ida') matchObj = llave.ida;
        else if (tipoMatch === 'vuelta') matchObj = llave.vuelta;
        else if (tipoMatch === 'desempate') matchObj = llave.desempate;

        if (!matchObj || matchObj.finalizado) return interaction.editReply('⚠️ Ya validado.');

        matchObj.golesLocal = gl; matchObj.golesVisitante = gv; matchObj.finalizado = true;

        const { determinarGanadorLlave } = await import('../../utils/generarBracket.js');
        const ganador = determinarGanadorLlave(llave, coppa.tipoEncuentro);
        if (ganador) llave.ganador = ganador;

        await coppa.save();
        const lName = tipoMatch === 'vuelta' ? llave.equipo2.nombre : llave.equipo1.nombre;
        const vName = tipoMatch === 'vuelta' ? llave.equipo1.nombre : llave.equipo2.nombre;
        const e = EmbedBuilder.from(interaction.message.embeds[0]).setTitle(`✅ Confirmado — Coppa (${tipoMatch.toUpperCase()})`).setDescription(`**${lName} ${gl} - ${gv} ${vName}**\nValidado por <@${interaction.user.id}>`).setColor('Green');

        let newComponents = interaction.message.components;
        if (llave.ganador) {
          newComponents = [];
        }

        return (
          await interaction.editReply({ content: '', embeds: [e], components: newComponents }),
          await client.channels.fetch(coppa.canalResultados)
            .then(channel => channel.send({ content: '', embeds: [e], components: [] }))
            .catch(() => { })
        );
      }

      if (interaction.customId.startsWith('m_aprv_sl|')) {
        const parts = interaction.customId.split('|');
        const val = parts[1];
        const di = parts[2] ? parseInt(parts[2]) : -1;

        const gl = parseInt(interaction.fields.getTextInputValue('gl'));
        const gv = parseInt(interaction.fields.getTextInputValue('gv'));

        if (isNaN(gl) || isNaN(gv)) {
          return interaction.reply({ content: '❌ Por favor ingresa números válidos para los goles.', flags: 64 });
        }

        await interaction.deferUpdate();

        const Superliga = (await import('../../models/superliga/Superliga.js')).default;
        const Supersupercopa = (await import('../../models/superliga/Supersupercopa.js')).default;
        const liga = await Superliga.findOne({ actual: true });
        const ssc = await Supersupercopa.findOne({ actual: true }) || await Supersupercopa.findOne({ estadoGlobal: 'Activa' });

        let partido = null;
        let esSSC = false;

        if (val.startsWith('sl_')) {
          if (!liga) return interaction.editReply({ content: '❌ No hay temporada activa.' });
          const [, fi, pi] = val.split('_').map(Number);
          const fechaObj = liga.fechas[fi]
          const encuentros = fechaObj.encuentros ?? fechaObj.partidos;
          partido = encuentros?.[pi];
        } else if (val.startsWith('ssc_g_')) {
          if (!ssc) return interaction.editReply({ content: '❌ No hay Supersupercopa activa.' });
          const [, , gi, fi, pi] = val.split('_').map(Number);
          partido = ssc.grupos[gi]?.fechas[fi]?.partidos[pi];
          esSSC = true;
        } else if (val.startsWith('ssc_e_')) {
          if (!ssc) return interaction.editReply({ content: '❌ No hay Supersupercopa activa.' });
          const [, , li, tipo] = val.split('_');
          const llave = ssc.fase === 'semifinales' ? ssc.semifinales[parseInt(li)] : ssc.final;
          partido = llave[tipo];
          esSSC = true;
        }

        if (!partido) return interaction.editReply({ content: '❌ Partido no encontrado.' });

        const duelo = di !== -1 && partido.duelosIndividuales ? partido.duelosIndividuales[di] : null;
        if (duelo && duelo.finalizado) return interaction.editReply({ content: '⚠️ Este minipartido ya fue validado.' });
        if (!duelo && partido.finalizado) return interaction.editReply({ content: '⚠️ Este partido ya fue validado.' });

        let esFinalizacionReciente = false;

        if (duelo) {
          // 1. Actualizar el duelo individual
          duelo.golesLocal = gl;
          duelo.golesVisitante = gv;
          duelo.finalizado = true;

          // 2. Media individual tras cada minipartido
          if (gl !== gv && duelo.localJugadorId && duelo.visitanteJugadorId) {
            const { aplicarCambioMediaDuelo } = await import('../../utils/db/mediaCalculator.js');
            const resMedia = await aplicarCambioMediaDuelo(
              gl > gv ? duelo.localJugadorId : duelo.visitanteJugadorId,
              gl > gv ? duelo.visitanteJugadorId : duelo.localJugadorId,
              Math.max(gl, gv), Math.min(gl, gv)
            );
            if (resMedia) {
              duelo.logMedia = `📈 **${resMedia.ganadorNombre}**: ${resMedia.nuevaMediaGanador} (+${resMedia.delta})\n📉 **${resMedia.perdedorNombre}**: ${resMedia.nuevaMediaPerdedor} (-${resMedia.delta})`;
            }
          }

          // 3. Recalcular agregados del partido (goles totales y minipuntos)
          let pml = 0, pmv = 0, gtl = 0, gtv = 0;
          for (const d of partido.duelosIndividuales) {
            if (d.finalizado) {
              gtl += d.golesLocal; gtv += d.golesVisitante;
              if (d.golesLocal > d.golesVisitante) pml++;
              else if (d.golesVisitante > d.golesLocal) pmv++;
            }
          }

          // Actualizar campos de goles y puntos en el objeto partido
          partido.puntosMiniLocal = pml;
          partido.puntosMiniVisitante = pmv;
          partido.golesTotalLocal = gtl;
          partido.golesTotalVisitante = gtv;

          // Sincronizar campos "golesLocal" y "golesVisitante" (como resultado de la serie)
          partido.golesLocal = pml;
          partido.golesVisitante = pmv;

          if (!partido.resultado) partido.resultado = {};
          partido.resultado.golesLocal = pml;
          partido.resultado.golesVisitante = pmv;

          let necesitaTercerPartidoParaDesempate = false;
          let imposibleRemontar = false;
          if (esSSC && val.startsWith('ssc_e_')) {
            const [, , liStr, tipo] = val.split('_');
            if (tipo === 'vuelta') {
              const llave = ssc.fase === 'semifinales' ? ssc.semifinales[parseInt(liStr)] : ssc.final;
              const globalL = (llave.ida.puntosMiniLocal || 0) + pmv;
              const globalV = (llave.ida.puntosMiniVisitante || 0) + pml;
              const dif = Math.abs(globalL - globalV);
              const duelosJugadosVuelta = pml + pmv;
              const duelosRestantesVuelta = 3 - duelosJugadosVuelta;
              if (duelosRestantesVuelta > 0 && dif <= duelosRestantesVuelta) {
                necesitaTercerPartidoParaDesempate = true;
              }
              if (dif > duelosRestantesVuelta) {
                imposibleRemontar = true;
              }
            }
          }

          const allFinished = partido.duelosIndividuales.every(d => d.finalizado);
          // El partido se liquida si alguien llega a 2 o si se jugaron los 3
          if ((allFinished || imposibleRemontar || ((pml >= 2 || pmv >= 2) && !necesitaTercerPartidoParaDesempate)) && !partido.premiosEntregados) {
            partido.finalizado = true;
            partido.premiosEntregados = true;
            esFinalizacionReciente = true;
          }
        } else {
          // Lógica legacy
          partido.golesLocal = gl;
          partido.golesVisitante = gv;
          partido.puntosMiniLocal = gl > gv ? 1 : 0;
          partido.puntosMiniVisitante = gv > gl ? 1 : 0;
          partido.golesTotalLocal = gl;
          partido.golesTotalVisitante = gv;
          if (!partido.resultado) partido.resultado = {};
          partido.resultado.golesLocal = gl;
          partido.resultado.golesVisitante = gv;
          partido.finalizado = true;
          partido.premiosEntregados = true;
          esFinalizacionReciente = true;
        }

        const allEquipos = await EquipoSuperliga.find({});
        const eqL = allEquipos.find(e => (e._id?.$oid ?? e._id?.toString()) === (partido.localId?.$oid ?? partido.localId?.toString()) || e.nombre === partido.localNombre);
        const eqV = allEquipos.find(e => (e._id?.$oid ?? e._id?.toString()) === (partido.visitanteId?.$oid ?? partido.visitanteId?.toString()) || e.nombre === partido.visitanteNombre);

        // ── Lógica de Premios Económicos (SOLO PARA EL GANADOR DEL SUPRAPARTIDO) ──
        let dineroLocal = 0, dineroVisitante = 0, logPremios = [], logMediaSeries = [];
        if (esFinalizacionReciente) {
          const pml = partido.puntosMiniLocal;
          const pmv = partido.puntosMiniVisitante;

          if (pml > pmv) {
            dineroLocal = (pml * 50_000) + 100_000;
            logPremios.push(`💰 **${eqL?.nombre}**: +$${(dineroLocal / 1000).toFixed(0)}k (Ganador)`);
            logMediaSeries.push(`👔 **Coach ${eqL?.coach?.nombre}**: +0.5 media`);
            logMediaSeries.push(`📈 **Plantilla ${eqL?.nombre}**: +0.2 media`);
            logMediaSeries.push(`📉 **Plantilla ${eqV?.nombre}**: -0.1 media`);
          } else if (pmv > pml) {
            dineroVisitante = (pmv * 50_000) + 100_000;
            logPremios.push(`💰 **${eqV?.nombre}**: +$${(dineroVisitante / 1000).toFixed(0)}k (Ganador)`);
            logMediaSeries.push(`👔 **Coach ${eqV?.coach?.nombre}**: +0.5 media`);
            logMediaSeries.push(`📈 **Plantilla ${eqV?.nombre}**: +0.2 media`);
            logMediaSeries.push(`📉 **Plantilla ${eqL?.nombre}**: -0.1 media`);
          }

          // Premios por avance de fase (SSC) - Solo para el ganador
          if (esSSC && ssc) {
            if (val.startsWith('ssc_e_')) {
              if (ssc.fase === 'semifinales') {
                if (pml > pmv) { dineroLocal += 1_000_000; logPremios.push(`🏆 **${eqL?.nombre}**: +$1M (Final)`); }
                else if (pmv > pml) { dineroVisitante += 1_000_000; logPremios.push(`🏆 **${eqV?.nombre}**: +$1M (Final)`); }
              } else if (ssc.fase === 'final') {
                if (pml > pmv) {
                  dineroLocal += 2_000_000;
                  logPremios.push(`🏆 **${eqL?.nombre}**: +$2M (CAMPEÓN)`);
                  if (eqL) {
                    if (eqL.coach?.media != null) eqL.coach.media = Math.round((eqL.coach.media + 1) * 100) / 100;
                    eqL.jugadores.forEach(j => { j.media = Math.round((j.media + 1) * 100) / 100; });
                    logPremios.push(`📈 **${eqL?.nombre}**: +1 Media a todo el plantel`);
                  }
                } else if (pmv > pml) {
                  dineroVisitante += 2_000_000;
                  logPremios.push(`🏆 **${eqV?.nombre}**: +$2M (CAMPEÓN)`);
                  if (eqV) {
                    if (eqV.coach?.media != null) eqV.coach.media = Math.round((eqV.coach.media + 1) * 100) / 100;
                    eqV.jugadores.forEach(j => { j.media = Math.round((j.media + 1) * 100) / 100; });
                    logPremios.push(`📈 **${eqV?.nombre}**: +1 Media a todo el plantel`);
                  }
                }
              }
            } else if (val.startsWith('ssc_g_')) {
              const parts = val.split('_');
              const gi = Number(parts[2]);
              const grupo = ssc.grupos[gi];
              const grupoTerminado = grupo.fechas.every(f => (f.partidos ?? f.encuentros).every(p => p.finalizado));
              if (grupoTerminado) {
                const stats = {};
                grupo.fechas.forEach(f => (f.partidos ?? f.encuentros).forEach(p => {
                  const lId = p.localId?.$oid ?? p.localId?.toString(), vId = p.visitanteId?.$oid ?? p.visitanteId?.toString();
                  if (!stats[lId]) stats[lId] = { id: lId, pts: 0, dg: 0, gf: 0 };
                  if (!stats[vId]) stats[vId] = { id: vId, pts: 0, dg: 0, gf: 0 };
                  stats[lId].gf += p.puntosMiniLocal || 0; stats[vId].gf += p.puntosMiniVisitante || 0;
                  stats[lId].dg += ((p.puntosMiniLocal || 0) - (p.puntosMiniVisitante || 0));
                  stats[vId].dg += ((p.puntosMiniVisitante || 0) - (p.puntosMiniLocal || 0));
                  if ((p.puntosMiniLocal || 0) > (p.puntosMiniVisitante || 0)) stats[lId].pts += 3;
                  else if ((p.puntosMiniLocal || 0) < (p.puntosMiniVisitante || 0)) stats[vId].pts += 3;
                  else { stats[lId].pts += 1; stats[vId].pts += 1; }
                }));
                const clasificados = Object.values(stats).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf).slice(0, 2);
                for (const clasificado of clasificados) {
                  if (clasificado.id === (eqL?._id?.$oid ?? eqL?._id?.toString())) { dineroLocal += 1_000_000; logPremios.push(`🏆 **${eqL?.nombre}**: +$1M (Semis)`); }
                  else if (clasificado.id === (eqV?._id?.$oid ?? eqV?._id?.toString())) { dineroVisitante += 1_000_000; logPremios.push(`🏆 **${eqV?.nombre}**: +$1M (Semis)`); }
                }
              }
            }
          }
        }

        // BD
        if (eqL) {
          eqL.dinero = (eqL.dinero || 0) + dineroLocal;
          if (esFinalizacionReciente) {
            const pml = partido.puntosMiniLocal, pmv = partido.puntosMiniVisitante;
            if (pml > pmv) {
              if (eqL.coach?.media != null) eqL.coach.media = Math.round((eqL.coach.media + 0.5) * 100) / 100;
              eqL.jugadores.forEach(j => { j.media = Math.round((j.media + 0.2) * 100) / 100; });
            } else if (pml < pmv) eqL.jugadores.forEach(j => { j.media = Math.round((j.media - 0.1) * 100) / 100; });
          }
          await eqL.save();
          if (dineroLocal > 0) await registrarMovimiento(eqL._id?.$oid ?? eqL._id?.toString(), { tipo: 'Premio', monto: dineroLocal, detalle: 'Premios de Partido' });
        }
        if (eqV) {
          eqV.dinero = (eqV.dinero || 0) + dineroVisitante;
          if (esFinalizacionReciente) {
            const pml = partido.puntosMiniLocal, pmv = partido.puntosMiniVisitante;
            if (pmv > pml) {
              if (eqV.coach?.media != null) eqV.coach.media = Math.round((eqV.coach.media + 0.5) * 100) / 100;
              eqV.jugadores.forEach(j => { j.media = Math.round((j.media + 0.2) * 100) / 100; });
            } else if (pmv < pml) eqV.jugadores.forEach(j => { j.media = Math.round((j.media - 0.1) * 100) / 100; });
          }
          await eqV.save();
          if (dineroVisitante > 0) await registrarMovimiento(eqV._id?.$oid ?? eqV._id?.toString(), { tipo: 'Premio', monto: dineroVisitante, detalle: 'Premios de Partido' });
        }

        // ── Lógica de Series SSC (Ida y Vuelta / Desempate) ──
        if (esSSC && ssc && val.startsWith('ssc_e_') && esFinalizacionReciente) {
          const [, , liStr, tipo] = val.split('_');
          const li = parseInt(liStr);
          const llave = ssc.fase === 'semifinales' ? ssc.semifinales[li] : ssc.final;

          if (llave && !llave.finalizado) {
            // Si terminó la vuelta, ver si hay desempate o ganador
            if (tipo === 'vuelta' && llave.ida.finalizado && !llave.desempate) {
              const gL = (llave.ida.puntosMiniLocal || 0) + (llave.vuelta.puntosMiniVisitante || 0);
              const gV = (llave.ida.puntosMiniVisitante || 0) + (llave.vuelta.puntosMiniLocal || 0);

              if (gL === gV) {
                // Empate global -> Crear desempate
                const crearPartido = (lId, vId, lNom, vNom, t) => ({
                  localId: lId, localNombre: lNom,
                  visitanteId: vId, visitanteNombre: vNom,
                  duelosIndividuales: [{
                    localJugadorId: null, localJugadorNombre: null,
                    visitanteJugadorId: null, visitanteJugadorNombre: null,
                    golesLocal: null, golesVisitante: null, finalizado: false
                  }],
                  finalizado: false, puntosMiniLocal: 0, puntosMiniVisitante: 0,
                  golesTotalLocal: 0, golesTotalVisitante: 0, tipo: t
                });

                llave.desempate = crearPartido(llave.ida.localId, llave.ida.visitanteId, llave.ida.localNombre, llave.ida.visitanteNombre, 'Desempate');

                const subChanId = process.env.CANAL_RESULTADOS_SUPERLIGA;
                if (subChanId) {
                  const subChan = await interaction.client.channels.fetch(subChanId).catch(() => null);
                  if (subChan) await subChan.send(`⚔️ **¡Empate en la serie!** Se ha generado un partido de **Desempate** entre **${llave.ida.localNombre}** y **${llave.ida.visitanteNombre}**.`);
                }
              } else {
                // Hay ganador por puntos
                llave.ganadorId = gL > gV ? llave.ida.localId : llave.ida.visitanteId;
                llave.finalizado = true;
              }
            } else if (tipo === 'desempate' || (tipo === 'vuelta' && llave.desempate)) {
              // Si terminó el desempate, el ganador del desempate gana la serie
              const p = llave.desempate;
              if (p.finalizado) {
                llave.ganadorId = (p.puntosMiniLocal > p.puntosMiniVisitante) ? p.localId : p.visitanteId;
                llave.finalizado = true;
              }
            } else if (tipo === 'ida' && !llave.vuelta) {
              // No debería pasar si se crean juntos, pero por seguridad
            }
          }
        }

        let logSanciones = [];
        // ── Lógica de Fin de Fecha para Superliga (Reducir suspensiones) ──
        if (!esSSC && liga && esFinalizacionReciente) {
          const parts = val.split('_');
          const fi = parseInt(parts[1]);
          const fechaObj = liga.fechas[fi];
          if (fechaObj) {
            const encuentros = fechaObj.partidos ?? fechaObj.encuentros;
            const fechaTerminada = encuentros.every(p => p.finalizado);
            if (fechaTerminada && !fechaObj.suspensionesProcesadas) {
              const equiposAll = await EquipoSuperliga.find({});
              for (const eq of equiposAll) {
                let eqUpdated = false;
                for (const j of eq.jugadores) {
                  if (j.suspendido && j.suspendido > 0) {
                    j.suspendido--;
                    if (j.suspendido < 0) j.suspendido = 0;
                    eqUpdated = true;
                    logSanciones.push(`🛡️ **${j.nombre}** (${eq.nombre}): -1 fecha de sanción (Restan: ${j.suspendido})`);
                  }
                }
                if (eqUpdated) await eq.save();
              }
              fechaObj.suspensionesProcesadas = true;
            }
          }
        }

        if (esSSC && ssc) await ssc.save(); else if (liga) await liga.save();

        let titleStr = '';
        let descStr = '';

        if (duelo) {
          titleStr = `✅ Resultado Validado (Mini ${di + 1})`;
          const localN = duelo.localJugadorNombre || partido.localNombre;
          const visitN = duelo.visitanteJugadorNombre || partido.visitanteNombre;
          descStr = `**${localN} ${gl} - ${gv} ${visitN}**\n\n`;

          if (duelo.logMedia) {
            descStr += `📊 **Media del Duelo:**\n${duelo.logMedia}\n\n`;
          }

          if (partido.finalizado) {
            descStr += `🏁 **Serie Finalizada:**\n**${eqL?.nombre} ${partido.puntosMiniLocal} - ${partido.puntosMiniVisitante} ${eqV?.nombre}**\n\n`;
            if (logMediaSeries.length) {
              descStr += `📈 **Progresión de Equipo:**\n${logMediaSeries.join('\n')}\n\n`;
            }
          }
        } else {
          titleStr = '✅ Resultado Validado';
          descStr = `**${eqL?.nombre} ${gl} - ${gv} ${eqV?.nombre}**\n\n`;
        }

        if (logPremios.length) {
          descStr += `💸 **Premios Económicos:**\n${logPremios.join('\n')}\n\n`;
        }

        if (logSanciones.length) {
          descStr += `⚖️ **Actualización de Sanciones (Fin de Fecha):**\n${logSanciones.join('\n')}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle(titleStr)
          .setDescription(descStr)
          .setColor('#2ecc71')
          .setTimestamp();

        await interaction.editReply({ content: '✅ Resultado procesado.', embeds: [embed] });

        // Enviar notificación al canal de envíos
        const submissionChanId = process.env.CANAL_RESULTADOS_SUPERLIGA;
        if (submissionChanId) {
          const subChan = await interaction.client.channels.fetch(submissionChanId).catch(() => null);
          if (subChan) {
            await subChan.send({ content: `📢 **Actualización de Torneo:**`, embeds: [embed] });
          }
        }
      }
    }
  }
};
