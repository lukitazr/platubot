import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType,
  StringSelectMenuBuilder
} from 'discord.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import buscarEquipo from '../../utils/db/buscarEquipo.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

export default {
  name: 'superliga-intercambio',
  aliases: ['sl-intercambio', 'sli'],
  desc: 'Propone un intercambio de jugadores con otro club',

  run: async (client, message, args) => {
    // 1. Validar coach ejecutor
    const allEquipos = await EquipoSuperliga.find({});
    const miEquipo = allEquipos.find(e => e.coach.id === message.author.id);
    if (!miEquipo) return message.reply('❌ No eres coach de ningún equipo.');

    const query = args.join(' ');
    if (!query) return message.reply('❌ Uso: `!sl-intercambio <nombre_equipo>`');

    // 2. Buscar equipo objetivo
    const resultado = await buscarEquipo(query, EquipoSuperliga);
    if (typeof resultado === 'string') return message.reply(resultado);
    const equipoObjetivo = resultado;

    if (equipoObjetivo.coach.id === message.author.id) {
      return message.reply('❌ No puedes intercambiar jugadores con tu propio equipo.');
    }

    if (equipoObjetivo.jugadores.length === 0) {
      return message.reply(`❌ El equipo **${equipoObjetivo.nombre}** no tiene jugadores.`);
    }

    // 3. Menú para elegir jugador del equipo objetivo
    const selectObjetivo = new StringSelectMenuBuilder()
      .setCustomId('swap_target')
      .setPlaceholder(`Elegí el jugador de ${equipoObjetivo.nombre} que querés`)
      .addOptions(equipoObjetivo.jugadores.map(j => ({ label: j.nombre, value: j.id })));

    const mSelect1 = await message.reply({
      content: `🔄 **Intercambio con ${equipoObjetivo.nombre}**\nSeleccioná el jugador que deseás obtener:`,
      components: [new ActionRowBuilder().addComponents(selectObjetivo)]
    });

    const filter = i => i.user.id === message.author.id;
    const resp1 = await mSelect1.awaitMessageComponent({ filter, componentType: ComponentType.StringSelect, time: 60000 }).catch(() => null);
    if (!resp1) return mSelect1.edit({ content: '❌ Tiempo agotado.', components: [] });

    const targetJugId = resp1.values[0];
    const targetJug = equipoObjetivo.jugadores.find(j => j.id === targetJugId);

    // 4. Menú para elegir jugador propio
    const selectPropio = new StringSelectMenuBuilder()
      .setCustomId('swap_own')
      .setPlaceholder('Elegí el jugador de tu equipo que ofrecés')
      .addOptions(miEquipo.jugadores.map(j => ({ label: j.nombre, value: j.id })));

    await resp1.update({
      content: `🔄 **Intercambio: ${miEquipo.nombre} ⟷ ${equipoObjetivo.nombre}**\nQuerés a: **${targetJug.nombre}**\nSeleccioná el jugador que ofrecés a cambio:`,
      components: [new ActionRowBuilder().addComponents(selectPropio)]
    });

    const resp2 = await mSelect1.awaitMessageComponent({ filter, componentType: ComponentType.StringSelect, time: 60000 }).catch(() => null);
    if (!resp2) return mSelect1.edit({ content: '❌ Tiempo agotado.', components: [] });

    const ownJugId = resp2.values[0];
    const ownJug = miEquipo.jugadores.find(j => j.id === ownJugId);

    await resp2.update({ content: `⏳ Propuesta enviada al coach de **${equipoObjetivo.nombre}**.`, components: [] });

    // 5. Enviar propuesta al coach objetivo
    const coachObjetivo = await client.users.fetch(equipoObjetivo.coach.id).catch(() => null);
    if (!coachObjetivo) return message.reply('❌ No se pudo contactar al coach del equipo objetivo.');

    const embedSwap = new EmbedBuilder()
      .setTitle('🔄 Propuesta de Intercambio')
      .setDescription(
        `El equipo **${miEquipo.nombre}** propone un intercambio:\n\n` +
        `📤 **Ofrece:** ${ownJug.nombre} (<@${ownJug.id}>)\n` +
        `📥 **Pide:** ${targetJug.nombre} (<@${targetJug.id}>)`
      )
      .setColor('#e67e22')
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('acc_swap').setLabel('✅ Aceptar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rej_swap').setLabel('❌ Rechazar').setStyle(ButtonStyle.Danger)
    );

    const msgCoach = await coachObjetivo.send({ embeds: [embedSwap], components: [row] }).catch(() => null);
    if (!msgCoach) return message.channel.send(`❌ El coach de **${equipoObjetivo.nombre}** tiene los DMs cerrados.`);

    const collector = msgCoach.createMessageComponentCollector({ componentType: ComponentType.Button, time: 7200000 });

    collector.on('collect', async iC => {
      await iC.deferUpdate();

      if (iC.customId === 'rej_swap') {
        await iC.editReply({ content: '❌ Has rechazado el intercambio.', embeds: [], components: [] });
        await message.author.send(`❌ **${equipoObjetivo.nombre}** ha rechazado tu propuesta de intercambio.`).catch(() => {});
        return collector.stop();
      }

      // 6. Ejecutar intercambio
      const freshEquipos = await EquipoSuperliga.find({});
      const eqOwn = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (miEquipo._id?.$oid ?? miEquipo._id));
      const eqTarget = freshEquipos.find(e => (e._id?.$oid ?? e._id) === (equipoObjetivo._id?.$oid ?? equipoObjetivo._id));

      const idxOwn = eqOwn.jugadores.findIndex(j => j.id === ownJugId);
      const idxTarget = eqTarget.jugadores.findIndex(j => j.id === targetJugId);

      const jugOwn = eqOwn.jugadores.splice(idxOwn, 1)[0];
      const jugTarget = eqTarget.jugadores.splice(idxTarget, 1)[0];

      eqOwn.jugadores.push(jugTarget);
      eqTarget.jugadores.push(jugOwn);
      await ensureUserRegistered(jugTarget.id, client);
      await ensureUserRegistered(jugOwn.id, client);

      await eqOwn.save();
      await eqTarget.save();

      // Registrar movimientos
      await registrarMovimiento(eqOwn._id?.$oid ?? eqOwn._id, {
        tipo: 'Modificación',
        jugador: `${jugOwn.nombre} ⟷ ${jugTarget.nombre}`,
        equipoRelacionado: eqTarget.nombre,
        detalle: 'Intercambio de jugadores'
      });
      await registrarMovimiento(eqTarget._id?.$oid ?? eqTarget._id, {
        tipo: 'Modificación',
        jugador: `${jugTarget.nombre} ⟷ ${jugOwn.nombre}`,
        equipoRelacionado: eqOwn.nombre,
        detalle: 'Intercambio de jugadores'
      });

      await iC.editReply({ content: '✅ Intercambio realizado con éxito.', embeds: [], components: [] });
      await message.author.send(`✅ ¡Intercambio completado! **${jugTarget.nombre}** ya es parte de tu equipo.`).catch(() => {});

      // Notificación al canal de aprobaciones
      const approvalChan = await client.channels.fetch(process.env.CANAL_APROBACION).catch(() => null);
      if (approvalChan) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📢 Mercado: Intercambio Realizado')
          .setDescription(
            `**Equipos:** ${eqOwn.nombre} ⟷ ${eqTarget.nombre}\n` +
            `🔄 **${jugOwn.nombre}** se va a **${eqTarget.nombre}**\n` +
            `🔄 **${jugTarget.nombre}** se va a **${eqOwn.nombre}**`
          )
          .setColor('#e67e22')
          .setTimestamp();
        approvalChan.send({ embeds: [logEmbed] });
      }

      collector.stop();
    });
  }
};
