import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} from 'discord.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import JugadorLibre from '../../models/superliga/JugadoresLibres.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import { calcularValorJugador } from '../../utils/db/mediaCalculator.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

export default {
  name: 'superliga-contratar',
  aliases: ['sl-contratar', 'slc'],
  desc: 'Contrata a un jugador libre o ejecuta una cláusula de rescisión',

  run: async (client, message, args) => {
    // 1. Validar coach
    const allEquipos = await EquipoSuperliga.find({});
    const miEquipo = allEquipos.find(e => e.coach.id === message.author.id);
    if (!miEquipo) return message.reply('❌ No eres coach de ningún equipo.');

    const userMention = message.mentions.users.first();
    if (!userMention) return message.reply('❌ Uso: `!sl-contratar <@jugador>`');

    const targetId = userMention.id;
    let targetJugador = null;
    let equipoOrigen = null;
    let esLibre = false;
    let monto = 0;

    // 2. Buscar en Agentes Libres
    const libres = await JugadorLibre.find({});
    const libreIndex = libres.findIndex(l => l.id === targetId);
    
    if (libreIndex !== -1) {
      targetJugador = libres[libreIndex];
      esLibre = true;
      monto = targetJugador.valor || calcularValorJugador(targetJugador.media);
    } else {
      // 3. Buscar en Equipos (Cláusula)
      equipoOrigen = allEquipos.find(e => e.jugadores.some(j => j.id === targetId));
      if (equipoOrigen) {
        const jug = equipoOrigen.jugadores.find(j => j.id === targetId);
        if (jug.clausula && (jug.clausula.tipo === 'dinero' || jug.clausula.monto)) {
          targetJugador = jug;
          monto = parseInt(jug.clausula.valor || jug.clausula.monto);
        } else {
          return message.reply('❌ Este jugador no es libre ni tiene una cláusula de rescisión activa.');
        }
      }
    }

    if (!targetJugador) {
      return message.reply('❌ No se encontró al jugador o no está disponible para contratación directa.');
    }

    if (miEquipo.dinero < monto) {
      return message.reply(`❌ No tienes suficiente dinero ($${miEquipo.dinero.toLocaleString()} < $${monto.toLocaleString()}).`);
    }

    // 4. Confirmación al jugador
    const embedConfirm = new EmbedBuilder()
      .setTitle('📝 Oferta de Contrato Directo')
      .setDescription(
        `El equipo **${miEquipo.nombre}** quiere contratarte directamente.\n\n` +
        `**Monto:** $${monto.toLocaleString()}\n` +
        `**Tipo:** ${esLibre ? 'Agente Libre' : 'Cláusula de Rescisión'}\n\n` +
        `¿Aceptas unirte a este equipo?`
      )
      .setColor('#2ecc71')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('acc_contrato').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rej_contrato').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
    );

    const targetUser = await client.users.fetch(targetId).catch(() => null);
    const msgJugador = await targetUser?.send({ embeds: [embedConfirm], components: [row] }).catch(() => null);

    if (!msgJugador) return message.reply('❌ El jugador tiene los DMs cerrados.');

    message.reply(`✅ Propuesta enviada a **${targetJugador.nombre}**. Esperando respuesta...`);

    const collector = msgJugador.createMessageComponentCollector({ componentType: ComponentType.Button, time: 7200000 });

    collector.on('collect', async i => {
      await i.deferUpdate();

      if (i.customId === 'rej_contrato') {
        await i.editReply({ content: '❌ Has rechazado el contrato.', embeds: [], components: [] });
        await message.author.send(`❌ **${targetJugador.nombre}** ha rechazado tu oferta de contrato.`).catch(() => {});
        return collector.stop();
      }

      // 5. Ejecutar contratación
      const freshEquipos = await EquipoSuperliga.find({});
      const comp = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (miEquipo._id?.$oid ?? miEquipo._id));
      
      if (comp.dinero < monto) {
          return i.editReply({ content: '❌ El club ya no tiene fondos suficientes.', components: [] });
      }

      let jugData = null;

      if (esLibre) {
        jugData = await JugadorLibre.findOne({ id: targetId });
        if (!jugData) return i.editReply({ content: '❌ El jugador ya no está disponible en agentes libres.', components: [] });
        await JugadorLibre.deleteOne({ id: targetId });
      } else {
        const orig = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (equipoOrigen._id?.$oid ?? equipoOrigen._id));
        const idx = orig.jugadores.findIndex(j => j.id === targetId);
        jugData = orig.jugadores.splice(idx, 1)[0];
        orig.dinero += monto;
        await orig.save();
        
        await registrarMovimiento(orig._id?.$oid ?? orig._id, {
            tipo: 'Baja',
            jugador: jugData.nombre,
            jugadorId: jugData.id,
            monto: monto,
            equipoRelacionado: comp.nombre,
            detalle: 'Cláusula de rescisión ejecutada'
        });
      }

      comp.dinero -= monto;
      jugData.contrato = 1; // Contrato por defecto
      comp.jugadores.push(jugData);
      await ensureUserRegistered(jugData.id, client);
      await comp.save();

      await registrarMovimiento(comp._id?.$oid ?? comp._id, {
        tipo: 'Alta',
        jugador: jugData.nombre,
        jugadorId: jugData.id,
        monto: monto,
        equipoRelacionado: esLibre ? 'Agente Libre' : equipoOrigen.nombre,
        detalle: esLibre ? 'Contratación de agente libre' : 'Cláusula de rescisión ejecutada'
      });

      await i.editReply({ content: `✅ ¡Felicidades! Ahora eres parte de **${comp.nombre}**.`, embeds: [], components: [] });
      await message.author.send(`✅ ¡Contratación exitosa! **${jugData.nombre}** se ha unido a tu plantilla.`).catch(() => {});

      // Notificación al canal de aprobaciones
      const approvalChan = await client.channels.fetch(process.env.CANAL_APROBACION).catch(() => null);
      if (approvalChan) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📢 Mercado: Nueva Contratación')
          .setDescription(
            `**Jugador:** ${jugData.nombre} (<@${jugData.id}>)\n` +
            `**Destino:** ${comp.nombre}\n` +
            `**Monto:** $${monto.toLocaleString()}\n` +
            `**Origen:** ${esLibre ? 'Agente Libre' : equipoOrigen.nombre}`
          )
          .setColor('#27ae60')
          .setTimestamp();
        approvalChan.send({ embeds: [logEmbed] });
      }

      collector.stop();
    });
  }
};
