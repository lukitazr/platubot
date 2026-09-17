import { ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ButtonStyle, ButtonBuilder } from 'discord.js';
import Supersupercopa from '../../models/superliga/Supersupercopa.js';
import Superliga from '../../models/superliga/Superliga.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import generarRoundRobinSuperliga from '../../utils/generarRoundRobinSuperliga.js';
import { buildSupercopaEmbed, buildSupercopaRows } from '../../utils/ui/superliga/buildSupercopaPanel.js';
import { aplicarCambioMediaDuelo } from '../../utils/db/mediaCalculator.js';

function calcTablaGrupo(grupo) {
  const stats = {};
  grupo.equipos.forEach(id => { stats[id] = { id, pts: 0, pj: 0, pg: 0, pp: 0, gf: 0, gc: 0, dg: 0 }; });
  grupo.fechas.forEach(f => (f.partidos ?? f.encuentros).forEach(p => {
    if (!p.finalizado) return;
    const l = stats[p.localId] || stats[Object.keys(stats).find(k => stats[k].nombre === p.localNombre)];
    const v = stats[p.visitanteId] || stats[Object.keys(stats).find(k => stats[k].nombre === p.visitanteNombre)];
    if (!l || !v) return;
    l.pj++; v.pj++;
    const sl = p.puntosMiniLocal ?? 0, sv = p.puntosMiniVisitante ?? 0;
    l.gf += sl; l.gc += sv; v.gf += sv; v.gc += sl;
    if (sl > sv) { l.pg++; l.pts += 3; v.pp++; }
    else if (sv > sl) { v.pg++; v.pts += 3; l.pp++; }
  }));
  return Object.values(stats).map(e => { e.dg = e.gf - e.gc; return e; }).sort((a,b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
}

function crearPartido(local, visitante, label = '') {
  return {
    _id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    label: label,
    localId: local._id?.$oid ?? local._id, localNombre: local.nombre,
    visitanteId: visitante._id?.$oid ?? visitante._id, visitanteNombre: visitante.nombre,
    duelosIndividuales: [
      { localJugadorId: null, localJugadorNombre: null, visitanteJugadorId: null, visitanteJugadorNombre: null, golesLocal: null, golesVisitante: null, finalizado: false },
      { localJugadorId: null, localJugadorNombre: null, visitanteJugadorId: null, visitanteJugadorNombre: null, golesLocal: null, golesVisitante: null, finalizado: false },
      { localJugadorId: null, localJugadorNombre: null, visitanteJugadorId: null, visitanteJugadorNombre: null, golesLocal: null, golesVisitante: null, finalizado: false },
    ],
    puntosMiniLocal: 0, puntosMiniVisitante: 0, golesTotalLocal: 0, golesTotalVisitante: 0, finalizado: false
  };
}

function crearDesempate(local, visitante) {
  const p = crearPartido(local, visitante, 'Desempate');
  p.duelosIndividuales = [p.duelosIndividuales[0]]; // Un solo minipartido
  return p;
}

function crearLlave(local, visitante) {
  return {
    localId: local._id?.$oid ?? local._id, localNombre: local.nombre,
    visitanteId: visitante._id?.$oid ?? visitante._id, visitanteNombre: visitante.nombre,
    ida: crearPartido(local, visitante, 'Ida'),
    vuelta: crearPartido(visitante, local, 'Vuelta'),
    desempate: null,
    finalizado: false
  };
}

export default {
  name: 'supersupercopa-gestion',
  aliases: ['ssc-gestion', 'sscg'],
  desc: 'Gestión de la Supersupercopa',
  permisos: ['Administrator'],

  run: async (client, message, args) => {
    let copa = await Supersupercopa.findOne({ estadoGlobal: 'Activa' }) || await Supersupercopa.findOne({});
    const panelMsg = await message.reply({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });

    const collector = panelMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600000 });

    collector.on('collect', async i => {
      if (!i.member.permissions.has('Administrator')) return i.reply({ content: '❌ No tienes permisos.', flags: 64 });
      copa = await Supersupercopa.findOne({ estadoGlobal: 'Activa' }) || copa;

      switch (i.customId) {
        case 'btn_ssc_refresh':
          await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
          await i.deferUpdate();
          break;

        case 'btn_ssc_borrar':
          if (copa) { await Supersupercopa.deleteOne({ estadoGlobal: 'Activa' }); copa = null; }
          await panelMsg.edit({ embeds: [buildSupercopaEmbed(null)], components: buildSupercopaRows(null) });
          await i.reply({ content: '✅ Supersupercopa borrada.', flags: 64 });
          break;

        case 'btn_ssc_sortear': {
          const todasLigas = await Superliga.find({});
          const ligaFin = todasLigas.filter(l => !l.actual).pop();
          if (!ligaFin) return i.reply({ content: '❌ No hay temporada de Superliga finalizada.', flags: 64 });
          const slActiva = await Superliga.findOne({ actual: true });
          if (slActiva) return i.reply({ content: '❌ Hay una temporada de Superliga activa. Finalizala primero.', flags: 64 });

          const equiposDB = await EquipoSuperliga.find({});
          // Calcular tabla de la última liga finalizada
          const stats = {};
          ligaFin.fechas?.forEach(f => {
            const enc = f.partidos ?? f.encuentros;
            if (!enc) return;
            enc.forEach(p => {
              if (!p.finalizado) return;
              const localNombre = p.local?.nombre ?? p.localNombre;
              const visitanteNombre = p.visitante?.nombre ?? p.visitanteNombre;
              if (!localNombre || !visitanteNombre) return;

              if (!stats[localNombre]) stats[localNombre] = { nombre: localNombre, pts: 0, pg: 0, pp: 0, pe: 0, dg: 0, gf: 0 };
              if (!stats[visitanteNombre]) stats[visitanteNombre] = { nombre: visitanteNombre, pts: 0, pg: 0, pp: 0, pe: 0, dg: 0, gf: 0 };

              // Superliga vieja usa `resultado.golesLocal/Visitante`, SSC usa `puntosMiniLocal/Visitante`
              const sl = p.resultado?.golesLocal ?? p.puntosMiniLocal ?? 0;
              const sv = p.resultado?.golesVisitante ?? p.puntosMiniVisitante ?? 0;

              stats[localNombre].gf += sl;
              stats[visitanteNombre].gf += sv;
              stats[localNombre].dg += sl - sv;
              stats[visitanteNombre].dg += sv - sl;

              if (sl > sv) {
                stats[localNombre].pts += 3;
                stats[localNombre].pg++;
                stats[visitanteNombre].pp++;
              } else if (sv > sl) {
                stats[visitanteNombre].pts += 3;
                stats[visitanteNombre].pg++;
                stats[localNombre].pp++;
              } else {
                stats[localNombre].pts += 1;
                stats[visitanteNombre].pts += 1;
                stats[localNombre].pe++;
                stats[visitanteNombre].pe++;
              }
            });
          });
          const sorted = Object.values(stats).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);

          const grupoA = [], grupoB = [];
          sorted.forEach((s, idx) => {
            const eq = equiposDB.find(e => e.nombre === s.nombre);
            if (!eq) return;
            const eId = eq._id?.$oid ?? eq._id;
            
            // Puestos impares (1°, 3°, 5°...) -> Grupo A | Puestos pares (2°, 4°, 6°...) -> Grupo B
            if (idx % 2 === 0) grupoA.push({ ...eq, _id: eId });
            else grupoB.push({ ...eq, _id: eId });
          });

          if (grupoA.length < 2 || grupoB.length < 2) return i.reply({ content: '❌ No hay suficientes equipos.', flags: 64 });

          const fechasA = generarRoundRobinSuperliga(grupoA, 1);
          const fechasB = generarRoundRobinSuperliga(grupoB, 1);

          copa = await Supersupercopa.create({
            temporada: ligaFin.temporada,
            fase: 'grupos',
            estadoGlobal: 'Activa',
            tema: { primario: '#0a0e14', secundario: '#161d26', acento: '#f1c40f', texto: '#ffffff', borde: '#374151' },
            grupos: [
              { nombre: 'A', equipos: grupoA.map(e => e._id), fechas: fechasA },
              { nombre: 'B', equipos: grupoB.map(e => e._id), fechas: fechasB },
            ],
            semifinales: [], final: null,
          });

          await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
          await i.reply({ content: `✅ Supersupercopa sorteada. Grupo A: ${grupoA.length} equipos, Grupo B: ${grupoB.length} equipos.`, flags: 64 });
          break;
        }

        case 'btn_ssc_resultado': {
          if (!copa || copa.estadoGlobal !== 'Activa') return i.reply({ content: '❌ No hay SSC activa.', flags: 64 });

          const allPartidos = [];
          if (copa.fase === 'grupos') {
            copa.grupos.forEach(
              (g, gi) => g.fechas.forEach(
                (f, fi) => f.partidos.forEach(
                  (p, pi) => {
                    allPartidos
                      .push({ 
                        label: `G${g.nombre} F${f.numero}: ${p.localNombre} vs ${p.visitanteNombre}`, 
                        desc: p.finalizado ? '✅' : '⏳', 
                        value: `g_${gi}_${fi}_${pi}`,
                        localNombre: p.localNombre,
                        visitanteNombre: p.visitanteNombre
                      });
            })));
          } else {
            const arr = copa.fase === 'semifinales' ? copa.semifinales : (copa.final ? [copa.final] : []);
            arr.forEach((llave, li) => {
              // Ida
              allPartidos.push({
                label: `${copa.fase} - ${llave.localNombre} vs ${llave.visitanteNombre} (Ida)`,
                desc: llave.ida.finalizado ? '✅' : '⏳',
                value: `e_${li}_ida`,
                localNombre: llave.localNombre,
                visitanteNombre: llave.visitanteNombre
              });
              // Vuelta
              allPartidos.push({
                label: `${copa.fase} - ${llave.visitanteNombre} vs ${llave.localNombre} (Vuelta)`,
                desc: llave.vuelta.finalizado ? '✅' : '⏳',
                value: `e_${li}_vuelta`,
                localNombre: llave.visitanteNombre,
                visitanteNombre: llave.localNombre
              });
              // Desempate (si existe)
              if (llave.desempate) {
                allPartidos.push({
                  label: `${copa.fase} - ${llave.localNombre} vs ${llave.visitanteNombre} (Desempate)`,
                  desc: llave.desempate.finalizado ? '✅' : '⏳',
                  value: `e_${li}_desempate`,
                  localNombre: llave.localNombre,
                  visitanteNombre: llave.visitanteNombre
                });
              }
            });
          }
          if (!allPartidos.length) return i.reply({ content: '❌ No hay partidos.', flags: 64 });

          let filtroParticipante = '';
          let pagina = 0;
          const ITEMS_PER_PAGE = 25;

          const generatePayload = () => {
            let filtered = allPartidos;
            if (filtroParticipante) {
              const q = filtroParticipante.toLowerCase().trim();
              filtered = filtered.filter(p =>
                (p.label && p.label.toLowerCase().includes(q)) ||
                (p.localNombre && p.localNombre.toLowerCase().includes(q)) ||
                (p.visitanteNombre && p.visitanteNombre.toLowerCase().includes(q))
              );
            }

            const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            pagina = Math.min(Math.max(0, pagina), totalPages - 1);
            const pageMatches = filtered.slice(pagina * ITEMS_PER_PAGE, (pagina + 1) * ITEMS_PER_PAGE);

            const rows = [];
            if (pageMatches.length > 0) {
              const menu = new StringSelectMenuBuilder()
                .setCustomId('sel_ssc_match')
                .setPlaceholder('Selecciona partido')
                .addOptions(pageMatches.map(p => ({
                  label: p.label.slice(0, 100),
                  description: p.desc.slice(0, 100),
                  value: p.value
                })));
              rows.push(new ActionRowBuilder().addComponents(menu));
            }

            const rowBtn = new ActionRowBuilder().addComponents(
              filtroParticipante
                ? new ButtonBuilder().setCustomId('btn_ssc_part_clear').setLabel(`❌ Quitar: ${filtroParticipante.slice(0, 12)}`).setStyle(ButtonStyle.Danger)
                : new ButtonBuilder().setCustomId('btn_ssc_part_search').setLabel('🔍 Buscar Participante').setStyle(ButtonStyle.Secondary)
            );
            rows.push(rowBtn);

            if (totalPages > 1) {
              const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_ssc_prev').setLabel('◀️ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
                new ButtonBuilder().setCustomId('btn_ssc_info').setLabel(`Página ${pagina + 1}/${totalPages} (${filtered.length} partidos)`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('btn_ssc_next').setLabel('Siguiente ▶️').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPages - 1)
              );
              rows.push(navRow);
            }

            const partInfo = filtroParticipante ? ` • 🔍 *Filtro: "${filtroParticipante}"*` : '';
            return {
              content: `Selecciona el partido para cargar resultados (${filtered.length} partidos)${partInfo}:`,
              components: rows,
              flags: 64
            };
          };

          await i.reply(generatePayload());
          const m1 = await i.fetchReply();

          const col = m1.createMessageComponentCollector({ time: 60000 });
          col.on('collect', async iM => {
            if (iM.customId === 'btn_ssc_part_clear') {
              filtroParticipante = '';
              pagina = 0;
              return iM.update(generatePayload());
            }

            if (iM.customId === 'btn_ssc_part_search') {
              const modal = new ModalBuilder()
                .setCustomId('mod_ssc_part_search')
                .setTitle('Buscar Participante');

              const inputPart = new TextInputBuilder()
                .setCustomId('input_ssc_part')
                .setLabel('Nombre del equipo o jugador')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ej: Boca, River, Juan...')
                .setRequired(true)
                .setMinLength(1)
                .setMaxLength(50);

              modal.addComponents(new ActionRowBuilder().addComponents(inputPart));
              await iM.showModal(modal);

              const modalResp = await i.awaitModalSubmit({
                filter: mI => mI.customId === 'mod_ssc_part_search' && mI.user.id === i.user.id,
                time: 60000
              }).catch(() => null);

              if (!modalResp) return;
              filtroParticipante = modalResp.fields.getTextInputValue('input_ssc_part').trim();
              pagina = 0;
              return modalResp.update(generatePayload());
            }

            if (iM.customId === 'btn_ssc_prev') {
              if (pagina > 0) pagina--;
              return iM.update(generatePayload());
            }
            if (iM.customId === 'btn_ssc_next') {
              pagina++;
              return iM.update(generatePayload());
            }

            if (iM.customId !== 'sel_ssc_match') return;
            const val = iM.values[0];
            let pObj;
            if (val.startsWith('g_')) {
              const [, gi, fi, pi] = val.split('_').map(Number);
              pObj = copa.grupos[gi].fechas[fi].partidos[pi];
            } else {
              const [, li, tipo] = val.split('_');
              const llave = copa.fase === 'semifinales' ? copa.semifinales[parseInt(li)] : copa.final;
              pObj = llave[tipo];
            }
            if (!pObj) return iM.reply({ content: '❌ Partido no encontrado.', flags: 64 });

            const rowMinis = new ActionRowBuilder();
            for (let i = 0; i < 3; i++) {
              const d = pObj.duelosIndividuales[i];
              rowMinis.addComponents(
                new ButtonBuilder()
                  .setCustomId(`btn_ssc_mini_${i}`)
                  .setLabel(d.finalizado ? `✅ ${d.localJugadorNombre} vs ${d.visitanteJugadorNombre}` : `🥅 ${d.localJugadorNombre} vs ${d.visitanteJugadorNombre}`)
                  .setStyle(d.finalizado ? ButtonStyle.Success : ButtonStyle.Primary)
                  .setDisabled(d.finalizado)
              );
            }

            await iM.reply({
              content: `🔍 **Validando Partido SSC:** ${pObj.localNombre} vs ${pObj.visitanteNombre}`,
              components: [rowMinis],
              flags: 64
            });
            const m2 = await iM.fetchReply();

            const colMini = m2.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
            colMini.on('collect', async iB => {
              const miniIdx = parseInt(iB.customId.split('_').pop());
              const duel = pObj.duelosIndividuales[miniIdx];
              const labelL = duel.localJugadorNombre || 'Local';
              const labelV = duel.visitanteJugadorNombre || 'Visitante';
              const idL = duel.localJugadorId || 'desconocido';
              const idV = duel.visitanteJugadorId || 'desconocido';

              const modal = new ModalBuilder().setCustomId(`m_ssc_mini_${miniIdx}`).setTitle(`Partido ${pObj.localNombre} vs ${pObj.visitanteNombre}`.slice(0, 45));
              modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gl').setLabel(`Goles ${labelL}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 5').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('gv').setLabel(`Goles ${labelV}`).setStyle(TextInputStyle.Short).setPlaceholder('Ej: 3').setRequired(true))
              );
              await iB.showModal(modal);

              const sub = await iB.awaitModalSubmit({
                filter: mI => mI.customId === `m_ssc_mini_${miniIdx}` && mI.user.id === iB.user.id,
                time: 60000
              }).catch(() => null);
              if (!sub) return;
              await sub.deferReply({ flags: 64 }).catch(() => {});

              try {
                const gl = parseInt(sub.fields.getTextInputValue('gl'));
                const gv = parseInt(sub.fields.getTextInputValue('gv'));
                if (isNaN(gl) || isNaN(gv)) throw new Error();

                duel.golesLocal = gl;
                duel.golesVisitante = gv;
                duel.finalizado = true;

                // Media individual tras cada minipartido
                if (gl !== gv && duel.localJugadorId && duel.visitanteJugadorId) {
                  try {
                    const resultadoMedia = await aplicarCambioMediaDuelo(
                      gl > gv ? duel.localJugadorId : duel.visitanteJugadorId,
                      gl > gv ? duel.visitanteJugadorId : duel.localJugadorId,
                      Math.max(gl, gv), Math.min(gl, gv)
                    );
                    if (resultadoMedia) {
                      const { ganadorNombre, perdedorNombre, delta, nuevaMediaGanador, nuevaMediaPerdedor } = resultadoMedia;
                      await i.channel.send(`🧮 Media de **${ganadorNombre}** subió a **${nuevaMediaGanador.toFixed(2)}** (+${delta.toFixed(2)}) \nMedia de **${perdedorNombre}** bajó a **${nuevaMediaPerdedor.toFixed(2)}** (-${delta.toFixed(2)})`);
                      await (await client.channels.fetch(process.env.CANAL_RESULTADOS_SUPERLIGA)).send(`⚽ Partido <@${idL}> (${pObj.localNombre}) vs <@${idV}> (${pObj.visitanteNombre})\n✅ Resultado: ${labelL} **${gl} - ${gv}** ${labelV}\n📊 Cambios en las medias tras el duelo de **SuperSuperCopa**:\n🧮 Media de **${ganadorNombre}** subió a **${nuevaMediaGanador.toFixed(2)}** (+${delta.toFixed(2)})\n🧮 Media de **${perdedorNombre}** bajó a **${nuevaMediaPerdedor.toFixed(2)}** (-${delta.toFixed(2)})`);
                    }
                  } catch (error) {
                    console.log(error)
                  }
                }

                // Recalcular estado global
                let pml = 0, pmv = 0, gtl = 0, gtv = 0;
                for (const d of pObj.duelosIndividuales) {
                  if (d.finalizado) {
                    gtl += d.golesLocal; gtv += d.golesVisitante;
                    if (d.golesLocal > d.golesVisitante) pml++;
                    else if (d.golesVisitante > d.golesLocal) pmv++;
                  }
                }
                
                pObj.puntosMiniLocal = pml;
                pObj.puntosMiniVisitante = pmv;
                pObj.golesTotalLocal = gtl;
                pObj.golesTotalVisitante = gtv;

                let necesitaTercerPartidoParaDesempate = false;
                let imposibleRemontar = false;
                if (!val.startsWith('g_')) {
                  const [, li, tipo] = val.split('_');
                  if (tipo === 'vuelta') {
                    const llave = copa.fase === 'semifinales' ? copa.semifinales[parseInt(li)] : copa.final;
                    const globalL = (llave.ida.puntosMiniLocal || 0) + pmv;
                    const globalV = (llave.ida.puntosMiniVisitante || 0) + pml;
                    const dif = Math.abs(globalL - globalV);
                    const duelosJugadosVuelta = pml + pmv;
                    const duelosRestantesVuelta = 3 - duelosJugadosVuelta;
                    if (duelosRestantesVuelta > 0 && dif <= duelosRestantesVuelta) {
                      necesitaTercerPartidoParaDesempate = true;
                    }
                    if (dif > duelosRestantesVuelta) {
                      imposibleRemontar = true;
                    }
                  }
                }

                const allFinished = pObj.duelosIndividuales.every(d => d.finalizado);
                if (allFinished || imposibleRemontar || ((pml >= 2 || pmv >= 2) && !necesitaTercerPartidoParaDesempate)) {
                  pObj.finalizado = true;
                }

                if (pObj.finalizado) {
                  const eqL = await EquipoSuperliga.findOne({ _id: pObj.localId });
                  const eqV = await EquipoSuperliga.findOne({ _id: pObj.visitanteId });
                  
                  let dineroL = 0, dineroV = 0;
                  if (pml > pmv) {
                    dineroL = 200_000;
                  } else if (pmv > pml) {
                    dineroV = 200_000;
                  }

                  if (copa.fase === 'semifinales') {
                    if (pml > pmv) dineroL += 1_000_000; else if (pmv > pml) dineroV += 1_000_000;
                  } else if (copa.fase === 'final') {
                    if (pml > pmv) {
                        dineroL += 2_000_000;
                        if (eqL) {
                            if (eqL.coach?.media != null) eqL.coach.media = Math.round((eqL.coach.media + 1) * 100) / 100;
                            eqL.jugadores.forEach(j => { j.media = Math.round((j.media + 1) * 100) / 100; });
                        }
                    } else if (pmv > pml) {
                        dineroV += 2_000_000;
                        if (eqV) {
                            if (eqV.coach?.media != null) eqV.coach.media = Math.round((eqV.coach.media + 1) * 100) / 100;
                            eqV.jugadores.forEach(j => { j.media = Math.round((j.media + 1) * 100) / 100; });
                        }
                    }
                  }

                  if (eqL) {
                    eqL.dinero = (eqL.dinero || 0) + dineroL;
                    if (pml > pmv) {
                        if (eqL.coach?.media != null) eqL.coach.media = Math.round((eqL.coach.media + 0.5) * 100) / 100;
                        eqL.jugadores.forEach(j => { j.media = Math.round((j.media + 0.2) * 100) / 100; });
                    } else if (pml < pmv) eqL.jugadores.forEach(j => { j.media = Math.round((j.media - 0.1) * 100) / 100; });
                    await eqL.save();
                    if (dineroL > 0) {
                      await i.channel.send({
                        content: `**${eqL.nombre}** ha ganado $**${dineroL}** por la victoria en la Supercopa.`
                      })
                      await client.channels.fetch(process.env.CANAL_RESULTADOS_SUPERLIGA)
                        .then(c => c.send({
                          content: `**${eqL.nombre}** ha ganado $**${dineroL}** por la victoria en la Supercopa.`
                        }))
                    }
                  }
                  if (eqV) {
                    eqV.dinero = (eqV.dinero || 0) + dineroV;
                    if (pmv > pml) {
                        if (eqV.coach?.media != null) eqV.coach.media = Math.round((eqV.coach.media + 0.5) * 100) / 100;
                        eqV.jugadores.forEach(j => { j.media = Math.round((j.media + 0.2) * 100) / 100; });
                    } else if (pmv < pml) eqV.jugadores.forEach(j => { j.media = Math.round((j.media - 0.1) * 100) / 100; });
                    await eqV.save();
                    if (dineroV > 0) {
                      await i.channel.send({
                        content: `**${eqV.nombre}** ha ganado $**${dineroV}** por la victoria en la Supercopa.`
                      })
                      await client.channels.fetch(process.env.CANAL_RESULTADOS_SUPERLIGA)
                        .then(c => c.send({
                          content: `**${eqV.nombre}** ha ganado $**${dineroV}** por la victoria en la Supercopa.`
                        }))
                    }
                  }
                }

                await copa.save();
                
                // Si es eliminación y se terminó un partido, checkear si hay que crear desempate
                if (!val.startsWith('g_')) {
                  const [, li, tipo] = val.split('_');
                  const llave = copa.fase === 'semifinales' ? copa.semifinales[parseInt(li)] : copa.final;
                  
                  if (llave.ida.finalizado && llave.vuelta.finalizado && !llave.desempate && !llave.finalizado) {
                    const ptsLocal = llave.ida.puntosMiniLocal + llave.vuelta.puntosMiniVisitante;
                    const ptsVisitante = llave.ida.puntosMiniVisitante + llave.vuelta.puntosMiniLocal;
                    
                    if (ptsLocal === ptsVisitante) {
                      const eqL = await EquipoSuperliga.findOne({ _id: llave.localId });
                      const eqV = await EquipoSuperliga.findOne({ _id: llave.visitanteId });
                      llave.desempate = crearDesempate(eqV, eqL);
                      await i.channel.send(`⚠️ **Empate en la serie (${ptsLocal}-${ptsVisitante})**. Se ha generado un **Partido de Desempate** (1 solo duelo).`);
                      await copa.save();
                    } else {
                      llave.finalizado = true;
                      llave.ganadorId = ptsLocal > ptsVisitante ? llave.localId : llave.visitanteId;
                      await copa.save();
                    }
                  } else if (llave.desempate?.finalizado) {
                    llave.finalizado = true;
                    llave.ganadorId = llave.desempate.puntosMiniLocal > llave.desempate.puntosMiniVisitante ? llave.desempate.localId : llave.desempate.visitanteId;
                    await copa.save();
                  }
                }

                await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                await sub.editReply({ content: `✅ Duelo **${labelL}** vs **${labelV}** guardado (**${gl}-${gv}**).` + (pObj.finalizado ? ' ¡Partido finalizado!' : '')});
              } catch { await sub.editReply({ content: '❌ Error al guardar.' }); }
            });
          });
          break;
        }

        case 'btn_ssc_avanzar': {
          if (!copa) return i.reply({ content: '❌ No hay SSC activa.', flags: 64 });
          const equiposDB = await EquipoSuperliga.find({});

          if (copa.fase === 'grupos') {
            const pendA = copa.grupos[0].fechas.flatMap(f => f.partidos).some(p => !p.finalizado);
            const pendB = copa.grupos[1].fechas.flatMap(f => f.partidos).some(p => !p.finalizado);
            if (pendA || pendB) return i.reply({ content: '❌ Faltan partidos por terminar en los grupos.', flags: 64 });

            const tablaA = calcTablaGrupo(copa.grupos[0]);
            const tablaB = calcTablaGrupo(copa.grupos[1]);
            const eqA1 = equiposDB.find(e => (e._id?.$oid ?? e._id) === tablaA[0]?.id);
            const eqA2 = equiposDB.find(e => (e._id?.$oid ?? e._id) === tablaA[1]?.id);
            const eqB1 = equiposDB.find(e => (e._id?.$oid ?? e._id) === tablaB[0]?.id);
            const eqB2 = equiposDB.find(e => (e._id?.$oid ?? e._id) === tablaB[1]?.id);
            if (!eqA1 || !eqA2 || !eqB1 || !eqB2) return i.reply({ content: '❌ Error obteniendo clasificados.', flags: 64 });

            copa.semifinales = [crearLlave(eqA1, eqB2), crearLlave(eqB1, eqA2)];
            copa.fase = 'semifinales';
            await copa.save();
            await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
            await i.reply({ content: `✅ Semis Ida/Vuelta: **${eqA1.nombre}** vs **${eqB2.nombre}** | **${eqB1.nombre}** vs **${eqA2.nombre}**`, flags: 64 });
          } else if (copa.fase === 'semifinales') {
            if (copa.semifinales.some(ll => !ll.finalizado)) return i.reply({ content: '❌ Faltan series por terminar.', flags: 64 });

            // Failsafe: calcular ganadorId en caso de finalizaciones manuales o bugs previos
            copa.semifinales.forEach(ll => {
              if (ll.finalizado && !ll.ganadorId) {
                if (ll.desempate && ll.desempate.finalizado) {
                  ll.ganadorId = ll.desempate.puntosMiniLocal > ll.desempate.puntosMiniVisitante ? ll.desempate.localId : ll.desempate.visitanteId;
                } else if (ll.ida && ll.vuelta && ll.ida.finalizado && ll.vuelta.finalizado) {
                  const ptsL = (ll.ida.puntosMiniLocal || 0) + (ll.vuelta.puntosMiniVisitante || 0);
                  const ptsV = (ll.ida.puntosMiniVisitante || 0) + (ll.vuelta.puntosMiniLocal || 0);
                  ll.ganadorId = ptsL > ptsV ? ll.ida.localId : ll.ida.visitanteId;
                }
              }
            });
            await copa.save();

            const g1Id = copa.semifinales[0].ganadorId;
            const g2Id = copa.semifinales[1].ganadorId;
            const eq1 = equiposDB.find(e => (e._id?.$oid ?? e._id) === g1Id);
            const eq2 = equiposDB.find(e => (e._id?.$oid ?? e._id) === g2Id);

            if (!eq1 || !eq2) return i.reply({ content: '❌ Error crítico: No se pudo determinar el ganador de una de las semifinales.', flags: 64 });

            copa.final = crearLlave(eq1, eq2);
            copa.fase = 'final';
            await copa.save();
            await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
            await i.reply({ content: `✅ Final Ida/Vuelta: **${eq1.nombre}** vs **${eq2.nombre}**`, flags: 64 });
          } else if (copa.fase === 'final') {
            if (!copa.final?.finalizado) return i.reply({ content: '❌ La final no ha terminado.', flags: 64 });
            copa.fase = 'finalizado';
            copa.estadoGlobal = 'Finalizada';
            await copa.save();
            await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
            await i.reply({ content: '🏆 Supersupercopa finalizada.', flags: 64 });
          }
          break;
        }

        case 'btn_ssc_editar_duelos': {
          if (!copa || !['semifinales', 'final'].includes(copa.fase)) return i.reply({ content: '❌ Solo disponible en fase eliminatoria.', flags: 64 });
          const partidos = copa.fase === 'semifinales' ? copa.semifinales : (copa.final ? [copa.final] : []);
          if (!partidos.length) return i.reply({ content: '❌ No hay cruces configurados en esta fase.', flags: 64 });

          const equiposDB = await EquipoSuperliga.find({});
          const getId = (e) => String(e?._id?.$oid ?? e?._id ?? e);

          const generateDuelosPayload = () => {
            const opts = partidos.map((p, idx) => ({
              label: `${copa.fase === 'semifinales' ? `Semi ${idx + 1}` : 'Final'}: ${p.localNombre} vs ${p.visitanteNombre}`.slice(0, 100),
              value: `${idx}`,
              description: `Estado: ${p.finalizado ? `Finalizado (Gana ID: ${p.ganadorId || 'TBD'})` : 'Pendiente'}`
            }));

            const menu = new StringSelectMenuBuilder().setCustomId('sel_ssc_duelo').setPlaceholder('Selecciona el cruce a editar...').addOptions(opts);
            const desc = partidos.map((p, idx) => `> \`Cruce ${idx + 1}:\` **${p.localNombre}** vs **${p.visitanteNombre}** ${p.finalizado ? '✅' : '⏳'}`).join('\n');

            return {
              content: `⚔️ **Editar Cruces — Supersupercopa (${copa.fase})**\n\n${desc}\n\n*Selecciona un cruce para modificar sus participantes:*`,
              components: [new ActionRowBuilder().addComponents(menu)],
              flags: 64
            };
          };

          await i.reply(generateDuelosPayload());
          const m1 = await i.fetchReply();
          const col = m1.createMessageComponentCollector({ time: 120000 });

          col.on('collect', async iD => {
            if (iD.customId === 'btn_ssc_duelo_back') {
              return iD.update(generateDuelosPayload());
            }

            if (iD.customId === 'sel_ssc_duelo') {
              const idx = parseInt(iD.values[0]);
              const p = partidos[idx];
              if (!p) return iD.reply({ content: '❌ Cruce no encontrado.', flags: 64 });

              const actRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_ssc_cruce_l').setLabel('🔵 Cambiar Local').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_ssc_cruce_v').setLabel('🔴 Cambiar Visitante').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_ssc_cruce_swap').setLabel('🔀 Invertir Posiciones').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_ssc_duelo_back').setLabel('🔙 Volver').setStyle(ButtonStyle.Secondary)
              );

              await iD.update({
                content: `⚔️ **Editando Cruce — ${copa.fase} (Partido ${idx + 1})**\n\n` +
                         `🔵 **Local (Equipo 1):** **${p.localNombre}**\n` +
                         `🔴 **Visitante (Equipo 2):** **${p.visitanteNombre}**\n` +
                         `📊 **Estado:** ${p.finalizado ? 'Finalizado' : 'Pendiente'}\n\n` +
                         `¿Qué cambio deseas realizar?`,
                components: [actRow]
              });

              const subInteract = await m1.awaitMessageComponent({
                filter: sI => sI.user.id === i.user.id,
                time: 60000
              }).catch(() => null);

              if (!subInteract) return;

              if (subInteract.customId === 'btn_ssc_duelo_back') {
                return subInteract.update(generateDuelosPayload());
              }

              if (subInteract.customId === 'btn_ssc_cruce_swap') {
                const tempId = p.localId;
                const tempNombre = p.localNombre;
                p.localId = p.visitanteId;
                p.localNombre = p.visitanteNombre;
                p.visitanteId = tempId;
                p.visitanteNombre = tempNombre;

                if (p.ida) {
                  p.ida.localId = p.localId; p.ida.localNombre = p.localNombre;
                  p.ida.visitanteId = p.visitanteId; p.ida.visitanteNombre = p.visitanteNombre;
                }
                if (p.vuelta) {
                  p.vuelta.localId = p.visitanteId; p.vuelta.localNombre = p.visitanteNombre;
                  p.vuelta.visitanteId = p.localId; p.vuelta.visitanteNombre = p.localNombre;
                }
                if (p.desempate) {
                  p.desempate.localId = p.localId; p.desempate.localNombre = p.localNombre;
                  p.desempate.visitanteId = p.visitanteId; p.desempate.visitanteNombre = p.visitanteNombre;
                }

                await copa.save();
                await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                return subInteract.update({
                  content: `✅ **Posiciones invertidas:** Ahora es **${p.localNombre}** (Local) vs **${p.visitanteNombre}** (Visitante).`,
                  components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_ssc_duelo_back').setLabel('🔙 Volver a Lista de Cruces').setStyle(ButtonStyle.Secondary))]
                });
              }

              if (subInteract.customId === 'btn_ssc_cruce_l' || subInteract.customId === 'btn_ssc_cruce_v') {
                const targetSlot = subInteract.customId === 'btn_ssc_cruce_l' ? 'local' : 'visitante';
                const slotTitle = targetSlot === 'local' ? 'Local' : 'Visitante';

                const eqOpts = equiposDB.slice(0, 25).map(e => ({
                  label: e.nombre.slice(0, 100),
                  value: getId(e),
                  description: `Asignar como ${slotTitle}`
                }));

                const selMenu = new StringSelectMenuBuilder()
                  .setCustomId('sel_ssc_target_team')
                  .setPlaceholder(`Selecciona el nuevo equipo ${slotTitle}...`)
                  .addOptions(eqOpts);

                const cancelRow = new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId('btn_ssc_duelo_back').setLabel('🔙 Cancelar').setStyle(ButtonStyle.Secondary)
                );

                await subInteract.update({
                  content: `📝 **Seleccionar ${slotTitle} para el Cruce:**`,
                  components: [new ActionRowBuilder().addComponents(selMenu), cancelRow]
                });

                const teamInteract = await m1.awaitMessageComponent({
                  filter: tI => tI.user.id === i.user.id,
                  time: 60000
                }).catch(() => null);

                if (!teamInteract) return;

                if (teamInteract.customId === 'btn_ssc_duelo_back') {
                  return teamInteract.update(generateDuelosPayload());
                }

                if (teamInteract.customId === 'sel_ssc_target_team') {
                  const selectedId = teamInteract.values[0];
                  const eqObj = equiposDB.find(e => getId(e) === selectedId);
                  if (!eqObj) return teamInteract.reply({ content: '❌ Equipo inválido.', flags: 64 });

                  if (targetSlot === 'local') {
                    p.localId = getId(eqObj);
                    p.localNombre = eqObj.nombre;
                  } else {
                    p.visitanteId = getId(eqObj);
                    p.visitanteNombre = eqObj.nombre;
                  }

                  if (p.ida) {
                    p.ida.localId = p.localId; p.ida.localNombre = p.localNombre;
                    p.ida.visitanteId = p.visitanteId; p.ida.visitanteNombre = p.visitanteNombre;
                  }
                  if (p.vuelta) {
                    p.vuelta.localId = p.visitanteId; p.vuelta.localNombre = p.visitanteNombre;
                    p.vuelta.visitanteId = p.localId; p.vuelta.visitanteNombre = p.localNombre;
                  }
                  if (p.desempate) {
                    p.desempate.localId = p.localId; p.desempate.localNombre = p.localNombre;
                    p.desempate.visitanteId = p.visitanteId; p.desempate.visitanteNombre = p.visitanteNombre;
                  }

                  await copa.save();
                  await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                  return teamInteract.update({
                    content: `✅ **${slotTitle}** actualizado a **${eqObj.nombre}**.\n\n` +
                             `📌 **Nuevo cruce:** **${p.localNombre}** vs **${p.visitanteNombre}**`,
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_ssc_duelo_back').setLabel('🔙 Volver a Lista de Cruces').setStyle(ButtonStyle.Secondary))]
                  });
                }
              }
            }
          });
          break;
        }

        case 'btn_ssc_tema': {
          const modal = new ModalBuilder().setCustomId('m_ssc_tema').setTitle('Editar Tema de Color');
          const current = copa?.tema || { primario: '#0a0e14', secundario: '#161d26', acento: '#f1c40f', texto: '#ffffff', borde: '#374151' };
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('primario').setLabel('Color Primario (fondo)').setStyle(TextInputStyle.Short).setValue(current.primario).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('secundario').setLabel('Color Secundario (cards)').setStyle(TextInputStyle.Short).setValue(current.secundario).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acento').setLabel('Color Acento').setStyle(TextInputStyle.Short).setValue(current.acento).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('texto').setLabel('Color Texto').setStyle(TextInputStyle.Short).setValue(current.texto).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('borde').setLabel('Color Borde').setStyle(TextInputStyle.Short).setValue(current.borde).setRequired(true)),
          );
          await i.showModal(modal);
          const sub = await i.awaitModalSubmit({ time: 60000 }).catch(() => null);
          if (!sub) return;
          if (!copa) { copa = await Supersupercopa.create({ estadoGlobal: 'Inactiva' }); }
          copa.tema = {
            primario: sub.fields.getTextInputValue('primario'),
            secundario: sub.fields.getTextInputValue('secundario'),
            acento: sub.fields.getTextInputValue('acento'),
            texto: sub.fields.getTextInputValue('texto'),
            borde: sub.fields.getTextInputValue('borde'),
          };
          await copa.save();
          await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
          await sub.reply({ content: '✅ Tema actualizado.', flags: 64 });
          break;
        }

        case 'btn_ssc_grupos': {
          if (!copa || !copa.grupos || copa.grupos.length < 2) {
            return i.reply({ content: '❌ No hay grupos activos en la Supersupercopa.', flags: 64 });
          }

          const equiposDB = await EquipoSuperliga.find({});
          const getId = (e) => String(e?._id?.$oid ?? e?._id ?? e);

          const generateGroupPayload = () => {
            const teamsA = (copa.grupos[0].equipos || []).map(id => equiposDB.find(e => getId(e) === getId(id)) || { _id: id, nombre: 'Desconocido' });
            const teamsB = (copa.grupos[1].equipos || []).map(id => equiposDB.find(e => getId(e) === getId(id)) || { _id: id, nombre: 'Desconocido' });

            const options = [];
            teamsA.forEach(t => {
              options.push({
                label: `${t.nombre} (Grupo A)`.slice(0, 100),
                description: 'Mover a Grupo B o intercambiar',
                value: `team_${getId(t)}_A`,
                emoji: '🅰️'
              });
            });
            teamsB.forEach(t => {
              options.push({
                label: `${t.nombre} (Grupo B)`.slice(0, 100),
                description: 'Mover a Grupo A o intercambiar',
                value: `team_${getId(t)}_B`,
                emoji: '🅱️'
              });
            });

            const rows = [];
            if (options.length > 0) {
              const menu = new StringSelectMenuBuilder()
                .setCustomId('sel_ssc_team_group')
                .setPlaceholder('Selecciona un equipo para cambiar su grupo...')
                .addOptions(options.slice(0, 25));
              rows.push(new ActionRowBuilder().addComponents(menu));
            }

            const descA = teamsA.map((t, idx) => `> \`${idx + 1}.\` **${t.nombre}**`).join('\n') || '*Sin equipos*';
            const descB = teamsB.map((t, idx) => `> \`${idx + 1}.\` **${t.nombre}**`).join('\n') || '*Sin equipos*';

            return {
              content: `🔀 **Modificación de Grupos — Supersupercopa**\n\n` +
                `🅰️ **Grupo A (${teamsA.length} equipos):**\n${descA}\n\n` +
                `🅱️ **Grupo B (${teamsB.length} equipos):**\n${descB}\n\n` +
                `*Seleccioná un equipo en el menú de abajo para moverlo o intercambiarlo:*`,
              components: rows,
              flags: 64
            };
          };

          await i.reply(generateGroupPayload());
          const groupMsg = await i.fetchReply();

          const groupCollector = groupMsg.createMessageComponentCollector({ time: 120000 });

          groupCollector.on('collect', async iG => {
            if (iG.customId === 'sel_ssc_team_group') {
              const val = iG.values[0];
              const [, selectedTeamId, currentGroup] = val.split('_');
              const teamObj = equiposDB.find(e => getId(e) === selectedTeamId) || { nombre: 'Equipo' };
              const targetGroup = currentGroup === 'A' ? 'B' : 'A';

              const actRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`btn_move_${selectedTeamId}_${currentGroup}`)
                  .setLabel(`➡️ Mover a Grupo ${targetGroup}`)
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(`btn_swap_${selectedTeamId}_${currentGroup}`)
                  .setLabel(`🔀 Intercambiar con equipo de Grupo ${targetGroup}`)
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId('btn_back_group')
                  .setLabel('🔙 Volver')
                  .setStyle(ButtonStyle.Secondary)
              );

              await iG.update({
                content: `⚙️ **Equipo Seleccionado:** **${teamObj.nombre}** (Actualmente en **Grupo ${currentGroup}**)\n\n¿Qué acción deseas realizar?`,
                components: [actRow]
              });

              const subInteract = await groupMsg.awaitMessageComponent({
                filter: sI => sI.user.id === i.user.id,
                time: 60000
              }).catch(() => null);

              if (!subInteract) return;

              if (subInteract.customId === 'btn_back_group') {
                return subInteract.update(generateGroupPayload());
              }

              if (subInteract.customId.startsWith('btn_move_')) {
                const sourceIdx = currentGroup === 'A' ? 0 : 1;
                const targetIdx = targetGroup === 'A' ? 0 : 1;

                copa.grupos[sourceIdx].equipos = copa.grupos[sourceIdx].equipos.filter(id => getId(id) !== selectedTeamId);
                if (!copa.grupos[targetIdx].equipos.some(id => getId(id) === selectedTeamId)) {
                  copa.grupos[targetIdx].equipos.push(selectedTeamId);
                }

                let fixtureNote = '';
                if (copa.fase === 'grupos') {
                  const anyMatchPlayed = copa.grupos.some(g => (g.fechas || []).some(f => (f.partidos || f.encuentros || []).some(p => p.finalizado)));
                  if (!anyMatchPlayed) {
                    const newTeamsA = copa.grupos[0].equipos.map(id => equiposDB.find(e => getId(e) === getId(id))).filter(Boolean);
                    const newTeamsB = copa.grupos[1].equipos.map(id => equiposDB.find(e => getId(e) === getId(id))).filter(Boolean);
                    if (newTeamsA.length >= 2) copa.grupos[0].fechas = generarRoundRobinSuperliga(newTeamsA, 1);
                    if (newTeamsB.length >= 2) copa.grupos[1].fechas = generarRoundRobinSuperliga(newTeamsB, 1);
                    fixtureNote = '\n*(El fixture de ambos grupos ha sido regenerado automáticamente).*';
                  } else {
                    fixtureNote = '\n⚠️ *(Nota: Ya hay partidos jugados en la copa, los partidos existentes se mantuvieron).*';
                  }
                }

                await copa.save();
                await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                return subInteract.update({
                  content: `✅ **${teamObj.nombre}** ha sido movido al **Grupo ${targetGroup}** exitosamente.${fixtureNote}`,
                  components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_back_group_final').setLabel('🔙 Volver a Gestión de Grupos').setStyle(ButtonStyle.Secondary))]
                });
              }

              if (subInteract.customId.startsWith('btn_swap_')) {
                const targetIdx = targetGroup === 'A' ? 0 : 1;
                const oppositeTeams = (copa.grupos[targetIdx].equipos || []).map(id => equiposDB.find(e => getId(e) === getId(id)) || { _id: id, nombre: 'Desconocido' });

                if (!oppositeTeams.length) {
                  return subInteract.reply({ content: `❌ No hay equipos en el Grupo ${targetGroup} para intercambiar.`, flags: 64 });
                }

                const swapMenu = new StringSelectMenuBuilder()
                  .setCustomId('sel_swap_target')
                  .setPlaceholder(`Selecciona el equipo del Grupo ${targetGroup} con quién intercambiar...`)
                  .addOptions(oppositeTeams.slice(0, 25).map(t => ({
                    label: t.nombre.slice(0, 100),
                    value: getId(t),
                    description: `Intercambiar con ${teamObj.nombre}`
                  })));

                const swapRow = new ActionRowBuilder().addComponents(swapMenu);
                const cancelRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_back_group').setLabel('🔙 Cancelar').setStyle(ButtonStyle.Secondary));

                await subInteract.update({
                  content: `🔀 **Intercambiar:** Selecciona qué equipo del **Grupo ${targetGroup}** pasará al **Grupo ${currentGroup}** en lugar de **${teamObj.nombre}**:`,
                  components: [swapRow, cancelRow]
                });

                const swapInteract = await groupMsg.awaitMessageComponent({
                  filter: swI => swI.user.id === i.user.id,
                  time: 60000
                }).catch(() => null);

                if (!swapInteract) return;

                if (swapInteract.customId === 'btn_back_group') {
                  return swapInteract.update(generateGroupPayload());
                }

                if (swapInteract.customId === 'sel_swap_target') {
                  const swapTeamId = swapInteract.values[0];
                  const swapTeamObj = equiposDB.find(e => getId(e) === swapTeamId) || { nombre: 'Equipo' };

                  const sourceIdx = currentGroup === 'A' ? 0 : 1;
                  const targetIdx = targetGroup === 'A' ? 0 : 1;

                  // Swap IDs
                  copa.grupos[sourceIdx].equipos = copa.grupos[sourceIdx].equipos.map(id => getId(id) === selectedTeamId ? swapTeamId : id);
                  copa.grupos[targetIdx].equipos = copa.grupos[targetIdx].equipos.map(id => getId(id) === swapTeamId ? selectedTeamId : id);

                  let fixtureNote = '';
                  if (copa.fase === 'grupos') {
                    const anyMatchPlayed = copa.grupos.some(g => (g.fechas || []).some(f => (f.partidos || f.encuentros || []).some(p => p.finalizado)));
                    if (!anyMatchPlayed) {
                      const newTeamsA = copa.grupos[0].equipos.map(id => equiposDB.find(e => getId(e) === getId(id))).filter(Boolean);
                      const newTeamsB = copa.grupos[1].equipos.map(id => equiposDB.find(e => getId(e) === getId(id))).filter(Boolean);
                      if (newTeamsA.length >= 2) copa.grupos[0].fechas = generarRoundRobinSuperliga(newTeamsA, 1);
                      if (newTeamsB.length >= 2) copa.grupos[1].fechas = generarRoundRobinSuperliga(newTeamsB, 1);
                      fixtureNote = '\n*(El fixture de ambos grupos ha sido regenerado automáticamente).*';
                    } else {
                      fixtureNote = '\n⚠️ *(Nota: Ya hay partidos jugados en la copa, los partidos existentes se mantuvieron).*';
                    }
                  }

                  await copa.save();
                  await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                  return swapInteract.update({
                    content: `✅ **Intercambio realizado:**\n• **${teamObj.nombre}** ➔ **Grupo ${targetGroup}**\n• **${swapTeamObj.nombre}** ➔ **Grupo ${currentGroup}**${fixtureNote}`,
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_back_group_final').setLabel('🔙 Volver a Gestión de Grupos').setStyle(ButtonStyle.Secondary))]
                  });
                }
              }
            }

            if (iG.customId === 'btn_back_group_final') {
              return iG.update(generateGroupPayload());
            }
          });
          break;
        }

        case 'btn_ssc_editar_equipos': {
          const equiposEdit = await EquipoSuperliga.find({});
          if (!equiposEdit.length) return i.reply({ content: '❌ No hay equipos.', flags: 64 });
          const opts = equiposEdit.slice(0, 25).map(e => ({ label: e.nombre, value: e._id?.$oid ?? e._id }));
          const menu = new StringSelectMenuBuilder().setCustomId('sel_ssc_eq').setPlaceholder('Equipo').addOptions(opts);
          await i.reply({ content: 'Selecciona equipo:', components: [new ActionRowBuilder().addComponents(menu)], flags: 64 });
          const m1 = await i.fetchReply();
          const col = m1.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
          col.on('collect', async iE => {
            if (iE.customId !== 'sel_ssc_eq') return;
            await iE.deferUpdate();
            const eq = equiposEdit.find(e => (e._id?.$oid ?? e._id) === iE.values[0]);
            const gIdx = copa?.grupos?.findIndex(g => (g.equipos || []).some(id => String(id?._id?.$oid ?? id?._id ?? id) === String(eq._id?.$oid ?? eq._id)));
            const gName = gIdx !== -1 && gIdx != null ? (gIdx === 0 ? 'A' : 'B') : null;
            const groupChangeOpt = gName ? [{ label: `🔀 Mover a Grupo ${gName === 'A' ? 'B' : 'A'} (Actual: ${gName})`, value: `change_group_${gName}` }] : [];
            const memOpts = [
              ...groupChangeOpt,
              { label: `👤 Coach: ${eq.coach.nombre}`, value: `coach_${eq.coach.id}` }
            ];
            eq.jugadores.forEach(j => memOpts.push({ label: `🏃 ${j.nombre}`, value: `jug_${j.id}` }));
            const memMenu = new StringSelectMenuBuilder().setCustomId('sel_ssc_mem').setPlaceholder('Miembro u Opción').addOptions(memOpts);
            await iE.editReply({ content: `Editando **${eq.nombre}**${gName ? ` (Grupo ${gName})` : ''}:`, components: [new ActionRowBuilder().addComponents(memMenu)] });
            const col2 = m1.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
            col2.on('collect', async iM => {
              if (iM.customId !== 'sel_ssc_mem') return;
              const val = iM.values[0];

              if (val.startsWith('change_group_')) {
                const currG = val.replace('change_group_', '');
                const targetG = currG === 'A' ? 'B' : 'A';
                const sIdx = currG === 'A' ? 0 : 1;
                const tIdx = targetG === 'A' ? 0 : 1;
                const eqIdStr = String(eq._id?.$oid ?? eq._id);

                copa.grupos[sIdx].equipos = copa.grupos[sIdx].equipos.filter(id => String(id?._id?.$oid ?? id?._id ?? id) !== eqIdStr);
                if (!copa.grupos[tIdx].equipos.some(id => String(id?._id?.$oid ?? id?._id ?? id) === eqIdStr)) {
                  copa.grupos[tIdx].equipos.push(eqIdStr);
                }

                if (copa.fase === 'grupos') {
                  const anyMatchPlayed = copa.grupos.some(g => (g.fechas || []).some(f => (f.partidos || f.encuentros || []).some(p => p.finalizado)));
                  if (!anyMatchPlayed) {
                    const newTeamsA = copa.grupos[0].equipos.map(id => equiposEdit.find(e => String(e._id?.$oid ?? e._id) === String(id))).filter(Boolean);
                    const newTeamsB = copa.grupos[1].equipos.map(id => equiposEdit.find(e => String(e._id?.$oid ?? e._id) === String(id))).filter(Boolean);
                    if (newTeamsA.length >= 2) copa.grupos[0].fechas = generarRoundRobinSuperliga(newTeamsA, 1);
                    if (newTeamsB.length >= 2) copa.grupos[1].fechas = generarRoundRobinSuperliga(newTeamsB, 1);
                  }
                }

                await copa.save();
                await panelMsg.edit({ embeds: [buildSupercopaEmbed(copa)], components: buildSupercopaRows(copa) });
                return iM.reply({ content: `✅ **${eq.nombre}** movido al **Grupo ${targetG}** exitosamente.`, flags: 64 });
              }

              const esCoach = val.startsWith('coach');
              const mem = esCoach ? eq.coach : eq.jugadores.find(j => j.id === val.split('_')[1]);
              const modal = new ModalBuilder().setCustomId('m_ssc_mem').setTitle('Editar');
              modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('media').setLabel('Media').setStyle(TextInputStyle.Short).setValue(mem.media.toString()).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pais').setLabel('País').setStyle(TextInputStyle.Short).setValue(mem.pais || 'Argentina').setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('stats').setLabel('Stats ACT-TIR-PAS-IQ-AUR-ESQ').setStyle(TextInputStyle.Short).setValue(`${mem.stats?.actividad||80}-${mem.stats?.tiro||80}-${mem.stats?.pase||80}-${mem.stats?.iq||80}-${mem.stats?.aura||80}-${mem.stats?.esquinazo||80}`).setRequired(true)),
              );
              await iM.showModal(modal);
              const sub = await iM.awaitModalSubmit({ time: 60000 }).catch(() => null);
              if (!sub) return;
              try {
                mem.media = parseInt(sub.fields.getTextInputValue('media'));
                mem.pais = sub.fields.getTextInputValue('pais');
                const [a,t,p,q,u,e] = sub.fields.getTextInputValue('stats').split('-').map(Number);
                mem.stats = { actividad: a, tiro: t, pase: p, iq: q, aura: u, esquinazo: e };
                mem.carta = '';
                await eq.save();
                await sub.reply({ content: `✅ ${mem.nombre} actualizado.`, flags: 64 });
              } catch { await sub.reply({ content: '❌ Formato inválido.', flags: 64 }); }
            });
          });
          break;
        }
      }
    });
  }
};
