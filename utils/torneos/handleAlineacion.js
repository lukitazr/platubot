import { 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ComponentType,
  AttachmentBuilder,
  EmbedBuilder
} from 'discord.js';
import { resolvePlayers } from '../db/userResolver.js';
import { generarAlineacion, generarAlineacionTabla } from '../visual/alineacionGenerator.js';

export default async function handleAlineacion(client, message, args, torneo) {
  const isTeamTournament = torneo.subTipo === 'equipos' || torneo.tipoCompeticion === 'equipos' || torneo.formatoPreset === 'equipos';
  if (!isTeamTournament) {
    return message.reply('❌ El sistema de alineaciones solo está disponible para torneos con formato por **Equipos**.');
  }

  const userId = message.author.id;
  const equipos = torneo.equipos || [];

  // 1. Identificar equipo del usuario (coach, propietario o miembro)
  const equipo = equipos.find(eq => {
    const isProp = String(eq.propietario) === userId;
    const isCoach = eq.coach && String(eq.coach.id || eq.coach.discordId) === userId;
    const isMember = eq.miembros?.some(m => String(typeof m === 'string' ? m : m.discordId) === userId);
    return isProp || isCoach || isMember;
  });

  if (!equipo) {
    return message.reply('❌ No formas parte ni diriges ningún equipo registrado en este torneo.');
  }

  const eqId = String(equipo.id || equipo._id || equipo.nombre);

  // 2. Buscar partido pendiente en enfrentamientosGrupos o llaves
  let partido = null;
  let esGrupos = false;
  let faseLlave = null;

  // Buscar en enfrentamientosGrupos
  const partidosGrupos = torneo.enfrentamientosGrupos || [];
  partido = partidosGrupos.find(p => {
    if (p.completado || p.resultado !== 'Pendiente') return false;
    const matchLoc = p.local === equipo.nombre || String(p.localId) === eqId;
    const matchVis = p.visitante === equipo.nombre || String(p.visitanteId) === eqId;
    return matchLoc || matchVis;
  });

  if (partido) {
    esGrupos = true;
  } else if (torneo.llaves && typeof torneo.llaves === 'object') {
    // Buscar en llaves eliminatorias
    for (const fase of Object.keys(torneo.llaves)) {
      const arr = torneo.llaves[fase];
      if (!Array.isArray(arr)) continue;
      const found = arr.find(ll => {
        if (ll.ganador) return false;
        const eq1 = ll.equipo1 || {};
        const eq2 = ll.equipo2 || {};
        const match1 = eq1.nombre === equipo.nombre || String(eq1.id || eq1.discordId) === eqId;
        const match2 = eq2.nombre === equipo.nombre || String(eq2.id || eq2.discordId) === eqId;
        return match1 || match2;
      });
      if (found) {
        partido = found;
        faseLlave = fase;
        break;
      }
    }
  }

  if (!partido) {
    return message.reply(`❌ El equipo **${equipo.nombre}** no tiene partidos pendientes en el torneo **${torneo.nombre}**.`);
  }

  const esLocal = (partido.local === equipo.nombre || String(partido.localId) === eqId || partido.equipo1?.nombre === equipo.nombre || String(partido.equipo1?.id || partido.equipo1?.discordId) === eqId);
  const rivalNombre = esLocal 
    ? (partido.visitante || partido.equipo2?.nombre || 'Rival')
    : (partido.local || partido.equipo1?.nombre || 'Rival');

  const duelosIndividuales = partido.duelosIndividuales || [];
  // Dynamic expectedDuels: use team member count (min of both teams) capped at equipo members
  const eqRival = equipos.find(eq => eq.nombre === (esLocal ? (partido.visitante || partido.equipo2?.nombre) : (partido.local || partido.equipo1?.nombre)));
  const miembrosCount = equipo.miembros?.length || 3;
  const rivalCount = eqRival?.miembros?.length || miembrosCount;
  const expectedDuels = Math.min(miembrosCount, rivalCount, Math.max(duelosIndividuales.length, 3));

  let duelosInicializados = false;
  while (duelosIndividuales.length < expectedDuels) {
    duelosIndividuales.push({
      localJugador: null,
      visitanteJugador: null,
      golesLocal: null,
      golesVisitante: null,
      finalizado: false
    });
    duelosInicializados = true;
  }
  if (!partido.duelosIndividuales || duelosInicializados) {
    partido.duelosIndividuales = duelosIndividuales;
    if (typeof torneo.markModified === 'function') {
      if (esGrupos) torneo.markModified('enfrentamientosGrupos');
      else torneo.markModified('llaves');
    }
    await torneo.save();
  }

  // Si solo se pidió consultar la alineación ("ver")
  if (args[0] === 'ver' || args[0] === 'ver-alineacion' || args[0] === 'info') {
    const playerIds = new Set();
    duelosIndividuales.forEach(d => {
      if (d.localJugador) playerIds.add(String(d.localJugador));
      if (d.visitanteJugador) playerIds.add(String(d.visitanteJugador));
    });
    const pMap = await resolvePlayers(playerIds);

    const embedVer = new EmbedBuilder()
      .setTitle(`📋 Alineación: ${partido.local || partido.equipo1?.nombre} vs ${partido.visitante || partido.equipo2?.nombre}`)
      .setDescription(`> Competición: **${torneo.nombre}** | Estado: **Pendiente**`)
      .setColor('#3498db');

    duelosIndividuales.slice(0, expectedDuels).forEach((d, idx) => {
      const lId = String(d.localJugador || '');
      const vId = String(d.visitanteJugador || '');
      const lName = pMap.get(lId)?.nombre || (lId ? `<@${lId}>` : '⏳ Pendiente');
      const vName = pMap.get(vId)?.nombre || (vId ? `<@${vId}>` : '⏳ Pendiente');
      embedVer.addFields({ name: `Duelo #${idx + 1}`, value: `${lName} **vs** ${vName}`, inline: false });
    });

    return message.reply({ embeds: [embedVer] });
  }

  // 3. Resolver lista de jugadores del equipo
  const miembrosIds = (equipo.miembros || []).map(m => String(typeof m === 'string' ? m : m.discordId));
  const playerMap = await resolvePlayers(miembrosIds);

  if (miembrosIds.length < expectedDuels) {
    return message.reply(`❌ El equipo **${equipo.nombre}** tiene ${miembrosIds.length} miembros registrados, pero se requieren al menos ${expectedDuels} jugadores para alinear.`);
  }

  const options = miembrosIds.map((mId) => {
    const pInfo = playerMap.get(mId);
    const nombre = pInfo?.nombre || `Jugador (${mId.slice(-4)})`;
    return {
      label: nombre,
      value: mId,
      description: `ID: ${mId}`
    };
  });

  const loading = await message.reply(`<a:loading:1461897825439711468> Cargando interfaz de alineación para **${equipo.nombre}**...`);

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`alin_torneo_${Date.now()}`)
      .setPlaceholder(`Elegí tus ${expectedDuels} jugadores en orden (Duelo 1, 2, 3)`)
      .setMinValues(expectedDuels)
      .setMaxValues(expectedDuels)
      .addOptions(options)
  );

  const m = await loading.edit({
    content: `📋 **Alineación: ${equipo.nombre}** vs **${rivalNombre}**\nSelecciona los **${expectedDuels} jugadores** en el orden que competirán (Selección 1 = Duelo 1, 2 = Duelo 2, 3 = Duelo 3):`,
    components: [menu]
  });

  const collector = m.createMessageComponentCollector({
    filter: i => i.user.id === message.author.id,
    componentType: ComponentType.StringSelect,
    time: 120000
  });

  collector.on('collect', async i => {
    await i.deferUpdate();

    const selectedIds = i.values;
    const seleccionados = selectedIds.map(id => {
      const pInfo = playerMap.get(id);
      return { id, nombre: pInfo?.nombre || `Jugador (${id.slice(-4)})` };
    });

    // Asignar en duelosIndividuales
    for (let idx = 0; idx < expectedDuels; idx++) {
      if (esLocal) {
        duelosIndividuales[idx].localJugador = seleccionados[idx].id;
      } else {
        duelosIndividuales[idx].visitanteJugador = seleccionados[idx].id;
      }
    }

    if (typeof torneo.markModified === 'function') {
      if (esGrupos) torneo.markModified('enfrentamientosGrupos');
      else torneo.markModified('llaves');
    }
    await torneo.save();

    collector.stop('success');

    // Intentar generar alineación gráfica visual
    let fileAttach = null;
    try {
      if (expectedDuels > 3) {
        // Table-style image for >3 duels
        const duelosData = [];
        for (let idx = 0; idx < expectedDuels; idx++) {
          const lId = String(duelosIndividuales[idx]?.localJugador || '');
          const vId = String(duelosIndividuales[idx]?.visitanteJugador || '');
          let lName = '⏳ Pendiente', lAvatar = null;
          let vName = '⏳ Pendiente', vAvatar = null;
          if (lId) {
            const u = await client.users.fetch(lId).catch(() => null);
            if (u) {
              lName = u.displayName || u.username;
              lAvatar = u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 });
            } else {
              lName = `<@${lId}>`;
            }
          }
          if (vId) {
            const u = await client.users.fetch(vId).catch(() => null);
            if (u) {
              vName = u.displayName || u.username;
              vAvatar = u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 });
            } else {
              vName = `<@${vId}>`;
            }
          }
          duelosData.push({ localNombre: lName, visitanteNombre: vName, localAvatar: lAvatar, visitanteAvatar: vAvatar });
        }

        const localName = partido.local || partido.equipo1?.nombre || equipo.nombre;
        const visitanteName = partido.visitante || partido.equipo2?.nombre || rivalNombre;
        const imgBuffer = await generarAlineacionTabla({
          titulo: `${localName} vs ${visitanteName}`,
          subtitulo: `${torneo.nombre} — Alineación`,
          duelos: duelosData,
          tema: torneo.tema || {}
        });

        if (imgBuffer && imgBuffer.length > 0) {
          fileAttach = new AttachmentBuilder(imgBuffer, { name: 'alineacion.png' });
        }
      } else {
        // Card-style image for <=3 duels
        const localCards = [null, null, null];
        const visCards = [null, null, null];

        for (let idx = 0; idx < expectedDuels; idx++) {
          const lId = String(duelosIndividuales[idx]?.localJugador || '');
          const vId = String(duelosIndividuales[idx]?.visitanteJugador || '');
          
          if (lId) {
            const u = await client.users.fetch(lId).catch(() => null);
            if (u) localCards[idx] = u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
          }
          if (vId) {
            const u = await client.users.fetch(vId).catch(() => null);
            if (u) visCards[idx] = u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
          }
        }

        const imgBuffer = await generarAlineacion({
          escudoLocal: equipo.escudo,
          escudoVisitante: null,
          jugadoresLocalCards: esLocal ? localCards : visCards,
          jugadoresVisitanteCards: !esLocal ? localCards : visCards
        });

        if (imgBuffer && imgBuffer.length > 0) {
          fileAttach = new AttachmentBuilder(imgBuffer, { name: 'alineacion.png' });
        }
      }
    } catch {}

    let confirmMsg = `✅ **Alineación de ${equipo.nombre} confirmada exitosamente.**\n\n`;
    duelosIndividuales.slice(0, expectedDuels).forEach((d, idx) => {
      const lId = d.localJugador;
      const vId = d.visitanteJugador;
      const lText = lId ? `<@${lId}>` : '⏳ Pendiente';
      const vText = vId ? `<@${vId}>` : '⏳ Pendiente';
      confirmMsg += `**Duelo #${idx + 1}**: ${lText} vs ${vText}\n`;
    });

    const replyPayload = {
      content: confirmMsg,
      components: []
    };
    if (fileAttach) replyPayload.files = [fileAttach];

    await m.edit(replyPayload);
  });

  collector.on('end', async (_, reason) => {
    if (reason !== 'success') {
      await m.edit({ content: '❌ Tiempo agotado. Alineación no guardada.', components: [] }).catch(() => {});
    }
  });
}
