import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { findPendingMatchesForUser } from "./matchFinder.js";
import { analyzeMatchScreenshot } from "./aiValidator.js";
import { processMatchResultAndSyncStandings } from "./db/globalUserSync.js";
import Torneo from "../models/copas/Torneo.js";

/**
 * Verifica si un canal es un canal de ENTRADA válido de resultados y NO de salida/aprobación.
 */
export async function isResultInputChannel(channelId) {
  if (!channelId) return false;
  const channelStr = String(channelId);

  // Canales de SALIDA / APROBACIÓN (NUNCA procesan capturas como entrada)
  const outputChannels = [
    process.env.CANAL_APROBACION,
    process.env.CANAL_ADMIN_LOG,
    process.env.CANAL_RESULTADOS_ADMIN
  ].filter(Boolean).map(String);

  if (outputChannels.includes(channelStr)) {
    return false;
  }

  // Canales de ENTRADA configurados en .env
  const envInputChannels = [
    process.env.CANAL_RESULTADOS_PRIMERA,
    process.env.CANAL_RESULTADOS_SEGUNDA,
    process.env.CANAL_RESULTADOS_TERCERA,
    process.env.CANAL_RESULTADOS_SUPERLIGA,
    process.env.CANAL_RESULTADOS_SUPERSUPERCOPA,
    process.env.CANAL_RESULTADOS_SUPERCOPA,
    process.env.CANAL_RESULTADOS_COPPA
  ].filter(Boolean).map(String);

  if (envInputChannels.includes(channelStr)) {
    return true;
  }

  // Canales de ENTRADA en torneos personalizados, Superliga o Supersupercopa
  const torneoCoincidente = await Torneo.findOne({ canalResultados: channelStr }).catch(() => null);
  if (torneoCoincidente) {
    return true;
  }

  const Superliga = (await import('../models/superliga/Superliga.js')).default;
  const slCoincidente = await Superliga.findOne({ canalResultados: channelStr }).catch(() => null);
  if (slCoincidente) {
    return true;
  }

  const Supersupercopa = (await import('../models/superliga/Supersupercopa.js')).default;
  const sscCoincidente = await Supersupercopa.findOne({ canalResultados: channelStr }).catch(() => null);
  if (sscCoincidente) {
    return true;
  }

  return false;
}

export default async function submission(client, message) {
  if (message.author.bot) return;

  // 1. Filtrar únicamente canales de ENTRADA de resultados
  const isValidInput = await isResultInputChannel(message.channel.id);
  if (!isValidInput) return;

  // 2. Filtrar adjuntos de tipo imagen
  const imageAttachments = message.attachments.filter(att =>
    att.contentType?.startsWith('image/') ||
    /\.(png|jpg|jpeg|webp)$/i.test(att.name)
  );

  if (imageAttachments.size === 0) return;

  // 3. Buscar partidos pendientes del usuario en los modelos vinculados
  const pendingMatches = await findPendingMatchesForUser(message.author.id, message.channel.id, client);

  if (!pendingMatches.length) {
    const warnMsg = await message.reply(`ℹ️ <@${message.author.id}>, se detectó una imagen pero no tienes partidos pendientes registrados en este canal.`);
    setTimeout(() => warnMsg.delete().catch(() => { }), 10000);
    return;
  }

  const firstImage = imageAttachments.first();

  // 4. Agrupar partidos por competición activa y paginar si superan el límite de 25 opciones de Discord
  const compGroups = [];
  const compMap = new Map();
  for (const m of pendingMatches) {
    const compName = m.competicionNombre || 'Competición';
    if (!compMap.has(compName)) {
      const group = { name: compName, matches: [] };
      compMap.set(compName, group);
      compGroups.push(group);
    }
    compMap.get(compName).matches.push(m);
  }

  let currentCompIdx = 0;
  let currentPage = 0;
  const ITEMS_PER_PAGE = 25;

  const buildComponents = (compIdx, page) => {
    const currentGroup = compGroups[compIdx] || compGroups[0];
    const totalPages = Math.ceil(currentGroup.matches.length / ITEMS_PER_PAGE) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = safePage * ITEMS_PER_PAGE;
    const pageMatches = currentGroup.matches.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    const rows = [];

    // Si hay más de 1 competición activa o más de 25 partidos en total, mostrar selector de competición
    if (compGroups.length > 1) {
      const compOptions = compGroups.map((g, idx) => ({
        label: g.name.slice(0, 100),
        description: `(${g.matches.length} partido${g.matches.length === 1 ? '' : 's'} pendiente${g.matches.length === 1 ? '' : 's'})`.slice(0, 100),
        value: `comp_${idx}`,
        default: idx === compIdx
      }));

      const compSelect = new StringSelectMenuBuilder()
        .setCustomId('sel_comp_filter')
        .setPlaceholder('🏆 Filtrar por competición...')
        .addOptions(compOptions);

      rows.push(new ActionRowBuilder().addComponents(compSelect));
    }

    // Selector de partidos de la competición y página actual
    const matchOptions = pageMatches.map((m) => {
      const globalIdx = pendingMatches.indexOf(m);
      return {
        label: m.etiqueta.slice(0, 100),
        description: `🏆 ${m.competicionNombre}`.slice(0, 100),
        value: `${globalIdx}|${m.matchId}`.slice(0, 100)
      };
    });

    const matchSelect = new StringSelectMenuBuilder()
      .setCustomId('sel_multi_match_submit')
      .setPlaceholder(`Selecciona el partido (${currentGroup.name}${totalPages > 1 ? ` - Pág ${safePage + 1}/${totalPages}` : ''})...`.slice(0, 100))
      .addOptions(matchOptions);

    rows.push(new ActionRowBuilder().addComponents(matchSelect));

    // Botones de paginación e ignorar
    const btnRow = new ActionRowBuilder();
    if (totalPages > 1) {
      btnRow.addComponents(
        new ButtonBuilder()
          .setCustomId('btn_sub_prev_page')
          .setLabel('◀️ Anterior')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId('btn_sub_next_page')
          .setLabel('▶️ Siguiente')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      );
    }

    btnRow.addComponents(
      new ButtonBuilder()
        .setCustomId('btn_ignore_submit')
        .setLabel('❌ Ignorar')
        .setStyle(ButtonStyle.Danger)
    );

    rows.push(btnRow);
    return { rows, safePage, totalPages, currentGroup };
  };

  const initialUI = buildComponents(currentCompIdx, currentPage);
  const promptMsg = await message.reply({
    content: `📷 <@${message.author.id}> Selecciona a qué partido corresponde tu captura o presiona **Ignorar**:`,
    components: initialUI.rows
  });

  let targetMatch = null;
  const filter = i => i.user.id === message.author.id;

  while (true) {
    let interaction = null;
    try {
      interaction = await promptMsg.awaitMessageComponent({ filter, time: 60000 });
    } catch {
      await promptMsg.delete().catch(() => {});
      return;
    }

    if (!interaction) {
      await promptMsg.delete().catch(() => {});
      return;
    }

    if (interaction.customId === 'btn_ignore_submit') {
      await interaction.deferUpdate().catch(() => {});
      await promptMsg.delete().catch(() => {});
      return;
    }

    if (interaction.customId === 'sel_comp_filter') {
      currentCompIdx = parseInt(interaction.values[0].replace('comp_', '')) || 0;
      currentPage = 0;
      const { rows } = buildComponents(currentCompIdx, currentPage);
      await interaction.update({ components: rows }).catch(() => {});
      continue;
    }

    if (interaction.customId === 'btn_sub_prev_page') {
      currentPage = Math.max(0, currentPage - 1);
      const { rows } = buildComponents(currentCompIdx, currentPage);
      await interaction.update({ components: rows }).catch(() => {});
      continue;
    }

    if (interaction.customId === 'btn_sub_next_page') {
      currentPage++;
      const { rows } = buildComponents(currentCompIdx, currentPage);
      await interaction.update({ components: rows }).catch(() => {});
      continue;
    }

    if (interaction.customId === 'sel_multi_match_submit') {
      await interaction.deferUpdate().catch(() => {});
      const [idxStr, selectedMatchId] = interaction.values[0].split('|');
      const targetIdx = parseInt(idxStr);
      targetMatch = pendingMatches[targetIdx] || pendingMatches.find(m => m.matchId === selectedMatchId);
      await promptMsg.delete().catch(() => {});
      break;
    }
  }

  if (!targetMatch) return;

  // 5. Recolectar TODAS las imágenes adjuntas (máximo 3)
  const allImages = [...imageAttachments.values()].slice(0, 3);

  // Determinar si el partido es de ida/vuelta según el torneo
  const llave = targetMatch.partidoRef;
  const esIdaVuelta = targetMatch.isIdaVuelta || (targetMatch.modelDoc?.tipoEncuentro === 'ida_vuelta' && llave?.vuelta !== undefined) || (llave?.ida !== undefined && llave?.vuelta !== undefined);

  // Mapeo posicional de imágenes a tipos de partido
  const TIPOS_POR_POSICION = esIdaVuelta
    ? ['ida', 'vuelta', 'desempate']
    : ['unico', 'unico', 'unico'];

  // 6. Descargar todos los buffers de imagen
  const imageBuffers = await Promise.all(allImages.map(async (img) => {
    try {
      const resp = await fetch(img.url);
      return { buffer: Buffer.from(await resp.arrayBuffer()), img, hash: null };
    } catch (e) {
      console.error('[Submission] Error al descargar imagen:', e.message);
      return null;
    }
  }));

  // Agregar hash MD5 simple para detectar duplicados
  const crypto = await import('crypto');
  for (const item of imageBuffers) {
    if (item?.buffer) {
      item.hash = crypto.createHash('md5').update(item.buffer).digest('hex');
    }
  }

  // Verificar que no haya imágenes duplicadas
  const hashes = imageBuffers.filter(Boolean).map(i => i.hash);
  const uniqueHashes = new Set(hashes);
  if (uniqueHashes.size < hashes.length) {
    await message.channel.send({
      content: `❌ <@${message.author.id}>, detecté imágenes duplicadas adjuntas. Cada imagen debe corresponder a un partido diferente (Ida, Vuelta, Desempate).`
    });
    return;
  }

  // Canal de SALIDA / APROBACIÓN para revisión de administradores
  const adminChannelId = process.env.CANAL_APROBACION || process.env.CANAL_ADMIN_LOG || process.env.CANAL_RESULTADOS_ADMIN;
  const adminChannel = adminChannelId ? await client.channels.fetch(adminChannelId).catch(() => null) : null;

  const apiKey = process.env.GEMINI_API_KEY;

  // 7. Procesar cada imagen según su posición
  let anyAutoApproved = false;
  let anyManualReview = false;
  let anyRejected = false;

  for (let i = 0; i < imageBuffers.length; i++) {
    const item = imageBuffers[i];
    if (!item?.buffer) continue;

    const tipoPartido = TIPOS_POR_POSICION[i] || 'unico';
    const tipoLabel = tipoPartido === 'unico' ? '' : ` (${tipoPartido.toUpperCase()})`;

    // Verificar si este sub-partido ya fue asentado
    if (esIdaVuelta && llave) {
      const subMatch = llave[tipoPartido];
      if (subMatch && subMatch.finalizado) {
        await message.channel.send({
          content: `⚠️ <@${message.author.id}>, el partido de **${tipoPartido.toUpperCase()}** ya fue registrado previamente.`
        });
        continue;
      }
    }

    const isVuelta = tipoPartido === 'vuelta';
    const localPartNom = isVuelta ? targetMatch.visitanteNombre : targetMatch.localNombre;
    const visitantePartNom = isVuelta ? targetMatch.localNombre : targetMatch.visitanteNombre;
    const localPartId = isVuelta ? targetMatch.visitanteId : targetMatch.localId;
    const visitantePartId = isVuelta ? targetMatch.localId : targetMatch.visitanteId;

    // Buscar aliases de ambos jugadores en la base de datos de Jugador y Equipos
    const JugadorModel = (await import('../models/Jugador.js')).default;
    const [pLocDoc, pVisDoc] = await Promise.all([
      localPartId ? JugadorModel.findOne({ $or: [{ id: String(localPartId) }, { _id: String(localPartId) }, { discordId: String(localPartId) }, { nombre: localPartNom }] }).catch(() => null) : null,
      visitantePartId ? JugadorModel.findOne({ $or: [{ id: String(visitantePartId) }, { _id: String(visitantePartId) }, { discordId: String(visitantePartId) }, { nombre: visitantePartNom }] }).catch(() => null) : null
    ]);

    const localAliases = Array.isArray(pLocDoc?.aliases) ? [...pLocDoc.aliases] : [];
    const visitanteAliases = Array.isArray(pVisDoc?.aliases) ? [...pVisDoc.aliases] : [];

    // Si es un partido completo de equipos (y NO un duelo individual 1v1), agregar coaches y nombres de club a los aliases
    if (!targetMatch.dueloRef && (targetMatch.competicionCodigo === 'superliga' || targetMatch.competicionCodigo === 'supersupercopa')) {
      const EquiposModel = (await import('../models/superliga/Equipos.js')).default;
      const [eqLoc, eqVis] = await Promise.all([
        EquiposModel.findOne({ $or: [{ _id: String(localPartId) }, { nombre: localPartNom }] }).catch(() => null),
        EquiposModel.findOne({ $or: [{ _id: String(visitantePartId) }, { nombre: visitantePartNom }] }).catch(() => null)
      ]);

      if (eqLoc) {
        if (eqLoc.coach?.nombre) localAliases.push(eqLoc.coach.nombre);
        if (eqLoc.nombre && eqLoc.nombre !== localPartNom) localAliases.push(eqLoc.nombre);
      }
      if (eqVis) {
        if (eqVis.coach?.nombre) visitanteAliases.push(eqVis.coach.nombre);
        if (eqVis.nombre && eqVis.nombre !== visitantePartNom) visitanteAliases.push(eqVis.nombre);
      }
    }

    // Analizar con IA
    let aiResult = null;
    if (apiKey) {
      try {
        aiResult = await analyzeMatchScreenshot({
          imageBuffer: item.buffer,
          mimeType: item.img.contentType || 'image/png',
          localName: localPartNom,
          visitanteName: visitantePartNom,
          localAliases,
          visitanteAliases,
          competitionName: targetMatch.competicionNombre,
          apiKey
        });
      } catch (err) {
        console.log(`[Submission IA] Error en imagen ${i + 1}:`, err.message);
      }
    }

    // CASO A: IA aprobó con alta confianza → autocomplete
    if (aiResult && aiResult.valido && aiResult.confianza === 'alta') {
      const gl = isVuelta ? aiResult.golesVisitante : aiResult.golesLocal;
      const gv = isVuelta ? aiResult.golesLocal : aiResult.golesVisitante;

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

      await message.channel.send({
        content: `✅ <@${message.author.id}>, partido${tipoLabel} validado automáticamente por IA: **${localPartNom} ${isVuelta ? gv : gl} - ${isVuelta ? gl : gv} ${visitantePartNom}**`
      });

      if (adminChannel) {
        const autoEmbed = new EmbedBuilder()
          .setTitle(`🤖 Validado por IA${tipoLabel}`)
          .setColor('#22c55e')
          .addFields(
            { name: 'Competición', value: targetMatch.competicionNombre, inline: true },
            { name: 'Encuentro', value: `${localPartNom} vs ${visitantePartNom}`, inline: true },
            { name: 'Resultado', value: `**${localPartNom} ${isVuelta ? gv : gl} - ${isVuelta ? gl : gv} ${visitantePartNom}**`, inline: false },
            { name: 'Reporte IA', value: `\`${aiResult.reporte || 'OK'}\``, inline: false }
          )
          .setImage(item.img.url)
          .setTimestamp();
        await adminChannel.send({ embeds: [autoEmbed] }).catch(() => { });
      }
      anyAutoApproved = true;
      continue;
    }

    // CASO B: IA rechazó con confianza baja → rechazo inmediato
    if (aiResult && !aiResult.error && !aiResult.valido && aiResult.confianza === 'baja') {
      await message.channel.send({
        content: `❌ <@${message.author.id}>, la imagen ${i + 1}${tipoLabel} **no corresponde** al partido **${localPartNom} vs ${visitantePartNom}**.\n> ${aiResult.reporte || 'Imagen inválida.'}\n\nAsegúrate de enviar la pantalla de fin de partido correcta.`
      });
      anyRejected = true;
      continue;
    }

    // CASO C: revisión manual (confianza media, IA falló, o sin API)
    const reportSummary = aiResult?.reporte || (aiResult?.error ? `IA: ${aiResult.error}` : 'Sin análisis IA');

    const reviewEmbed = new EmbedBuilder()
      .setTitle(`📩 Revisión Manual${tipoLabel}`)
      .setDescription(`**Reporte**: \`${reportSummary}\``)
      .setColor('#3b82f6')
      .addFields(
        { name: 'Competición', value: targetMatch.competicionNombre, inline: true },
        { name: 'Encuentro', value: `${localPartNom} vs ${visitantePartNom}`, inline: true },
        { name: 'Enviado por', value: `<@${message.author.id}>`, inline: true }
      )
      .setImage(item.img.url)
      .setFooter({ text: `ID Match: ${targetMatch.matchId} | Tipo: ${tipoPartido}` })
      .setTimestamp();

    const adminRow = new ActionRowBuilder();
    const customIdBase = `${targetMatch.matchId}|${message.author.id}|${tipoPartido}`;

    if (aiResult && aiResult.golesLocal !== null && aiResult.golesLocal !== undefined && aiResult.golesVisitante !== null && aiResult.golesVisitante !== undefined) {
      const gl = isVuelta ? aiResult.golesVisitante : aiResult.golesLocal;
      const gv = isVuelta ? aiResult.golesLocal : aiResult.golesVisitante;

      reviewEmbed.addFields({
        name: 'Marcador Estimado IA',
        value: `\`${gl} - ${gv}\` (Confianza: ${aiResult.confianza})`,
        inline: false
      });

      adminRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_admin_aprv_ai|${customIdBase}|${gl}|${gv}`)
          .setLabel(`✅ Aprobar (${gl} - ${gv})${tipoLabel}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`btn_admin_edit_ai|${customIdBase}`)
          .setLabel(`✏️ Editar${tipoLabel}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_admin_deny_ai|${customIdBase}`)
          .setLabel('❌ Rechazar')
          .setStyle(ButtonStyle.Danger)
      );
    } else {
      adminRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_admin_edit_ai|${customIdBase}`)
          .setLabel(`✏️ Cargar Marcador${tipoLabel}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_admin_deny_ai|${customIdBase}`)
          .setLabel('❌ Rechazar')
          .setStyle(ButtonStyle.Danger)
      );
    }

    if (adminChannel) {
      await adminChannel.send({ embeds: [reviewEmbed], components: [adminRow] }).catch(() => { });
    }
    anyManualReview = true;
  }

  // Mensaje resumen al usuario si se mandó algo a revisión manual
  if (anyManualReview) {
    await message.channel.send({
      content: `🔍 <@${message.author.id}>, una o más capturas fueron enviadas al equipo de Administración para revisión manual.`
    });
  }
}