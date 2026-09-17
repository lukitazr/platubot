import handleTabla from '../../utils/torneos/handleTabla.js';
import handleFixture from '../../utils/torneos/handleFixture.js';
import { handleInscripcion, handleSelfInscripcion } from '../../utils/torneos/handleInscripcion.js';
import handleGestion from '../../utils/torneos/handleGestionTorneo.js';
import { handleParticipantes, handleBracket, handleAgregarMiembro } from '../../utils/torneos/handleParticipantes.js';
import handleHelp from '../../utils/torneos/handleHelp.js';
import handleAlineacion from '../../utils/torneos/handleAlineacion.js';

export default {
    name: 'torneo-generic',
    desc: 'Comandos genéricos para torneos dinámicos. Uso: !<prefix>-<subcomando> <args>',
    permisos: [],

    async runGeneric(client, message, args, torneo, subComando) {
        const esDirecta = torneo.formatoPreset === 'directa';

        switch (subComando) {
            case 'tabla':
            case 't':
                if (esDirecta) return message.reply('❌ Este torneo es de **Eliminación Directa** y no tiene tabla de posiciones. Usa `participantes`, `fixture` o `bracket`.');
                return handleTabla(client, message, args, torneo);
            case 'fixture':
            case 'f':
                return handleFixture(client, message, args, torneo);
            case 'inscripcion':
            case 'insc':
                return handleInscripcion(client, message, args, torneo);
            case 'inscribirme':
            case 'iscme':
                return handleSelfInscripcion(client, message, args, torneo);
            case 'help':
            case 'h':
            case 'ayuda':
                return handleHelp(message, torneo);
            case 'agregar-miembro':
            case 'agregar':
            case 'add-member':
                return handleAgregarMiembro(client, message, args, torneo);
            case 'participantes':
            case 'part':
            case 'p':
            case 'players':
                return handleParticipantes(client, message, args, torneo);
            case 'bracket':
            case 'b':
            case 'eliminatorias':
            case 'elim':
                if (torneo.formatoPreset === 'liga' && !torneo.playoffsHabilitados && (!torneo.llaves || Object.keys(torneo.llaves).length === 0)) {
                    return message.reply('❌ Este torneo es de formato **Liga (Todos contra todos)** y no cuenta con llaves eliminatorias. Usa `tabla` o `fixture`.');
                }
                return handleBracket(client, message, args, torneo);
            case 'alineacion':
            case 'alineaciones':
            case 'formacion':
            case 'alin':
                return handleAlineacion(client, message, args, torneo);
            case 'gestion':
            case 'manage':
            case 'g':
                return handleGestion(client, message, args, torneo);
            case 'sync':
            case 'sincronizar':
            case 'recalcular': {
                if (!message.member.permissions.has('Administrator') && message.author.id !== torneo.createdBy) {
                    return message.reply('❌ Solo administradores pueden sincronizar el torneo.');
                }
                const loadingSync = await message.reply('<a:loading:1461897825439711468> Sincronizando equipos y fixture del torneo...');
                const { syncTournament } = await import('../primera/sincronizarfixture.js');
                const syncRes = await syncTournament(torneo, client);
                return loadingSync.edit(`✅ **${torneo.nombre}** sincronizado con éxito. Se actualizaron **${syncRes.equiposCount}** equipos/participantes y **${syncRes.matchesFinalized}** partidos.`);
            }
            default:
                return message.reply(`❌ Subcomando \`${subComando}\` no reconocido para el torneo **${torneo.nombre}**.`);
        }
    }
};
