import Jugador from '../models/Jugador.js';
import EquipoSuperliga from '../models/superliga/Equipos.js';
import Torneo from '../models/copas/Torneo.js';

/**
 * Normaliza un string removiendo acentos y pasando a minúsculas
 */
export function normalizeStr(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * Resuelve si un argumento corresponde a un filtro de Jugador o Equipo.
 * @param {string} rawQuery 
 * @param {Object} [client] 
 * @returns {Promise<Object|null>}
 */
export async function resolveFilterTarget(rawQuery, client = null) {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  const qTrim = rawQuery.trim();
  if (!qTrim) return null;

  // 1. Extraer ID de mención de Discord <@123456789> o <@!123456789>
  const mentionMatch = qTrim.match(/^<@!?(\d{17,20})>$/);
  const isSnowflake = /^\d{17,20}$/.test(qTrim);
  const discordId = mentionMatch ? mentionMatch[1] : (isSnowflake ? qTrim : null);

  const normQuery = normalizeStr(qTrim);

  // 2. Si es Discord ID o mención
  if (discordId) {
    const jugador = await Jugador.findOne({
      $or: [{ id: discordId }, { _id: discordId }, { discordId }]
    }).catch(() => null);

    let nombre = jugador?.nombre;
    let avatar = jugador?.avatar;

    if (!nombre && client) {
      const u = await client.users.fetch(discordId).catch(() => null);
      if (u) {
        nombre = u.displayName || u.username;
        avatar = u.displayAvatarURL({ extension: 'png', size: 128 });
      }
    }

    if (!nombre) nombre = `Usuario (${discordId.slice(-4)})`;

    const eqSuperliga = await EquipoSuperliga.findOne({
      $or: [
        { 'coach.id': discordId },
        { 'coach.discordId': discordId },
        { 'jugadores.id': discordId },
        { 'jugadores.discordId': discordId }
      ]
    }).catch(() => null);

    const aliases = [
      normQuery,
      discordId,
      normalizeStr(nombre),
      ...(Array.isArray(jugador?.aliases) ? jugador.aliases.map(normalizeStr) : [])
    ];

    return {
      isFilter: true,
      type: 'player',
      id: discordId,
      nombre,
      avatar,
      aliases: [...new Set(aliases.filter(Boolean))],
      teamDoc: eqSuperliga || null,
      jugadorDoc: jugador || null
    };
  }

  // 3. Buscar en Equipos de Superliga por nombre exacto o parcial
  const equipos = await EquipoSuperliga.find({}).catch(() => []);
  const matchingEquipo = equipos.find(e => {
    const n = normalizeStr(e.nombre);
    return n === normQuery || n.includes(normQuery) || normQuery.includes(n);
  });

  if (matchingEquipo) {
    const aliases = [
      normalizeStr(matchingEquipo.nombre),
      String(matchingEquipo._id || ''),
      String(matchingEquipo.id || '')
    ];
    return {
      isFilter: true,
      type: 'team',
      id: String(matchingEquipo.id || matchingEquipo._id || ''),
      nombre: matchingEquipo.nombre,
      avatar: matchingEquipo.escudo || null,
      aliases: [...new Set(aliases.filter(Boolean))],
      teamDoc: matchingEquipo
    };
  }

  // 4. Buscar en Torneos por equipos de torneos personalizados
  const torneos = await Torneo.find({}).catch(() => []);
  for (const t of torneos) {
    const eq = (t.equipos || []).find(e => {
      const n = normalizeStr(e.nombre);
      return n === normQuery || n.includes(normQuery) || normQuery.includes(n);
    });
    if (eq) {
      return {
        isFilter: true,
        type: 'team',
        id: String(eq.id || eq.discordId || eq._id || ''),
        nombre: eq.nombre,
        avatar: eq.avatar || eq.escudo || null,
        aliases: [normalizeStr(eq.nombre), String(eq.id || '')].filter(Boolean),
        teamDoc: eq
      };
    }
  }

  // 5. Buscar en Jugadores por nombre o aliases
  const jugadores = await Jugador.find({}).catch(() => []);
  const matchingJugador = jugadores.find(j => {
    const n = normalizeStr(j.nombre);
    if (n === normQuery || n.includes(normQuery) || normQuery.includes(n)) return true;
    if (Array.isArray(j.aliases) && j.aliases.some(a => {
      const an = normalizeStr(a);
      return an === normQuery || an.includes(normQuery) || normQuery.includes(an);
    })) return true;
    return false;
  });

  if (matchingJugador) {
    const id = String(matchingJugador.id || matchingJugador.discordId || matchingJugador._id || '');
    const aliases = [
      normalizeStr(matchingJugador.nombre),
      id,
      ...(Array.isArray(matchingJugador.aliases) ? matchingJugador.aliases.map(normalizeStr) : [])
    ];
    return {
      isFilter: true,
      type: 'player',
      id,
      nombre: matchingJugador.nombre,
      avatar: matchingJugador.avatar || null,
      aliases: [...new Set(aliases.filter(Boolean))],
      jugadorDoc: matchingJugador
    };
  }

  // 6. Si no coincide con DB pero es una búsqueda textual
  return {
    isFilter: true,
    type: 'generic',
    id: null,
    nombre: qTrim,
    avatar: null,
    aliases: [normQuery],
    doc: null
  };
}

/**
 * Comprueba si un partido involucra al jugador o equipo objetivo.
 */
export function matchInvolvesTarget(match, target) {
  if (!match || !target) return false;

  const targetId = target.id ? String(target.id) : null;
  const aliases = target.aliases || [];

  const locId = String(match.localId || match.localDiscordId || match.localOwner || match.equipo1?.discordId || match.equipo1?.id || '');
  const visId = String(match.visitanteId || match.visitanteDiscordId || match.visitanteOwner || match.equipo2?.discordId || match.equipo2?.id || '');

  // 1. Por ID
  if (targetId) {
    if (locId && locId === targetId) return true;
    if (visId && visId === targetId) return true;
  }

  // 2. Por nombres y aliases de equipo / jugador principal
  const locNom = normalizeStr(match.local || match.localNombre || match.equipo1?.nombre || '');
  const visNom = normalizeStr(match.visitante || match.visitanteNombre || match.equipo2?.nombre || '');

  if (aliases.some(a => a && (locNom === a || locNom.includes(a) || a.includes(locNom)))) return true;
  if (aliases.some(a => a && (visNom === a || visNom.includes(a) || a.includes(visNom)))) return true;

  // 3. Por duelos individuales
  const duelos = match.duelosIndividuales || match.miniPartidos || [];
  if (Array.isArray(duelos) && duelos.length > 0) {
    for (const d of duelos) {
      const dLocId = String(d.localJugador || d.jugadorLocalId || d.localJugadorId || d.localId || '');
      const dVisId = String(d.visitanteJugador || d.jugadorVisitanteId || d.visitanteJugadorId || d.visitanteId || '');

      if (targetId) {
        if (dLocId && dLocId === targetId) return true;
        if (dVisId && dVisId === targetId) return true;
      }

      const dLocNom = normalizeStr(d.localJugadorNombre || d.localNombre || d.local || '');
      const dVisNom = normalizeStr(d.visitanteJugadorNombre || d.visitanteNombre || d.visitante || '');

      if (aliases.some(a => a && (dLocNom === a || dLocNom.includes(a) || a.includes(dLocNom)))) return true;
      if (aliases.some(a => a && (dVisNom === a || dVisNom.includes(a) || a.includes(dVisNom)))) return true;
    }
  }

  return false;
}

/**
 * Agrupa una lista de partidos en páginas de hasta `pageSize` fechas (por defecto 10).
 */
export function paginateFilteredMatches(matches, pageSize = 10) {
  if (!matches || matches.length === 0) return [];
  const pages = [];
  for (let i = 0; i < matches.length; i += pageSize) {
    const chunk = matches.slice(i, i + pageSize);
    const startFecha = chunk[0].fechaNumero ?? chunk[0].fechaLabel ?? `F${i + 1}`;
    const endFecha = chunk[chunk.length - 1].fechaNumero ?? chunk[chunk.length - 1].fechaLabel ?? `F${i + chunk.length}`;

    let label = `Fechas ${startFecha} - ${endFecha}`;
    if (typeof startFecha === 'number' && typeof endFecha === 'number') {
      label = startFecha === endFecha ? `Fecha ${startFecha}` : `Fechas ${startFecha} a ${endFecha}`;
    } else if (chunk.length === 1) {
      label = `${startFecha}`;
    }

    pages.push({
      pageIndex: Math.floor(i / pageSize),
      partidos: chunk,
      label,
      startFecha,
      endFecha
    });
  }
  return pages;
}

/**
 * Renderiza y envía el fixture filtrado por jugador para Primera/Segunda división
 */
export async function sendFilteredLeagueFixture({
  client,
  context,
  liga,
  filterTarget,
  div,
  existingMsg = null,
  pageIdx = 0
}) {
  const { AttachmentBuilder } = await import('discord.js');
  const { generarFixtureImagen } = await import('./visual/fixtureGenerator.js');
  const { buildFixtureNavigation } = await import('./ui/fixtureNavigation.js');
  const { getOrCachePlayerAvatar } = await import('./visual/avatarCache.js');

  const tema =
    div === 'primera'
      ? { primario: '#1a0505', secundario: '#2e0909', acento: '#ff4d4d', borde: '#450f0f' }
      : { primario: '#1a0d00', secundario: '#2e1800', acento: '#ffaa60', borde: '#452400' };

  // Recolectar todos los partidos del target a través de todas las fechas
  const allFilteredMatches = [];
  const schedule = liga.partidos ?? liga.fechas ?? [];

  for (const fecha of schedule) {
    const partidos = fecha.partidos ?? fecha.encuentros ?? [];
    for (const p of partidos) {
      if (matchInvolvesTarget(p, filterTarget)) {
        allFilteredMatches.push({
          ...p,
          fechaNumero: fecha.numero,
          fechaLabel: `Fecha ${fecha.numero}`
        });
      }
    }
  }

  if (allFilteredMatches.length === 0) {
    const msg = `ℹ️ No se encontraron partidos para **${filterTarget.nombre}** en **${liga.nombreLiga || 'esta temporada'}**.`;
    return existingMsg ? existingMsg.edit({ content: msg, components: [] }) : (context.editReply ? context.editReply(msg) : context.reply(msg));
  }

  // Paginar cada 10 fechas
  const pages = paginateFilteredMatches(allFilteredMatches, 10);
  const safePageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
  const currentPage = pages[safePageIdx];

  const msg = existingMsg
    ? await existingMsg.edit('<a:loading:1461897825439711468> Generando fixture filtrado...')
    : await (context.editReply ? context.editReply('<a:loading:1461897825439711468> Generando fixture filtrado...') : context.reply('<a:loading:1461897825439711468> Generando fixture filtrado...'));

  const partidosRender = await Promise.all(
    currentPage.partidos.map(async p => {
      const avatarL = await getOrCachePlayerAvatar(p.localId || p.localNombre, client);
      const avatarV = await getOrCachePlayerAvatar(p.visitanteId || p.visitanteNombre, client);

      let resText = 'Pendiente';
      if (p.finalizado) {
        if (p.isDoubleWO) resText = 'WO - WO';
        else resText = `${p.golesLocal}-${p.golesVisitante}${p.isWO ? ' (WO)' : ''}`;
      }

      let ganadorText = null;
      if (p.finalizado) {
        if (p.isDoubleWO) ganadorText = 'Sin Ganador';
        else if (p.golesLocal > p.golesVisitante) ganadorText = p.localNombre;
        else if (p.golesVisitante > p.golesLocal) ganadorText = p.visitanteNombre;
        else ganadorText = 'Empate';
      }

      return {
        local: p.localNombre,
        visitante: p.visitanteNombre,
        resultado: resText,
        ganador: ganadorText,
        avatarL,
        avatarV,
        fechaLabel: p.fechaLabel,
        fechaNumero: p.fechaNumero
      };
    })
  );

  const buffer = await generarFixtureImagen({
    titulo: `${liga.nombreLiga || 'Liga'}`,
    subtitulo: `Partidos de ${filterTarget.nombre} (${currentPage.label})`,
    partidos: partidosRender,
    tema
  });

  const attachment = new AttachmentBuilder(buffer, { name: 'fixture_jugador.png' });
  const content = `📅 **Fixture: ${liga.nombreLiga || 'Liga'} — Partidos de ${filterTarget.nombre} (${currentPage.label})**`;
  const labels = pages.map((pg, i) => `${pg.label} (Pág. ${i + 1}/${pages.length})`);
  const components = buildFixtureNavigation(`${div}_filt`, safePageIdx, pages.length, labels);

  if (existingMsg) {
    await msg.edit({ content, files: [attachment], components });
  } else if (context.editReply) {
    await msg.editReply({ content, files: [attachment], components });
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
    await sendFilteredLeagueFixture({
      client,
      context,
      liga,
      filterTarget,
      div,
      existingMsg: msg,
      pageIdx: nextIdx
    });
  });
}
