import { ComponentType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, EmbedBuilder, ChannelSelectMenuBuilder, ChannelType } from 'discord.js';
import Coppa from '../../models/copas/Coppa.js';
import { avanzarFase, determinarGanadorLlave } from '../../utils/generarBracket.js';

export default {
  name: 'coppa-gestion',
  aliases: ['gestioncoppa', 'coppaadmin'],
  desc: 'Panel de gestión de la Coppa (admin)',
  permisos: ['Administrator'],

  run: async (client, message) => {
    const coppa = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null);
    if (!coppa) {
      return message.reply('❌ No hay una **Coppa** en curso. Creá una con `!coppa-crear`.');
    }

    const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
    const llavesActuales = coppa.llaves[faseActual] ?? [];
    const pendientes = llavesActuales.filter(l => !l.ganador).length;
    const total = llavesActuales.length;

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Gestión — Coppa')
      .setDescription(
        `**Fase actual:** ${faseActual}\n` +
        `**Llaves:** ${total - pendientes}/${total} finalizadas\n` +
        `**Participantes:** ${coppa.equipos.length}/16`
      )
      .setColor('#059669')
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_coppa_resultado')
        .setLabel('📥 Cargar Resultado')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pendientes === 0),
      new ButtonBuilder()
        .setCustomId('btn_coppa_cruces')
        .setLabel('⚔️ Editar Cruces')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('btn_coppa_avanzar')
        .setLabel('⏭️ Avanzar Fase')
        .setStyle(ButtonStyle.Success)
        .setDisabled(pendientes > 0),
      new ButtonBuilder()
        .setCustomId('btn_coppa_part')
        .setLabel('👥 Participantes')
        .setStyle(ButtonStyle.Primary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_coppa_canal')
        .setLabel('📺 Canal')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('btn_coppa_borrar')
        .setLabel('🗑️ Borrar')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('btn_coppa_refresh')
        .setLabel('🔃 Refresh')
        .setStyle(ButtonStyle.Secondary),
    );

    const panelMsg = await message.reply({ embeds: [embed], components: [row1, row2] });

    const collector = panelMsg.createMessageComponentCollector({
      filter: i => i.member.permissions.has('Administrator'),
      time: 1800000,
    });

    collector.on('collect', async i => {
      const coppaFresh = await Coppa.findOne({ estado: 'EnCurso' }).catch(() => null);
      if (!coppaFresh) return i.reply({ content: '❌ La Coppa ya no existe.', flags: 64 });

      switch (i.customId) {
        case 'btn_coppa_part':
          await handleGestionParticipantesCoppa(i, coppaFresh);
          break;
        case 'btn_coppa_canal':
          await handleCambiarCanalCoppa(i, coppaFresh);
          break;
        case 'btn_coppa_resultado':
          await handleResultadoCoppa(i, coppaFresh, client);
          break;
        case 'btn_coppa_cruces':
          await handleEditarCrucesCoppa(i, coppaFresh, panelMsg);
          break;
        case 'btn_coppa_avanzar':
          await handleAvanzarCoppa(i, coppaFresh, panelMsg);
          break;
        case 'btn_coppa_borrar':
          await handleBorrarCoppa(i, coppaFresh, panelMsg);
          break;
        case 'btn_coppa_refresh':
          await i.deferUpdate();
          const fase = coppaFresh.fasesEliminatoria[coppaFresh.faseActual];
          const llaves = coppaFresh.llaves[fase] ?? [];
          const p = llaves.filter(l => !l.ganador).length;
          const t = llaves.length;
          const newEmbed = EmbedBuilder.from(embed).setDescription(`**Fase actual:** ${fase}\n**Llaves:** ${t - p}/${t} finalizadas\n**Participantes:** ${coppaFresh.equipos.length}/16`);
          await panelMsg.edit({ embeds: [newEmbed] });
          break;
      }
    });
  },
};

async function handleEditarCrucesCoppa(interaction, coppa, panelMsg) {
  const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
  const allLlaves = coppa.llaves[faseActual] || [];
  if (!allLlaves.length) return interaction.reply({ content: '❌ No hay llaves en esta fase.', flags: 64 });

  const generatePayload = () => {
    const options = allLlaves.map((l, idx) => {
      const eq1 = l.equipo1?.nombre || 'TBD';
      const eq2 = l.equipo2?.nombre || 'TBD';
      const est = l.ganador ? `Finalizado (${l.ganador.nombre || l.ganador})` : 'Pendiente';
      return {
        label: `Llave ${idx + 1}: ${eq1} vs ${eq2}`.slice(0, 100),
        description: `Estado: ${est}`.slice(0, 100),
        value: `${idx}`,
        emoji: '⚔️'
      };
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('sel_coppa_cruce_match')
      .setPlaceholder(`Selecciona la llave a editar (${faseActual})...`)
      .addOptions(options.slice(0, 25));

    const desc = allLlaves.map((l, idx) => {
      const eq1 = l.equipo1?.nombre || 'TBD';
      const eq2 = l.equipo2?.nombre || 'TBD';
      const est = l.ganador ? `✅ *(${l.ganador.nombre || l.ganador})*` : '⏳';
      return `> \`Llave ${idx + 1}:\` **${eq1}** vs **${eq2}** ${est}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Editar Cruces — Coppa (${faseActual})`)
      .setDescription(`${desc}\n\n*Seleccioná una llave en el menú para modificar los participantes:*`)
      .setColor('#059669');

    return {
      content: '',
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: 64
    };
  };

  await interaction.reply(generatePayload());
  const resp = await interaction.fetchReply();

  const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 120000 });

  collector.on('collect', async i => {
    if (i.customId === 'btn_coppa_cruces_back') {
      return i.update(generatePayload());
    }

    if (i.customId === 'sel_coppa_cruce_match') {
      const idx = parseInt(i.values[0]);
      const llave = allLlaves[idx];
      if (!llave) return i.reply({ content: '❌ Llave no encontrada.', flags: 64 });

      const localName = llave.equipo1?.nombre || 'TBD';
      const visitName = llave.equipo2?.nombre || 'TBD';

      const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_coppa_eq1').setLabel('🔵 Cambiar Local').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_coppa_eq2').setLabel('🔴 Cambiar Visitante').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_coppa_swap').setLabel('🔀 Invertir Posiciones').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_coppa_cruces_back').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary)
      );

      await i.update({
        content: `⚔️ **Editando Llave ${idx + 1} — Coppa (${faseActual})**\n\n` +
                 `🔵 **Local (Equipo 1):** ${localName} (<@${llave.equipo1?.discordId || 'Sin Discord'}>)\n` +
                 `🔴 **Visitante (Equipo 2):** ${visitName} (<@${llave.equipo2?.discordId || 'Sin Discord'}>)\n` +
                 `📊 **Estado:** ${llave.ganador ? `Finalizado` : 'Pendiente'}\n\n` +
                 `¿Qué cambio deseas realizar?`,
        embeds: [],
        components: [rowActions]
      });

      const actionInteract = await resp.awaitMessageComponent({ filter: iA => iA.user.id === interaction.user.id, time: 60000 }).catch(() => null);
      if (!actionInteract) return;

      if (actionInteract.customId === 'btn_coppa_cruces_back') {
        return actionInteract.update(generatePayload());
      }

      if (actionInteract.customId === 'btn_coppa_swap') {
        const temp = llave.equipo1;
        llave.equipo1 = llave.equipo2;
        llave.equipo2 = temp;

        await coppa.save();
        return actionInteract.update({
          content: `✅ **Posiciones invertidas:** Ahora es **${llave.equipo1?.nombre}** (Local) vs **${llave.equipo2?.nombre}** (Visitante).`,
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_coppa_cruces_back').setLabel('🔙 Volver a Lista de Llaves').setStyle(ButtonStyle.Secondary))]
        });
      }

      if (actionInteract.customId === 'btn_coppa_eq1' || actionInteract.customId === 'btn_coppa_eq2') {
        const targetSlot = actionInteract.customId === 'btn_coppa_eq1' ? 1 : 2;
        const slotName = targetSlot === 1 ? 'Local (Equipo 1)' : 'Visitante (Equipo 2)';

        const partOptions = (coppa.equipos || []).slice(0, 23).map((eq, eIdx) => ({
          label: `${eIdx + 1}. ${eq.nombre}`.slice(0, 100),
          description: `ID: ${eq.discordId || 'Sin Discord'}`,
          value: `team_${eIdx}`,
          emoji: '👤'
        }));

        partOptions.push({
          label: 'BYE (Pase Libre)',
          description: 'Pase libre a la siguiente ronda',
          value: 'team_bye',
          emoji: '⏩'
        });

        partOptions.push({
          label: 'TBD (A Definir)',
          description: 'Slot pendiente',
          value: 'team_tbd',
          emoji: '❓'
        });

        const selTeamMenu = new StringSelectMenuBuilder()
          .setCustomId('sel_team_coppa_cruce')
          .setPlaceholder(`Selecciona el nuevo ${slotName}...`)
          .addOptions(partOptions);

        const teamRow = new ActionRowBuilder().addComponents(selTeamMenu);
        const cancelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_coppa_cruces_back').setLabel('🔙 Cancelar').setStyle(ButtonStyle.Secondary)
        );

        await actionInteract.update({
          content: `📝 **Seleccionar ${slotName} para Llave ${idx + 1} (${faseActual})**\n\nElige un participante de la lista:`,
          components: [teamRow, cancelRow]
        });

        const teamInteract = await resp.awaitMessageComponent({ filter: iT => iT.user.id === interaction.user.id, time: 60000 }).catch(() => null);
        if (!teamInteract) return;

        if (teamInteract.customId === 'btn_coppa_cruces_back') {
          return teamInteract.update(generatePayload());
        }

        if (teamInteract.customId === 'sel_team_coppa_cruce') {
          const chosen = teamInteract.values[0];
          let nuevoObj = null;

          if (chosen === 'team_bye') {
            nuevoObj = { nombre: 'BYE', discordId: 'BYE' };
          } else if (chosen === 'team_tbd') {
            nuevoObj = { nombre: 'TBD', discordId: null };
          } else {
            const tIdx = parseInt(chosen.replace('team_', ''));
            const eq = coppa.equipos[tIdx];
            if (eq) {
              nuevoObj = {
                nombre: eq.nombre,
                discordId: eq.discordId || null,
                avatar: eq.avatar || null
              };
            }
          }

          if (!nuevoObj) return teamInteract.reply({ content: '❌ Participante inválido.', flags: 64 });

          if (targetSlot === 1) llave.equipo1 = nuevoObj;
          else llave.equipo2 = nuevoObj;

          await coppa.save();

          return teamInteract.update({
            content: `✅ **${slotName}** actualizado a **${nuevoObj.nombre}** para la **Llave ${idx + 1}**.\n\n` +
                     `📌 **Nuevo cruce:** **${llave.equipo1?.nombre || 'TBD'}** vs **${llave.equipo2?.nombre || 'TBD'}**`,
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_coppa_cruces_back').setLabel('🔙 Volver a Lista de Llaves').setStyle(ButtonStyle.Secondary))]
          });
        }
      }
    }
  });
}

async function handleCambiarCanalCoppa(interaction, coppa) {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId('coppa_sel_channel_internal')
        .setPlaceholder('Selecciona el nuevo canal...')
        .addChannelTypes(ChannelType.GuildText);

    await interaction.reply({ 
        content: '📺 **Cambiar Canal de la Coppa**', 
        components: [new ActionRowBuilder().addComponents(select)], 
        flags: 64
    });
    const resp = await interaction.fetchReply();

    const sel = await resp.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60000 }).catch(() => null);
    if (!sel) return;

    coppa.canalResultados = sel.values[0];
    await coppa.save();
    await sel.update({ content: `✅ Canal de la Coppa actualizado a <#${sel.values[0]}>.`, components: [] });
}

async function handleGestionParticipantesCoppa(interaction, coppa) {
    if (coppa.equipos.length === 0) return interaction.reply({ content: '❌ No hay participantes.', flags: 64 });

    const select = new StringSelectMenuBuilder()
        .setCustomId('sel_part_coppa_internal')
        .setPlaceholder('Selecciona un usuario...')
        .addOptions(coppa.equipos.map((e, idx) => ({
            label: e.nombre,
            description: `ID: ${e.discordId}`,
            value: `${idx}`
        })));

    await interaction.reply({ 
        content: '👥 **Participantes Inscritos**', 
        components: [new ActionRowBuilder().addComponents(select)], 
        flags: 64
    });
    const resp = await interaction.fetchReply();

    const sel = await resp.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60000 }).catch(() => null);
    if (!sel) return;

    const idx = parseInt(sel.values[0]);
    const equipo = coppa.equipos[idx];

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('del_p_coppa_si').setLabel('Confirmar Eliminación').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('del_p_coppa_no').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    await sel.update({ content: `⚠️ ¿Estás seguro de que quieres eliminar a **${equipo.nombre}**?`, components: [confirmRow] });

    const confirm = await resp.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(() => null);
    if (confirm?.customId === 'del_p_coppa_si') {
        coppa.equipos.splice(idx, 1);
        await coppa.save();
        await confirm.update({ content: `✅ **${equipo.nombre}** eliminado.`, components: [] });
    } else {
        await confirm?.update({ content: 'Acción cancelada.', components: [] });
    }
}

async function handleResultadoCoppa(interaction, coppa, client) {
  const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
  const allLlaves = coppa.llaves[faseActual].filter(l => !l.ganador && l.equipo2?.discordId !== 'BYE');
  if (!allLlaves.length) return interaction.reply({ content: '✅ No hay llaves pendientes.', flags: 64 });

  let filtroParticipante = '';

  const generatePayload = () => {
    let llaves = allLlaves;
    if (filtroParticipante) {
      const q = filtroParticipante.toLowerCase().trim();
      llaves = llaves.filter(l =>
        (l.equipo1?.nombre && l.equipo1.nombre.toLowerCase().includes(q)) ||
        (l.equipo2?.nombre && l.equipo2.nombre.toLowerCase().includes(q))
      );
    }

    const rows = [];
    if (llaves.length > 0) {
      const opciones = llaves.slice(0, 25).map(l => ({ label: `${l.equipo1.nombre} vs ${l.equipo2.nombre}`.slice(0, 100), value: l.id }));
      const select = new StringSelectMenuBuilder().setCustomId('sel_l_res_internal').setPlaceholder('Selecciona la llave...').addOptions(opciones);
      rows.push(new ActionRowBuilder().addComponents(select));
    }

    const rowBtn = new ActionRowBuilder().addComponents(
      filtroParticipante
        ? new ButtonBuilder().setCustomId('btn_coppa_part_clear').setLabel(`❌ Quitar: ${filtroParticipante.slice(0, 12)}`).setStyle(ButtonStyle.Danger)
        : new ButtonBuilder().setCustomId('btn_coppa_part_search').setLabel('🔍 Buscar Participante').setStyle(ButtonStyle.Secondary)
    );
    rows.push(rowBtn);

    const partInfo = filtroParticipante ? ` • 🔍 *Filtro: "${filtroParticipante}"*` : '';
    const content = `📥 **Cargar Resultado — Coppa (${faseActual})**\n${llaves.length} llaves pendientes encontradas${partInfo}:`;

    return { content, components: rows, flags: 64 };
  };

  await interaction.reply(generatePayload());
  const resp = await interaction.fetchReply();

  const collector = resp.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 120000
  });

  collector.on('collect', async i => {
    if (i.customId === 'btn_coppa_part_clear') {
      filtroParticipante = '';
      return i.update(generatePayload());
    }

    if (i.customId === 'btn_coppa_part_search') {
      const modal = new ModalBuilder()
        .setCustomId('mod_coppa_part_search')
        .setTitle('Buscar Participante');

      const inputPart = new TextInputBuilder()
        .setCustomId('input_coppa_part')
        .setLabel('Nombre del participante / equipo')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: Platubi, Juan...')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(50);

      modal.addComponents(new ActionRowBuilder().addComponents(inputPart));
      await i.showModal(modal);

      const modalResp = await interaction.awaitModalSubmit({
        filter: mI => mI.customId === 'mod_coppa_part_search' && mI.user.id === interaction.user.id,
        time: 60000
      }).catch(() => null);

      if (!modalResp) return;
      filtroParticipante = modalResp.fields.getTextInputValue('input_coppa_part').trim();
      return modalResp.update(generatePayload());
    }

    if (i.customId === 'sel_l_res_internal') {
      const llaveId = i.values[0];
      const llave = coppa.llaves[faseActual].find(l => l.id === llaveId);
      if (!llave) return i.reply({ content: '❌ Llave no encontrada.', flags: 64 });

      const subSelect = new StringSelectMenuBuilder().setCustomId('sel_t_res_internal').setPlaceholder('¿Qué partido?').addOptions([
        { label: 'IDA', value: 'ida' }, { label: 'VUELTA', value: 'vuelta' }, { label: 'DESEMPATE', value: 'desempate' }
      ]);

      await i.update({ content: `📊 Partido para: **${llave.equipo1.nombre} vs ${llave.equipo2.nombre}**`, components: [new ActionRowBuilder().addComponents(subSelect)] });

      const selTipo = await resp.awaitMessageComponent({ filter: mI => mI.user.id === interaction.user.id && mI.customId === 'sel_t_res_internal', time: 60000 }).catch(() => null);
      if (!selTipo) return;

      const tipo = selTipo.values[0];
      const modal = new ModalBuilder().setCustomId(`mod_res_internal`).setTitle(`${tipo.toUpperCase()}: ${llave.equipo1.nombre.slice(0, 15)} vs ${llave.equipo2.nombre.slice(0, 15)}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles ${(tipo === 'ida' || tipo === 'desempate') ? llave.equipo1.nombre.slice(0, 15) : llave.equipo2.nombre.slice(0, 15)}`).setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles ${(tipo === 'ida' || tipo === 'desempate') ? llave.equipo2.nombre.slice(0, 15) : llave.equipo1.nombre.slice(0, 15)}`).setStyle(TextInputStyle.Short).setRequired(true))
      );

      await selTipo.showModal(modal);
      const submit = await interaction.awaitModalSubmit({ time: 60000 }).catch(() => null);
      if (!submit) return;

      const gl = parseInt(submit.fields.getTextInputValue('gl'));
      const gv = parseInt(submit.fields.getTextInputValue('gv'));

      if (isNaN(gl) || isNaN(gv)) {
        return submit.reply({ content: '❌ Valores de goles inválidos.', flags: 64 });
      }

      const fresh = await Coppa.findOne({ estado: 'EnCurso' });
      const freshL = fresh.llaves[faseActual].find(l => l.id === llaveId);

      if (tipo === 'ida') { freshL.ida.golesLocal = gl; freshL.ida.golesVisitante = gv; freshL.ida.finalizado = true; }
      else if (tipo === 'vuelta') { freshL.vuelta.golesLocal = gl; freshL.vuelta.golesVisitante = gv; freshL.vuelta.finalizado = true; }
      else { freshL.desempate.golesLocal = gl; freshL.desempate.golesVisitante = gv; freshL.desempate.finalizado = true; }

      const ganador = determinarGanadorLlave(freshL);
      if (ganador) freshL.ganador = ganador;
      await fresh.save();
      await submit.reply({ content: `✅ Resultado guardado con éxito.`, flags: 64 });
      
      if (client && coppa.canalResultados) {
        await client.channels.fetch(coppa.canalResultados)
          .then(channel => channel.send({ content: `**Resultado de la Coppa:** ${tipo.toUpperCase()} | ${
           (tipo === 'ida' || tipo === 'desempate' ) ? freshL.equipo1.nombre : freshL.equipo2.nombre
          } ${gl} - ${gv} ${
            (tipo === 'ida' || tipo === 'desempate' ) ? freshL.equipo2.nombre : freshL.equipo1.nombre
          } ${ganador ? `| **Gana:** ${ganador.nombre}` : ''}` }))
          .catch(() => { });
      }
    }
  });
}

async function handleAvanzarCoppa(interaction, coppa, panelMsg) {
  const faseActual = coppa.fasesEliminatoria[coppa.faseActual];
  const pendientes = coppa.llaves[faseActual].filter(l => !l.ganador).length;
  if (pendientes > 0) return interaction.reply({ content: `❌ Hay llaves pendientes.`, flags: 64 });

  if (coppa.faseActual >= coppa.fasesEliminatoria.length - 1) {
    coppa.estado = 'Finalizado';
    await coppa.save();
    
    // Adjudicar título oficial al campeón de la Coppa
    const finalWinner = coppa.llaves[faseActual]?.[0]?.ganador;
    if (finalWinner) {
      const { awardTitle } = await import('../../utils/torneos/titulosHelper.js');
      const wId = finalWinner.discordId || finalWinner.id || finalWinner.nombre;
      await awardTitle(wId, { nombreTorneo: coppa.nombre || 'Coppa Platubi', esOficial: true });
    }

    return interaction.reply({ content: `🏆🎉 ¡La Coppa ha finalizado! Campeón: **${finalWinner?.nombre || 'Desconocido'}**` });
  }
  const nuevaFase = avanzarFase(coppa);
  await coppa.save();
  await interaction.reply({ content: `⏭️ Fase avanzada a ${nuevaFase}!` });
}

async function handleBorrarCoppa(interaction, coppa, panelMsg) {
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bc_si').setLabel('Borrar').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('bc_no').setLabel('No').setStyle(ButtonStyle.Secondary));
  await interaction.reply({ content: '⚠️ ¿Borrar Coppa?', components: [row], flags: 64 });
  const resp = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(() => null);
  if (resp?.customId === 'bc_si') { await Coppa.deleteOne({ _id: coppa._id }); await panelMsg.delete(); resp.update({ content: '🗑️ Borrada.', components: [] }); }
  else { resp?.update({ content: 'Cancelado.', components: [] }); }
}
