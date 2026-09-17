import { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ComponentType, AttachmentBuilder } from 'discord.js';
import Superliga from '../../models/superliga/Superliga.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import JugadorLibre from '../../models/superliga/JugadoresLibres.js';
import { registrarMovimiento } from '../../utils/db/registrarMovimiento.js';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';
import {
  generarPaginaCampeonYTabla,
  generarPaginaMovimientos,
  generarPaginaPremios,
  generarPaginaProgresion,
} from '../../utils/visual/finalizarGenerator.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function getShieldB64(escudoPath) {
  if (!escudoPath) return null;
  try {
    const fullPath = join(process.cwd(), escudoPath);
    if (existsSync(fullPath)) {
      const buffer = readFileSync(fullPath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    }
  } catch (e) {}
  return null;
}

export default {
  name: 'superliga-finalizar',
  aliases: ['sl-finalizar'],
  permisos: ['Administrator'],
  run: async (client, message, args) => {
    const liga = await Superliga.findOne({ actual: true });
    if (!liga) return message.reply('❌ No hay una temporada activa para finalizar.');

    // 1. Validar que todos los partidos estén finalizados
    const pendientes = [];
    liga.fechas.forEach(f => {
      const enc = f.partidos ?? f.encuentros;
      enc.forEach(p => {
      if (!p.finalizado) pendientes.push(`F${f.numero}: ${p.localNombre} vs ${p.visitanteNombre}`);
    })});

    if (pendientes.length > 0) {
      return message.reply(`❌ No se puede finalizar la temporada. Faltan **${pendientes.length}** partidos por jugar:\n` + pendientes.slice(0, 10).join('\n') + (pendientes.length > 10 ? '\n...' : ''));
    }

    // 1.5 Validar equipos con múltiples jugadores 90+ de media
    const equiposVal = await EquipoSuperliga.find({});
    const equiposExcedidos = [];
    equiposVal.forEach(eq => {
      const jugadores90Mas = eq.jugadores.filter(j => j.media >= 90);
      if (jugadores90Mas.length >= 2) {
        equiposExcedidos.push(`• **${eq.nombre}**: ${jugadores90Mas.map(j => `${j.nombre} [${j.media}]`).join(', ')}`);
      }
    });

    if (equiposExcedidos.length > 0) {
      return message.reply(`❌ **No se puede finalizar la temporada.**\nSegún el reglamento, no se permite tener 2 o más jugadores con **90+ de media** en el mismo equipo. Los siguientes equipos deben vender o liberar jugadores antes de poder cerrar la temporada:\n\n${equiposExcedidos.join('\n')}`);
    }

    // 2. Confirmación
    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Cierre de Temporada')
      .setDescription(`¿Estás seguro de finalizar la **${liga.temporada}**?\n\nEsto ejecutará:\n- Reparto de premios económicos.\n- Progresión de medias estacional.\n- Reducción de contratos y vencimientos.\n- Cierre del registro de la temporada.`)
      .setColor('#f1c40f');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_finalizar').setLabel('✅ Sí, Finalizar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_finalizar').setLabel('❌ Cancelar').setStyle(ButtonStyle.Secondary)
    );

    const msg = await message.reply({ embeds: [confirmEmbed], components: [row] });
    const coll = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });

    coll.on('collect', async i => {
      if (i.user.id !== message.author.id) return i.reply({ content: '❌ Solo el autor puede confirmar.', flags: 64 });
      
      if (i.customId === 'cancel_finalizar') {
        await i.update({ content: 'Cierre cancelado.', embeds: [], components: [] });
        return coll.stop();
      }

      await i.update({ content: '<a:loading:1461897825439711468> Procesando cierre de temporada...', embeds: [], components: [] });

      try {
        const equipos = await EquipoSuperliga.find({});
        const N = equipos.length;
        const totalPartidosTemporada = liga.fechas.length;
        
        // ── Calcular Tabla para Posiciones ──────────────────────────────
        const tabla = equipos.map(e => {
          const id = e._id?.$oid ?? e._id;
          let pts = 0, pJ = 0, v = 0, p = 0, gf = 0, gc = 0;
          liga.fechas.forEach(f => (f.partidos ?? f.encuentros).forEach(partido => {
            const esLocal = partido.localId === id || (partido.localNombre ?? partido.local.nombre) === e.nombre;
            const esVisitante = partido.visitanteId === id || (partido.visitanteNombre ?? partido.visitante.nombre) === e.nombre;
            if (!esLocal && !esVisitante) return;
            pJ++;
            const pml = partido.puntosMiniLocal ?? partido.resultado.golesLocal ?? 0;
            const pmv = partido.puntosMiniVisitante ?? partido.resultado.golesVisitante ?? 0;
            let gl;
            if (partido.golesTotalLocal) gl = partido.golesTotalLocal;
            else {
              gl = 0;
              partido.duelosIndividuales.forEach(duelo => {
                if (duelo.jugadorLocalId === id) gl += duelo.golesLocal;
              });
            }
            let gv;
            if (partido.golesTotalVisitante) gv = partido.golesTotalVisitante;
            else {
              gv = 0;
              partido.duelosIndividuales.forEach(duelo => {
                if (duelo.jugadorVisitanteId === id) gv += duelo.golesVisitante;
              });
            }
            if (esLocal) {
              gf += gl; gc += gv;
              if (pml > pmv) { pts += 3; v++; }
              else if (pml === pmv) pts += 1;
              else p++;
            } else {
              gf += gv; gc += gl;
              if (pmv > pml) { pts += 3; v++; }
              else if (pml === pmv) pts += 1;
              else p++;
            }
          }));
          return { id, pts, pJ, v, p, gf, gc, dg: gf - gc, nombre: e.nombre, escudo: e.escudo };
        }).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);

        // ── Data para las imágenes ──────────────────────────────────────
        const dataPremios = [];
        const dataMovimientos = [];
        const dataProgresion = [];

        // Helper para registrar movimientos directamente en el objeto del equipo (evita sobreescritura)
        const pushMovimiento = (eq, mov) => {
          if (!eq.libroTraspasos) eq.libroTraspasos = [];
          eq.libroTraspasos.push({
            tipo: mov.tipo,
            jugador: mov.jugador || '',
            jugadorId: mov.jugadorId || '',
            fecha: new Date().toISOString(),
            monto: mov.monto || 0,
            equipoRelacionado: mov.equipoRelacionado || '',
            detalle: mov.detalle || ''
          });
        };

        // 3. Iterar por equipo para premios y jugadores
        for (let idx = 0; idx < tabla.length; idx++) {
          const tEq = tabla[idx];
          const P = idx + 1;
          const equipo = equipos.find(e => (e._id?.$oid ?? e._id?.toString()) === (tEq.id?.$oid ?? tEq.id?.toString()));
          if (!equipo) continue;

          const equipoId = equipo._id?.$oid ?? equipo._id?.toString();
          const escudoB64 = getShieldB64(equipo.escudo);

          // ── A. Premios Económicos ──────────────────────────────────────
          const premioPuesto = 1000000 + ((N - P) / (N - 1)) * 2000000;
          const premioVictorias = tEq.v * 250000;
          const totalPremios = Math.round(premioPuesto + premioVictorias);
          
          equipo.dinero = (equipo.dinero || 0) + totalPremios;

          dataPremios.push({
            equipo: equipo.nombre,
            escudoB64,
            puesto: P,
            premioPuesto,
            premioVictorias,
            victorias: tEq.v,
            total: totalPremios,
            dineroFinal: equipo.dinero,
          });

          // Se agregan los premios al dinero del equipo (ya hecho arriba), 
          // pero no se registran en el libro de traspasos por petición del usuario.

          // ── B. Progresión y Contratos ──────────────────────────────────
          const deltaMediaPuesto = -2 + ((N - P) / (N - 1)) * 4;
          const clubMovimientos = [];
          const clubProgresion = [];

          // Progresión del Coach
          if (equipo.coach?.media != null) {
            const mediaAntes = equipo.coach.media;
            // El coach siempre recibe progresión por puesto
            let partidosCoach = 0;
            liga.fechas.forEach(f => (f.partidos ?? f.encuentros).forEach(partido => {
              if (partido.duelosIndividuales) {
                const ids = partido.duelosIndividuales.map(d => [d.localJugadorId, d.visitanteJugadorId]).flat();
                if (ids.includes(equipo.coach.id)) partidosCoach++;
              }
            }));
            const clasificoCoach = partidosCoach >= (totalPartidosTemporada / 2);
            if (clasificoCoach) {
              equipo.coach.media = Math.round((equipo.coach.media + deltaMediaPuesto) * 100) / 100;
            }
            clubProgresion.push({
              nombre: equipo.coach.nombre,
              rol: 'DT',
              mediaAntes,
              mediaDespues: equipo.coach.media,
              delta: equipo.coach.media - mediaAntes,
              clasifico: clasificoCoach,
            });
          }

          // Progresión de Jugadores
          for (let jIdx = equipo.jugadores.length - 1; jIdx >= 0; jIdx--) {
            const j = equipo.jugadores[jIdx];
            const mediaAntes = j.media;
            
            // Contar partidos jugados
            let partidosJugados = 0;
            liga.fechas.forEach(f => (f.partidos ?? f.encuentros).forEach(partido => {
              if (partido.duelosIndividuales) {
                const ids = partido.duelosIndividuales.map(d => [d.localJugadorId, d.visitanteJugadorId]).flat();
                if (ids.includes(j.id)) partidosJugados++;
              }
            }));

            const clasifico = partidosJugados >= (totalPartidosTemporada / 2);
            if (clasifico) {
              j.media = Math.round((j.media + deltaMediaPuesto) * 100) / 100;
            }

            clubProgresion.push({
              nombre: j.nombre,
              rol: 'JUG',
              mediaAntes,
              mediaDespues: j.media,
              delta: j.media - mediaAntes,
              clasifico,
            });

            // Contrato
            j.contrato = (j.contrato || 1) - 1;

            // Vencimientos
            if (j.contrato <= 0) {
              const jugadorData = equipo.jugadores.splice(jIdx, 1)[0];
              
              if (jugadorData.prestadoDe?.equipoId) {
                // Devolver a equipo original
                const original = equipos.find(e => (e._id?.$oid ?? e._id?.toString()) === jugadorData.prestadoDe.equipoId);
                if (original) {
                  const devuelto = { ...jugadorData };
                  delete devuelto.prestadoDe;
                  devuelto.contrato = jugadorData.prestadoDe.contratoOriginal || 1;
                  original.jugadores.push(devuelto);
                  await ensureUserRegistered(devuelto.id, client);
                  
                  // Alta en el club original
                  pushMovimiento(original, {
                    tipo: 'Alta', 
                    jugador: devuelto.nombre, 
                    jugadorId: devuelto.id, 
                    equipoRelacionado: equipo.nombre,
                    detalle: `Regreso de préstamo`
                  });

                  // Baja en el club actual
                  pushMovimiento(equipo, {
                    tipo: 'Baja',
                    jugador: jugadorData.nombre,
                    jugadorId: jugadorData.id,
                    equipoRelacionado: original.nombre,
                    detalle: 'Fin de préstamo'
                  });

                  clubMovimientos.push({ tipo: 'Baja', jugador: jugadorData.nombre, detalle: `Fin de préstamo → ${original.nombre}` });
                }
              } else {
                // A Agentes Libres
                await JugadorLibre.create({
                  nombre: jugadorData.nombre,
                  id: jugadorData.id,
                  media: jugadorData.media,
                  mediaInicial: jugadorData.mediaInicial || jugadorData.media,
                  stats: jugadorData.stats,
                  exEquipo: equipo.nombre
                });

                pushMovimiento(equipo, {
                  tipo: 'Baja', 
                  jugador: jugadorData.nombre, 
                  jugadorId: jugadorData.id, 
                  equipoRelacionado: 'Agente Libre',
                  detalle: 'Vencimiento de contrato'
                });

                clubMovimientos.push({ tipo: 'Baja', jugador: jugadorData.nombre, detalle: 'Vencimiento de contrato → Agente Libre' });
              }
            }
          }

          await equipo.save();

          dataMovimientos.push({ equipo: equipo.nombre, escudoB64, items: clubMovimientos });
          dataProgresion.push({ equipo: equipo.nombre, escudoB64, personas: clubProgresion });
        }

        // 4. Finalizar Temporada
        liga.actual = false;
        liga.fechaFin = Date.now();
        await liga.save();

        // ── 5. Generar las 4 imágenes ────────────────────────────────────
        await i.editReply({ content: '🎨 Generando resumen visual...' });

        const tablaConEscudos = tabla.map(t => ({
          ...t,
          escudoB64: getShieldB64(t.escudo),
          pj: t.pJ, pg: t.v, pp: t.p,
        }));

        const campeonData = tablaConEscudos[0];

        const [img1, img2, img3, img4] = await Promise.all([
          generarPaginaCampeonYTabla({
            campeon: { nombre: campeonData.nombre, escudoB64: campeonData.escudoB64, pts: campeonData.pts, v: campeonData.v },
            tabla: tablaConEscudos,
            temporada: liga.temporada,
          }),
          generarPaginaMovimientos({ movimientos: dataMovimientos, temporada: liga.temporada }),
          generarPaginaPremios({ premios: dataPremios, temporada: liga.temporada }),
          generarPaginaProgresion({ progresion: dataProgresion, temporada: liga.temporada }),
        ]);

        const attachments = [
          new AttachmentBuilder(img1, { name: 'campeon_tabla.png' }),
          new AttachmentBuilder(img2, { name: 'movimientos.png' }),
          new AttachmentBuilder(img3, { name: 'premios.png' }),
          new AttachmentBuilder(img4, { name: 'progresion.png' }),
        ];

        await i.editReply({
          content: `✅ **${liga.temporada} — Finalizada**\n🏆 Campeón: **${campeonData.nombre}**`,
          files: attachments,
        });
      } catch (err) {
        console.error(err);
        await i.editReply({ content: '❌ Hubo un error al procesar el cierre. Revisa la consola.' });
      }
      coll.stop();
    });
  }
};
