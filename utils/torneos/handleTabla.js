import { getAvatarBase64 } from '../visual/avatarUtils.js';
import { generarTablaImagenCopa } from '../visual/copaVisualGenerator.js';
import { getCachedImage } from '../visual/imageCache.js';
import { AttachmentBuilder } from 'discord.js';

export default async function handleTabla(client, message, args, torneo) {
    if (torneo.estado === 'Configuracion') return message.reply('❌ El torneo aún no ha comenzado.');

    const grupoSeleccionado = args[0]?.toUpperCase();

    // Si se especificó un grupo, validar que exista al menos un equipo en él
    if (grupoSeleccionado && !torneo.equipos.some(e => e.grupo?.toUpperCase() === grupoSeleccionado)) {
        return message.reply(`❌ El grupo **${grupoSeleccionado}** no existe en este torneo.`);
    }

    const loading = await message.reply('<a:loading:1461897825439711468> Generando tabla...');

    try {
        const esIndividual = torneo.tipoCompeticion === 'individual' || torneo.tipoJugadores === 'users';

        // Si es torneo individual, resolver datos relacionales desde la base de datos `Jugador`
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

        const tabla = await Promise.all(torneo.equipos.map(async e => {
            const idKey = String(e.discordId || e.propietario || e.id || '');
            const pInfo = playerMap.get(idKey) || playerMap.get(e.nombre) || {};

            // Priorizar nombre guardado en base de datos de jugadores si es torneo individual
            const finalNombre = (esIndividual && pInfo.nombre) ? pInfo.nombre : e.nombre;
            // Priorizar avatar en base de datos/caché local sobre URL externa
            const avatarSrc = (esIndividual && pInfo.avatar) ? pInfo.avatar : e.avatar;

            return {
                nombre: finalNombre,
                avatar: await getAvatarBase64(avatarSrc),
                miembros: e.miembros ? await Promise.all(e.miembros.map(async m => {
                    const mId = typeof m === 'string' ? m : m.discordId;
                    const mInfo = playerMap.get(String(mId)) || {};
                    return {
                        ...m,
                        nombre: mInfo.nombre || m.nombre,
                        avatar: await getAvatarBase64(mInfo.avatar || m.avatar)
                    };
                })) : undefined,
                pj: e.pj || 0, pg: e.pg || 0, pe: e.pe || 0, pp: e.pp || 0,
                gf: e.gf || 0, gc: e.gc || 0, puntos: e.puntos || 0,
                grupo: e.grupo
            };
        }));
        tabla.sort((a, b) => b.puntos - a.puntos || (b.gf - b.gc) - (a.gf - a.gc));

        const key = grupoSeleccionado ? `tabla_${grupoSeleccionado}` : 'tabla';

        const png = await getCachedImage(
            torneo.prefix,
            key,
            { equipos: torneo.equipos, tema: torneo.tema, nombre: torneo.nombre, logo: torneo.logo },
            () => generarTablaImagenCopa(torneo, tabla, torneo.nombre, grupoSeleccionado)
        );
        const attachment = new AttachmentBuilder(png, { name: `${key}.png` });
        await loading.edit({ content: '', files: [attachment] });
    } catch (error) {
        console.error(error);
        await loading.edit('❌ Error al generar la tabla.');
    }
}