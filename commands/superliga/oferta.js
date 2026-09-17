import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import { parseCurrency } from '../../utils/db/currencyHelper.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

export default {
  name: 'superliga-oferta',
  aliases: ['sl-oferta', 'slo'],
  desc: 'Envía una oferta por un jugador a otro club',

  run: async (client, message, args) => {
    // 1. Validar coach
    const allEquipos = await EquipoSuperliga.find({});
    const miEquipo = allEquipos.find(e => e.coach.id === message.author.id);
    if (!miEquipo) return message.reply('❌ No eres coach de ningún equipo.');

    // 2. Parsear argumentos
    const userMention = message.mentions.users.first();
    const montoArg = args.find(arg => !arg.startsWith('<@'));
    
    if (!userMention || !montoArg) {
      return message.reply('❌ Uso: `!sl-oferta <@jugador> <monto>` (ej: 1.5M, 500k)');
    }

    const monto = parseCurrency(montoArg);
    if (monto === null || monto <= 0) {
      return message.reply('❌ Monto inválido. Usá números planos o sufijos (M, K).');
    }
    if (miEquipo.dinero < monto) {
      return message.reply(`❌ No tienes suficiente dinero (Saldo: $${miEquipo.dinero.toLocaleString()}).`);
    }

    // 3. Buscar jugador y su equipo
    const targetId = userMention.id;
    const equipoVendedor = allEquipos.find(e => e.jugadores.some(j => j.id === targetId));
    if (!equipoVendedor) {
      return message.reply('❌ Ese jugador no pertenece a ningún equipo (usa `!sl-contratar` si es libre).');
    }

    if (equipoVendedor.coach.id === message.author.id) {
      return message.reply('❌ No puedes hacerte una oferta a ti mismo.');
    }

    const jugador = equipoVendedor.jugadores.find(j => j.id === targetId);
    const coachVendedor = await client.users.fetch(equipoVendedor.coach.id).catch(() => null);

    if (!coachVendedor) return message.reply('❌ No se pudo contactar al coach del equipo vendedor.');

    // 4. Enviar propuesta al coach vendedor
    const embedOferta = new EmbedBuilder()
      .setTitle('💰 Nueva Oferta de Transferencia')
      .setDescription(
        `El equipo **${miEquipo.nombre}** ha enviado una oferta por **${jugador.nombre}**.\n\n` +
        `**Monto ofrecido:** $${monto.toLocaleString()}\n` +
        `**Tu saldo actual:** $${equipoVendedor.dinero.toLocaleString()}`
      )
      .setColor('#f1c40f')
      .setTimestamp();

    const rowOferta = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('acc_coach').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('edit_coach').setLabel('✏️ Contraoferta').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('rej_coach').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
    );

    const msgVendedor = await coachVendedor.send({ embeds: [embedOferta], components: [rowOferta] }).catch(() => null);
    if (!msgVendedor) return message.reply('❌ El coach del equipo vendedor tiene los DMs cerrados.');

    message.reply(`✅ Oferta enviada al coach de **${equipoVendedor.nombre}**. Tienen 2 horas para responder.`);

    const filterCoach = i => ['acc_coach', 'edit_coach', 'rej_coach'].includes(i.customId);
    const collectorCoach = msgVendedor.createMessageComponentCollector({ filter: filterCoach, time: 7200000 }); // 2 horas

    collectorCoach.on('collect', async iC => {
      if (iC.customId === 'rej_coach') {
        await iC.update({ content: '❌ Has rechazado la oferta.', embeds: [], components: [] });
        await message.author.send(`❌ El equipo **${equipoVendedor.nombre}** ha rechazado tu oferta por **${jugador.nombre}**.`).catch(() => {});
        return collectorCoach.stop();
      }

      if (iC.customId === 'edit_coach') {
        const modal = new ModalBuilder().setCustomId('m_contra').setTitle('Contraoferta');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nuevo_monto').setLabel('Monto pretendido').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        await iC.showModal(modal);
        
        const sub = await iC.awaitModalSubmit({ time: 60000 }).catch(() => null);
        if (!sub) return;

        const montoInput = sub.fields.getTextInputValue('nuevo_monto');
        const nuevoMonto = parseCurrency(montoInput);
        if (nuevoMonto === null || nuevoMonto <= 0) return sub.reply({ content: '❌ Monto inválido.', flags: 64 });

        await sub.reply({ content: `✅ Contraoferta enviada por $${nuevoMonto.toLocaleString()}. Esperando respuesta del comprador...`, flags: 64 });
        
        // Lógica de negociación recursiva
        const manejarPropuesta = async (montoPropuesto, emisorId, receptorId, esVendedor) => {
          const receptorUser = await client.users.fetch(receptorId).catch(() => null);
          const emisorUser = await client.users.fetch(emisorId).catch(() => null);
          if (!receptorUser || !emisorUser) return;

          const embed = new EmbedBuilder()
            .setTitle(esVendedor ? '✏️ Contraoferta Recibida' : '💰 Oferta Recibida')
            .setDescription(
              `El equipo **${esVendedor ? equipoVendedor.nombre : miEquipo.nombre}** propone **$${montoPropuesto.toLocaleString()}** por **${jugador.nombre}**.`
            )
            .setColor(esVendedor ? '#3498db' : '#f1c40f')
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('acc_neg').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('edit_neg').setLabel('✏️ Re-negociar').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rej_neg').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
          );

          const msgNeg = await receptorUser.send({ embeds: [embed], components: [row] }).catch(() => null);
          if (!msgNeg) {
            return emisorUser.send(`❌ No se pudo contactar al otro coach. Negociación cancelada.`);
          }

          const coll = msgNeg.createMessageComponentCollector({ time: 7200000 });
          coll.on('collect', async iN => {
            if (iN.customId === 'rej_neg') {
              await iN.update({ content: '❌ Has rechazado la propuesta.', embeds: [], components: [] });
              await emisorUser.send(`❌ La negociación por **${jugador.nombre}** ha sido rechazada por el otro equipo.`).catch(() => {});
              return coll.stop();
            }

            if (iN.customId === 'acc_neg') {
              await iN.update({ content: `✅ Has aceptado la propuesta de $${montoPropuesto.toLocaleString()}.`, components: [] });
              await emisorUser.send(`✅ ¡Acuerdo alcanzado! Se ha aceptado el monto de **$${montoPropuesto.toLocaleString()}**.`).catch(() => {});
              
              // Si se llega a un acuerdo, procedemos a la confirmación del jugador
              return iniciarConfirmacionJugador(montoPropuesto);
            }

            if (iN.customId === 'edit_neg') {
              const modalN = new ModalBuilder().setCustomId('m_neg').setTitle('Nueva Propuesta');
              modalN.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('m_val').setLabel('Nuevo monto (ej: 1M, 500k)').setStyle(TextInputStyle.Short).setRequired(true)
              ));
              await iN.showModal(modalN);
              const subN = await iN.awaitModalSubmit({ time: 60000 }).catch(() => null);
              if (!subN) return;

              const valInput = subN.fields.getTextInputValue('m_val');
              const val = parseCurrency(valInput);
              if (val === null || val <= 0) return subN.reply({ content: '❌ Monto inválido.', flags: 64 });

              await subN.reply({ content: `✅ Propuesta enviada por $${val.toLocaleString()}.`, flags: 64 });
              coll.stop();
              return manejarPropuesta(val, receptorId, emisorId, !esVendedor);
            }
          });
        };

        const iniciarConfirmacionJugador = async (montoFinal) => {
          // 5. Enviar propuesta al jugador
          const embedJugador = new EmbedBuilder()
            .setTitle('🚀 Propuesta de Contrato')
            .setDescription(
              `El equipo **${miEquipo.nombre}** quiere contratarte.\n\n` +
              `**Club actual:** ${equipoVendedor.nombre}\n` +
              `**Monto de transferencia:** $${montoFinal.toLocaleString()}\n` +
              `Ambos clubes han llegado a un acuerdo. ¿Quieres unirte a este equipo?`
            )
            .setColor('#3498db');

          const rowJugador = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('acc_jug').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rej_jug').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
          );

          const targetUser = await client.users.fetch(targetId).catch(() => null);
          const msgJugador = await targetUser?.send({ embeds: [embedJugador], components: [rowJugador] }).catch(() => null);

          if (!msgJugador) {
            await message.author.send('❌ El jugador tiene los DMs cerrados. Operación cancelada.').catch(() => {});
            return;
          }

          const collectorJug = msgJugador.createMessageComponentCollector({ time: 7200000 });

          collectorJug.on('collect', async iJ => {
            if (iJ.customId === 'rej_jug') {
              await iJ.update({ content: '❌ Has rechazado el contrato.', embeds: [], components: [] });
              await coachVendedor.send(`❌ **${jugador.nombre}** ha rechazado el contrato con **${miEquipo.nombre}**.`).catch(() => {});
              await message.author.send(`❌ **${jugador.nombre}** ha rechazado unirse a tu equipo.`).catch(() => {});
              return collectorJug.stop();
            }

            if (iJ.customId === 'acc_jug') {
              // 6. Ejecutar transferencia (con el montoFinal)
              const freshEquipos = await EquipoSuperliga.find({});
              const comp = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (miEquipo._id?.$oid ?? miEquipo._id));
              const vend = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (equipoVendedor._id?.$oid ?? equipoVendedor._id));
              
              if (comp.dinero < montoFinal) {
                return iJ.update({ content: '❌ El club comprador ya no tiene fondos suficientes.', components: [] });
              }

              const jugIndex = vend.jugadores.findIndex(j => j.id === targetId);
              const jugData = vend.jugadores.splice(jugIndex, 1)[0];
              
              comp.dinero -= montoFinal;
              vend.dinero += montoFinal;
              
              jugData.contrato = 1;
              comp.jugadores.push(jugData);
              await ensureUserRegistered(jugData.id, client);

              await comp.save();
              await vend.save();

              await registrarMovimiento(comp._id?.$oid ?? comp._id, {
                tipo: 'Alta', jugador: jugData.nombre, jugadorId: jugData.id,
                monto: montoFinal, equipoRelacionado: vend.nombre, detalle: 'Compra de jugador'
              });
              await registrarMovimiento(vend._id?.$oid ?? vend._id, {
                tipo: 'Baja', jugador: jugData.nombre, jugadorId: jugData.id,
                monto: montoFinal, equipoRelacionado: comp.nombre, detalle: 'Venta de jugador'
              });

              await iJ.update({ content: `✅ ¡Felicidades! Ahora eres parte de **${comp.nombre}**.`, embeds: [], components: [] });
              await coachVendedor.send(`✅ Traspaso completado: **${jugData.nombre}** se ha unido a **${comp.nombre}** por $${montoFinal.toLocaleString()}.`).catch(() => {});
              await message.author.send(`✅ ¡Traspaso exitoso! **${jugData.nombre}** ya es parte de tu plantilla.`).catch(() => {});

              const approvalChan = await client.channels.fetch(process.env.CANAL_APROBACION).catch(() => null);
              if (approvalChan) {
                const logEmbed = new EmbedBuilder()
                  .setTitle('📢 Mercado: Transferencia Completada')
                  .setDescription(`**Jugador:** ${jugData.nombre} (<@${jugData.id}>)\n**Origen:** ${vend.nombre}\n**Destino:** ${comp.nombre}\n**Monto:** $${montoFinal.toLocaleString()}`)
                  .setColor('#2ecc71').setTimestamp();
                approvalChan.send({ embeds: [logEmbed] });
              }
              collectorJug.stop();
            }
          });
        };

        // Iniciar el ciclo de contraoferta hacia el comprador
        return manejarPropuesta(nuevoMonto, coachVendedor.id, message.author.id, true);
      }

      if (iC.customId === 'acc_coach') {
        await iC.update({ content: '⏳ Has aceptado la oferta. Ahora el jugador debe confirmar el traspaso.', components: [] });
        
        // 5. Enviar propuesta al jugador (directo si aceptó la oferta inicial)
        const iniciarConfirmacionJugador = async (montoFinal) => {
          const embedJugador = new EmbedBuilder()
            .setTitle('🚀 Propuesta de Contrato')
            .setDescription(
              `El equipo **${miEquipo.nombre}** quiere contratarte.\n\n` +
              `**Club actual:** ${equipoVendedor.nombre}\n` +
              `**Monto de transferencia:** $${montoFinal.toLocaleString()}\n` +
              `Tu coach ya ha aceptado la oferta. ¿Quieres unirte a este equipo?`
            )
            .setColor('#3498db');

          const rowJugador = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('acc_jug').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rej_jug').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
          );

          const targetUser = await client.users.fetch(targetId).catch(() => null);
          const msgJugador = await targetUser?.send({ embeds: [embedJugador], components: [rowJugador] }).catch(() => null);

          if (!msgJugador) {
            await message.author.send('❌ El jugador tiene los DMs cerrados. Operación cancelada.').catch(() => {});
            return;
          }

          const collectorJug = msgJugador.createMessageComponentCollector({ time: 7200000 });

          collectorJug.on('collect', async iJ => {
            if (iJ.customId === 'rej_jug') {
              await iJ.update({ content: '❌ Has rechazado el contrato.', embeds: [], components: [] });
              await coachVendedor.send(`❌ **${jugador.nombre}** ha rechazado el contrato con **${miEquipo.nombre}**.`).catch(() => {});
              await message.author.send(`❌ **${jugador.nombre}** ha rechazado unirse a tu equipo.`).catch(() => {});
              return collectorJug.stop();
            }

            if (iJ.customId === 'acc_jug') {
              const freshEquipos = await EquipoSuperliga.find({});
              const comp = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (miEquipo._id?.$oid ?? miEquipo._id));
              const vend = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (equipoVendedor._id?.$oid ?? equipoVendedor._id));
              
              if (comp.dinero < montoFinal) {
                return iJ.update({ content: '❌ El club comprador ya no tiene fondos suficientes.', components: [] });
              }

              const jugIndex = vend.jugadores.findIndex(j => j.id === targetId);
              const jugData = vend.jugadores.splice(jugIndex, 1)[0];
              
              comp.dinero -= montoFinal;
              vend.dinero += montoFinal;
              
              jugData.contrato = 1;
              comp.jugadores.push(jugData);
              await ensureUserRegistered(jugData.id, client);

              await comp.save();
              await vend.save();

              await registrarMovimiento(comp._id?.$oid ?? comp._id, {
                tipo: 'Alta', jugador: jugData.nombre, jugadorId: jugData.id,
                monto: montoFinal, equipoRelacionado: vend.nombre, detalle: 'Compra de jugador'
              });
              await registrarMovimiento(vend._id?.$oid ?? vend._id, {
                tipo: 'Baja', jugador: jugData.nombre, jugadorId: jugData.id,
                monto: montoFinal, equipoRelacionado: comp.nombre, detalle: 'Venta de jugador'
              });

              await iJ.update({ content: `✅ ¡Felicidades! Ahora eres parte de **${comp.nombre}**.`, embeds: [], components: [] });
              await coachVendedor.send(`✅ Traspaso completado: **${jugData.nombre}** se ha unido a **${comp.nombre}** por $${montoFinal.toLocaleString()}.`).catch(() => {});
              await message.author.send(`✅ ¡Traspaso exitoso! **${jugData.nombre}** ya es parte de tu plantilla.`).catch(() => {});

              const approvalChan = await client.channels.fetch(process.env.CANAL_APROBACION).catch(() => null);
              if (approvalChan) {
                const logEmbed = new EmbedBuilder()
                  .setTitle('📢 Mercado: Transferencia Completada')
                  .setDescription(`**Jugador:** ${jugData.nombre} (<@${jugData.id}>)\n**Origen:** ${vend.nombre}\n**Destino:** ${comp.nombre}\n**Monto:** $${montoFinal.toLocaleString()}`)
                  .setColor('#2ecc71').setTimestamp();
                approvalChan.send({ embeds: [logEmbed] });
              }
              collectorJug.stop();
            }
          });
        };
        
        return iniciarConfirmacionJugador(monto);
      }
    });
  }
};
