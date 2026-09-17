import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function buildSupercopaEmbed(copa) {
  if (!copa || copa.estadoGlobal === 'Inactiva') {
    return new EmbedBuilder()
      .setTitle('🏆 Gestión — Supersupercopa')
      .setDescription('⚠️ No hay ninguna Supersupercopa activa.')
      .setColor('#e67e22')
      .setTimestamp();
  }

  const fase = copa.fase;
  const grupoA = copa.grupos[0];
  const grupoB = copa.grupos[1];
  
  const totalPartidosA = grupoA.fechas.flatMap(f => f.partidos ?? f.encuentros).length;
  const pendientesA = grupoA.fechas.flatMap(f => f.partidos ?? f.encuentros).filter(p => !p.finalizado).length;
  const totalPartidosB = grupoB.fechas.flatMap(f => f.partidos ?? f.encuentros).length;
  const pendientesB = grupoB.fechas.flatMap(f => f.partidos ?? f.encuentros).filter(p => !p.finalizado).length;

  let faseStr = fase === 'grupos' ? '🏟️ Fase de Grupos' : 
                fase === 'semifinales' ? '⚔️ Semifinales' :
                fase === 'final' ? '🏆 Final' : '✅ Finalizado';

  let desc = 
    `**Temporada:** ${copa.temporada}\n` +
    `**Fase:** ${faseStr}\n`;

  if (fase === 'grupos') {
    desc += `**Grupo A:** ${grupoA.equipos.length} equipos (${pendientesA}/${totalPartidosA} pend.)\n` +
            `**Grupo B:** ${grupoB.equipos.length} equipos (${pendientesB}/${totalPartidosB} pend.)`;
  } else if (fase === 'semifinales') {
    const pend = copa.semifinales.filter(p => !p.finalizado).length;
    desc += `**Semis:** ${pend}/2 pendientes`;
  } else if (fase === 'final') {
    desc += `**Final:** ${copa.final?.finalizado ? '✅ Jugada' : '⏳ Pendiente'}`;
  }

  const acento = copa.tema?.acento || '#f1c40f';

  return new EmbedBuilder()
    .setTitle(`🏆 Gestión — Supersupercopa`)
    .setDescription(desc)
    .setColor(acento)
    .setFooter({ text: 'Panel de control administrativo' })
    .setTimestamp();
}

export function buildSupercopaRows(copa) {
  const activa = copa?.estadoGlobal === 'Activa';
  const enElim = activa && ['semifinales', 'final'].includes(copa?.fase);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_ssc_sortear')
      .setLabel('📅 Sortear Fixture')
      .setStyle(ButtonStyle.Success)
      .setDisabled(activa),
    new ButtonBuilder()
      .setCustomId('btn_ssc_resultado')
      .setLabel('📥 Cargar Resultado')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!activa),
    new ButtonBuilder()
      .setCustomId('btn_ssc_grupos')
      .setLabel('🔀 Modificar Grupos')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!activa),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_ssc_editar_equipos')
      .setLabel('📝 Editar Equipos')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_ssc_editar_duelos')
      .setLabel('⚔️ Editar Duelos')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!enElim),
    new ButtonBuilder()
      .setCustomId('btn_ssc_avanzar')
      .setLabel('⏩ Avanzar Fase')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!activa),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_ssc_tema')
      .setLabel('🎨 Editar Tema')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_ssc_borrar')
      .setLabel('🗑️ Borrar')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!activa),
    new ButtonBuilder()
      .setCustomId('btn_ssc_refresh')
      .setLabel('🔃 Actualizar')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}
