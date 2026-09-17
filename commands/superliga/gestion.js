import {
    EmbedBuilder,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonStyle,
    ButtonBuilder,
    FileUploadBuilder,
    LabelBuilder
} from 'discord.js';
import Superliga from '../../models/superliga/Superliga.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import generarRoundRobinSuperliga from '../../utils/generarRoundRobinSuperliga.js';
import { buildSuperligaEmbed, buildSuperligaRows } from '../../utils/ui/superliga/buildSuperligaPanel.js';
import descargarImagen from '../../utils/descargarImagen.js';

export default {
    name: 'superliga-gestion',
    aliases: ['sl-gestion', 'slg'],
    desc: 'Gestión de la Superliga (Panel Interactivo)',
    permisos: ['Administrator'],

    run: async (client, message, args) => {
        if (args.length > 0) {
            return handleLegacyCommands(client, message, args);
        }

        const liga = await Superliga.findOne({ actual: true });
        const panelMsg = await message.reply({
            embeds: [buildSuperligaEmbed(liga)],
            components: buildSuperligaRows(liga)
        });

        const collector = panelMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 600000,
        });

        collector.on('collect', async i => {
            if (!i.member.permissions.has('Administrator')) {
                return i.reply({ content: '❌ No tienes permisos.', flags: 64 });
            }

            const freshLiga = await Superliga.findOne({ actual: true });

            switch (i.customId) {
                case 'btn_sl_refresh':
                    await panelMsg.edit({
                        embeds: [buildSuperligaEmbed(freshLiga)],
                        components: buildSuperligaRows(freshLiga)
                    });
                    await i.reply({ content: '🔃 Panel actualizado.', flags: 64 });
                    break;

                case 'btn_sl_equipos':
                    const equiposAll = await EquipoSuperliga.find({});
                    await i.reply({
                        embeds: [new EmbedBuilder().setTitle('👥 Equipos').setDescription(equiposAll.map(e => `• **${e.nombre}**`).join('\n') || 'Vacío').setColor('#3498db')],
                        flags: 64
                    });
                    break;

                case 'btn_sl_borrar': {
                    if (!freshLiga) return i.reply({ content: '❌ No hay temporada.', flags: 64 });

                    const confirmBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_sl_borrar_confirm').setLabel('⚠️ Estoy seguro, borrar').setStyle(ButtonStyle.Danger)
                    );

                    await i.reply({
                        content: `❗ **¿Estás absolutamente seguro?** Esta acción borrará permanentemente la temporada **${freshLiga.temporada}** y todo su progreso.`,
                        components: [confirmBtn],
                        flags: 64
                    });
                    const mConfirm = await i.fetchReply();

                    const colConfirm = mConfirm.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
                    colConfirm.on('collect', async iC => {
                        if (iC.customId === 'btn_sl_borrar_confirm') {
                            const modalName = new ModalBuilder().setCustomId('m_sl_borrar_final').setTitle('Confirmación Final');
                            modalName.addComponents(
                                new ActionRowBuilder().addComponents(
                                    new TextInputBuilder()
                                        .setCustomId('confirm_name')
                                        .setLabel(`Escribe "${freshLiga.temporada}" para borrar`)
                                        .setStyle(TextInputStyle.Short)
                                        .setPlaceholder(freshLiga.temporada)
                                        .setRequired(true)
                                )
                            );
                            await iC.showModal(modalName);

                            const subF = await iC.awaitModalSubmit({ time: 60000 }).catch(() => null);
                            if (!subF) return;

                            if (subF.fields.getTextInputValue('confirm_name') === freshLiga.temporada) {
                                await Superliga.deleteOne({ _id: freshLiga._id });
                                await panelMsg.edit({ embeds: [buildSuperligaEmbed(null)], components: buildSuperligaRows(null) });
                                await subF.reply({ content: `✅ Temporada **${freshLiga.temporada}** borrada permanentemente.`, flags: 64 });
                            } else {
                                await subF.reply({ content: '❌ El nombre no coincide. Operación cancelada.', flags: 64 });
                            }
                        }
                    });
                    break;
                }

                case 'btn_sl_resultado': {
                    if (!freshLiga) return i.reply({ content: '❌ No hay temporada activa.', flags: 64 });

                    const allEq = await EquipoSuperliga.find({});
                    const equiposList = allEq.filter(e => freshLiga.equipos.includes(e._id?.$oid ?? e._id));
                    if (equiposList.length === 0) return i.reply({ content: '❌ No hay equipos en esta liga.', flags: 64 });

                    let filtroEq = '';

                    const renderEqMenuPayload = () => {
                        let filteredEq = equiposList;
                        if (filtroEq) {
                            const q = filtroEq.toLowerCase().trim();
                            filteredEq = filteredEq.filter(e =>
                                (e.nombre && e.nombre.toLowerCase().includes(q)) ||
                                (e.jugadores && e.jugadores.some(j => j.nombre && j.nombre.toLowerCase().includes(q)))
                            );
                        }

                        const rows = [];
                        if (filteredEq.length > 0) {
                            const eqOptions = filteredEq.slice(0, 25).map(e => ({ label: e.nombre.slice(0, 100), value: e._id?.$oid ?? e._id }));
                            const eqMenu = new StringSelectMenuBuilder().setCustomId('sel_eq_res').setPlaceholder('1. Selecciona un Equipo').addOptions(eqOptions);
                            rows.push(new ActionRowBuilder().addComponents(eqMenu));
                        }

                        const rowBtn = new ActionRowBuilder().addComponents(
                            filtroEq
                                ? new ButtonBuilder().setCustomId('btn_sl_clear_eq').setLabel(`❌ Quitar: ${filtroEq.slice(0, 12)}`).setStyle(ButtonStyle.Danger)
                                : new ButtonBuilder().setCustomId('btn_sl_search_eq').setLabel('🔍 Buscar Equipo / Participante').setStyle(ButtonStyle.Secondary)
                        );
                        rows.push(rowBtn);

                        const partInfo = filtroEq ? ` • 🔍 *Filtro: "${filtroEq}"*` : '';
                        return {
                            content: `Selecciona el equipo para cargar el resultado (${filteredEq.length} equipos)${partInfo}:`,
                            components: rows,
                            flags: 64
                        };
                    };

                    await i.reply(renderEqMenuPayload());
                    const m1 = await i.fetchReply();
                    const colEq = m1.createMessageComponentCollector({ time: 60000 });

                    const flowResultado = async (ctx, partido) => {
                        const renderFormRows = () => {
                            const rows = [];
                            const rowForm = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId('btn_res_edit_form').setLabel('✏️ Editar Formación').setStyle(ButtonStyle.Secondary)
                            );
                            rows.push(rowForm);

                            const rowMinis = new ActionRowBuilder();
                            for (let i = 0; i < 3; i++) {
                                const d = partido.duelosIndividuales[i];
                                const label = d.finalizado ? `✅ Mini ${i + 1} (${d.golesLocal}-${d.golesVisitante})` : `🥅 Mini ${i + 1}`;
                                rowMinis.addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`btn_res_mini_${i}`)
                                        .setLabel(label)
                                        .setStyle(d.finalizado ? ButtonStyle.Success : ButtonStyle.Primary)
                                );
                            }
                            rows.push(rowMinis);
                            return rows;
                        };

                        const getStatusText = () =>
                            `🔍 **Validando Partido:** ${partido.localNombre} vs ${partido.visitanteNombre}\n` +
                            `Mini 1: ${partido.duelosIndividuales[0].localJugadorNombre || '?'} vs ${partido.duelosIndividuales[0].visitanteJugadorNombre || '?'}` +
                            (partido.duelosIndividuales[0].finalizado ? ` [${partido.duelosIndividuales[0].golesLocal}-${partido.duelosIndividuales[0].golesVisitante}]` : '') + `\n` +
                            `Mini 2: ${partido.duelosIndividuales[1].localJugadorNombre || '?'} vs ${partido.duelosIndividuales[1].visitanteJugadorNombre || '?'}` +
                            (partido.duelosIndividuales[1].finalizado ? ` [${partido.duelosIndividuales[1].golesLocal}-${partido.duelosIndividuales[1].golesVisitante}]` : '') + `\n` +
                            `Mini 3: ${partido.duelosIndividuales[2].localJugadorNombre || '?'} vs ${partido.duelosIndividuales[2].visitanteJugadorNombre || '?'}` +
                            (partido.duelosIndividuales[2].finalizado ? ` [${partido.duelosIndividuales[2].golesLocal}-${partido.duelosIndividuales[2].golesVisitante}]` : '');

                        await ctx.reply({
                            content: getStatusText(),
                            components: renderFormRows(),
                            flags: 64
                        });
                        const m = await ctx.fetchReply();

                        const colRes = m.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });
                        colRes.on('collect', async (btnInt) => {
                            if (btnInt.customId === 'btn_res_edit_form') {
                                const eqL = await EquipoSuperliga.findOne({ _id: partido.localId });
                                const eqV = await EquipoSuperliga.findOne({ _id: partido.visitanteId });

                                const pedir = async (targetEq, side) => {
                                    const opts = targetEq.jugadores.map(j => ({ label: j.nombre, value: j.id }));
                                    const s1 = new StringSelectMenuBuilder().setCustomId('s1').setPlaceholder(`Mini 1 - ${side}`).addOptions(opts);
                                    const s2 = new StringSelectMenuBuilder().setCustomId('s2').setPlaceholder(`Mini 2 - ${side}`).addOptions(opts);
                                    const s3 = new StringSelectMenuBuilder().setCustomId('s3').setPlaceholder(`Mini 3 - ${side}`).addOptions(opts);

                                    await btnInt.followUp({ content: `Editando formación para ${targetEq.nombre}`, components: [new ActionRowBuilder().addComponents(s1), new ActionRowBuilder().addComponents(s2), new ActionRowBuilder().addComponents(s3)], flags: 64 });
                                    const msgForm = await btnInt.fetchReply();
                                    const res = { j1: null, j2: null, j3: null };
                                    const col = msgForm.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

                                    return new Promise(resolve => {
                                        col.on('collect', async si => {
                                            await si.deferUpdate();
                                            if (si.customId === 's1') res.j1 = si.values[0];
                                            if (si.customId === 's2') res.j2 = si.values[0];
                                            if (si.customId === 's3') res.j3 = si.values[0];
                                            if (res.j1 && res.j2 && res.j3) { col.stop(); resolve(res); }
                                        });
                                        col.on('end', () => resolve(res.j1 ? res : null));
                                    });
                                };

                                const fL = await pedir(eqL, 'Local');
                                const fV = await pedir(eqV, 'Visitante');

                                if (fL && fV) {
                                    const asignar = (idx, lid, vid) => {
                                        const jl = eqL.jugadores.find(j => j.id === lid);
                                        const jv = eqV.jugadores.find(j => j.id === vid);
                                        partido.duelosIndividuales[idx].localJugadorId = jl.id;
                                        partido.duelosIndividuales[idx].localJugadorNombre = jl.nombre;
                                        partido.duelosIndividuales[idx].visitanteJugadorId = jv.id;
                                        partido.duelosIndividuales[idx].visitanteJugadorNombre = jv.nombre;
                                    };
                                    asignar(0, fL.j1, fV.j1); asignar(1, fL.j2, fV.j2); asignar(2, fL.j3, fV.j3);
                                    await freshLiga.save();
                                    await btnInt.followUp({ content: '✅ Formación actualizada.', flags: 64 });
                                    await m.edit({ content: getStatusText(), components: renderFormRows() }).catch(() => {});
                                }
                            }

                            if (btnInt.customId.startsWith('btn_res_mini_')) {
                                const miniIdx = parseInt(btnInt.customId.split('_').pop());
                                const duelo = partido.duelosIndividuales[miniIdx];

                                const procesarSubmitModal = async (triggerInteraction) => {
                                    const modalResp = await triggerInteraction.awaitModalSubmit({
                                        filter: mI => mI.customId === `m_g_mini_${miniIdx}` && mI.user.id === triggerInteraction.user.id,
                                        time: 60000
                                    }).catch(() => null);

                                    if (!modalResp) return;
                                    await modalResp.deferUpdate().catch(() => {});

                                    const gl = parseInt(modalResp.fields.getTextInputValue('gl')) || 0;
                                    const gv = parseInt(modalResp.fields.getTextInputValue('gv')) || 0;

                                    duelo.golesLocal = gl;
                                    duelo.golesVisitante = gv;
                                    duelo.finalizado = true;

                                    // 2. Media individual tras cada minipartido
                                    if (gl !== gv && duelo.localJugadorId && duelo.visitanteJugadorId) {
                                        try {
                                            const { aplicarCambioMediaDuelo } = await import('../../utils/db/mediaCalculator.js');
                                            const resMedia = await aplicarCambioMediaDuelo(
                                                gl > gv ? duelo.localJugadorId : duelo.visitanteJugadorId,
                                                gl > gv ? duelo.visitanteJugadorId : duelo.localJugadorId,
                                                Math.max(gl, gv), Math.min(gl, gv)
                                            );
                                            if (resMedia) {
                                                duelo.logMedia = `📈 **${resMedia.ganadorNombre}**: ${resMedia.nuevaMediaGanador} (+${resMedia.delta})\n📉 **${resMedia.perdedorNombre}**: ${resMedia.nuevaMediaPerdedor} (-${resMedia.delta})`;
                                            }
                                        } catch (e) {
                                            console.error('[Gestion Superliga] Error en media:', e);
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

                                    partido.puntosMiniLocal = pml;
                                    partido.puntosMiniVisitante = pmv;
                                    partido.golesTotalLocal = gtl;
                                    partido.golesTotalVisitante = gtv;
                                    partido.golesLocal = pml;
                                    partido.golesVisitante = pmv;
                                    if (partido.resultado) {
                                        partido.resultado.golesLocal = pml;
                                        partido.resultado.golesVisitante = pmv;
                                    }

                                    const allFinished = partido.duelosIndividuales.every(d => d.finalizado);
                                    if (allFinished || pml >= 2 || pmv >= 2) {
                                        partido.finalizado = true;
                                    }

                                    await freshLiga.save();

                                    try {
                                        const { invalidateCache } = await import('../../utils/visual/imageCache.js');
                                        invalidateCache('superliga');
                                    } catch (e) {}

                                    await m.edit({ content: getStatusText(), components: renderFormRows() }).catch(() => {});
                                    await panelMsg.edit({ embeds: [buildSuperligaEmbed(freshLiga)], components: buildSuperligaRows(freshLiga) }).catch(() => {});
                                };

                                // Si ya estaba finalizado -> Opción de anular resultado
                                if (duelo.finalizado) {
                                    const anularRow = new ActionRowBuilder().addComponents(
                                        new ButtonBuilder().setCustomId(`btn_anular_mini_yes_${miniIdx}`).setLabel('🗑️ Anular Resultado de este Mini').setStyle(ButtonStyle.Danger),
                                        new ButtonBuilder().setCustomId(`btn_anular_mini_edit_${miniIdx}`).setLabel('✏️ Cambiar Goles').setStyle(ButtonStyle.Primary),
                                        new ButtonBuilder().setCustomId(`btn_anular_mini_no_${miniIdx}`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
                                    );

                                    await btnInt.reply({
                                        content: `⚠️ **Mini ${miniIdx + 1} ya tiene resultado (${duelo.golesLocal} - ${duelo.golesVisitante}):**\n¿Qué acción deseas realizar?`,
                                        components: [anularRow],
                                        flags: 64
                                    });
                                    const mOpt = await btnInt.fetchReply();
                                    const colOpt = mOpt.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

                                    colOpt.on('collect', async iOpt => {
                                        if (iOpt.customId === `btn_anular_mini_no_${miniIdx}`) {
                                            return iOpt.update({ content: 'Acción cancelada.', components: [] });
                                        }

                                        if (iOpt.customId === `btn_anular_mini_yes_${miniIdx}`) {
                                            duelo.finalizado = false;
                                            duelo.golesLocal = null;
                                            duelo.golesVisitante = null;

                                            let pml = 0, pmv = 0, gtl = 0, gtv = 0;
                                            for (const d of partido.duelosIndividuales) {
                                                if (d.finalizado) {
                                                    gtl += d.golesLocal; gtv += d.golesVisitante;
                                                    if (d.golesLocal > d.golesVisitante) pml++;
                                                    else if (d.golesVisitante > d.golesLocal) pmv++;
                                                }
                                            }
                                            partido.puntosMiniLocal = pml;
                                            partido.puntosMiniVisitante = pmv;
                                            partido.golesTotalLocal = gtl;
                                            partido.golesTotalVisitante = gtv;
                                            if (partido.resultado) {
                                                partido.resultado.golesLocal = pml;
                                                partido.resultado.golesVisitante = pmv;
                                            }
                                            partido.golesLocal = pml;
                                            partido.golesVisitante = pmv;
                                            partido.finalizado = false;

                                            await freshLiga.save();
                                            await iOpt.update({ content: `✅ **Mini ${miniIdx + 1} anulado correctamente.** El resultado volvió a quedar pendiente.`, components: [] });
                                            await m.edit({ content: getStatusText(), components: renderFormRows() }).catch(() => {});
                                            await panelMsg.edit({ embeds: [buildSuperligaEmbed(freshLiga)], components: buildSuperligaRows(freshLiga) }).catch(() => {});
                                            return;
                                        }

                                        if (iOpt.customId === `btn_anular_mini_edit_${miniIdx}`) {
                                            const localName = duelo.localJugadorNombre || partido.localNombre;
                                            const visitanteName = duelo.visitanteJugadorNombre || partido.visitanteNombre;
                                            const modalGoles = new ModalBuilder().setCustomId(`m_g_mini_${miniIdx}`).setTitle(`Goles Mini ${miniIdx + 1}`);
                                            modalGoles.addComponents(
                                                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles ${localName}`).setStyle(TextInputStyle.Short).setValue(String(duelo.golesLocal ?? '')).setRequired(true)),
                                                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles ${visitanteName}`).setStyle(TextInputStyle.Short).setValue(String(duelo.golesVisitante ?? '')).setRequired(true))
                                            );
                                            await iOpt.showModal(modalGoles);
                                            await procesarSubmitModal(iOpt);
                                        }
                                    });
                                    return;
                                }

                                const localName = duelo.localJugadorNombre || partido.localNombre;
                                const visitanteName = duelo.visitanteJugadorNombre || partido.visitanteNombre;
                                const modalGoles = new ModalBuilder().setCustomId(`m_g_mini_${miniIdx}`).setTitle(`Goles Mini ${miniIdx + 1}`);
                                modalGoles.addComponents(
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles ${localName}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 5').setRequired(true)),
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles ${visitanteName}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 3').setRequired(true))
                                );
                                await btnInt.showModal(modalGoles);
                                await procesarSubmitModal(btnInt);
                            }
                        });
                    };

                    colEq.on('collect', async iEq => {
                        if (iEq.customId === 'btn_sl_clear_eq') {
                            filtroEq = '';
                            return iEq.update(renderEqMenuPayload());
                        }

                        if (iEq.customId === 'btn_sl_search_eq') {
                            const modal = new ModalBuilder()
                                .setCustomId('mod_sl_search_eq')
                                .setTitle('Buscar Equipo o Jugador');

                            const inputEq = new TextInputBuilder()
                                .setCustomId('input_sl_eq')
                                .setLabel('Nombre del equipo o jugador')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Ej: Boca, Pedro...')
                                .setRequired(true)
                                .setMinLength(1)
                                .setMaxLength(50);

                            modal.addComponents(new ActionRowBuilder().addComponents(inputEq));
                            await iEq.showModal(modal);

                            const modalResp = await i.awaitModalSubmit({
                                filter: mI => mI.customId === 'mod_sl_search_eq' && mI.user.id === i.user.id,
                                time: 60000
                            }).catch(() => null);

                            if (!modalResp) return;
                            filtroEq = modalResp.fields.getTextInputValue('input_sl_eq').trim();
                            return modalResp.update(renderEqMenuPayload());
                        }

                        if (iEq.customId !== 'sel_eq_res') return;
                        await iEq.deferUpdate();
                        const selEqId = iEq.values[0];
                        const selEq = equiposList.find(e => (e._id?.$oid ?? e._id) === selEqId);

                        const matchOptions = [];
                        for (const f of freshLiga.fechas) {
                            for (const [idx, p] of (f.encuentros || f.partidos).entries()) {
                                if (p.localId === selEqId || p.visitanteId === selEqId) {
                                    matchOptions.push({
                                        label: `F${f.numero}: ${p.localNombre} vs ${p.visitanteNombre}`,
                                        description: p.finalizado ? `✅ Finalizado (${p.puntosMiniLocal ?? 0}-${p.puntosMiniVisitante ?? 0})` : '⏳ Pendiente',
                                        value: `${f.numero}_${idx + 1}`
                                    });
                                }
                            }
                        }

                        if (matchOptions.length === 0) {
                            return iEq.followUp({ content: '❌ Este equipo no tiene partidos.', flags: 64 });
                        }

                        let matchPagina = 0;
                        const MATCH_ITEMS_PAGE = 25;

                        const renderMatchMenuPayload = () => {
                            const totalPages = Math.ceil(matchOptions.length / MATCH_ITEMS_PAGE) || 1;
                            matchPagina = Math.min(Math.max(0, matchPagina), totalPages - 1);
                            const pageItems = matchOptions.slice(matchPagina * MATCH_ITEMS_PAGE, (matchPagina + 1) * MATCH_ITEMS_PAGE);

                            const matchMenu = new StringSelectMenuBuilder()
                                .setCustomId('sel_match_res')
                                .setPlaceholder('2. Selecciona el Partido')
                                .addOptions(pageItems);

                            const rows = [new ActionRowBuilder().addComponents(matchMenu)];

                            if (totalPages > 1) {
                                const navRow = new ActionRowBuilder().addComponents(
                                    new ButtonBuilder().setCustomId('btn_m_sl_prev').setLabel('◀️ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(matchPagina === 0),
                                    new ButtonBuilder().setCustomId('btn_m_sl_info').setLabel(`Página ${matchPagina + 1}/${totalPages} (${matchOptions.length} partidos)`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                                    new ButtonBuilder().setCustomId('btn_m_sl_next').setLabel('Siguiente ▶️').setStyle(ButtonStyle.Secondary).setDisabled(matchPagina >= totalPages - 1)
                                );
                                rows.push(navRow);
                            }

                            return {
                                content: `Partidos de **${selEq.nombre}** (${matchOptions.length} encontrados). Selecciona uno:`,
                                components: rows
                            };
                        };

                        await iEq.editReply(renderMatchMenuPayload());

                        const colMatch = m1.createMessageComponentCollector({ time: 120000 });
                        colMatch.on('collect', async iMatch => {
                            if (iMatch.user.id !== iEq.user.id) return;

                            if (iMatch.customId === 'btn_m_sl_prev') {
                                if (matchPagina > 0) matchPagina--;
                                return iMatch.update(renderMatchMenuPayload());
                            }
                            if (iMatch.customId === 'btn_m_sl_next') {
                                matchPagina++;
                                return iMatch.update(renderMatchMenuPayload());
                            }

                            if (iMatch.customId === 'sel_match_res') {
                                const [nFR, nPR] = iMatch.values[0].split('_').map(Number);
                                const fObj = freshLiga.fechas.find(f => f.numero === nFR);
                                const pObj = fObj?.partidos[nPR - 1] || fObj?.encuentros[nPR - 1];

                                if (!pObj) return iMatch.reply({ content: '❌ Partido no encontrado.', flags: 64 });

                                await flowResultado(iMatch, pObj);
                            }
                        });
                    });
                    break;
                }

                case 'btn_sl_editar_equipos': {
                    const equiposEdit = await EquipoSuperliga.find({});
                    if (equiposEdit.length === 0) return i.reply({ content: '❌ No hay equipos registrados.', flags: 64 });

                    const eqOptionsEdit = equiposEdit.slice(0, 25).map(e => ({ label: e.nombre, value: e._id?.$oid ?? e._id }));
                    const eqMenuEdit = new StringSelectMenuBuilder().setCustomId('sel_eq_edit').setPlaceholder('1. Selecciona un Equipo').addOptions(eqOptionsEdit);

                    await i.reply({ content: 'Selecciona el equipo a editar:', components: [new ActionRowBuilder().addComponents(eqMenuEdit)], flags: 64 });
                    const mEdit = await i.fetchReply();
                    const colEqEdit = mEdit.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

                    colEqEdit.on('collect', async iEqEdit => {
                        if (iEqEdit.customId !== 'sel_eq_edit') return;
                        await iEqEdit.deferUpdate();
                        const selEqId = iEqEdit.values[0];
                        const selEq = equiposEdit.find(e => (e._id?.$oid ?? e._id) === selEqId);

                        const options = [
                            { label: '📝 Editar Nombre/Escudo', value: 'edit_club' },
                            { label: `👤 Coach: ${selEq.coach.nombre}`, value: `edit_coach_${selEq.coach.id}` }
                        ];
                        selEq.jugadores.forEach(j => {
                            options.push({ label: `🏃 Jugador: ${j.nombre}`, value: `edit_jug_${j.id}` });
                        });

                        const actionMenu = new StringSelectMenuBuilder().setCustomId('sel_eq_action').setPlaceholder('2. Selecciona qué editar').addOptions(options);
                        await iEqEdit.editReply({ content: `Opciones de **${selEq.nombre}**. Selecciona qué deseas editar:`, components: [new ActionRowBuilder().addComponents(actionMenu)] });

                        const colAct = mEdit.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
                        colAct.on('collect', async iAct => {
                            if (iAct.customId !== 'sel_eq_action') return;
                            const action = iAct.values[0];

                            if (action === 'edit_club') {
                                const modalClub = new ModalBuilder().setCustomId(`m_club_${selEqId}`).setTitle('Editar Club');
                                const nLabel = new LabelBuilder()
                                    .setLabel('Nombre del Equipo')
                                    .setTextInputComponent(
                                        new TextInputBuilder()
                                            .setCustomId('n')
                                            .setStyle(TextInputStyle.Short)
                                            .setValue(selEq.nombre)
                                            .setRequired(true)
                                    );

                                const fileInput = new FileUploadBuilder()
                                    .setCustomId('e')
                                    .setRequired(true);

                                const inputLabel = new LabelBuilder()
                                    .setLabel("Escudo del Equipo")
                                    .setFileUploadComponent(fileInput);

                                modalClub.addLabelComponents(nLabel, inputLabel);
                                await iAct.showModal(modalClub);

                                const subClub = await iAct.awaitModalSubmit({ time: 60000 }).catch(() => null);
                                if (!subClub) return;

                                await subClub.deferReply({ flags: 64 });
                                const nombre = subClub.fields.getTextInputValue('n');
                                const escudo = subClub.fields.getField('e');

                                const url = escudo?.attachments.first()?.url;
                                if (!url) return subClub.editReply('❌ No se ha subido ninguna imagen para el escudo.');

                                const ext = url.split('.').pop().split('?')[0] || 'png';
                                const fileName = `${nombre.toLowerCase().replace(/ /g, '_')}_${Date.now()}.${ext}`;
                                const localPath = await descargarImagen(url, fileName, 'equipos');

                                selEq.nombre = nombre;
                                selEq.escudo = localPath;

                                await selEq.save();
                                await subClub.editReply({ content: `✅ Equipo **${selEq.nombre}** actualizado.`, flags: 64 });
                            } else {
                                const idJug = action.split('_')[2];
                                const esCoach = action.startsWith('edit_coach');
                                const mem = esCoach ? selEq.coach : selEq.jugadores.find(j => j.id === idJug);

                                const modalMem = new ModalBuilder().setCustomId(`m_mem_${idJug}`).setTitle('Editar Stats y Contrato');
                                modalMem.addComponents(
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('media').setLabel('Media').setStyle(TextInputStyle.Short).setValue(mem.media.toString()).setRequired(true)),
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pais').setLabel('País').setStyle(TextInputStyle.Short).setValue(mem.pais || 'Argentina').setRequired(true)),
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('stats').setLabel('Stats (ACT-TIR-PAS-IQ-AUR-ESQ)').setStyle(TextInputStyle.Short).setValue(`${mem.stats.actividad}-${mem.stats.tiro}-${mem.stats.pase}-${mem.stats.iq}-${mem.stats.aura}-${mem.stats.esquinazo}`).setRequired(true)),
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('contrato').setLabel('Contrato (Temporadas)').setStyle(TextInputStyle.Short).setValue((mem.contrato || 1).toString()).setRequired(true)),
                                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clausula').setLabel('Cláusula (ej: dinero 1000, ninguna)').setStyle(TextInputStyle.Short).setValue(mem.clausula ? `${mem.clausula.tipo} ${mem.clausula.valor}`.trim() : 'ninguna').setRequired(true))
                                );
                                await iAct.showModal(modalMem);

                                const subMem = await iAct.awaitModalSubmit({ time: 60000 }).catch(() => null);
                                if (!subMem) return;
                                try {
                                    mem.media = parseInt(subMem.fields.getTextInputValue('media'));
                                    mem.pais = subMem.fields.getTextInputValue('pais');
                                    const [act, tir, pas, iq, aur, esq] = subMem.fields.getTextInputValue('stats').split('-').map(Number);
                                    mem.stats = { actividad: act, tiro: tir, pase: pas, iq: iq, aura: aur, esquinazo: esq };

                                    mem.contrato = Math.max(1, parseInt(subMem.fields.getTextInputValue('contrato')) || 1);
                                    const clausulaStr = subMem.fields.getTextInputValue('clausula').trim().split(' ');
                                    const tipoC = clausulaStr[0].toLowerCase();
                                    let valorC = clausulaStr.slice(1).join(' ').trim();

                                    if (['dinero', 'partidos', 'objetivo', 'ninguna'].includes(tipoC)) {
                                        if (tipoC === 'dinero') {
                                            const upperVal = valorC.toUpperCase();
                                            let multiplier = 1;
                                            let numStr = upperVal;
                                            if (upperVal.endsWith('M')) { multiplier = 1000000; numStr = upperVal.slice(0, -1); }
                                            else if (upperVal.endsWith('K')) { multiplier = 1000; numStr = upperVal.slice(0, -1); }
                                            const val = parseFloat(numStr.replace(',', '.'));
                                            if (!isNaN(val)) valorC = (val * multiplier).toString();
                                        } else if (tipoC === 'partidos') {
                                            if (!isNaN(parseInt(valorC))) valorC = parseInt(valorC).toString();
                                        }
                                        mem.clausula = { tipo: tipoC, valor: valorC };
                                    } else {
                                        mem.clausula = { tipo: 'ninguna', valor: '' };
                                    }

                                    mem.carta = ''; // Force refresh visual
                                    await selEq.save();
                                    await subMem.reply({ content: `✅ Jugador **${mem.nombre}** actualizado.`, flags: 64 });
                                } catch (e) { await subMem.reply({ content: '❌ Formato inválido. Stats ej: 80-80-80-80-80-80', flags: 64 }); }
                            }
                        });
                    });
                    break;
                }

                case 'btn_sl_gen_fixture': {
                    if (!freshLiga) return i.reply({ content: '❌ No hay temporada activa.', flags: 64 });
                    if (freshLiga.fechas && freshLiga.fechas.length > 0) return i.reply({ content: '❌ El fixture ya existe.', flags: 64 });

                    const equiposAll = await EquipoSuperliga.find({});
                    if (equiposAll.length < 2) return i.reply({ content: '❌ Se necesitan al menos 2 equipos.', flags: 64 });

                    freshLiga.fechas = generarRoundRobinSuperliga(equiposAll, freshLiga.reglas?.vueltas || 1);
                    freshLiga.equipos = equiposAll.map(e => e._id?.$oid ?? e._id);
                    await freshLiga.save();

                    await panelMsg.edit({ embeds: [buildSuperligaEmbed(freshLiga)], components: buildSuperligaRows(freshLiga) });
                    await i.reply({ content: '✅ Fixture generado correctamente.', flags: 64 });
                    break;
                }

                case 'btn_sl_nueva': {
                    const modalNueva = new ModalBuilder().setCustomId('m_sl_nueva').setTitle('Nueva Temporada');
                    modalNueva.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nombre').setLabel('Nombre de la Temporada').setStyle(TextInputStyle.Short).setPlaceholder('Ej: Temporada 1').setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vueltas').setLabel('Cantidad de Vueltas').setStyle(TextInputStyle.Short).setValue('1').setRequired(true))
                    );
                    await i.showModal(modalNueva);
                    const subN = await i.awaitModalSubmit({ time: 60000 }).catch(() => null);
                    if (!subN) return;

                    const nom = subN.fields.getTextInputValue('nombre');
                    const v = parseInt(subN.fields.getTextInputValue('vueltas')) || 1;

                    const todosLosEquipos = await EquipoSuperliga.find({});
                    if (todosLosEquipos.length < 2) return subN.reply({ content: '❌ Se necesitan al menos 2 equipos para iniciar.', flags: 64 });

                    const eqOptions = todosLosEquipos.slice(0, 25).map(e => ({ label: e.nombre, value: (e._id?.$oid ?? e._id).toString() }));
                    const eqMenu = new StringSelectMenuBuilder()
                        .setCustomId('sel_eq_nueva')
                        .setPlaceholder('Selecciona los equipos participantes')
                        .setMinValues(2)
                        .setMaxValues(eqOptions.length)
                        .addOptions(eqOptions);

                    await subN.reply({
                        content: `Configuración de **${nom}** guardada. Ahora selecciona los equipos que participarán:`,
                        components: [new ActionRowBuilder().addComponents(eqMenu)],
                        flags: 64
                    });
                    const mSelect = await subN.fetchReply();

                    const colEqNueva = mSelect.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 120000 });
                    colEqNueva.on('collect', async iEqNueva => {
                        if (iEqNueva.customId !== 'sel_eq_nueva') return;
                        await iEqNueva.deferUpdate();

                        const idsSeleccionados = iEqNueva.values;
                        const equiposSeleccionados = todosLosEquipos.filter(e => idsSeleccionados.includes((e._id?.$oid ?? e._id).toString()));

                        const fechas = generarRoundRobinSuperliga(equiposSeleccionados, v);
                        const nLiga = await Superliga.create({
                            nombre: 'Superliga',
                            temporada: nom,
                            actual: true,
                            equipos: equiposSeleccionados.map(e => e._id?.$oid ?? e._id),
                            fechas,
                            reglas: { vueltas: v },
                            fechaInicio: Date.now()
                        });

                        await panelMsg.edit({ embeds: [buildSuperligaEmbed(nLiga)], components: buildSuperligaRows(nLiga) });
                        await iEqNueva.editReply({ content: `✅ Temporada **${nom}** iniciada con ${equiposSeleccionados.length} equipos y fixture generado.`, components: [] });
                        colEqNueva.stop();
                    });
                    break;
                }

                case 'btn_sl_terminar': {
                    if (!freshLiga) return i.reply({ content: '❌ No hay temporada activa.', flags: 64 });
                    await i.reply({
                        content: '⚠️ Para finalizar la temporada con **reparto de premios, progresión de medias y vencimiento de contratos**, usa el comando:\n`!sl-finalizar`\n\nSi solo quieres desactivarla sin procesar nada, confirma aquí abajo.',
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId('btn_sl_terminar_force').setLabel('Terminar sin procesar').setStyle(ButtonStyle.Danger)
                            )
                        ],
                        flags: 64
                    });
                    break;
                }

                case 'btn_sl_terminar_force': {
                    const liga = await Superliga.findOne({ actual: true });
                    if (liga) {
                        liga.actual = false;
                        await liga.save();
                        await i.update({ content: `✅ Temporada **${liga.temporada}** terminada (sin procesar premios/progresión).`, components: [] });
                    }
                    break;
                }
            }
        });

        collector.on('end', () => panelMsg.edit({ components: [] }).catch(() => { }));
    }
};

async function handleLegacyCommands(client, message, args) {
    const subcomando = args[0]?.toLowerCase();
    if (subcomando === 'iniciar') {
        const temporada = args[1];
        const vueltas = parseInt(args[2]) || 1;
        if (!temporada) return message.reply('❌ Uso: `!superliga-gestion iniciar <nombre_temporada> [vueltas]`');
        const actual = await Superliga.findOne({ actual: true });
        if (actual) return message.reply('❌ Ya hay una temporada activa.');
        const equipos = await EquipoSuperliga.find({});
        if (equipos.length < 2) return message.reply('❌ Se necesitan al menos 2 equipos.');
        const fechas = generarRoundRobinSuperliga(equipos, vueltas);
        await Superliga.create({
            nombre: 'Superliga',
            temporada,
            actual: true,
            equipos: equipos.map(e => e._id?.$oid ?? e._id),
            fechas,
            reglas: { vueltas },
            fechaInicio: Date.now()
        });
        return message.reply(`✅ Superliga **${temporada}** iniciada.`);
    }

    if (subcomando === 'sync_stats') {
        const infoMsg = await message.reply('<a:loading:1461897825439711468> Calculando estadísticas históricas para todos los equipos... esto puede tomar un momento.');
        const allLigas = await Superliga.find({});
        const equipos = await EquipoSuperliga.find({});

        const statsMap = {};
        const nameMap = {};
        for (const eq of equipos) {
            const eqId = eq._id?.$oid ?? eq._id;
            statsMap[eqId] = {
                puntosAcumulados: 0,
                partidosGanados: 0,
                partidosPerdidos: 0,
                diferenciaGoles: 0,
                titulosTotales: 0
            };
            nameMap[eq.nombre] = eqId;
        }

        for (const liga of allLigas) {
            if (!liga.fechas) continue;
            const currentLigaStats = {};

            for (const f of liga.fechas) {
                const encuentros = f.partidos ?? f.encuentros;
                if (!encuentros) continue;

                for (const p of encuentros) {
                    if (!p.finalizado) continue;

                    const lId = nameMap[p.localNombre || p.local?.nombre] || p.localId;
                    const vId = nameMap[p.visitanteNombre || p.visitante?.nombre] || p.visitanteId;

                    if (!currentLigaStats[lId]) currentLigaStats[lId] = { pts: 0, dg: 0, gf: 0 };
                    if (!currentLigaStats[vId]) currentLigaStats[vId] = { pts: 0, dg: 0, gf: 0 };

                    let pml = p.puntosMiniLocal ?? p.resultado?.golesLocal ?? 0;
                    let pmv = p.puntosMiniVisitante ?? p.resultado?.golesVisitante ?? 0;

                    const duelos = p.duelosIndividuales || p.miniPartidos;
                    if (pml === 0 && pmv === 0 && duelos) {
                        duelos.forEach(mp => {
                            if (mp.finalizado) {
                                if (mp.golesLocal > mp.golesVisitante) pml++;
                                else if (mp.golesVisitante > mp.golesLocal) pmv++;
                            }
                        });
                    }

                    let gl = p.golesTotalLocal || 0;
                    if (!gl && p.duelosIndividuales) { p.duelosIndividuales.forEach(mp => { gl += mp.golesLocal || 0; }); }
                    let gv = p.golesTotalVisitante || 0;
                    if (!gv && p.duelosIndividuales) { p.duelosIndividuales.forEach(mp => { gv += mp.golesVisitante || 0; }); }

                    if (statsMap[lId]) {
                        statsMap[lId].diferenciaGoles += (gl - gv);
                        if (pml > pmv) { statsMap[lId].partidosGanados++; statsMap[lId].puntosAcumulados += 3; }
                        else if (pmv > pml) { statsMap[lId].partidosPerdidos++; }
                        else { statsMap[lId].puntosAcumulados += 1; }
                    }
                    if (statsMap[vId]) {
                        statsMap[vId].diferenciaGoles += (gv - gl);
                        if (pmv > pml) { statsMap[vId].partidosGanados++; statsMap[vId].puntosAcumulados += 3; }
                        else if (pml > pmv) { statsMap[vId].partidosPerdidos++; }
                        else { statsMap[vId].puntosAcumulados += 1; }
                    }

                    currentLigaStats[lId].pts += (pml > pmv ? 3 : (pml === pmv ? 1 : 0));
                    currentLigaStats[vId].pts += (pmv > pml ? 3 : (pmv === pml ? 1 : 0));
                    currentLigaStats[lId].dg += (pml - pmv);
                    currentLigaStats[vId].dg += (pmv - pml);
                    currentLigaStats[lId].gf += pml;
                    currentLigaStats[vId].gf += pmv;
                }
            }

            const entries = Object.entries(currentLigaStats);
            if (entries.length > 0) {
                const winnerEntry = entries.sort((a, b) => {
                    return b[1].pts - a[1].pts || b[1].dg - a[1].dg || b[1].gf - a[1].gf;
                })[0];
                const winnerId = winnerEntry[0];
                if (statsMap[winnerId]) {
                    statsMap[winnerId].titulosTotales++;
                }
            }
        }

        for (const eq of equipos) {
            const eqId = eq._id?.$oid ?? eq._id;
            if (statsMap[eqId]) {
                eq.tablaHistorica = statsMap[eqId];
                await eq.save();
            }
        }
        return infoMsg.edit(`✅ Estadísticas históricas sincronizadas correctamente para **${equipos.length}** equipos en **${allLigas.length}** temporadas.`);
    }

    return message.reply('💡 Tip: Usa `!superliga-gestion` sin argumentos para abrir el panel.\nSubcomandos: `iniciar`, `sync_stats`');
}
