import {
    AttachmentBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    FileUploadBuilder,
    LabelBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType
} from 'discord.js';
import Torneo from '../../models/copas/Torneo.js';
import { getFlagUrl } from '../visual/countryHelper.js';
import generarRoundRobin from '../generarRoundRobin.js';
import generarBracket from '../generarBracket.js';
import descargarImagen from '../descargarImagen.js';
import { getCachedImage, invalidateCache } from '../visual/imageCache.js';
import { generarTablaImagenCopa } from '../visual/copaVisualGenerator.js';
import { getAvatarBase64 } from '../visual/avatarUtils.js';
import { generarDuelosIndividuales, generarSlotsVacios } from './handleParticipantes.js';
import { awardTitle } from './titulosHelper.js';

export default async function handleGestion(client, message, args, torneo) {
    if (!message.member.permissions.has('Administrator') && message.author.id !== torneo.createdBy) {
        return message.reply('❌ Solo administradores pueden gestionar el torneo.');
    }

    const t = torneo.tema;
    const faseActual = torneo.fasesEliminatoria?.[torneo.faseActual] || (torneo.gruposHabilitados ? 'Fase de Grupos' : 'Configuración');

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Gestión — ${torneo.nombre}`)
        .setDescription(
            `**Estado:** ${torneo.estado}\n` +
            `**Carácter:** ${torneo.caracter === 'oficial' ? '🏆 Oficial' : '🎖️ Amistoso'}\n` +
            `**Fase Actual:** ${faseActual}\n` +
            `**Participantes:** ${torneo.equipos.length}/${torneo.cantidadParticipantes}\n` +
            `**Prefijo:** \`${torneo.prefix}\``
        )
        .addFields(
            { name: '🎨 Colores del Tema', value: `Primario: \`${t.primario}\`\nSecundario: \`${t.secundario}\`\nAcento: \`${t.acento}\`\nTexto: \`${t.texto}\`\nBorde: \`${t.borde}\``, inline: true }
        )
        .setColor(t.acento)
        .setTimestamp();

    const yaLleno = torneo.equipos.length >= torneo.cantidadParticipantes;
    const hayPartidosGrupos = Array.isArray(torneo.enfrentamientosGrupos) && torneo.enfrentamientosGrupos.length > 0;
    const hayPartidosLlaves = !!(torneo.llaves && Object.keys(torneo.llaves).length > 0 && Object.values(torneo.llaves).some(arr => Array.isArray(arr) && arr.length > 0));
    const hayPartidos = hayPartidosGrupos || hayPartidosLlaves;
    const sinPartidos = !hayPartidos;
    const sinEliminatorias = !torneo.fasesEliminatoria || torneo.fasesEliminatoria.length === 0 || !hayPartidosLlaves;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`gt_sortear|${torneo.prefix}`)
            .setLabel('🎲 Sortear Partidos')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!yaLleno || !sinPartidos),
        new ButtonBuilder()
            .setCustomId(`gt_res|${torneo.prefix}`)
            .setLabel('📥 Cargar Resultado')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(sinPartidos),
        new ButtonBuilder()
            .setCustomId(`gt_cruces|${torneo.prefix}`)
            .setLabel('⚔️ Editar Cruces')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(sinEliminatorias),
        new ButtonBuilder()
            .setCustomId(`gt_fase|${torneo.prefix}`)
            .setLabel('⏭️ Avanzar Fase')
            .setStyle(ButtonStyle.Success)
            .setDisabled(sinPartidos || (torneo.enfrentamientosGrupos?.length > 0 && torneo.enfrentamientosGrupos.some(e => !e.ganador && !e.completado))),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gt_part|${torneo.prefix}`).setLabel('👥 Part.').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`gt_tema|${torneo.prefix}`).setLabel('🎨 Tema').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`gt_canal|${torneo.prefix}`).setLabel('📺 Canal').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`gt_borrar|${torneo.prefix}`).setLabel('🗑️ Borrar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`gt_refresh|${torneo.prefix}`).setLabel('🔃').setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gt_publicar|${torneo.prefix}`).setLabel('📢 Publicar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`gt_reiniciar_fase|${torneo.prefix}`).setLabel('⏪ Reiniciar Fase').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`gt_historial|${torneo.prefix}`).setLabel('📜 Historial').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`gt_inscripcion_embed|${torneo.prefix}`).setLabel('📣 Inscripción').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`gt_caracter|${torneo.prefix}`).setLabel(torneo.caracter === 'oficial' ? '🏆 Oficial' : '🎖️ Amistoso').setStyle(torneo.caracter === 'oficial' ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    const rows = [row1, row2, row3];

    // Row 4: team-specific options
    if (torneo.tipoCompeticion === 'equipos') {
        const autoLabel = torneo.alineacionesAutomaticas !== false ? '🔄 Alineaciones: Auto' : '✋ Alineaciones: Manual';
        const autoStyle = torneo.alineacionesAutomaticas !== false ? ButtonStyle.Success : ButtonStyle.Secondary;
        const row4 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gt_alin_toggle|${torneo.prefix}`).setLabel(autoLabel).setStyle(autoStyle),
        );
        rows.push(row4);
    }

    const panelMsg = await message.reply({ embeds: [embed], components: rows });

    const collector = panelMsg.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        time: 3600000
    });

    collector.on('collect', async i => {
        const freshTorneo = await Torneo.findOne({ prefix: torneo.prefix });
        if (!freshTorneo) return i.reply({ content: '❌ El torneo ya no existe.', flags: 64 });

        const [action] = i.customId.split('|');

        switch (action) {
            case 'gt_part':
                await handleGestionParticipantes(i, freshTorneo, panelMsg);
                break;
            case 'gt_tema':
                await handleEditarTema(i, freshTorneo, panelMsg);
                break;
            case 'gt_canal':
                await handleCambiarCanal(i, freshTorneo, panelMsg);
                break;
            case 'gt_borrar':
                await handleBorrarTorneo(i, freshTorneo, panelMsg);
                break;
            case 'gt_sortear':
                await handleSortearAdmin(i, freshTorneo, panelMsg);
                break;
            case 'gt_cruces':
                await handleEditarCruces(i, freshTorneo, panelMsg);
                break;
            case 'gt_res':
                await handleCargarResultadoAdmin(i, freshTorneo, panelMsg);
                break;
            case 'gt_fase':
                await handleAvanzarFaseAdmin(i, freshTorneo, panelMsg);
                break;
            case 'gt_refresh':
                await i.deferUpdate();
                await handleGestion(client, message, args, freshTorneo);
                await panelMsg.delete().catch(() => { });
                break;
            case 'gt_publicar':
                await handlePublicarActualizacion(i, freshTorneo);
                break;
            case 'gt_reiniciar_fase':
                await handleReiniciarFase(i, freshTorneo);
                break;
            case 'gt_historial':
                await handleHistorial(i, freshTorneo);
                break;
            case 'gt_inscripcion_embed':
                await handleInscripcionEmbed(i, freshTorneo);
                break;
            case 'gt_alin_toggle': {
                freshTorneo.alineacionesAutomaticas = freshTorneo.alineacionesAutomaticas === false ? true : false;
                await freshTorneo.save();
                const modeLabel = freshTorneo.alineacionesAutomaticas ? '🔄 Automático' : '✋ Manual';
                await i.reply({ content: `✅ Modo de alineaciones cambiado a **${modeLabel}**.\n${freshTorneo.alineacionesAutomaticas ? 'Los duelos se llenarán automáticamente al sortear.' : 'Los duelos quedarán vacíos y los coaches deberán usar el comando de alineación.'}`, flags: 64 });
                break;
            }
            case 'gt_caracter': {
                freshTorneo.caracter = freshTorneo.caracter === 'oficial' ? 'amistoso' : 'oficial';
                await freshTorneo.save();
                const carLabel = freshTorneo.caracter === 'oficial' ? '🏆 Oficial' : '🎖️ Amistoso';
                await i.reply({ content: `✅ Carácter del torneo cambiado a **${carLabel}**.\n${freshTorneo.caracter === 'oficial' ? 'Los títulos otorgados serán contabilizados como **Oficiales**.' : 'Los títulos otorgados serán contabilizados como **Amistosos** (no afectan el ranking histórico).'}`, flags: 64 });
                break;
            }
        }
    });
}

async function handleCambiarCanal(interaction, torneo, panelMsg) {
    const select = new ChannelSelectMenuBuilder()
        .setCustomId('gt_sel_channel_internal')
        .setPlaceholder('Selecciona el nuevo canal de resultados...')
        .addChannelTypes(ChannelType.GuildText);

    await interaction.reply({
        content: '📺 **Cambiar Canal de Resultados**\nSelecciona el canal donde se enviarán las actualizaciones:',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: 64
    });
    const resp = await interaction.fetchReply();

    const sel = await resp.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60000 }).catch(() => null);
    if (!sel) return;

    torneo.canalResultados = sel.values[0];
    await torneo.save();
    await sel.update({ content: `✅ Canal actualizado a <#${sel.values[0]}>.`, components: [] });
}

async function handleEditarCruces(interaction, torneo, panelMsg) {
    if (!torneo.fasesEliminatoria || torneo.fasesEliminatoria.length === 0 || Object.keys(torneo.llaves || {}).length === 0) {
        return interaction.reply({ content: '❌ Este torneo no cuenta con llaves o cruces eliminatorios generados aún.', flags: 64 });
    }

    let faseIndex = torneo.faseActual || 0;
    if (faseIndex >= torneo.fasesEliminatoria.length) faseIndex = 0;
    let faseSeleccionada = torneo.fasesEliminatoria[faseIndex];

    const generatePayload = () => {
        const matches = torneo.llaves[faseSeleccionada] || [];
        if (matches.length === 0) {
            return {
                content: `⚠️ No hay partidos cargados para la fase **${faseSeleccionada}**.`,
                embeds: [],
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('gt_cruces_back_main').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary)
                    )
                ],
                flags: 64
            };
        }

        const options = matches.map((m, idx) => {
            const eq1 = m.equipo1?.nombre || 'TBD';
            const eq2 = m.equipo2?.nombre || 'TBD';
            const estado = m.ganador ? `Finalizado (${m.resultado || 'Completado'})` : 'Pendiente';
            return {
                label: `Partido ${idx + 1}: ${eq1} vs ${eq2}`.slice(0, 100),
                description: `Fase: ${faseSeleccionada} • Estado: ${estado}`.slice(0, 100),
                value: `${idx}`,
                emoji: '⚔️'
            };
        });

        const rows = [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('gt_sel_cruce_match')
                    .setPlaceholder(`Selecciona el cruce a editar (${faseSeleccionada})...`)
                    .addOptions(options.slice(0, 25))
            )
        ];

        if (torneo.fasesEliminatoria.length > 1) {
            const phaseBtns = torneo.fasesEliminatoria.map((f, fIdx) =>
                new ButtonBuilder()
                    .setCustomId(`gt_cruce_fase_${fIdx}`)
                    .setLabel(f.slice(0, 20))
                    .setStyle(f === faseSeleccionada ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );
            rows.push(new ActionRowBuilder().addComponents(phaseBtns.slice(0, 5)));
        }

        const descMatches = matches.map((m, idx) => {
            const eq1 = m.equipo1?.nombre || 'TBD';
            const eq2 = m.equipo2?.nombre || 'TBD';
            const est = m.ganador ? `✅ *(${m.resultado || 'Fin'})*` : '⏳';
            return `> \`Partido ${idx + 1}:\` **${eq1}** vs **${eq2}** ${est}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`⚔️ Gestión de Cruces — ${torneo.nombre}`)
            .setDescription(`**Fase:** ${faseSeleccionada}\n\n${descMatches}\n\n*Seleccioná un partido en el menú para modificar sus integrantes:*`)
            .setColor(torneo.tema?.acento || '#e94560');

        return {
            content: '',
            embeds: [embed],
            components: rows,
            flags: 64
        };
    };

    await interaction.reply(generatePayload());
    const resp = await interaction.fetchReply();

    const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 180000 });

    collector.on('collect', async i => {
        if (i.customId === 'gt_cruces_back_main') {
            return i.update(generatePayload());
        }

        if (i.customId.startsWith('gt_cruce_fase_')) {
            const fIdx = parseInt(i.customId.replace('gt_cruce_fase_', ''));
            if (torneo.fasesEliminatoria[fIdx]) {
                faseSeleccionada = torneo.fasesEliminatoria[fIdx];
                return i.update(generatePayload());
            }
        }

        if (i.customId === 'gt_sel_cruce_match') {
            const matchIdx = parseInt(i.values[0]);
            const matches = torneo.llaves[faseSeleccionada] || [];
            const match = matches[matchIdx];
            if (!match) return i.reply({ content: '❌ Partido no encontrado.', flags: 64 });

            const localName = match.equipo1?.nombre || 'TBD';
            const visitName = match.equipo2?.nombre || 'TBD';

            const rowActions = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_cruce_eq1').setLabel('🔵 Cambiar Local').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_cruce_eq2').setLabel('🔴 Cambiar Visitante').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_cruce_swap').setLabel('🔀 Invertir Posiciones').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('gt_cruces_back_main').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary)
            );

            await i.update({
                content: `⚔️ **Editando Cruce — ${faseSeleccionada} (Partido ${matchIdx + 1})**\n\n` +
                         `🔵 **Local (Equipo 1):** ${localName} (<@${match.equipo1?.discordId || 'Sin Discord'}>)\n` +
                         `🔴 **Visitante (Equipo 2):** ${visitName} (<@${match.equipo2?.discordId || 'Sin Discord'}>)\n` +
                         `📊 **Estado:** ${match.ganador ? `Finalizado (${match.resultado || 'Completado'})` : 'Pendiente'}\n\n` +
                         `¿Qué cambio deseas realizar?`,
                embeds: [],
                components: [rowActions]
            });

            const actionInteract = await resp.awaitMessageComponent({ filter: iA => iA.user.id === interaction.user.id, time: 60000 }).catch(() => null);
            if (!actionInteract) return;

            if (actionInteract.customId === 'gt_cruces_back_main') {
                return actionInteract.update(generatePayload());
            }

            if (actionInteract.customId === 'btn_cruce_swap') {
                const temp = match.equipo1;
                match.equipo1 = match.equipo2;
                match.equipo2 = temp;

                if (torneo.tipoCompeticion === 'equipos') {
                    const eqL = torneo.equipos.find(e => e.propietario === match.equipo1?.discordId || e.discordId === match.equipo1?.discordId || e.nombre === match.equipo1?.nombre);
                    const eqV = torneo.equipos.find(e => e.propietario === match.equipo2?.discordId || e.discordId === match.equipo2?.discordId || e.nombre === match.equipo2?.nombre);
                    if (eqL && eqV) {
                        match.duelosIndividuales = torneo.alineacionesAutomaticas !== false ? generarDuelosIndividuales(eqL, eqV) : generarSlotsVacios(3);
                    }
                }

                await torneo.save();
                invalidateCache(torneo.prefix);
                return actionInteract.update({
                    content: `✅ **Posiciones invertidas:** Ahora es **${match.equipo1?.nombre}** (Local) vs **${match.equipo2?.nombre}** (Visitante).`,
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gt_cruces_back_main').setLabel('🔙 Volver a Lista de Cruces').setStyle(ButtonStyle.Secondary))]
                });
            }

            if (actionInteract.customId === 'btn_cruce_eq1' || actionInteract.customId === 'btn_cruce_eq2') {
                const targetSlot = actionInteract.customId === 'btn_cruce_eq1' ? 1 : 2;
                const slotName = targetSlot === 1 ? 'Local (Equipo 1)' : 'Visitante (Equipo 2)';

                const partOptions = (torneo.equipos || []).slice(0, 23).map((eq, eIdx) => ({
                    label: `${eIdx + 1}. ${eq.nombre}`.slice(0, 100),
                    description: `ID: ${eq.discordId || 'Sin Discord'}`,
                    value: `team_${eIdx}`,
                    emoji: '👤'
                }));

                partOptions.push({
                    label: 'BYE (Pase Libre)',
                    description: 'Asignar pase libre / victoria automática',
                    value: 'team_bye',
                    emoji: '⏩'
                });

                partOptions.push({
                    label: 'TBD (A Definir / Vacío)',
                    description: 'Dejar slot pendiente',
                    value: 'team_tbd',
                    emoji: '❓'
                });

                const selTeamMenu = new StringSelectMenuBuilder()
                    .setCustomId('gt_sel_team_for_cruce')
                    .setPlaceholder(`Selecciona el nuevo ${slotName}...`)
                    .addOptions(partOptions);

                const teamRow = new ActionRowBuilder().addComponents(selTeamMenu);
                const cancelRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('gt_cruces_back_main').setLabel('🔙 Cancelar').setStyle(ButtonStyle.Secondary)
                );

                await actionInteract.update({
                    content: `📝 **Seleccionar ${slotName} para Partido ${matchIdx + 1} (${faseSeleccionada})**\n\nElige un participante de la lista:`,
                    components: [teamRow, cancelRow]
                });

                const teamInteract = await resp.awaitMessageComponent({ filter: iT => iT.user.id === interaction.user.id, time: 60000 }).catch(() => null);
                if (!teamInteract) return;

                if (teamInteract.customId === 'gt_cruces_back_main') {
                    return teamInteract.update(generatePayload());
                }

                if (teamInteract.customId === 'gt_sel_team_for_cruce') {
                    const chosen = teamInteract.values[0];
                    let nuevoObj = null;

                    if (chosen === 'team_bye') {
                        nuevoObj = { nombre: 'BYE', discordId: 'BYE' };
                    } else if (chosen === 'team_tbd') {
                        nuevoObj = { nombre: 'TBD', discordId: null };
                    } else {
                        const tIdx = parseInt(chosen.replace('team_', ''));
                        const eq = torneo.equipos[tIdx];
                        if (eq) {
                            nuevoObj = {
                                nombre: eq.nombre,
                                discordId: eq.discordId || eq.propietario || null,
                                id: eq.id || eq.discordId || null,
                                avatar: eq.avatar || null
                            };
                        }
                    }

                    if (!nuevoObj) return teamInteract.reply({ content: '❌ Participante inválido.', flags: 64 });

                    if (targetSlot === 1) match.equipo1 = nuevoObj;
                    else match.equipo2 = nuevoObj;

                    if (torneo.tipoCompeticion === 'equipos' && match.equipo1?.discordId && match.equipo2?.discordId && match.equipo2.discordId !== 'BYE') {
                        const eqL = torneo.equipos.find(e => e.propietario === match.equipo1.discordId || e.discordId === match.equipo1.discordId || e.nombre === match.equipo1.nombre);
                        const eqV = torneo.equipos.find(e => e.propietario === match.equipo2.discordId || e.discordId === match.equipo2.discordId || e.nombre === match.equipo2.nombre);
                        if (eqL && eqV) {
                            match.duelosIndividuales = torneo.alineacionesAutomaticas !== false ? generarDuelosIndividuales(eqL, eqV) : generarSlotsVacios(3);
                        }
                    }

                    await torneo.save();
                    invalidateCache(torneo.prefix);

                    return teamInteract.update({
                        content: `✅ **${slotName}** actualizado a **${nuevoObj.nombre}** para el **Partido ${matchIdx + 1}**.\n\n` +
                                 `📌 **Nuevo cruce:** **${match.equipo1?.nombre || 'TBD'}** vs **${match.equipo2?.nombre || 'TBD'}**`,
                        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gt_cruces_back_main').setLabel('🔙 Volver a Lista de Cruces').setStyle(ButtonStyle.Secondary))]
                    });
                }
            }
        }
    });
}

async function handleGestionParticipantes(interaction, torneo, panelMsg) {
    if (torneo.equipos.length === 0) return interaction.reply({ content: '❌ No hay participantes inscritos.', flags: 64 });

    let pagina = 0;
    let vista = 'lista'; // 'lista' | 'resumen_grupos'
    const ITEMS_PER_PAGE = 25;

    const generatePayload = () => {
        if (vista === 'resumen_grupos') {
            const groupMap = new Map();
            torneo.equipos.forEach(eq => {
                const gName = eq.grupo ? `Grupo ${eq.grupo}` : 'Sin Grupo Asignado';
                if (!groupMap.has(gName)) groupMap.set(gName, []);
                groupMap.get(gName).push(eq);
            });

            const sortedGroups = Array.from(groupMap.entries()).sort(([a], [b]) => {
                if (a.startsWith('Sin Grupo')) return 1;
                if (b.startsWith('Sin Grupo')) return -1;
                return a.localeCompare(b);
            });

            const embed = new EmbedBuilder()
                .setTitle(`🏷️ Distribución de Grupos — ${torneo.nombre}`)
                .setColor(torneo.tema?.acento || '#0099ff')
                .setDescription(
                    sortedGroups.map(([gName, list]) =>
                        `### 📌 ${gName} (${list.length})\n` +
                        list.map((e, idx) => `> \`${idx + 1}.\` **${e.nombre}** (<@${e.discordId || 'Sin Discord'}>)`).join('\n')
                    ).join('\n\n') || '*No hay participantes.*'
                )
                .setFooter({ text: 'Volvé a la lista para seleccionar un participante y editar su grupo.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gt_part_back_lista').setLabel('🔙 Volver a la Lista').setStyle(ButtonStyle.Primary)
            );

            return {
                content: '',
                embeds: [embed],
                components: [row],
                flags: 64
            };
        }

        const totalPages = Math.ceil(torneo.equipos.length / ITEMS_PER_PAGE) || 1;
        pagina = Math.min(Math.max(0, pagina), totalPages - 1);
        const pageItems = torneo.equipos.slice(pagina * ITEMS_PER_PAGE, (pagina + 1) * ITEMS_PER_PAGE);

        const select = new StringSelectMenuBuilder()
            .setCustomId(`gt_sel_part_internal`)
            .setPlaceholder('Selecciona un participante para gestionar...')
            .addOptions(pageItems.map((e, idx) => {
                const realIdx = pagina * ITEMS_PER_PAGE + idx;
                const groupTag = e.grupo ? ` [G: ${e.grupo}]` : '';
                return {
                    label: `${realIdx + 1}. ${e.nombre}${groupTag}`.slice(0, 100),
                    description: `ID: ${e.discordId || 'Sin Discord'}${e.grupo ? ` | Grupo: ${e.grupo}` : ' | Sin Grupo'}`,
                    value: `${realIdx}`
                };
            }));

        const rows = [new ActionRowBuilder().addComponents(select)];

        const navComponents = [];
        if (totalPages > 1) {
            navComponents.push(
                new ButtonBuilder().setCustomId('gt_part_prev').setLabel('◀️ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
                new ButtonBuilder().setCustomId('gt_part_info').setLabel(`Página ${pagina + 1}/${totalPages} (${torneo.equipos.length} participantes)`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('gt_part_next').setLabel('Siguiente ▶️').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPages - 1),
            );
        }
        navComponents.push(
            new ButtonBuilder().setCustomId('gt_part_resumen').setLabel('🏷️ Resumen de Grupos').setStyle(ButtonStyle.Secondary)
        );
        rows.push(new ActionRowBuilder().addComponents(navComponents));

        return {
            content: '👥 **Gestión de Participantes**\nSelecciona a quién quieres editar, mover de grupo o eliminar:',
            embeds: [],
            components: rows,
            flags: 64
        };
    };

    await interaction.reply(generatePayload());
    const resp = await interaction.fetchReply();

    const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 180000 });

    collector.on('collect', async i => {
        if (i.customId === 'back_p') {
            return i.update(generatePayload());
        }
        if (i.customId === 'gt_part_resumen') {
            vista = 'resumen_grupos';
            return i.update(generatePayload());
        }
        if (i.customId === 'gt_part_back_lista') {
            vista = 'lista';
            return i.update(generatePayload());
        }
        if (i.customId === 'gt_part_prev') {
            if (pagina > 0) pagina--;
            return i.update(generatePayload());
        }
        if (i.customId === 'gt_part_next') {
            pagina++;
            return i.update(generatePayload());
        }

        if (i.customId === 'gt_sel_part_internal') {
            const idx = parseInt(i.values[0]);
            const equipo = torneo.equipos[idx];
            if (!equipo) return i.reply({ content: '❌ Participante no encontrado.', flags: 64 });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('edit_p').setLabel('📝 Editar Datos').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('group_p').setLabel('🔀 Cambiar Grupo').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('del_p').setLabel('🗑️ Eliminar').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('back_p').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary)
            );

            const groupStatus = equipo.grupo ? `**Grupo ${equipo.grupo}**` : '*Sin grupo asignado*';
            await i.update({
                content: `👤 **Participante:** ${equipo.nombre} (<@${equipo.discordId || 'Sin Discord'}>)\n🏷️ **Grupo actual:** ${groupStatus}`,
                embeds: [],
                components: [row]
            });

            const actionBtn = await resp.awaitMessageComponent({ filter: iA => iA.user.id === interaction.user.id, time: 60000 }).catch(() => null);
            if (!actionBtn) return;

            if (actionBtn.customId === 'back_p') {
                return actionBtn.update(generatePayload());
            }

            if (actionBtn.customId === 'del_p') {
                torneo.equipos.splice(idx, 1);
                await torneo.save();
                invalidateCache(torneo.prefix);
                return actionBtn.update({ content: `✅ **${equipo.nombre}** ha sido eliminado del torneo.`, components: [] });
            }

            if (actionBtn.customId === 'group_p') {
                const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                let suggestedGroups = [];
                const numGrupos = torneo.cantidadGrupos || 4;
                for (let k = 0; k < Math.min(numGrupos, 26); k++) {
                    suggestedGroups.push(alphabet[k]);
                }
                torneo.equipos.forEach(eq => {
                    if (eq.grupo && !suggestedGroups.includes(eq.grupo.toUpperCase())) {
                        suggestedGroups.push(eq.grupo.toUpperCase());
                    }
                });

                const groupOptions = suggestedGroups.slice(0, 20).map(g => {
                    const cantEnG = torneo.equipos.filter(eq => eq.grupo === g).length;
                    const esActual = equipo.grupo === g;
                    return {
                        label: `Grupo ${g} (${cantEnG} part.)${esActual ? ' [Actual]' : ''}`.slice(0, 100),
                        description: `Asignar a ${equipo.nombre} al Grupo ${g}`,
                        value: `g_${g}`,
                        emoji: '🏷️'
                    };
                });

                groupOptions.push({
                    label: '✏️ Otro Grupo (Personalizado)...',
                    description: 'Ingresar una letra o nombre personalizado',
                    value: 'g_custom',
                    emoji: '✍️'
                });

                groupOptions.push({
                    label: '❌ Sin Grupo',
                    description: 'Quitar asignación de grupo a este participante',
                    value: 'g_none',
                    emoji: '🗑️'
                });

                const groupSelect = new StringSelectMenuBuilder()
                    .setCustomId('gt_sel_group_target')
                    .setPlaceholder('Selecciona el nuevo grupo...')
                    .addOptions(groupOptions);

                const groupRow = new ActionRowBuilder().addComponents(groupSelect);
                const cancelRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('back_p').setLabel('🔙 Cancelar').setStyle(ButtonStyle.Secondary)
                );

                await actionBtn.update({
                    content: `🔀 **Cambiar Grupo para:** ${equipo.nombre}\n**Grupo Actual:** ${groupStatus}\n\nSelecciona el grupo de destino:`,
                    components: [groupRow, cancelRow]
                });

                const groupInteract = await resp.awaitMessageComponent({ filter: iG => iG.user.id === interaction.user.id, time: 60000 }).catch(() => null);
                if (!groupInteract) return;

                if (groupInteract.customId === 'back_p') {
                    return groupInteract.update(generatePayload());
                }

                if (groupInteract.customId === 'gt_sel_group_target') {
                    const chosen = groupInteract.values[0];

                    if (chosen === 'g_custom') {
                        const customModal = new ModalBuilder()
                            .setCustomId(`modal_custom_g_${idx}`)
                            .setTitle(`Grupo para ${equipo.nombre}`.slice(0, 45));

                        const inputG = new TextInputBuilder()
                            .setCustomId('input_grupo')
                            .setLabel('Nombre o Letra del Grupo')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Ej: A, B, C, Grupo 1...')
                            .setValue(equipo.grupo || '')
                            .setMaxLength(20)
                            .setRequired(true);

                        customModal.addComponents(new ActionRowBuilder().addComponents(inputG));
                        await groupInteract.showModal(customModal);

                        const submitCustom = await interaction.awaitModalSubmit({
                            filter: mI => mI.customId === `modal_custom_g_${idx}` && mI.user.id === interaction.user.id,
                            time: 60000
                        }).catch(() => null);

                        if (!submitCustom) return;
                        const nuevoG = submitCustom.fields.getTextInputValue('input_grupo').trim().toUpperCase();
                        equipo.grupo = nuevoG;
                        if (!torneo.gruposHabilitados) torneo.gruposHabilitados = true;

                        await torneo.save();
                        invalidateCache(torneo.prefix);
                        await submitCustom.reply({ content: `✅ **${equipo.nombre}** asignado al **Grupo ${nuevoG}** correctamente.`, flags: 64 });
                        return resp.edit(generatePayload()).catch(() => {});
                    } else if (chosen === 'g_none') {
                        delete equipo.grupo;
                        await torneo.save();
                        invalidateCache(torneo.prefix);
                        return groupInteract.update({ content: `✅ Se ha quitado la asignación de grupo a **${equipo.nombre}**.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_p').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary))] });
                    } else {
                        const nuevoG = chosen.replace('g_', '');
                        equipo.grupo = nuevoG;
                        if (!torneo.gruposHabilitados) torneo.gruposHabilitados = true;

                        await torneo.save();
                        invalidateCache(torneo.prefix);
                        return groupInteract.update({ content: `✅ **${equipo.nombre}** ahora se encuentra en el **Grupo ${nuevoG}**.`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('back_p').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary))] });
                    }
                }
                return;
            }

            if (actionBtn.customId === 'edit_p') {
                const modal = new ModalBuilder().setCustomId(`modal_edit_p_${idx}`).setTitle(`Editar: ${equipo.nombre}`.slice(0, 45));
                const nLabel = new LabelBuilder()
                    .setLabel('Nuevo Nombre')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('nombre')
                            .setStyle(TextInputStyle.Short)
                            .setValue(equipo.nombre)
                            .setRequired(true)
                    );

                if (torneo.tipoJugadores === 'teams') {
                    const fileInput = new FileUploadBuilder().setCustomId('logo').setMaxValues(1).setRequired(false);
                    const labelInput = new LabelBuilder().setLabel("Nuevo Logo (Opcional)").setFileUploadComponent(fileInput);
                    modal.addLabelComponents(nLabel, labelInput);
                } else {
                    modal.addLabelComponents(nLabel);
                }

                await actionBtn.showModal(modal);
                const submit = await actionBtn.awaitModalSubmit({ time: 600000 }).catch(() => null);
                if (!submit) return;

                const nuevoNombre = submit.fields.getTextInputValue('nombre');
                equipo.nombre = nuevoNombre;

                if (torneo.tipoJugadores === 'countries') {
                    const flag = getFlagUrl(nuevoNombre);
                    if (flag) equipo.avatar = flag;
                } else if (torneo.tipoJugadores === 'teams') {
                    const attachment = submit.fields.getField("logo")?.attachments.first();
                    if (attachment) {
                        const local = await descargarImagen(attachment.url, `${torneo.prefix}_edit_${equipo.discordId}`);
                        if (local) equipo.avatar = local;
                    }
                }

                await torneo.save();
                invalidateCache(torneo.prefix);
                await submit.reply({ content: `✅ Datos de **${nuevoNombre}** actualizados correctamente.`, flags: 64 });
            }
        }
    });
}

async function handleCargarResultadoAdmin(interaction, torneo, panelMsg) {
    let esGrupo = false;
    let allMatches = [];

    if (torneo.enfrentamientosGrupos?.length > 0) {
        esGrupo = true;
        allMatches = torneo.enfrentamientosGrupos.map((e, idx) => ({
            ...e,
            _idx: idx,
            localNombre: e.local || e.equipo1?.nombre || 'TBD',
            visitanteNombre: e.visitante || e.equipo2?.nombre || 'TBD',
            completado: !!e.completado || !!e.ganador,
            resultado: e.resultado,
        }));
    } else if (torneo.fasesEliminatoria?.length > 0) {
        const fase = torneo.fasesEliminatoria[torneo.faseActual];
        allMatches = (torneo.llaves[fase] || []).map((e, idx) => ({
            ...e,
            _idx: idx,
            localNombre: e.equipo1?.nombre || 'TBD',
            visitanteNombre: e.equipo2?.nombre || 'TBD',
            completado: !!e.ganador,
            resultado: e.resultado,
        }));
    }

    if (allMatches.length === 0) return interaction.reply({ content: '❌ No hay partidos configurados para este torneo.', flags: 64 });

    let filtro = allMatches.some(m => !m.completado) ? 'pendientes' : 'jugados';
    let filtroParticipante = '';
    let pagina = 0;
    const ITEMS_PER_PAGE = 25;

    const generatePayload = () => {
        let filtered = [];
        if (filtro === 'pendientes') filtered = allMatches.filter(m => !m.completado);
        else if (filtro === 'jugados') filtered = allMatches.filter(m => m.completado);
        else filtered = allMatches;

        if (filtroParticipante) {
            const q = filtroParticipante.toLowerCase().trim();
            filtered = filtered.filter(m =>
                (m.localNombre && m.localNombre.toLowerCase().includes(q)) ||
                (m.visitanteNombre && m.visitanteNombre.toLowerCase().includes(q)) ||
                (m.grupo && String(m.grupo).toLowerCase().includes(q))
            );
        }

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        pagina = Math.min(Math.max(0, pagina), totalPages - 1);
        const pageMatches = filtered.slice(pagina * ITEMS_PER_PAGE, (pagina + 1) * ITEMS_PER_PAGE);

        const cantPend = allMatches.filter(m => !m.completado).length;
        const cantJug = allMatches.filter(m => m.completado).length;

        const rows = [];

        if (pageMatches.length > 0) {
            const select = new StringSelectMenuBuilder()
                .setCustomId(`gt_sel_match_internal`)
                .setPlaceholder(filtro === 'jugados' ? 'Selecciona un partido para anular...' : 'Selecciona el partido a cargar...')
                .addOptions(pageMatches.map(e => ({
                    label: `${e.localNombre} vs ${e.visitanteNombre}`.slice(0, 100),
                    description: e.completado ? `✅ Finalizado: ${e.resultado || 'Completado'} (Clic para anular)` : `⏳ Pendiente ${e.grupo ? `(Grupo ${e.grupo})` : ''}`.slice(0, 100),
                    value: `${e._idx}`
                })));
            rows.push(new ActionRowBuilder().addComponents(select));
        }

        const rowFiltros = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('gt_f_pend').setLabel(`⏳ Pendientes (${cantPend})`).setStyle(filtro === 'pendientes' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('gt_f_jug').setLabel(`✅ Jugados (${cantJug})`).setStyle(filtro === 'jugados' ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('gt_f_todos').setLabel(`📋 Todos (${allMatches.length})`).setStyle(filtro === 'todos' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            filtroParticipante
                ? new ButtonBuilder().setCustomId('gt_f_part_clear').setLabel(`❌ Quitar: ${filtroParticipante.slice(0, 10)}`).setStyle(ButtonStyle.Danger)
                : new ButtonBuilder().setCustomId('gt_f_part_search').setLabel('🔍 Buscar Part.').setStyle(ButtonStyle.Secondary)
        );
        rows.push(rowFiltros);

        if (totalPages > 1) {
            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('gt_res_prev').setLabel('◀️ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
                new ButtonBuilder().setCustomId('gt_res_info').setLabel(`Página ${pagina + 1}/${totalPages} (${filtered.length} partidos)`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('gt_res_next').setLabel('Siguiente ▶️').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPages - 1),
            );
            rows.push(navRow);
        }

        const title = filtro === 'pendientes' ? '⏳ Partidos Pendientes' : (filtro === 'jugados' ? '✅ Partidos Jugados (Anulables)' : '📋 Todos los Partidos');
        const partInfo = filtroParticipante ? ` • 🔍 *Filtro: "${filtroParticipante}"*` : '';
        return {
            content: `⚙️ **Gestión de Resultados — ${torneo.nombre}**\nMostrando **${title}** (${filtered.length} partidos)${partInfo}:`,
            components: rows,
            flags: 64
        };
    };

    await interaction.reply(generatePayload());
    const resp = await interaction.fetchReply();

    const collector = resp.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 180000 });

    collector.on('collect', async i => {
        if (i.customId === 'gt_f_pend') {
            filtro = 'pendientes'; pagina = 0; return i.update(generatePayload());
        }
        if (i.customId === 'gt_f_jug') {
            filtro = 'jugados'; pagina = 0; return i.update(generatePayload());
        }
        if (i.customId === 'gt_f_todos') {
            filtro = 'todos'; pagina = 0; return i.update(generatePayload());
        }
        if (i.customId === 'gt_f_part_clear') {
            filtroParticipante = ''; pagina = 0; return i.update(generatePayload());
        }
        if (i.customId === 'gt_f_part_search') {
            const modal = new ModalBuilder()
                .setCustomId('gt_modal_search_part')
                .setTitle('Buscar Participante');

            const inputPart = new TextInputBuilder()
                .setCustomId('input_gt_part')
                .setLabel('Nombre del participante o equipo')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: Platubi, Equipo A...')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50);

            modal.addComponents(new ActionRowBuilder().addComponents(inputPart));
            await i.showModal(modal);

            const modalResp = await interaction.awaitModalSubmit({
                filter: mI => mI.customId === 'gt_modal_search_part' && mI.user.id === interaction.user.id,
                time: 60000
            }).catch(() => null);

            if (!modalResp) return;
            const q = modalResp.fields.getTextInputValue('input_gt_part').trim();
            filtroParticipante = q;
            pagina = 0;
            return modalResp.update(generatePayload());
        }
        if (i.customId === 'gt_res_prev') {
            if (pagina > 0) pagina--; return i.update(generatePayload());
        }
        if (i.customId === 'gt_res_next') {
            pagina++; return i.update(generatePayload());
        }
        if (i.customId === 'gt_cancel_anular') {
            return i.update(generatePayload());
        }

        // Confirmar anulación de resultado en torneo
        if (i.customId.startsWith('gt_confirm_anular_')) {
            const matchIdx = parseInt(i.customId.replace('gt_confirm_anular_', ''));
            const fresh = await Torneo.findOne({ prefix: torneo.prefix });
            if (!fresh) return i.reply({ content: '❌ Torneo no encontrado.', flags: 64 });

            if (esGrupo) {
                const m = fresh.enfrentamientosGrupos[matchIdx];
                if (m) {
                    const prevResultado = m.resultado || '';
                    const lName = m.local;
                    const vName = m.visitante;
                    const isPrevDoubleWO = m.isDoubleWO || prevResultado === 'WO - WO' || prevResultado === 'X-X';
                    const isPrevWO = m.isWO || prevResultado.includes('WO') || prevResultado === '3-0' || prevResultado === '0-3';

                    const [prevGlRaw, prevGvRaw] = prevResultado.replace(/\s*\([^)]*\)/g, '').split('-').map(s => parseInt(s.trim(), 10));
                    const prevGl = isNaN(prevGlRaw) ? 0 : prevGlRaw;
                    const prevGv = isNaN(prevGvRaw) ? 0 : prevGvRaw;

                    m.resultado = 'Pendiente';
                    m.completado = false;
                    m.ganador = null;
                    m.isWO = false;
                    m.isDoubleWO = false;

                    if (Array.isArray(fresh.equipos)) {
                        const tL = fresh.equipos.find(eq => eq.nombre === lName);
                        const tV = fresh.equipos.find(eq => eq.nombre === vName);
                        if (tL && tV) {
                            tL.pj = Math.max(0, (tL.pj || 0) - 1);
                            tV.pj = Math.max(0, (tV.pj || 0) - 1);

                            if (isPrevDoubleWO) {
                                tL.pp = Math.max(0, (tL.pp || 0) - 1);
                                tL.pe = Math.max(0, (tL.pe || 0) - 1);
                                tL.gc = Math.max(0, (tL.gc || 0) - 3);
                                tL.puntos = (tL.puntos || 0) + 2;

                                tV.pp = Math.max(0, (tV.pp || 0) - 1);
                                tV.pe = Math.max(0, (tV.pe || 0) - 1);
                                tV.gc = Math.max(0, (tV.gc || 0) - 3);
                                tV.puntos = (tV.puntos || 0) + 2;
                            } else {
                                tL.gf = Math.max(0, (tL.gf || 0) - prevGl);
                                tL.gc = Math.max(0, (tL.gc || 0) - prevGv);
                                tV.gf = Math.max(0, (tV.gf || 0) - prevGv);
                                tV.gc = Math.max(0, (tV.gc || 0) - prevGl);

                                if (prevGl > prevGv) {
                                    tL.pg = Math.max(0, (tL.pg || 0) - 1);
                                    tL.puntos = Math.max(0, (tL.puntos || 0) - 3);
                                    tV.pp = Math.max(0, (tV.pp || 0) - 1);
                                    if (isPrevWO) {
                                        tV.pe = Math.max(0, (tV.pe || 0) - 1);
                                        tV.puntos = (tV.puntos || 0) + 2;
                                    }
                                } else if (prevGv > prevGl) {
                                    tV.pg = Math.max(0, (tV.pg || 0) - 1);
                                    tV.puntos = Math.max(0, (tV.puntos || 0) - 3);
                                    tL.pp = Math.max(0, (tL.pp || 0) - 1);
                                    if (isPrevWO) {
                                        tL.pe = Math.max(0, (tL.pe || 0) - 1);
                                        tL.puntos = (tL.puntos || 0) + 2;
                                    }
                                } else {
                                    tL.pe = Math.max(0, (tL.pe || 0) - 1);
                                    tV.pe = Math.max(0, (tV.pe || 0) - 1);
                                    tL.puntos = Math.max(0, (tL.puntos || 0) - 1);
                                    tV.puntos = Math.max(0, (tV.puntos || 0) - 1);
                                }
                            }
                        }
                    }
                }
            } else {
                const fase = fresh.fasesEliminatoria[fresh.faseActual];
                const m = fresh.llaves[fase]?.[matchIdx];
                if (m) {
                    if (m.ida) { m.ida.golesLocal = null; m.ida.golesVisitante = null; m.ida.finalizado = false; m.ida.isWO = false; m.ida.isDoubleWO = false; }
                    if (m.vuelta) { m.vuelta.golesLocal = null; m.vuelta.golesVisitante = null; m.vuelta.finalizado = false; m.vuelta.isWO = false; m.vuelta.isDoubleWO = false; }
                    if (m.desempate) { m.desempate.golesLocal = null; m.desempate.golesVisitante = null; m.desempate.finalizado = false; m.desempate.isWO = false; m.desempate.isDoubleWO = false; }
                    m.ganador = null;
                    m.resultado = null;
                    m.isWO = false;
                    m.isDoubleWO = false;
                }
            }

            await fresh.save();
            allMatches[matchIdx].completado = false;
            allMatches[matchIdx].resultado = 'Pendiente';

            await i.update(generatePayload());
            return i.followUp({ content: `✅ **Resultado anulado con éxito:** El partido volvió a estado pendiente y las tablas del torneo fueron actualizadas.`, flags: 64 });
        }

        // Selección de partido
        if (i.customId === 'gt_sel_match_internal') {
            const idx = parseInt(i.values[0]);
            const match = allMatches[idx];
            if (!match) return i.reply({ content: '❌ Partido no encontrado.', flags: 64 });

            const localNombre = match.localNombre;
            const visitanteNombre = match.visitanteNombre;

            // Si ya está completado -> Confirmación de anulación
            if (match.completado) {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`gt_confirm_anular_${idx}`).setLabel('🗑️ Confirmar Anulación').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('gt_cancel_anular').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
                );

                return i.update({
                    content: `⚠️ **¿Estás seguro de que deseas anular el resultado del siguiente partido?**\n\n` +
                        `📌 **Encuentro:** ${localNombre} vs ${visitanteNombre}\n` +
                        `📊 **Resultado registrado:** ${match.resultado || 'Completado'}\n\n` +
                        `ℹ️ *Esta acción restablecerá el partido a estado pendiente y recalculará la tabla de posiciones del torneo.*`,
                    components: [confirmRow]
                });
            }

            // Si está pendiente -> Flujo de carga de resultado
            let tipoMatch = 'unico';
            let targetInteraction = i;

            if (!esGrupo && torneo.tipoEncuentro === 'ida_vuelta') {
                const subSelect = new StringSelectMenuBuilder().setCustomId('gt_sel_t_res_internal').setPlaceholder('¿Qué partido?').addOptions([
                    { label: 'IDA', value: 'ida' }, { label: 'VUELTA', value: 'vuelta' }, { label: 'DESEMPATE', value: 'desempate' }
                ]);
                await i.update({ content: `📊 Partido para: **${localNombre} vs ${visitanteNombre}**`, components: [new ActionRowBuilder().addComponents(subSelect)] });
                const selTipo = await resp.awaitMessageComponent({ filter: iT => iT.user.id === interaction.user.id, time: 60000 }).catch(() => null);
                if (!selTipo) return;
                tipoMatch = selTipo.values[0];
                targetInteraction = selTipo;
            }

            const glName = (tipoMatch === 'vuelta') ? visitanteNombre : localNombre;
            const gvName = (tipoMatch === 'vuelta') ? localNombre : visitanteNombre;

            const modal = new ModalBuilder()
                .setCustomId(`modal_res_admin_${idx}`)
                .setTitle(`${tipoMatch.toUpperCase()}: ${glName} vs ${gvName}`.slice(0, 45));

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles de ${glName} (o X para WO)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 2 o X')),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles de ${gvName} (o X para WO)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 1 o X'))
            );

            await targetInteraction.showModal(modal);
            const submit = await interaction.awaitModalSubmit({ filter: mI => mI.customId === `modal_res_admin_${idx}` && mI.user.id === interaction.user.id, time: 600000 }).catch(() => null);
            if (!submit) return;

            const glInput = submit.fields.getTextInputValue('gl').trim().toUpperCase();
            const gvInput = submit.fields.getTextInputValue('gv').trim().toUpperCase();

            let isDoubleWO = false;
            let isWO = false;
            let gl = 0;
            let gv = 0;

            if (glInput === 'X' && gvInput === 'X') {
                isDoubleWO = true;
                gl = 0;
                gv = 0;
            } else if (glInput === 'X' && !isNaN(parseInt(gvInput, 10))) {
                // Local dio WO (pierde 0-3 por WO)
                isWO = true;
                gl = 0;
                gv = 3;
            } else if (gvInput === 'X' && !isNaN(parseInt(glInput, 10))) {
                // Visitante dio WO (pierde 3-0 por WO)
                isWO = true;
                gl = 3;
                gv = 0;
            } else {
                gl = parseInt(glInput, 10);
                gv = parseInt(gvInput, 10);
                if (isNaN(gl) || isNaN(gv)) {
                    return submit.reply({ content: '❌ Goles inválidos. Usa números (ej: 3, 0) o `X` para W.O.', flags: 64 });
                }
                if ((gl === 3 && gv === 0) || (gl === 0 && gv === 3)) {
                    isWO = true;
                } else if (gl === 0 && gv === 0) {
                    isDoubleWO = true;
                }
            }

            const fresh = await Torneo.findOne({ prefix: torneo.prefix });
            let resDisplay = '';

            if (esGrupo) {
                const m = fresh.enfrentamientosGrupos.find(e => e.local === localNombre && e.visitante === visitanteNombre && !e.completado);
                if (m) {
                    m.isWO = isWO;
                    m.isDoubleWO = isDoubleWO;
                    m.completado = true;

                    if (isDoubleWO) {
                        m.resultado = 'WO - WO';
                        m.ganador = 'Sin Ganador';
                        resDisplay = 'WO - WO (Doble W.O.)';
                    } else {
                        m.resultado = `${gl}-${gv}${isWO ? ' (WO)' : ''}`;
                        if (gl > gv) m.ganador = localNombre;
                        else if (gv > gl) m.ganador = visitanteNombre;
                        else m.ganador = 'Empate';
                        resDisplay = `${gl} - ${gv}${isWO ? ' (WO)' : ''}`;
                    }

                    const tL = fresh.equipos.find(eq => eq.nombre === localNombre);
                    const tV = fresh.equipos.find(eq => eq.nombre === visitanteNombre);
                    if (tL && tV) {
                        tL.pj = (tL.pj || 0) + 1;
                        tV.pj = (tV.pj || 0) + 1;

                        if (isDoubleWO) {
                            // Doble WO: -2 puntos, -3 DG (vía +3 GC) y cuenta como PP/PE
                            tL.pp = (tL.pp || 0) + 1;
                            tL.pe = (tL.pe || 0) + 1;
                            tL.gc = (tL.gc || 0) + 3;
                            tL.puntos = (tL.puntos || 0) - 2;

                            tV.pp = (tV.pp || 0) + 1;
                            tV.pe = (tV.pe || 0) + 1;
                            tV.gc = (tV.gc || 0) + 3;
                            tV.puntos = (tV.puntos || 0) - 2;
                        } else {
                            tL.gf = (tL.gf || 0) + gl;
                            tL.gc = (tL.gc || 0) + gv;
                            tV.gf = (tV.gf || 0) + gv;
                            tV.gc = (tV.gc || 0) + gl;

                            if (gl > gv) {
                                tL.pg = (tL.pg || 0) + 1;
                                tL.puntos = (tL.puntos || 0) + 3;
                                tV.pp = (tV.pp || 0) + 1;
                                if (isWO) {
                                    // Perdedor por WO resta 2 puntos y suma PE (representación de WO en tabla)
                                    tV.pe = (tV.pe || 0) + 1;
                                    tV.puntos = (tV.puntos || 0) - 2;
                                }
                            } else if (gv > gl) {
                                tV.pg = (tV.pg || 0) + 1;
                                tV.puntos = (tV.puntos || 0) + 3;
                                tL.pp = (tL.pp || 0) + 1;
                                if (isWO) {
                                    tL.pe = (tL.pe || 0) + 1;
                                    tL.puntos = (tL.puntos || 0) - 2;
                                }
                            } else {
                                tL.pe = (tL.pe || 0) + 1;
                                tV.pe = (tV.pe || 0) + 1;
                                tL.puntos = (tL.puntos || 0) + 1;
                                tV.puntos = (tV.puntos || 0) + 1;
                            }
                        }
                    }
                }
            } else {
                const fase = fresh.fasesEliminatoria[fresh.faseActual];
                const m = fresh.llaves[fase]?.find(e => e.equipo1.nombre === localNombre && e.equipo2.nombre === visitanteNombre && !e.ganador);
                if (m) {
                    let matchObj = null;
                    if (tipoMatch === 'unico' || tipoMatch === 'ida') matchObj = m.ida;
                    else if (tipoMatch === 'vuelta') matchObj = m.vuelta;
                    else if (tipoMatch === 'desempate') matchObj = m.desempate;

                    if (matchObj) {
                        matchObj.golesLocal = gl;
                        matchObj.golesVisitante = gv;
                        matchObj.finalizado = true;
                        matchObj.isWO = isWO;
                        matchObj.isDoubleWO = isDoubleWO;

                        m.isWO = isWO;
                        m.isDoubleWO = isDoubleWO;

                        if (isDoubleWO) {
                            m.resultado = 'WO - WO';
                            m.ganador = 'Sin Ganador';
                            resDisplay = 'WO - WO (Doble W.O.)';
                        } else {
                            m.resultado = `${gl}-${gv}${isWO ? ' (WO)' : ''}`;
                            resDisplay = `${gl} - ${gv}${isWO ? ' (WO)' : ''}`;

                            if (tipoMatch === 'unico') {
                                if (gl > gv) m.ganador = m.equipo1.discordId || m.equipo1.nombre;
                                else if (gv > gl) m.ganador = m.equipo2.discordId || m.equipo2.nombre;
                                else m.ganador = m.equipo1.discordId || m.equipo1.nombre;
                            } else {
                                const { determinarGanadorLlave } = await import('../generarBracket.js');
                                const ganador = determinarGanadorLlave(m);
                                if (ganador) m.ganador = ganador;
                            }
                        }
                    }
                }
            }

            await fresh.save();
            allMatches[idx].completado = true;
            allMatches[idx].resultado = isDoubleWO ? 'WO - WO' : `${gl}-${gv}${isWO ? ' (WO)' : ''}`;

            await submit.reply({ content: `✅ Resultado guardado: **${localNombre} ${resDisplay} ${visitanteNombre}**`, flags: 64 });
            resp.edit(generatePayload()).catch(() => { });
        }
    });
}

async function handleSortearAdmin(interaction, torneo, panelMsg) {
    if (torneo.equipos.length < torneo.cantidadParticipantes) {
        return interaction.reply({ content: `❌ Faltan participantes (${torneo.equipos.length}/${torneo.cantidadParticipantes}).`, flags: 64 });
    }

    let targetInteraction = interaction;

    try {
        if (torneo.formatoPreset === 'directa') {
            await interaction.deferReply({ flags: 64 }).catch(() => { });
            const data = generarBracket(torneo.equipos, torneo.tipoEncuentro);

            if (torneo.tipoCompeticion === 'equipos') {
                const primeraFase = data.fasesEliminatoria[0];
                const matchesR1 = data.llaves[primeraFase];
                matchesR1.forEach(m => {
                    if (m.equipo1.discordId && m.equipo2.discordId && m.equipo2.discordId !== 'BYE') {
                        const eqL = torneo.equipos.find(e => e.propietario === m.equipo1.discordId || e.discordId === m.equipo1.discordId);
                        const eqV = torneo.equipos.find(e => e.propietario === m.equipo2.discordId || e.discordId === m.equipo2.discordId);
                        if (eqL && eqV) {
                            m.duelosIndividuales = torneo.alineacionesAutomaticas !== false
                                ? generarDuelosIndividuales(eqL, eqV)
                                : generarSlotsVacios(3);
                        }
                    }
                });
            }

            torneo.llaves = data.llaves;
            torneo.fasesEliminatoria = data.fasesEliminatoria;
            torneo.faseActual = 0;
            torneo.gruposHabilitados = false;
        } else {
            const modal = new ModalBuilder()
                .setCustomId(`modal_fixture_admin`)
                .setTitle(`¿Cuántas vueltas?`);

            const nLabel = new LabelBuilder()
                .setLabel('Vueltas')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('num')
                        .setStyle(TextInputStyle.Short)
                        .setValue("1")
                        .setRequired(true)
                );

            modal.addLabelComponents(nLabel);

            await interaction.showModal(modal);
            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.user.id === interaction.user.id,
                time: 60000
            }).catch(() => null);

            if (!modalSubmit) return;
            await modalSubmit.deferReply({ flags: 64 }).catch(() => { });
            targetInteraction = modalSubmit;

            const numero = parseInt(modalSubmit.fields.getTextInputValue('num')) ?? null;

            if (isNaN(numero)) return targetInteraction.editReply({ content: '❌ La cantidad de vueltas debe ser un numero válido.' });

            const tieneGrupos = torneo.gruposHabilitados || torneo.equipos.some(e => e.grupo);
            if (tieneGrupos) {
                let grupos = [];
                const preAsignados = torneo.equipos.some(e => e.grupo);

                if (preAsignados) {
                    const groupMap = new Map();
                    torneo.equipos.forEach(eq => {
                        const gName = eq.grupo || 'Sin Grupo';
                        if (!groupMap.has(gName)) groupMap.set(gName, []);
                        groupMap.get(gName).push(eq);
                    });
                    grupos = Array.from(groupMap.entries()).map(([nombre, equipos]) => ({ nombre, equipos }));
                } else {
                    let numGrupos = torneo.cantidadGrupos;
                    if (!numGrupos || numGrupos <= 0) {
                        numGrupos = Math.ceil(torneo.equipos.length / 4) || 1;
                    }

                    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                    grupos = Array.from({ length: numGrupos }, (_, i) => ({
                        nombre: alphabet[i] || `Grupo ${i + 1}`,
                        equipos: []
                    }));

                    const tempEquipos = [...torneo.equipos];
                    shuffle(tempEquipos);

                    tempEquipos.forEach((eq, idx) => {
                        const gIdx = idx % numGrupos;
                        grupos[gIdx].equipos.push(eq);
                        const originalEq = torneo.equipos.find(e => e.nombre === eq.nombre);
                        if (originalEq) {
                            originalEq.grupo = grupos[gIdx].nombre;
                        }
                    });
                }

                const matches = [];
                grupos.forEach(g => {
                    if (g.equipos.length > 0) {
                        const roundRobin = generarRoundRobin(g.equipos, numero);
                        roundRobin.forEach((fecha, fIdx) => {
                            fecha.partidos.forEach(p => {
                                if (p.localId !== 'BYE' && p.visitanteId !== 'BYE') {
                                    const eqL = torneo.equipos.find(e => e.nombre === p.localNombre);
                                    const eqV = torneo.equipos.find(e => e.nombre === p.visitanteNombre);
                                    const duelos = (torneo.tipoCompeticion === 'equipos' && eqL && eqV)
                                        ? (torneo.alineacionesAutomaticas !== false ? generarDuelosIndividuales(eqL, eqV) : generarSlotsVacios(3))
                                        : [];

                                    matches.push({
                                        local: p.localNombre,
                                        visitante: p.visitanteNombre,
                                        localId: eqL?.propietario || eqL?.discordId || p.localId,
                                        visitanteId: eqV?.propietario || eqV?.discordId || p.visitanteId,
                                        resultado: 'Pendiente',
                                        ganador: null,
                                        completado: false,
                                        fecha: fIdx + 1,
                                        grupo: g.nombre,
                                        duelosIndividuales: duelos
                                    });
                                }
                            });
                        });
                    }
                });

                torneo.enfrentamientosGrupos = matches;
            } else {
                const roundRobin = generarRoundRobin(torneo.equipos, numero);
                const matches = [];
                roundRobin.forEach((fecha, fIdx) => {
                    fecha.partidos.forEach(p => {
                        if (p.localId !== 'BYE' && p.visitanteId !== 'BYE') {
                            const eqL = torneo.equipos.find(e => e.nombre === p.localNombre);
                            const eqV = torneo.equipos.find(e => e.nombre === p.visitanteNombre);
                            const duelos = (torneo.tipoCompeticion === 'equipos' && eqL && eqV)
                                ? (torneo.alineacionesAutomaticas !== false ? generarDuelosIndividuales(eqL, eqV) : generarSlotsVacios(3))
                                : [];

                            matches.push({
                                local: p.localNombre,
                                visitante: p.visitanteNombre,
                                localId: eqL?.propietario || eqL?.discordId || p.localId,
                                visitanteId: eqV?.propietario || eqV?.discordId || p.visitanteId,
                                resultado: 'Pendiente',
                                ganador: null,
                                completado: false,
                                fecha: fIdx + 1,
                                duelosIndividuales: duelos
                            });
                        }
                    });
                });
                torneo.enfrentamientosGrupos = matches;
            }
        }

        torneo.estado = 'EnCurso';
        await torneo.save();

        await targetInteraction.editReply({ content: `✅ **Sorteo Completado:** Se han generado los partidos para **${torneo.nombre}**. El estado ha cambiado a **EnCurso**.` });

        const fresh = await Torneo.findOne({ prefix: torneo.prefix });
        const embed = EmbedBuilder.from(panelMsg.embeds[0])
            .setDescription(`**Estado:** EnCurso\n**Fase Actual:** ${fresh.gruposHabilitados ? 'Fase de Grupos' : fresh.fasesEliminatoria[0]}\n**Participantes:** ${fresh.equipos.length}/${fresh.cantidadParticipantes}\n**Prefijo:** \`${fresh.prefix}\``);

        await panelMsg.edit({ embeds: [embed] });

    } catch (error) {
        console.error('Error en sorteo:', error);
        if (targetInteraction.deferred || targetInteraction.replied) {
            await targetInteraction.editReply({ content: '❌ Error al realizar el sorteo.' }).catch(() => { });
        } else {
            await targetInteraction.reply({ content: '❌ Error al realizar el sorteo.', flags: 64 }).catch(() => { });
        }
    }
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function handleEditarTema(interaction, torneo, panelMsg) {
    const t = torneo.tema;
    const modal = new ModalBuilder()
        .setCustomId(`modal_gt_tema|${torneo.prefix}`)
        .setTitle('🎨 Editar Colores del Torneo');

    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pri').setLabel('Color Primario').setValue(t.primario).setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sec').setLabel('Color Secundario').setValue(t.secundario).setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acc').setLabel('Color Acento').setValue(t.acento).setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txt').setLabel('Color de Texto').setValue(t.texto).setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bor').setLabel('Color de Borde').setValue(t.borde).setStyle(TextInputStyle.Short).setRequired(true))
    );

    await interaction.showModal(modal);

    const submit = await interaction.awaitModalSubmit({ time: 600000 }).catch(() => null);
    if (!submit) return;

    const sanitizeHex = (val, fallback) => {
        if (!val || typeof val !== 'string') return fallback;
        const matches = val.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
        if (matches && matches.length > 0) return matches[0];
        if (/^[0-9a-fA-F]{6}$/.test(val.trim())) return `#${val.trim()}`;
        return fallback;
    };

    torneo.tema = {
        primario: sanitizeHex(submit.fields.getTextInputValue('pri'), '#1a1a2e'),
        secundario: sanitizeHex(submit.fields.getTextInputValue('sec'), '#16213e'),
        acento: sanitizeHex(submit.fields.getTextInputValue('acc'), '#e94560'),
        texto: sanitizeHex(submit.fields.getTextInputValue('txt'), '#ffffff'),
        borde: sanitizeHex(submit.fields.getTextInputValue('bor'), '#0f3460')
    };

    await torneo.save();
    await submit.reply({ content: '✅ Tema actualizado correctamente. Pulsa Refresh en el panel para ver los cambios.', flags: 64 });
}

async function handleBorrarTorneo(interaction, torneo, panelMsg) {
    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_del_yes').setLabel('Eliminar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_del_no').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    );

    const ask = await interaction.reply({ content: `⚠️ **¡CUIDADO!** ¿Estás seguro de que quieres eliminar el torneo **${torneo.nombre}**? Esta acción no se puede deshacer.`, components: [confirmRow], flags: 64 });

    const filter = i => i.user.id === interaction.user.id;
    const resp = await interaction.channel.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

    if (resp?.customId === 'confirm_del_yes') {
        await Torneo.deleteOne({ _id: torneo._id });
        console.log(`Torneo ${torneo.nombre} eliminado por ${interaction.user.username} - ID: ${interaction.user.id} - En canal: ${interaction.channel.name}`);
        await panelMsg.delete().catch(() => { });
        await resp.update({ content: '🗑️ Torneo eliminado.', components: [] });
    } else {
        await resp?.update({ content: 'Acción cancelada.', components: [] });
    }
}

async function handleAvanzarFaseAdmin(interaction, torneo, panelMsg) {
    const fresh = await Torneo.findOne({ prefix: torneo.prefix });

    if (fresh.enfrentamientosGrupos?.length > 0 && Object.keys(fresh.llaves || {}).length === 0) {
        if (fresh.enfrentamientosGrupos.some(e => !e.completado)) {
            return interaction.reply({ content: '❌ No puedes avanzar fase hasta terminar todos los partidos' + (fresh.gruposHabilitados ? ' de grupos' : '') + '.', flags: 64 });
        }

        if (fresh.playoffsHabilitados) {
            let clasificados = [];
            if (fresh.equipos.some(e => e.grupo)) {
                const grupos = {};
                fresh.equipos.forEach(eq => {
                    const g = eq.grupo || 'A';
                    if (!grupos[g]) grupos[g] = [];
                    grupos[g].push(eq);
                });

                Object.keys(grupos).forEach(g => {
                    grupos[g].sort((a, b) => b.puntos - a.puntos || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf);
                });

                const terceros = [];
                const clasificadosPorGrupo = fresh.clasificadosPorGrupo || 2;

                Object.keys(grupos).sort().forEach(g => {
                    const grupoEquipos = grupos[g];
                    const directos = grupoEquipos.slice(0, clasificadosPorGrupo);
                    clasificados.push(...directos);

                    if (fresh.mejorTercero && grupoEquipos.length > clasificadosPorGrupo) {
                        terceros.push(grupoEquipos[clasificadosPorGrupo]);
                    }
                });

                if (fresh.mejorTercero && terceros.length > 0) {
                    terceros.sort((a, b) => b.puntos - a.puntos || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf);
                    const cantTerceros = fresh.cantMejoresTerceros || 0;
                    clasificados.push(...terceros.slice(0, cantTerceros));
                }
            } else {
                const tabla = fresh.equipos.sort((a, b) => b.puntos - a.puntos || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf);
                let n = Math.pow(2, Math.floor(Math.log2(tabla.length)));
                if (n === tabla.length && n > 2) n = n / 2;
                if (n < 2) n = 2;
                clasificados = tabla.slice(0, n);
            }

            const n = clasificados.length;
            const { default: genBracket } = await import('../generarBracket.js');
            const data = genBracket(clasificados, fresh.tipoEncuentro);

            if (fresh.tipoCompeticion === 'equipos') {
                const primeraFase = data.fasesEliminatoria[0];
                const matchesR1 = data.llaves[primeraFase];
                matchesR1.forEach(m => {
                    if (m.equipo1.discordId && m.equipo2.discordId && m.equipo2.discordId !== 'BYE') {
                        const eqL = fresh.equipos.find(e => e.propietario === m.equipo1.discordId || e.discordId === m.equipo1.discordId);
                        const eqV = fresh.equipos.find(e => e.propietario === m.equipo2.discordId || e.discordId === m.equipo2.discordId);
                        if (eqL && eqV) {
                            m.duelosIndividuales = fresh.alineacionesAutomaticas !== false
                                ? generarDuelosIndividuales(eqL, eqV)
                                : generarSlotsVacios(3);
                        }
                    }
                });
            }

            fresh.llaves = data.llaves;
            fresh.fasesEliminatoria = data.fasesEliminatoria;
            fresh.faseActual = 0;

            await fresh.save();
            return interaction.reply({ content: `✅ **Fase de grupos finalizada.** Se generaron los brackets para los **${n}** mejores equipos. Siguiente fase: **${fresh.fasesEliminatoria[0]}**`, flags: 64 });
        } else {
            fresh.estado = 'Finalizado';
            await fresh.save();

            // Adjudicar título al campeón de la liga
            const sortedEquipos = [...fresh.equipos].sort((a, b) => (b.puntos ?? 0) - (a.puntos ?? 0) || ((b.gf ?? 0) - (b.gc ?? 0)) - ((a.gf ?? 0) - (a.gc ?? 0)));
            const campeonEq = sortedEquipos[0];
            if (campeonEq) {
                const esOfi = fresh.caracter === 'oficial';
                if (fresh.tipoCompeticion === 'individual' || fresh.tipoJugadores === 'users') {
                    const cId = campeonEq.discordId || campeonEq.propietario || campeonEq.id || campeonEq.nombre;
                    await awardTitle(cId, { nombreTorneo: fresh.nombre, esOficial: esOfi });
                } else if (Array.isArray(campeonEq.miembros)) {
                    for (const m of campeonEq.miembros) {
                        const mId = typeof m === 'string' ? m : (m.discordId || m.id || m.nombre);
                        await awardTitle(mId, { nombreTorneo: fresh.nombre, esOficial: esOfi });
                    }
                }
            }

            return interaction.reply({ content: '🏆 **¡La fase de grupos (liga) ha finalizado!** El torneo ha terminado.', flags: 64 });
        }
    } else {
        if (!fresh.fasesEliminatoria || fresh.fasesEliminatoria.length === 0) {
            return interaction.reply({ content: '❌ No hay fases eliminatorias configuradas.', flags: 64 });
        }

        const fase = fresh.fasesEliminatoria[fresh.faseActual];
        const matches = fresh.llaves[fase] || [];

        if (matches.some(m => !m.ganador && m.equipo2.discordId !== 'BYE')) {
            return interaction.reply({ content: `❌ Todos los partidos de la fase **${fase}** deben tener un ganador para poder avanzar.`, flags: 64 });
        }

        const { avanzarFase } = await import('../generarBracket.js');
        const sgte = avanzarFase(fresh);

        if (!sgte) {
            fresh.estado = 'Finalizado';
            await fresh.save();

            // Adjudicar título al ganador de la final
            const finalMatches = fresh.llaves[fase] || [];
            const finalWinner = finalMatches[0]?.ganador;
            if (finalWinner) {
                const esOfi = fresh.caracter === 'oficial';
                if (fresh.tipoCompeticion === 'individual' || fresh.tipoJugadores === 'users') {
                    const wId = finalWinner.discordId || finalWinner.id || finalWinner.nombre;
                    await awardTitle(wId, { nombreTorneo: fresh.nombre, esOficial: esOfi });
                } else {
                    const eqWinner = fresh.equipos.find(e => (e.discordId || e.id || e.nombre) === (finalWinner.discordId || finalWinner.id || finalWinner.nombre) || e.propietario === finalWinner.discordId);
                    if (eqWinner && Array.isArray(eqWinner.miembros)) {
                        for (const m of eqWinner.miembros) {
                            const mId = typeof m === 'string' ? m : (m.discordId || m.id || m.nombre);
                            await awardTitle(mId, { nombreTorneo: fresh.nombre, esOficial: esOfi });
                        }
                    } else if (finalWinner.discordId || finalWinner.id) {
                        await awardTitle(finalWinner.discordId || finalWinner.id, { nombreTorneo: fresh.nombre, esOficial: esOfi });
                    }
                }
            }

            const embed = EmbedBuilder.from(panelMsg.embeds[0]).setDescription(`**Estado:** Finalizado\n**Fase Actual:** Completado\n**Prefijo:** \`${fresh.prefix}\``);
            await panelMsg.edit({ embeds: [embed], components: [] });

            return interaction.reply({ content: '🏆 **¡El torneo ha finalizado!** Se ha completado la gran final.', flags: 64 });
        } else {
            if (fresh.tipoCompeticion === 'equipos') {
                const nextMatches = fresh.llaves[sgte] || [];
                nextMatches.forEach(m => {
                    if (m.equipo1.discordId && m.equipo2.discordId && m.equipo2.discordId !== 'BYE') {
                        const eqL = fresh.equipos.find(e => e.propietario === m.equipo1.discordId || e.discordId === m.equipo1.discordId);
                        const eqV = fresh.equipos.find(e => e.propietario === m.equipo2.discordId || e.discordId === m.equipo2.discordId);
                        if (eqL && eqV) {
                            m.duelosIndividuales = fresh.alineacionesAutomaticas !== false
                                ? generarDuelosIndividuales(eqL, eqV)
                                : generarSlotsVacios(3);
                        }
                    }
                });
            }

            await fresh.save();
            return interaction.reply({ content: `✅ Fase avanzada con éxito. Se generaron los cruces de **${sgte}**.`, flags: 64 });
        }
    }
}

async function handlePublicarActualizacion(interaction, torneo) {
    if (!torneo.canalResultados) {
        return interaction.reply({ content: '❌ No hay canal de resultados configurado.', flags: 64 });
    }
    const canal = await interaction.client.channels.fetch(torneo.canalResultados).catch(() => null);
    if (!canal) {
        return interaction.reply({ content: '❌ Canal de resultados no encontrado o inaccesible.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const esDirecta = torneo.formatoPreset === 'directa';
        const files = [];
        const embed = new EmbedBuilder()
            .setTitle(`📢 Actualización — ${torneo.nombre}`)
            .setColor(torneo.tema.acento)
            .setTimestamp();

        if (torneo.logo) {
            files.push(new AttachmentBuilder(torneo.logo, { name: 'logo_copa.png' }));
            embed.setThumbnail('attachment://logo_copa.png');
        }

        if (!esDirecta && torneo.equipos?.length > 0) {
            const tabla = await Promise.all(torneo.equipos.map(async e => ({
                nombre: e.nombre,
                avatar: await getAvatarBase64(e.avatar),
                miembros: e.miembros,
                pj: e.pj || 0, pg: e.pg || 0, pe: e.pe || 0, pp: e.pp || 0,
                gf: e.gf || 0, gc: e.gc || 0, puntos: e.puntos || 0,
                grupo: e.grupo
            })));
            tabla.sort((a, b) => b.puntos - a.puntos || (b.gf - b.gc) - (a.gf - a.gc));

            const png = await getCachedImage(
                torneo.prefix,
                'tabla',
                { equipos: torneo.equipos, tema: torneo.tema, nombre: torneo.nombre, logo: torneo.logo },
                () => generarTablaImagenCopa(torneo, tabla, torneo.nombre)
            );
            files.push(new AttachmentBuilder(png, { name: 'tabla.png' }));
            embed.setImage('attachment://tabla.png');
        }

        const ultimos = torneo.historialResultados?.slice(-5).reverse() || [];
        const resultadosTexto = ultimos.map(r =>
            `**${r.partido}**: ${r.resultado} — por <@${r.cargadoPor}>`
        ).join('\n') || 'Sin resultados recientes.';
        embed.setDescription(`### Últimos Resultados:\n${resultadosTexto}`);

        await canal.send({ embeds: [embed], files });
        await interaction.editReply({ content: '✅ Actualización publicada con éxito en el canal configurado.' });
    } catch (e) {
        console.error('[Gestion] Error en handlePublicarActualizacion:', e);
        await interaction.editReply({ content: '❌ Ocurrió un error al publicar la actualización.' });
    }
}

async function handleReiniciarFase(interaction, torneo) {
    if (torneo.faseActual === 0 && !torneo.gruposHabilitados) {
        return interaction.reply({ content: '❌ No hay fase anterior a la que volver.', flags: 64 });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_reset_yes').setLabel('Confirmar Reinicio').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_reset_no').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    );

    const faseNombre = torneo.fasesEliminatoria?.[torneo.faseActual] || (torneo.gruposHabilitados ? 'Fase de Grupos' : 'Configuración');

    const resp = await interaction.reply({
        content: `⚠️ **¿Estás seguro de reiniciar la fase actual (${faseNombre})?** Esto regenerará los cruces de esta fase y se perderán los resultados cargados en la misma.`,
        components: [row],
        flags: 64
    });

    const btn = await resp.awaitMessageComponent({ time: 30000 }).catch(() => null);
    if (btn?.customId !== 'confirm_reset_yes') {
        return btn?.update({ content: 'Acción cancelada.', components: [] });
    }

    await btn.deferUpdate();

    if (torneo.faseActual > 0) {
        const faseAnterior = torneo.fasesEliminatoria[torneo.faseActual - 1];
        const faseActual = torneo.fasesEliminatoria[torneo.faseActual];

        if (torneo.llaves && torneo.llaves[faseActual]) {
            torneo.llaves[faseActual] = torneo.llaves[faseActual].map(m => ({
                ...m,
                equipo1: { nombre: 'TBD', discordId: null },
                equipo2: { nombre: 'TBD', discordId: null },
                ida: { golesLocal: null, golesVisitante: null, finalizado: false },
                vuelta: m.vuelta ? { golesLocal: null, golesVisitante: null, finalizado: false } : null,
                desempate: m.desempate ? { golesLocal: null, golesVisitante: null, finalizado: false } : null,
                ganador: null,
                resultado: null,
                completado: false
            }));
        }

        if (torneo.llaves && torneo.llaves[faseAnterior]) {
            torneo.llaves[faseAnterior] = torneo.llaves[faseAnterior].map(m => ({
                ...m,
                ganador: null,
                resultado: null,
                completado: false,
                ida: { ...m.ida, finalizado: false, golesLocal: null, golesVisitante: null },
                vuelta: m.vuelta ? { ...m.vuelta, finalizado: false, golesLocal: null, golesVisitante: null } : null,
                desempate: m.desempate ? { ...m.desempate, finalizado: false, golesLocal: null, golesVisitante: null } : null
            }));
        }

        torneo.faseActual--;
    } else if (torneo.gruposHabilitados) {
        torneo.llaves = {};
        torneo.fasesEliminatoria = [];
        torneo.faseActual = 0;

        torneo.enfrentamientosGrupos = torneo.enfrentamientosGrupos.map(m => ({
            ...m,
            golesLocal: null,
            golesVisitante: null,
            ganador: null,
            completado: false
        }));
    }

    await torneo.save();

    const { invalidateCache } = await import('../visual/imageCache.js');
    invalidateCache(torneo.prefix);

    const faseNueva = torneo.fasesEliminatoria?.[torneo.faseActual] || (torneo.gruposHabilitados ? 'Fase de Grupos' : 'Configuración');
    await btn.editReply({ content: `✅ **Fase reiniciada.** Ahora estás en: **${faseNueva}**`, components: [] });
}

async function handleHistorial(interaction, torneo) {
    const hist = torneo.historialResultados || [];
    const ultimos = hist.slice(-20).reverse();

    if (!ultimos.length) {
        return interaction.reply({ content: '📜 Aún no hay registros de resultados en el historial de este torneo.', flags: 64 });
    }

    const texto = ultimos.map((h, i) =>
        `\`${new Date(h.timestamp).toLocaleDateString()}\` **${h.partido}** (\`${h.tipo || 'único'}\`) ➔ **${h.resultado}** — por <@${h.cargadoPor}>`
    ).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`📜 Historial de Resultados — ${torneo.nombre}`)
        .setDescription(texto)
        .setColor(torneo.tema.acento)
        .setFooter({ text: `Mostrando los últimos ${ultimos.length} registros` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleInscripcionEmbed(interaction, torneo) {
    if (!torneo.canalResultados) {
        return interaction.reply({ content: '❌ No hay canal de resultados configurado. Configure un canal primero.', flags: 64 });
    }
    const canal = await interaction.client.channels.fetch(torneo.canalResultados).catch(() => null);
    if (!canal) {
        return interaction.reply({ content: '❌ Canal de resultados no encontrado.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const plazasLibres = torneo.cantidadParticipantes - torneo.equipos.length;
        const files = [];

        const embed = new EmbedBuilder()
            .setTitle(`📣 ¡Inscripciones Abiertas! — ${torneo.nombre}`)
            .setDescription(
                `¡Te invitamos a inscribirte en este emocionante torneo!\n\n` +
                `**Información del Torneo:**\n` +
                `> 🏆 **Nombre:** ${torneo.nombre}\n` +
                `> ⚔️ **Modo:** \`${torneo.tipoCompeticion.toUpperCase()}\`\n` +
                `> 👥 **Plazas Disponibles:** **${plazasLibres}** libres de ${torneo.cantidadParticipantes}\n` +
                `> 🔑 **Prefijo:** \`${torneo.prefix}\``
            )
            .setColor(torneo.tema.acento)
            .setTimestamp();

        if (torneo.logo) {
            files.push(new AttachmentBuilder(torneo.logo, { name: 'logo_copa.png' }));
            embed.setThumbnail('attachment://logo_copa.png');
        }

        const button = new ButtonBuilder()
            .setCustomId(`autojoin_${torneo.prefix}`)
            .setLabel('🎮 Inscribirme')
            .setStyle(ButtonStyle.Success)
            .setDisabled(plazasLibres <= 0 || torneo.estado !== 'Inscripcion');

        const row = new ActionRowBuilder().addComponents(button);

        await canal.send({ embeds: [embed], components: [row], files });
        await interaction.editReply({ content: '✅ Embed de inscripción publicado correctamente en el canal de resultados.' });
    } catch (e) {
        console.error('[Gestion] Error en handleInscripcionEmbed:', e);
        await interaction.editReply({ content: '❌ Ocurrió un error al publicar el embed de inscripción.' });
    }
}
