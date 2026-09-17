import {
    AttachmentBuilder,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import { generarImagenParticipantes, generarBracketCopa } from '../visual/copaVisualGenerator.js';
import { getCachedImage } from '../visual/imageCache.js';
import { getAvatarBase64 } from '../visual/avatarUtils.js';

export async function handleParticipantes(client, message, args, torneo) {
    const loading = await message.reply('<a:loading:1461897825439711468> Generando lista de participantes...');
    try {
        const esIndividual = torneo.tipoCompeticion === 'individual' || torneo.tipoJugadores === 'users';

        let playerMap = new Map();
        if (esIndividual) {
            const { resolvePlayers } = await import('../db/userResolver.js');
            const allIds = new Set();
            torneo.equipos.forEach(e => {
                if (e.discordId) allIds.add(String(e.discordId));
                if (e.propietario) allIds.add(String(e.propietario));
                if (e.id) allIds.add(String(e.id));
                if (e.nombre) allIds.add(String(e.nombre));
            });
            playerMap = await resolvePlayers(allIds, client);
        }

        const torneoCopy = JSON.parse(JSON.stringify(torneo));
        torneoCopy.equipos = await Promise.all(torneoCopy.equipos.map(async e => {
            const idKey = String(e.discordId || e.propietario || e.id || '');
            const pInfo = playerMap.get(idKey) || playerMap.get(e.nombre) || {};

            const finalNombre = (esIndividual && pInfo.nombre) ? pInfo.nombre : e.nombre;
            const avatarSrc = (esIndividual && pInfo.avatar) ? pInfo.avatar : e.avatar;

            return {
                ...e,
                nombre: finalNombre,
                avatar: await getAvatarBase64(avatarSrc)
            };
        }));

        const png = await getCachedImage(
            torneo.prefix,
            'participantes',
            { equipos: torneo.equipos, tema: torneo.tema, nombre: torneo.nombre, logo: torneo.logo },
            () => generarImagenParticipantes(torneoCopy)
        );
        const attachment = new AttachmentBuilder(png, { name: 'participantes.png' });
        await loading.edit({ content: `👥 **Participantes — ${torneo.nombre}**`, files: [attachment] });
    } catch (error) {
        console.error(error);
        await loading.edit('❌ Error al generar la imagen de participantes.');
    }
}

export async function handleBracket(client, message, args, torneo) {
    if (!message.member.permissions.has('Administrator') && message.author.id !== torneo.createdBy) {
        return message.reply('❌ Solo administradores pueden gestionar el torneo.');
    }
    if (torneo.estado === 'Configuracion' || !torneo.fasesEliminatoria?.length) return message.reply('❌ El torneo aún no ha generado los brackets.');
    const loading = await message.reply('<a:loading:1461897825439711468> Generando bracket...');
    try {
        const png = await getCachedImage(
            torneo.prefix,
            'bracket',
            { llaves: torneo.llaves, faseActual: torneo.faseActual, tema: torneo.tema, nombre: torneo.nombre, logo: torneo.logo },
            () => generarBracketCopa(torneo)
        );
        const attachment = new AttachmentBuilder(png, { name: 'bracket.png' });
        await loading.edit({ content: `📊 **Bracket — ${torneo.nombre}**`, files: [attachment] });
    } catch (error) {
        console.error(error);
        await loading.edit('❌ Error al generar el bracket.');
    }
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function generarDuelosIndividuales(equipoLocal, equipoVisitante) {
    if (!equipoLocal.miembros || !equipoVisitante.miembros) return [];

    const localPlayers = shuffle([...equipoLocal.miembros]);
    const visitantePlayers = shuffle([...equipoVisitante.miembros]);
    const n = Math.min(localPlayers.length, visitantePlayers.length);

    return Array.from({ length: n }, (_, i) => {
        const idL = typeof localPlayers[i] === 'string' ? localPlayers[i] : (localPlayers[i].discordId || localPlayers[i].id);
        const idV = typeof visitantePlayers[i] === 'string' ? visitantePlayers[i] : (visitantePlayers[i].discordId || visitantePlayers[i].id);
        return {
            localJugador: String(idL),
            visitanteJugador: String(idV),
            golesLocal: null,
            golesVisitante: null,
            finalizado: false,
        };
    });
}

export function generarSlotsVacios(cantidad = 3) {
    return Array.from({ length: cantidad }, () => ({
        localJugador: null,
        visitanteJugador: null,
        golesLocal: null,
        golesVisitante: null,
        finalizado: false
    }));
}

export async function handleAgregarMiembro(client, message, args, torneo) {
    if (torneo.tipoCompeticion !== 'equipos') {
        return message.reply('❌ Este comando solo está disponible en torneos de **Equipos**.');
    }

    const userId = message.author.id;
    const isAdmin = message.member.permissions.has('Administrator');
    const miEquipo = torneo.equipos.find(e => e.propietario === userId);

    if (!miEquipo && !isAdmin) {
        return message.reply('❌ No eres el propietario de ningún equipo registrado en este torneo.');
    }

    let equipoTarget = miEquipo;

    if (isAdmin && torneo.equipos.length > 0) {
        if (!equipoTarget) {
            const rowSelect = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin_select_target_team|${torneo.prefix}`)
                    .setPlaceholder('Selecciona el equipo al que agregar el miembro...')
                    .addOptions(torneo.equipos.map(e => ({
                        label: e.nombre,
                        value: e.propietario,
                        description: `Propietario ID: ${e.propietario}`
                    })))
            );

            const msgSelect = await message.reply({
                content: '⚙️ **Selección de Equipo (Administrador)**\nPor favor, selecciona a qué equipo deseas agregar el miembro:',
                components: [rowSelect]
            });

            const iSelect = await msgSelect.awaitMessageComponent({ time: 30000 }).catch(() => null);
            if (!iSelect) return;

            equipoTarget = torneo.equipos.find(e => e.propietario === iSelect.values[0]);
            await iSelect.deferUpdate();
        }
    }

    if (!equipoTarget) {
        return message.reply('❌ No se ha podido determinar el equipo objetivo.');
    }

    const limitMax = torneo.equipoConfig?.maxJugadores || 5;
    if (equipoTarget.miembros && equipoTarget.miembros.length >= limitMax) {
        return message.reply(`❌ El equipo **${equipoTarget.nombre}** ya alcanzó el límite máximo de **${limitMax}** jugadores.`);
    }

    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(`select_new_member|${torneo.prefix}`)
            .setPlaceholder('Selecciona al usuario para agregar al equipo...')
    );

    const msg = await message.reply({
        content: `👥 **Agregar miembro a ${equipoTarget.nombre}**\nSelecciona al usuario que deseas agregar:`,
        components: [row]
    });

    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 60000
    });

    collector.on('collect', async interaction => {
        const selectedId = interaction.values[0];
        const selectedUser = interaction.users.get(selectedId);

        const yaRegistrado = torneo.equipos.some(e =>
            e.miembros?.some(m => (typeof m === 'string' ? m : m.discordId) === selectedId) ||
            e.propietario === selectedId ||
            e.discordId === selectedId
        );

        if (yaRegistrado) {
            return interaction.reply({ content: `❌ **${selectedUser.username}** ya está registrado en este torneo o forma parte de un equipo.`, flags: 64 });
        }

        const { ensureUserRegistered } = await import('../../utils/db/userResolver.js');
        await ensureUserRegistered(selectedUser);

        if (!equipoTarget.miembros) equipoTarget.miembros = [];
        equipoTarget.miembros.push(selectedId);

        await torneo.save();

        await interaction.reply({ content: `✅ **Miembro agregado con éxito:** **${selectedUser.tag}** se ha unido a **${equipoTarget.nombre}**.` });
    });
}
