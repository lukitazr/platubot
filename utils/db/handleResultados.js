import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from "discord.js";
import { processMatchResultAndSyncStandings, revertMatchResultAndSyncStandings } from "./globalUserSync.js";

export default async function handleResultados(interaction, liga, div) {
  const schedule = liga.fechas ?? liga.partidos ?? [];
  let allPartidos = schedule.flatMap(f =>
    (f.partidos ?? f.encuentros ?? []).filter(Boolean).map(p => ({
      ...p,
      _id: String(p._id || p.id || `${f.numero}_${p.localNombre}_${p.visitanteNombre}`),
      fechaNum: f.numero,
      localNombre: p.localNombre || p.local?.nombre || 'Local',
      visitanteNombre: p.visitanteNombre || p.visitante?.nombre || 'Visitante',
      localId: p.localId || p.localDiscordId || p.local?.id || p.local,
      visitanteId: p.visitanteId || p.visitanteDiscordId || p.visitante?.id || p.visitante,
      finalizado: !!p.finalizado,
      golesLocal: p.golesLocal,
      golesVisitante: p.golesVisitante,
    }))
  );

  if (!allPartidos.length) {
    return interaction.reply({ content: '❌ No hay partidos en el fixture de esta liga.', flags: 64 });
  }

  let filtro = allPartidos.some(p => !p.finalizado) ? 'pendientes' : 'jugados';
  let filtroParticipante = '';
  let pagina = 0;
  const ITEMS_PER_PAGE = 25;

  const generatePayload = () => {
    let filtered = [];
    if (filtro === 'pendientes') filtered = allPartidos.filter(p => !p.finalizado);
    else if (filtro === 'jugados') filtered = allPartidos.filter(p => p.finalizado);
    else filtered = allPartidos;

    if (filtroParticipante) {
      const q = filtroParticipante.toLowerCase().trim();
      filtered = filtered.filter(p =>
        (p.localNombre && p.localNombre.toLowerCase().includes(q)) ||
        (p.visitanteNombre && p.visitanteNombre.toLowerCase().includes(q)) ||
        (p.localId && String(p.localId).toLowerCase().includes(q)) ||
        (p.visitanteId && String(p.visitanteId).toLowerCase().includes(q))
      );
    }

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
    pagina = Math.min(Math.max(0, pagina), totalPages - 1);

    const pageMatches = filtered.slice(pagina * ITEMS_PER_PAGE, (pagina + 1) * ITEMS_PER_PAGE);

    const cantPendientes = allPartidos.filter(p => !p.finalizado).length;
    const cantJugados = allPartidos.filter(p => p.finalizado).length;

    const rows = [];

    // 1. Selector de partidos de la página actual
    if (pageMatches.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`sel_resultado_${div}`)
        .setPlaceholder(
          filtro === 'jugados'
            ? 'Selecciona un partido para anular resultado...'
            : (filtro === 'pendientes' ? 'Selecciona un partido para cargar resultado...' : 'Selecciona un partido a gestionar...')
        )
        .addOptions(pageMatches.map(p => {
          const desc = p.finalizado
            ? `✅ Resultado: ${p.golesLocal} - ${p.golesVisitante} (Clic para anular)`
            : `⏳ Pendiente${p.imagenResultado ? ' • 📷 Con imagen' : ''}`;
          return {
            label: `F${p.fechaNum}: ${p.localNombre} vs ${p.visitanteNombre}`.slice(0, 100),
            description: desc.slice(0, 100),
            value: p._id,
          };
        }));
      rows.push(new ActionRowBuilder().addComponents(select));
    }

    // 2. Botones de Filtro
    const rowFiltros = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_filtro_pendientes_${div}`)
        .setLabel(`⏳ Pendientes (${cantPendientes})`)
        .setStyle(filtro === 'pendientes' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`btn_filtro_jugados_${div}`)
        .setLabel(`✅ Jugados (${cantJugados})`)
        .setStyle(filtro === 'jugados' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`btn_filtro_todos_${div}`)
        .setLabel(`📋 Todos (${allPartidos.length})`)
        .setStyle(filtro === 'todos' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      filtroParticipante
        ? new ButtonBuilder()
            .setCustomId(`btn_filtro_part_clear_${div}`)
            .setLabel(`❌ Quitar: ${filtroParticipante.slice(0, 12)}`)
            .setStyle(ButtonStyle.Danger)
        : new ButtonBuilder()
            .setCustomId(`btn_filtro_part_search_${div}`)
            .setLabel('🔍 Buscar Participante')
            .setStyle(ButtonStyle.Secondary)
    );
    rows.push(rowFiltros);

    // 3. Botones de Paginación (si hay más de 1 página)
    if (totalPages > 1) {
      const rowNav = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_pag_prev_${div}`)
          .setLabel('◀️ Anterior')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina === 0),
        new ButtonBuilder()
          .setCustomId(`btn_pag_info_${div}`)
          .setLabel(`Página ${pagina + 1} de ${totalPages} (${filtered.length} partidos)`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`btn_pag_next_${div}`)
          .setLabel('Siguiente ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina >= totalPages - 1),
      );
      rows.push(rowNav);
    }

    const titleFiltro = filtro === 'pendientes'
      ? '⏳ Partidos Pendientes'
      : (filtro === 'jugados' ? '✅ Partidos Jugados (Anulables)' : '📋 Todos los Partidos');

    const partInfo = filtroParticipante ? ` • 🔍 *Filtro: "${filtroParticipante}"*` : '';

    const content = `⚙️ **Gestión de Resultados — ${liga.nombreLiga ?? `Liga ${div}`}**\n` +
      `Mostrando **${titleFiltro}** (${filtered.length} partidos encontrados)${partInfo}.\n` +
      (pageMatches.length === 0 ? `\n*No hay partidos que coincidan con los filtros.*` : `*Selecciona un partido del menú para ${filtro === 'jugados' ? 'anular su resultado' : 'cargar su resultado'}.*`);

    return { content, components: rows };
  };

  const initialPayload = generatePayload();
  const panelMsg = await interaction.reply({ ...initialPayload, flags: 64, fetchReply: true });

  const collector = panelMsg.createMessageComponentCollector({
    filter: i => i.user.id === interaction.user.id,
    time: 180000,
  });

  collector.on('collect', async i => {
    // Filtros de Estado
    if (i.customId === `btn_filtro_pendientes_${div}`) {
      filtro = 'pendientes';
      pagina = 0;
      return i.update(generatePayload());
    }
    if (i.customId === `btn_filtro_jugados_${div}`) {
      filtro = 'jugados';
      pagina = 0;
      return i.update(generatePayload());
    }
    if (i.customId === `btn_filtro_todos_${div}`) {
      filtro = 'todos';
      pagina = 0;
      return i.update(generatePayload());
    }

    // Filtro de Búsqueda por Participante
    if (i.customId === `btn_filtro_part_clear_${div}`) {
      filtroParticipante = '';
      pagina = 0;
      return i.update(generatePayload());
    }

    if (i.customId === `btn_filtro_part_search_${div}`) {
      const modal = new ModalBuilder()
        .setCustomId(`modal_filtro_part_${div}`)
        .setTitle('Buscar Participante');

      const inputPart = new TextInputBuilder()
        .setCustomId('input_part_query')
        .setLabel('Nombre o ID del participante')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: Platubi, Juan, Boca...')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(50);

      modal.addComponents(new ActionRowBuilder().addComponents(inputPart));
      await i.showModal(modal);

      const modalFilter = mI => mI.customId === `modal_filtro_part_${div}` && mI.user.id === interaction.user.id;
      const modalResp = await interaction.awaitModalSubmit({ filter: modalFilter, time: 60000 }).catch(() => null);
      if (!modalResp) return;

      const q = modalResp.fields.getTextInputValue('input_part_query').trim();
      filtroParticipante = q;
      pagina = 0;

      return modalResp.update(generatePayload());
    }

    // Paginación
    if (i.customId === `btn_pag_prev_${div}`) {
      if (pagina > 0) pagina--;
      return i.update(generatePayload());
    }
    if (i.customId === `btn_pag_next_${div}`) {
      pagina++;
      return i.update(generatePayload());
    }

    // Cancelar diálogo de anulación
    if (i.customId.startsWith(`btn_cancel_anular_${div}`)) {
      return i.update(generatePayload());
    }

    // Confirmar anulación de resultado
    if (i.customId.startsWith(`btn_confirm_anular_${div}_`)) {
      const targetId = i.customId.replace(`btn_confirm_anular_${div}_`, '');
      const partido = allPartidos.find(p => String(p._id) === String(targetId));
      if (!partido) {
        return i.reply({ content: '❌ Partido no encontrado.', flags: 64 });
      }

      await revertMatchResultAndSyncStandings({
        localId: partido.localId || partido.localDiscordId,
        visitanteId: partido.visitanteId || partido.visitanteDiscordId,
        localNombre: partido.localNombre,
        visitanteNombre: partido.visitanteNombre,
        golesLocal: partido.golesLocal,
        golesVisitante: partido.golesVisitante,
        ligaDoc: liga,
        partidoId: partido._id,
        context: `Liga ${div}`
      });

      partido.finalizado = false;
      partido.golesLocal = null;
      partido.golesVisitante = null;
      partido.imagenResultado = null;

      await i.update(generatePayload());
      return i.followUp({
        content: `✅ **Resultado anulado con éxito:** El partido **F${partido.fechaNum}: ${partido.localNombre} vs ${partido.visitanteNombre}** volvió a estado pendiente y las tablas fueron recalculadas.`,
        flags: 64
      });
    }

    // Selección de partido en el Select Menu
    if (i.customId === `sel_resultado_${div}`) {
      const partidoId = i.values[0];
      const partido = allPartidos.find(p => String(p._id) === String(partidoId));
      if (!partido) return i.reply({ content: '❌ Partido no encontrado.', flags: 64 });

      // CASO A: Partido finalizado -> Confirmación para anular resultado
      if (partido.finalizado) {
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_confirm_anular_${div}_${partido._id}`)
            .setLabel('🗑️ Confirmar Anulación')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`btn_cancel_anular_${div}`)
            .setLabel('❌ Cancelar')
            .setStyle(ButtonStyle.Secondary)
        );

        return i.update({
          content: `⚠️ **¿Estás seguro de que deseas anular el resultado del siguiente partido?**\n\n` +
            `📌 **Fecha ${partido.fechaNum}:** ${partido.localNombre} **${partido.golesLocal} - ${partido.golesVisitante}** ${partido.visitanteNombre}\n\n` +
            `ℹ️ *Esta acción restablecerá el partido a estado pendiente, descontará los goles y puntos de la tabla de posiciones y revertirá el historial H2H de ambos jugadores.*`,
          components: [confirmRow]
        });
      }

      // CASO B: Partido pendiente -> Mostrar modal de carga de resultado
      const modal = new ModalBuilder()
        .setCustomId(`modal_resultado_${div}_${partido._id}`)
        .setTitle(`F${partido.fechaNum}: ${partido.localNombre} vs ${partido.visitanteNombre}`.slice(0, 45));

      const inputLocal = new TextInputBuilder()
        .setCustomId('input_goles_local')
        .setLabel(`Goles de ${partido.localNombre}`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: 2')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

      const inputVisitante = new TextInputBuilder()
        .setCustomId('input_goles_visitante')
        .setLabel(`Goles de ${partido.visitanteNombre}`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: 1')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

      modal.addComponents(
        new ActionRowBuilder().addComponents(inputLocal),
        new ActionRowBuilder().addComponents(inputVisitante),
      );

      await i.showModal(modal);

      const modalFilter = mI => mI.customId === `modal_resultado_${div}_${partido._id}` && mI.user.id === interaction.user.id;
      const modalResp = await interaction.awaitModalSubmit({ filter: modalFilter, time: 120000 }).catch(() => null);
      if (!modalResp) return;

      const gl = parseInt(modalResp.fields.getTextInputValue('input_goles_local'));
      const gv = parseInt(modalResp.fields.getTextInputValue('input_goles_visitante'));

      if (isNaN(gl) || isNaN(gv)) {
        return modalResp.reply({ content: '❌ Valores inválidos. Ingresa solo números.', flags: 64 });
      }

      await processMatchResultAndSyncStandings({
        localId: partido.localId || partido.localDiscordId,
        visitanteId: partido.visitanteId || partido.visitanteDiscordId,
        localNombre: partido.localNombre,
        visitanteNombre: partido.visitanteNombre,
        golesLocal: gl,
        golesVisitante: gv,
        ligaDoc: liga,
        partidoId: partido._id,
        context: `Liga ${div}`
      });

      partido.finalizado = true;
      partido.golesLocal = gl;
      partido.golesVisitante = gv;

      const imgLine = partido.imagenResultado ? `\n📷 [Ver imagen del resultado](${partido.imagenResultado})` : '';

      await modalResp.reply({
        content: `✅ Resultado cargado y asentado en todas las tablas y estadísticas globales: **${partido.localNombre} ${gl} - ${gv} ${partido.visitanteNombre}**${imgLine}`,
        flags: 64,
      });

      // Actualizar el menú principal
      panelMsg.edit(generatePayload()).catch(() => {});
    }
  });

  collector.on('end', () => {
    panelMsg.edit({ components: [] }).catch(() => {});
  });
}