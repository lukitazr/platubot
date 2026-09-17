import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} from 'discord.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

export default {
  name: 'superliga-prestamo',
  aliases: ['sl-prestamo', 'slp'],
  desc: 'Envía una propuesta de préstamo por un jugador',

  run: async (client, message, args) => {
    // 1. Validar coach emisor
    const allEquipos = await EquipoSuperliga.find({});
    const miEquipo = allEquipos.find(e => e.coach.id === message.author.id);
    if (!miEquipo) return message.reply('❌ No eres coach de ningún equipo.');

    const userMention = message.mentions.users.first();
    const tempsStr = args.find(arg => /^\d+$/.test(arg));

    if (!userMention || !tempsStr) {
      return message.reply('❌ Uso: `!sl-prestamo <@jugador> <temporadas>`');
    }

    const temporadas = parseInt(tempsStr);
    const targetId = userMention.id;

    // 2. Buscar jugador y equipo dueño
    const equipoDueno = allEquipos.find(e => e.jugadores.some(j => j.id === targetId));
    if (!equipoDueno) return message.reply('❌ Ese jugador no pertenece a ningún equipo.');

    if (equipoDueno.coach.id === message.author.id) {
      return message.reply('❌ No puedes pedir prestado un jugador de tu propio equipo.');
    }

    const jugador = equipoDueno.jugadores.find(j => j.id === targetId);
    const coachDueno = await client.users.fetch(equipoDueno.coach.id).catch(() => null);

    if (!coachDueno) return message.reply('❌ No se pudo contactar al coach del equipo dueño.');

    // 3. Enviar propuesta al coach dueño
    const embedPropuesta = new EmbedBuilder()
      .setTitle('🤝 Propuesta de Préstamo')
      .setDescription(
        `El equipo **${miEquipo.nombre}** solicita a **${jugador.nombre}** en préstamo.\n\n` +
        `**Duración:** ${temporadas} temporada(s)\n` +
        `**Condiciones:** El club receptor pagará el 100% del sueldo durante el préstamo.`
      )
      .setColor('#9b59b6')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('acc_prestamo').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rej_prestamo').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
    );

    const msgCoach = await coachDueno.send({ embeds: [embedPropuesta], components: [row] }).catch(() => null);
    if (!msgCoach) return message.reply('❌ El coach del equipo dueño tiene los DMs cerrados.');

    message.reply(`✅ Propuesta de préstamo enviada al coach de **${equipoDueno.nombre}**.`);

    const collector = msgCoach.createMessageComponentCollector({ componentType: ComponentType.Button, time: 7200000 });

    collector.on('collect', async i => {
      await i.deferUpdate();

      if (i.customId === 'rej_prestamo') {
        await i.editReply({ content: '❌ Has rechazado la propuesta de préstamo.', embeds: [], components: [] });
        await message.author.send(`❌ **${equipoDueno.nombre}** ha rechazado tu propuesta de préstamo por **${jugador.nombre}**.`).catch(() => {});
        return collector.stop();
      }

      // 4. Ejecutar préstamo
      const freshEquipos = await EquipoSuperliga.find({});
      const rec = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (miEquipo._id?.$oid ?? miEquipo._id));
      const due = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (equipoDueno._id?.$oid ?? equipoDueno._id));

      const jugIndex = due.jugadores.findIndex(j => j.id === targetId);
      const jugData = due.jugadores.splice(jugIndex, 1)[0];

      // Guardar info del préstamo
      jugData.prestadoDe = {
        equipoId: due._id?.$oid ?? due._id,
        equipoNombre: due.nombre,
        temporadasRestantes: temporadas,
        contratoOriginal: jugData.contrato || 1
      };

      rec.jugadores.push(jugData);
      await ensureUserRegistered(jugData.id, client);

      await rec.save();
      await due.save();

      // Registrar movimientos
      await registrarMovimiento(rec._id?.$oid ?? rec._id, {
        tipo: 'Préstamo',
        jugador: jugData.nombre,
        jugadorId: jugData.id,
        equipoRelacionado: due.nombre,
        detalle: `Llega a préstamo por ${temporadas} temporada(s)`
      });
      await registrarMovimiento(due._id?.$oid ?? due._id, {
        tipo: 'Préstamo',
        jugador: jugData.nombre,
        jugadorId: jugData.id,
        equipoRelacionado: rec.nombre,
        detalle: `Sale a préstamo por ${temporadas} temporada(s)`
      });

      await i.editReply({ content: `✅ Has aceptado el préstamo de **${jugData.nombre}** a **${rec.nombre}**.`, embeds: [], components: [] });
      await message.author.send(`✅ ¡Propuesta aceptada! **${jugData.nombre}** ya está en tu plantilla a préstamo.`).catch(() => {});

      // Notificación al canal de aprobaciones
      const approvalChan = await client.channels.fetch(process.env.CANAL_APROBACION).catch(() => null);
      if (approvalChan) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📢 Mercado: Nuevo Préstamo')
          .setDescription(
            `**Jugador:** ${jugData.nombre} (<@${jugData.id}>)\n` +
            `**Origen:** ${due.nombre}\n` +
            `**Destino:** ${rec.nombre}\n` +
            `**Duración:** ${temporadas} temporada(s)`
          )
          .setColor('#9b59b6')
          .setTimestamp();
        approvalChan.send({ embeds: [logEmbed] });
      }

      collector.stop();
    });
  }
};
