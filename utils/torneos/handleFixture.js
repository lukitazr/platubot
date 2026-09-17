import { generarFixtureImagen } from '../visual/fixtureGenerator.js';
import { buildFixtureNavigation } from '../ui/fixtureNavigation.js';
import { getAvatarBase64 } from '../visual/avatarUtils.js';
import { getCachedImage } from '../visual/imageCache.js';
import { AttachmentBuilder } from 'discord.js';
import Torneo from '../../models/copas/Torneo.js';
import { resolveFilterTarget, matchInvolvesTarget, paginateFilteredMatches } from '../fixtureFilter.js';

export default async function handleFixture(client, message, args, torneo) {
    if (torneo.estado === 'Configuracion') return message.reply('❌ El fixture aún no ha sido generado.');

    // 1. Detectar si hay un filtro por jugador o equipo
    let filterQuery = null;
    const mentionOrId = args.find(arg => /^<@!?\d{17,20}>$/.test(arg) || /^\d{17,20}$/.test(arg));
    if (mentionOrId) {
        filterQuery = mentionOrId;
    } else if (args.length > 0) {
        // Descartar si el argumento es únicamente una letra de grupo o una palabra clave de fase
        const nonKeywords = args.filter(a => !['eliminatorias', 'bracket', 'grupos', 'fase'].includes(a.toLowerCase()) && !(a.length === 1 && /^[A-Z]$/i.test(a)));
        if (nonKeywords.length > 0) {
            filterQuery = nonKeywords.join(' ');
        }
    }

    if (filterQuery) {
        const filterTarget = await resolveFilterTarget(filterQuery, client);
        if (filterTarget && (filterTarget.id || filterTarget.doc || filterTarget.teamDoc || filterTarget.jugadorDoc || torneo.equipos.some(e => e.nombre.toLowerCase().includes(filterQuery.toLowerCase())))) {
            return await sendFilteredTorneo(client, message, torneo, filterTarget);
        }
    }

    const grupoSeleccionado = args.find(arg => arg.length === 1 && /^[A-Z]$/i.test(arg))?.toUpperCase();

    if (grupoSeleccionado && torneo.gruposHabilitados) {
        const existeGrupo = torneo.enfrentamientosGrupos.some(e => e.grupo === grupoSeleccionado);
        if (!existeGrupo) {
            return message.reply(`❌ El grupo **${grupoSeleccionado}** no existe en este torneo.`);
        }
    }

    // Recopilar todas las fases disponibles
    const labels = [];
    const fasesData = []; // [{ type: 'grupo' | 'bracket', name: string, data: any }]

    if (torneo.enfrentamientosGrupos?.length > 0) {
        const fechas = [...new Set(torneo.enfrentamientosGrupos.map(e => e.fecha || 1))].sort((a, b) => a - b);
        const labelPrefix = torneo.gruposHabilitados ? 'Fase de Grupos - ' : '';
        fechas.forEach(f => {
            labels.push(`${labelPrefix}Fecha ${f}`);
            fasesData.push({ type: 'grupo', name: `${labelPrefix}Fecha ${f}`, data: torneo.enfrentamientosGrupos.filter(e => (e.fecha || 1) === f) });
        });
    }

    if (torneo.fasesEliminatoria?.length > 0) {
        torneo.fasesEliminatoria.forEach(fase => {
            labels.push(fase);
            fasesData.push({ type: 'bracket', name: fase, data: torneo.llaves?.[fase] || [] });
        });
    }

    if (fasesData.length === 0) return message.reply('❌ No hay enfrentamientos disponibles.');

    // Determinar fase inicial
    let currentIdx = 0;
    if (args.includes('eliminatorias') || args.includes('bracket')) {
        currentIdx = fasesData.findIndex(f => f.type === 'bracket');
        if (currentIdx === -1) currentIdx = 0;
    } else {
        const pendIdx = fasesData.findIndex(f => {
            if (f.type === 'grupo') {
                const dataFiltrada = grupoSeleccionado ? f.data.filter(m => {
                    if (m.grupo) return m.grupo === grupoSeleccionado;
                    const teamL = torneo.equipos.find(eq => eq.nombre === (m.local || m.equipo1?.nombre));
                    return teamL && teamL.grupo === grupoSeleccionado;
                }) : f.data;
                return dataFiltrada.some(m => !m.completado);
            }
            return f.data.some(m => !m.ganador);
        });
        currentIdx = pendIdx !== -1 ? pendIdx : 0;
    }

    try {
        const loading = await message.reply('<a:loading:1461897825439711468> Generando fixture...');
        await renderAndSendFixture(client, message, torneo, currentIdx, fasesData, labels, loading, grupoSeleccionado);
    } catch (error) {
        console.error('[Fixture Error]', error);
        await message.reply('❌ Error al generar el fixture: ' + error.message);
    }
}

async function sendFilteredTorneo(client, context, torneo, filterTarget, existingMsg = null, pageIdx = 0) {
    const allFilteredMatches = [];

    // 1. Fase de Grupos
    if (torneo.enfrentamientosGrupos?.length > 0) {
        for (const e of torneo.enfrentamientosGrupos) {
            if (matchInvolvesTarget(e, filterTarget)) {
                allFilteredMatches.push({
                    ...e,
                    tipoFase: 'grupo',
                    fechaNumero: e.fecha || 1,
                    fechaLabel: torneo.gruposHabilitados ? `Grupo ${e.grupo || ''} - Fecha ${e.fecha || 1}`.trim() : `Fecha ${e.fecha || 1}`
                });
            }
        }
    }

    // 2. Eliminatorias
    if (torneo.fasesEliminatoria?.length > 0) {
        for (const fase of torneo.fasesEliminatoria) {
            const llaves = torneo.llaves?.[fase] || [];
            for (const l of llaves) {
                if (matchInvolvesTarget(l, filterTarget)) {
                    allFilteredMatches.push({
                        ...l,
                        tipoFase: 'bracket',
                        fechaLabel: fase
                    });
                }
            }
        }
    }

    if (allFilteredMatches.length === 0) {
        const msg = `ℹ️ No se encontraron partidos para **${filterTarget.nombre}** en **${torneo.nombre}**.`;
        return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
    }

    // Paginar cada 10 fechas/fases
    const pages = paginateFilteredMatches(allFilteredMatches, 10);
    const safePageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
    const currentPage = pages[safePageIdx];

    const msg = existingMsg
        ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture filtrado...')
        : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture filtrado...') : context.reply('<a:loading:1461897825439711468> Generando fixture filtrado...'));

    const allUserIds = new Set();
    currentPage.partidos.forEach(e => {
        if (Array.isArray(e.duelosIndividuales)) {
            e.duelosIndividuales.forEach(d => {
                if (d.localJugador) allUserIds.add(String(d.localJugador));
                if (d.visitanteJugador) allUserIds.add(String(d.visitanteJugador));
            });
        }
    });
    torneo.equipos.forEach(eq => {
        if (eq.propietario) allUserIds.add(String(eq.propietario));
        if (Array.isArray(eq.miembros)) {
            eq.miembros.forEach(m => {
                const id = typeof m === 'string' ? m : m.discordId;
                if (id) allUserIds.add(String(id));
            });
        }
    });

    const { resolvePlayers } = await import('../../utils/db/userResolver.js');
    const playerMap = await resolvePlayers(allUserIds, client);

    const partidosRenderRaw = await Promise.all(currentPage.partidos.map(async e => {
        const localNombre = e.local || e.localNombre || e.equipo1?.nombre;
        const visitanteNombre = e.visitante || e.visitanteNombre || e.equipo2?.nombre;

        if (!localNombre || !visitanteNombre) return null;

        const teamL = torneo.equipos.find(eq => eq.nombre === localNombre);
        const teamV = torneo.equipos.find(eq => eq.nombre === visitanteNombre);

        let setsL = 0;
        let setsV = 0;
        let duelosJugados = 0;
        if (Array.isArray(e.duelosIndividuales) && e.duelosIndividuales.length > 0) {
            e.duelosIndividuales.forEach(d => {
                const gl = d.golesLocal;
                const gv = d.golesVisitante;
                if (d.finalizado || (typeof gl === 'number' && typeof gv === 'number')) {
                    duelosJugados++;
                    if (gl > gv) setsL++;
                    else if (gv > gl) setsV++;
                }
            });
        }

        let resText = 'Pendiente';
        if (duelosJugados > 0) {
            resText = `${setsL} - ${setsV}`;
        } else if (e.tipoFase === 'bracket' && torneo.tipoEncuentro === 'ida_vuelta') {
            const resParts = [];
            if (e.ida?.finalizado) resParts.push(`${e.ida.golesLocal}-${e.ida.golesVisitante}`);
            if (e.vuelta?.finalizado) resParts.push(`${e.vuelta.golesVisitante}-${e.vuelta.golesLocal}`);
            if (e.desempate?.finalizado) resParts.push(`(${e.desempate.golesLocal}-${e.desempate.golesVisitante})`);

            if (resParts.length > 0) {
                resText = resParts.join(' / ');
            } else if (e.resultado && (e.ganador || e.completado)) {
                resText = e.resultado;
            }
        } else {
            if (e.ganador || e.completado || e.ida?.finalizado) {
                if (e.resultado) resText = e.resultado;
                else if (e.ida?.finalizado) resText = `${e.ida.golesLocal}-${e.ida.golesVisitante}`;
            }
        }

        let ganadorNombre = null;
        if (e.ganador) {
            if (e.ganador === e.equipo1?.discordId || e.ganador === e.local) ganadorNombre = localNombre;
            else if (e.ganador === e.equipo2?.discordId || e.ganador === e.visitante) ganadorNombre = visitanteNombre;
        } else if (duelosJugados > 0 && e.duelosIndividuales && e.duelosIndividuales.every(d => d.finalizado)) {
            if (setsL > setsV) ganadorNombre = localNombre;
            else if (setsV > setsL) ganadorNombre = visitanteNombre;
        }

        const duelosRender = Array.isArray(e.duelosIndividuales)
            ? await Promise.all(e.duelosIndividuales.map(async d => {
                const idL = String(d.localJugador || d.localId || '');
                const idV = String(d.visitanteJugador || d.visitanteId || '');
                const pL = playerMap.get(idL) || {};
                const pV = playerMap.get(idV) || {};

                const lName = pL.nombre || d.localJugadorNombre || d.localNombre || 'Jugador Local';
                const vName = pV.nombre || d.visitanteJugadorNombre || d.visitanteNombre || 'Jugador Visitante';

                return {
                    ...d,
                    localJugadorNombre: lName,
                    visitanteJugadorNombre: vName,
                    avatarLocal: await getAvatarBase64(pL.avatar || d.avatarLocal),
                    avatarVisitante: await getAvatarBase64(pV.avatar || d.avatarVisitante)
                };
            }))
            : [];

        return {
            local: localNombre,
            visitante: visitanteNombre,
            resultado: resText,
            ganador: ganadorNombre,
            avatarL: teamL?.miembros?.length >= 2
                ? await Promise.all(teamL.miembros.map(async m => {
                    const id = typeof m === 'string' ? m : m.discordId;
                    const p = playerMap.get(String(id)) || (typeof m === 'object' ? m : {});
                    return {
                        id,
                        nombre: p.nombre || `Jugador (${String(id).slice(-4)})`,
                        avatar: await getAvatarBase64(p.avatar)
                    };
                }))
                : await getAvatarBase64(teamL?.avatar || e.equipo1?.avatar),
            avatarV: teamV?.miembros?.length >= 2
                ? await Promise.all(teamV.miembros.map(async m => {
                    const id = typeof m === 'string' ? m : m.discordId;
                    const p = playerMap.get(String(id)) || (typeof m === 'object' ? m : {});
                    return {
                        id,
                        nombre: p.nombre || `Jugador (${String(id).slice(-4)})`,
                        avatar: await getAvatarBase64(p.avatar)
                    };
                }))
                : await getAvatarBase64(teamV?.avatar || e.equipo2?.avatar),
            ida: e.ida,
            vuelta: e.vuelta,
            desempate: e.desempate,
            duelosIndividuales: duelosRender,
            fechaLabel: e.fechaLabel
        };
    }));

    const partidosRender = partidosRenderRaw.filter(Boolean);

    const buffer = await generarFixtureImagen({
        titulo: torneo.nombre,
        subtitulo: `Partidos de ${filterTarget.nombre} (${currentPage.label})`,
        partidos: partidosRender,
        tema: torneo.tema,
        tipoEncuentro: torneo.tipoEncuentro
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'fixture_torneo_filtro.png' });
    const content = `📅 **Fixture: ${torneo.nombre} — Partidos de ${filterTarget.nombre} (${currentPage.label})**`;
    const labels = pages.map((pg, i) => `${pg.label} (Pág. ${i + 1}/${pages.length})`);
    const components = buildFixtureNavigation(`torneo_${torneo.prefix}_filt`, safePageIdx, pages.length, labels);

    if (existingMsg) {
        await msg.edit({ content, files: [attachment], components });
    } else {
        await msg.edit({ content, files: [attachment], components });
    }

    const userId = context.author?.id || context.user?.id;
    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async i => {
        await i.deferUpdate();
        let nextIdx = safePageIdx;

        if (i.customId.endsWith('_fix_prev')) nextIdx--;
        else if (i.customId.endsWith('_fix_next')) nextIdx++;
        else if (i.customId.endsWith('_fix_select')) nextIdx = parseInt(i.values[0]);

        collector.stop();
        const fresh = await Torneo.findOne({ prefix: torneo.prefix });
        if (!fresh) return;
        await sendFilteredTorneo(client, context, fresh, filterTarget, msg, nextIdx);
    });
}

async function renderAndSendFixture(client, context, torneo, idx, fasesData, labels, existingMsg = null, grupoSeleccionado = null) {
    const fase = fasesData[idx];
    let enfs = fase.data;

    if (fase.type === 'grupo' && grupoSeleccionado) {
        enfs = enfs.filter(e => {
            if (e.grupo) return e.grupo === grupoSeleccionado;
            const localNombre = e.local || e.equipo1?.nombre;
            const teamL = torneo.equipos.find(eq => eq.nombre === localNombre);
            return teamL && teamL.grupo === grupoSeleccionado;
        });
    }

    // Recopilar todos los IDs de usuarios para la resolución relacional desde `Jugador`
    const allUserIds = new Set();
    enfs.forEach(e => {
        if (Array.isArray(e.duelosIndividuales)) {
            e.duelosIndividuales.forEach(d => {
                if (d.localJugador) allUserIds.add(String(d.localJugador));
                if (d.visitanteJugador) allUserIds.add(String(d.visitanteJugador));
            });
        }
    });
    torneo.equipos.forEach(eq => {
        if (eq.propietario) allUserIds.add(String(eq.propietario));
        if (Array.isArray(eq.miembros)) {
            eq.miembros.forEach(m => {
                const id = typeof m === 'string' ? m : m.discordId;
                if (id) allUserIds.add(String(id));
            });
        }
    });

    const { resolvePlayers } = await import('../../utils/db/userResolver.js');
    const playerMap = await resolvePlayers(allUserIds, client);

    const partidosRenderRaw = await Promise.all(enfs.map(async e => {
        const localNombre = e.local || e.localNombre || e.equipo1?.nombre;
        const visitanteNombre = e.visitante || e.visitanteNombre || e.equipo2?.nombre;

        if (!localNombre || !visitanteNombre) return null;

        const teamL = torneo.equipos.find(eq => eq.nombre === localNombre);
        const teamV = torneo.equipos.find(eq => eq.nombre === visitanteNombre);

        // Calcular puntuación por duelos individuales (estilo Superliga/Supersupercopa)
        let setsL = 0;
        let setsV = 0;
        let duelosJugados = 0;
        if (Array.isArray(e.duelosIndividuales) && e.duelosIndividuales.length > 0) {
            e.duelosIndividuales.forEach(d => {
                const gl = d.golesLocal;
                const gv = d.golesVisitante;
                if (d.finalizado || (typeof gl === 'number' && typeof gv === 'number')) {
                    duelosJugados++;
                    if (gl > gv) setsL++;
                    else if (gv > gl) setsV++;
                }
            });
        }

        let resText = 'Pendiente';
        if (duelosJugados > 0) {
            resText = `${setsL} - ${setsV}`;
        } else if (fase.type === 'bracket' && torneo.tipoEncuentro === 'ida_vuelta') {
            const resParts = [];
            if (e.ida?.finalizado) resParts.push(`${e.ida.golesLocal}-${e.ida.golesVisitante}`);
            if (e.vuelta?.finalizado) resParts.push(`${e.vuelta.golesVisitante}-${e.vuelta.golesLocal}`);
            if (e.desempate?.finalizado) resParts.push(`(${e.desempate.golesLocal}-${e.desempate.golesVisitante})`);

            if (resParts.length > 0) {
                resText = resParts.join(' / ');
            } else if (e.resultado && (e.ganador || e.completado)) {
                resText = e.resultado;
            }
        } else {
            if (e.ganador || e.completado || e.ida?.finalizado) {
                if (e.resultado) resText = e.resultado;
                else if (e.ida?.finalizado) resText = `${e.ida.golesLocal}-${e.ida.golesVisitante}`;
            }
        }

        let ganadorNombre = null;
        if (e.ganador) {
            if (e.ganador === e.equipo1?.discordId || e.ganador === e.local) ganadorNombre = localNombre;
            else if (e.ganador === e.equipo2?.discordId || e.ganador === e.visitante) ganadorNombre = visitanteNombre;
        } else if (duelosJugados > 0 && e.duelosIndividuales && e.duelosIndividuales.every(d => d.finalizado)) {
            if (setsL > setsV) ganadorNombre = localNombre;
            else if (setsV > setsL) ganadorNombre = visitanteNombre;
        }

        // Mapear duelos con sus nombres y avatares relacionales desde `Jugador`
        const duelosRender = Array.isArray(e.duelosIndividuales)
            ? await Promise.all(e.duelosIndividuales.map(async d => {
                const idL = String(d.localJugador || d.localId || '');
                const idV = String(d.visitanteJugador || d.visitanteId || '');
                const pL = playerMap.get(idL) || {};
                const pV = playerMap.get(idV) || {};

                const lName = pL.nombre || d.localJugadorNombre || d.localNombre || 'Jugador Local';
                const vName = pV.nombre || d.visitanteJugadorNombre || d.visitanteNombre || 'Jugador Visitante';

                return {
                    ...d,
                    localJugadorNombre: lName,
                    visitanteJugadorNombre: vName,
                    avatarLocal: await getAvatarBase64(pL.avatar || d.avatarLocal),
                    avatarVisitante: await getAvatarBase64(pV.avatar || d.avatarVisitante)
                };
            }))
            : [];

        return {
            local: localNombre,
            visitante: visitanteNombre,
            resultado: resText,
            ganador: ganadorNombre,
            avatarL: teamL?.miembros?.length >= 2
                ? await Promise.all(teamL.miembros.map(async m => {
                    const id = typeof m === 'string' ? m : m.discordId;
                    const p = playerMap.get(String(id)) || (typeof m === 'object' ? m : {});
                    return {
                        id,
                        nombre: p.nombre || `Jugador (${String(id).slice(-4)})`,
                        avatar: await getAvatarBase64(p.avatar)
                    };
                }))
                : await getAvatarBase64(teamL?.avatar || e.equipo1?.avatar),
            avatarV: teamV?.miembros?.length >= 2
                ? await Promise.all(teamV.miembros.map(async m => {
                    const id = typeof m === 'string' ? m : m.discordId;
                    const p = playerMap.get(String(id)) || (typeof m === 'object' ? m : {});
                    return {
                        id,
                        nombre: p.nombre || `Jugador (${String(id).slice(-4)})`,
                        avatar: await getAvatarBase64(p.avatar)
                    };
                }))
                : await getAvatarBase64(teamV?.avatar || e.equipo2?.avatar),
            ida: e.ida,
            vuelta: e.vuelta,
            desempate: e.desempate,
            duelosIndividuales: duelosRender,
            grupo: e.grupo
        };
    }));

    const partidosRender = partidosRenderRaw.filter(Boolean);

    const key = `fixture_${fase.name.replace(/[^a-zA-Z0-9]/g, '_')}${grupoSeleccionado ? `_${grupoSeleccionado}` : ''}`;
    const subtituloImagen = fase.type === 'grupo' && grupoSeleccionado
        ? `${fase.name} — Grupo ${grupoSeleccionado}`
        : fase.name;

    const buffer = await getCachedImage(
        torneo.prefix,
        key,
        { partidos: partidosRender, tema: torneo.tema, titulo: torneo.nombre, subtitulo: subtituloImagen, tipoEncuentro: torneo.tipoEncuentro },
        () => generarFixtureImagen({
            titulo: torneo.nombre,
            subtitulo: subtituloImagen,
            partidos: partidosRender,
            tema: torneo.tema,
            tipoEncuentro: torneo.tipoEncuentro
        })
    );

    const attachment = new AttachmentBuilder(buffer, { name: `${key}.png` });
    const content = `📅 **Fixture: ${torneo.nombre} — ${fase.name}${fase.type === 'grupo' && grupoSeleccionado ? ` (Grupo ${grupoSeleccionado})` : ''}**`;
    const components = buildFixtureNavigation(`torneo_${torneo.prefix}`, idx, fasesData.length, labels);

    let msg;
    if (existingMsg) {
        msg = await existingMsg.edit({ content, files: [attachment], components });
    } else {
        msg = await context.reply({ content, files: [attachment], components });
    }

    const userId = context.author?.id || context.user?.id;
    const filter = i => i.user.id === userId;
    const collector = msg.createMessageComponentCollector({ filter, time: 300000 });

    collector.on('collect', async i => {
        await i.deferUpdate();
        let nextIdx = idx;

        if (i.customId.endsWith('_fix_prev')) nextIdx--;
        else if (i.customId.endsWith('_fix_next')) nextIdx++;
        else if (i.customId.endsWith('_fix_select')) nextIdx = parseInt(i.values[0]);

        collector.stop();
        const fresh = await Torneo.findOne({ prefix: torneo.prefix });

        const freshLabels = [];
        const freshFasesData = [];
        if (fresh.enfrentamientosGrupos?.length > 0) {
            const fechas = [...new Set(fresh.enfrentamientosGrupos.map(e => e.fecha || 1))].sort((a, b) => a - b);
            const labelPrefix = fresh.gruposHabilitados ? 'Fase de Grupos - ' : '';
            fechas.forEach(f => {
                freshLabels.push(`${labelPrefix}Fecha ${f}`);
                freshFasesData.push({ type: 'grupo', name: `${labelPrefix}Fecha ${f}`, data: fresh.enfrentamientosGrupos.filter(e => (e.fecha || 1) === f) });
            });
        }
        if (fresh.fasesEliminatoria?.length > 0) {
            fresh.fasesEliminatoria.forEach(f => {
                freshLabels.push(f);
                freshFasesData.push({ type: 'bracket', name: f, data: fresh.llaves?.[f] || [] });
            });
        }

        await renderAndSendFixture(client, context, fresh, nextIdx, freshFasesData, freshLabels, msg, grupoSeleccionado);
    });
}