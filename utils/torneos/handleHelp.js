import { EmbedBuilder } from 'discord.js';

function buildHelpEntries(torneo) {
    const entries = [
        { cmd: 'help', aliases: ['h', 'ayuda'], desc: 'Muestra esta ayuda dinámica según el torneo.' },
        { cmd: 'fixture', aliases: ['f'], desc: 'Muestra el fixture actual (fechas/fases).' },
        { cmd: 'participantes', aliases: ['part', 'p', 'players'], desc: 'Muestra la lista visual de participantes.' },
        { cmd: 'inscripcion', aliases: ['insc'], desc: 'Inscripción administrativa de participantes.' },
        { cmd: 'inscribirme', aliases: ['iscme'], desc: 'Auto-inscripción del usuario actual.' },
        { cmd: 'gestion', aliases: ['manage', 'g'], desc: 'Panel de gestión del torneo (admin/creador).' }
    ];

    if (torneo.tipoCompeticion === 'equipos' || torneo.subTipo === 'equipos' || torneo.formatoPreset === 'equipos') {
        entries.push({ cmd: 'agregar-miembro', aliases: ['agregar', 'add-member'], desc: 'Agrega un miembro a un equipo.' });
        entries.push({ cmd: 'alineacion', aliases: ['alineaciones', 'formacion', 'alin'], desc: 'Carga o consulta la alineación del equipo para el partido pendiente.' });
    }

    if (torneo.formatoPreset !== 'directa') {
        entries.push({ cmd: 'tabla', aliases: ['t'], desc: 'Muestra tabla de posiciones.' });
    }

    const tieneLlaves = Boolean(torneo.llaves && Object.keys(torneo.llaves).length > 0);
    if (torneo.formatoPreset === 'directa' || torneo.playoffsHabilitados || tieneLlaves) {
        entries.push({ cmd: 'bracket', aliases: ['b', 'eliminatorias', 'elim'], desc: 'Muestra llaves eliminatorias.' });
    }

    return entries;
}

export default async function handleHelp(message, torneo) {
    const entries = buildHelpEntries(torneo);
    const principal = process.env.PREFIX || '>';
    const tipo = torneo.tipoCompeticion || 'N/A';
    const formato = torneo.formatoPreset || 'N/A';

    const lines = entries.map(e => {
        const aliases = e.aliases?.length ? ` (alias: ${e.aliases.map(a => `\`${a}\``).join(', ')})` : '';
        return `• \`${principal}${torneo.prefix}-${e.cmd}\`${aliases}\n  ↳ ${e.desc}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`📘 Ayuda del torneo: ${torneo.nombre}`)
        .setDescription(`> Tipo: \`${tipo}\` | Formato: \`${formato}\` | Estado: \`${torneo.estado}\``)
        lines.forEach(line => embed.addFields({ name: '\u200B', value: line }));
    return message.reply({
        embeds: [embed],
    })
}