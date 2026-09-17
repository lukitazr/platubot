import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  StringSelectMenuBuilder,
  AttachmentBuilder
} from 'discord.js';
import EquipoSuperliga from '../../models/superliga/Equipos.js';
import Superliga from '../../models/superliga/Superliga.js';
import buscarEquipo from '../../utils/db/buscarEquipo.js';
import { calcularSalario, calcularValorJugador } from '../../utils/db/mediaCalculator.js';
import path from 'path';
import { generarImagenPlantilla, generarImagenStatsTemporada, generarImagenEconomia, generarImagenHistorial, generarImagenTraspasos } from '../../utils/visual/equipoInfoGenerator.js';
import { generarCarta } from '../../utils/visual/cardGenerator.js';
import fs from 'fs';
import { ensureUserRegistered } from '../../utils/db/userResolver.js';

// Helper para formatear moneda (k para miles, M para millones)
const formatCurrency = (num) => {
    if (Math.abs(num) >= 1_000_000) {
        return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (Math.abs(num) >= 1_000) {
        return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return num.toString();
};

export default {
  name: 'superliga-equipo',
  aliases: ['sl-equipo', 'sle'],
  desc: 'Gestión de equipos de la Superliga',
  // permisos: ['Administrator'], // Eliminado para permitir 'info' público

  run: async (client, message, args) => {
    const subcomando = args[0]?.toLowerCase();
    const isAdmin = message.member.permissions.has('Administrator');

    if (subcomando === 'crear') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_crear_equipo_modal')
          .setLabel('📝 Abrir Formulario de Creación')
          .setStyle(ButtonStyle.Success)
      );

      return message.reply({
        content: 'Haz clic en el botón para comenzar la creación del equipo.',
        components: [row]
      });
    }

    if (subcomando === 'agregar') {
      if (!isAdmin) return message.reply('❌ No tienes permisos para usar este subcomando.');
      const mentionIndex = args.findIndex(arg => arg.startsWith('<@') && arg.endsWith('>'));
      const query = mentionIndex !== -1 ? args.slice(1, mentionIndex).join(' ') : args[1];
      const userMention = message.mentions.users.first() || (mentionIndex !== -1 ? { id: args[mentionIndex].replace(/[<@!>]/g, '') } : null);

      if (!query || !userMention?.id) {
        return message.reply('❌ Uso: `!superliga-equipo agregar <nombre_equipo> <@usuario>`');
      }

      const resultado = await buscarEquipo(query, EquipoSuperliga);
      if (typeof resultado === 'string') return message.reply(resultado);
      const equipo = resultado;

      if (equipo.jugadores.length >= 3) {
        return message.reply(`❌ El equipo **${equipo.nombre}** ya tiene el máximo de 3 jugadores.`);
      }

      const yaEsta = equipo.jugadores.find(j => j.id === userMention.id);
      if (yaEsta) return message.reply(`❌ El jugador ya está en el equipo **${equipo.nombre}**.`);

      const targetUser = message.mentions.users.first() || await client.users.fetch(userMention.id).catch(() => null);
      await ensureUserRegistered(targetUser || userMention.id, client);
      
      const nuevoJugador = {
        nombre: targetUser?.username || 'Desconocido',
        id: userMention.id,
        pais: 'Argentina',
        media: 80
      };

      equipo.jugadores.push(nuevoJugador);

      if (!equipo.libroTraspasos) equipo.libroTraspasos = [];
      equipo.libroTraspasos.push({
          tipo: 'Alta',
          jugador: nuevoJugador.nombre,
          fecha: new Date(),
          monto: 0,
          equipoRelacionado: 'Agente Libre'
      });

      await equipo.save();

      return message.reply(`✅ Jugador **${nuevoJugador.nombre}** agregado a **${equipo.nombre}**.`);
    }

    if (subcomando === 'asignar') {
      if (!isAdmin) return message.reply('❌ No tienes permisos para usar este subcomando.');
      const tipo = args[1]?.toLowerCase();
      const userMention = message.mentions.users.first();

      if (!['media', 'pais', 'stats', 'contrato', 'clausula'].includes(tipo)) {
          return message.reply('❌ Uso: `!superliga-equipo asignar <media|pais|stats|contrato|clausula> <@usuario> [valores...]`');
      }
      if (!userMention) {
          return message.reply(`❌ Debes mencionar a un usuario. Uso: \`!superliga-equipo asignar ${tipo} <@usuario> [valores...]\``);
      }

      const filteredArgs = args.slice(2).filter(a => !a.includes(userMention.id));

      const equipos = await EquipoSuperliga.find({});
      let j = null;
      let eqEncontrado = null;

      for (const eq of equipos) {
          if (eq.coach?.id === userMention.id) {
              j = eq.coach;
              eqEncontrado = eq;
              break;
          }
          const found = eq.jugadores.find(jug => jug.id === userMention.id);
          if (found) {
              j = found;
              eqEncontrado = eq;
              break;
          }
      }

      if (!j) {
          return message.reply('❌ Ese usuario no pertenece a ningún equipo de Superliga registrado.');
      }

      let newValueMsg = '';

      if (tipo === 'media') {
          if (filteredArgs.length < 1) return message.reply('❌ Uso: `!superliga-equipo asignar media <@usuario> <media>`');
          const mediaNum = parseInt(filteredArgs[0]);
          if (isNaN(mediaNum) || mediaNum < 1 || mediaNum > 99) return message.reply('❌ La media debe ser un número válido entre 1 y 99.');
          j.media = mediaNum;
          newValueMsg = `⭐ Nueva Media: \`${mediaNum}\``;
      } else if (tipo === 'pais') {
          if (filteredArgs.length < 1) return message.reply('❌ Uso: `!superliga-equipo asignar pais <@usuario> <pais>`');
          const paisStr = filteredArgs.join(' ').trim();
          j.pais = paisStr;
          newValueMsg = `🌍 País: \`${paisStr}\``;
      } else if (tipo === 'stats') {
          if (filteredArgs.length < 6) return message.reply('❌ Uso: `!superliga-equipo asignar stats <@usuario> <ACT> <TIR> <PAS> <IQ> <AUR> <ESQ>`');
          const statsArr = filteredArgs.slice(0, 6).map(Number);
          if (statsArr.some(isNaN)) return message.reply('❌ Todos los valores de stats deben ser numéricos.');
          j.stats = {
              actividad: statsArr[0],
              tiro: statsArr[1],
              pase: statsArr[2],
              iq: statsArr[3],
              aura: statsArr[4],
              esquinazo: statsArr[5]
          };
          newValueMsg = `📊 Stats Actualizadas: \`ACT:${statsArr[0]} TIR:${statsArr[1]} PAS:${statsArr[2]} IQ:${statsArr[3]} AUR:${statsArr[4]} ESQ:${statsArr[5]}\``;
      } else if (tipo === 'contrato') {
          if (filteredArgs.length < 1) return message.reply('❌ Uso: `!superliga-equipo asignar contrato <@usuario> <temporadas>`');
          const temps = parseInt(filteredArgs[0]);
          if (isNaN(temps) || temps < 1) return message.reply('❌ El contrato debe ser de 1 temporada o más.');
          j.contrato = temps;
          newValueMsg = `📄 Contrato: \`${temps} Temporadas\``;
      } else if (tipo === 'clausula') {
          if (filteredArgs.length < 1) return message.reply('❌ Uso: `!superliga-equipo asignar clausula <@usuario> <dinero|partidos|objetivo|ninguna> [valor]`');
          const tipoClau = filteredArgs[0].toLowerCase();
          if (!['dinero', 'partidos', 'objetivo', 'ninguna'].includes(tipoClau)) return message.reply('❌ Tipos válidos: `dinero`, `partidos`, `objetivo`, `ninguna`');
          
          let valorClau = '';
          if (tipoClau !== 'ninguna') {
              if (filteredArgs.length < 2) return message.reply(`❌ Debes especificar un valor para la cláusula de tipo **${tipoClau}**.`);
              valorClau = filteredArgs.slice(1).join(' ').trim();
              
              if (tipoClau === 'dinero') {
                  const upperVal = valorClau.toUpperCase();
                  let multiplier = 1;
                  let numStr = upperVal;
                  if (upperVal.endsWith('M')) { multiplier = 1000000; numStr = upperVal.slice(0, -1); }
                  else if (upperVal.endsWith('K')) { multiplier = 1000; numStr = upperVal.slice(0, -1); }
                  
                  const val = parseFloat(numStr.replace(',', '.'));
                  if (isNaN(val)) return message.reply('❌ El valor de dinero debe ser numérico (ej: 1M, 500k, 1000000).');
                  valorClau = (val * multiplier).toString();
              } else if (tipoClau === 'partidos') {
                  if (isNaN(parseInt(valorClau))) return message.reply('❌ El valor para partidos debe ser numérico.');
                  valorClau = parseInt(valorClau).toString();
              }
          }
          
          j.clausula = { tipo: tipoClau, valor: valorClau };
          newValueMsg = `🔒 Cláusula: \`${tipoClau.toUpperCase()} ${valorClau}\``;
      }

      j.carta = ''; // Limpiamos la carta cacheada para obligar a regenerar la gráfica con las nuevas stats/media
      await eqEncontrado.save();

      return message.reply(`✅ Jugador actualizado en **${eqEncontrado.nombre}**.\n${newValueMsg}`);
    }

    if (subcomando === 'listar') {
      const equipos = await EquipoSuperliga.find({});
      if (!equipos.length) return message.reply('❌ No hay equipos registrados.');

      const embed = new EmbedBuilder()
        .setTitle('🏆 Equipos de la Superliga')
        .setColor('#0099ff')
        .setDescription(equipos.map(e => `• **${e.nombre}** - Coach: ${e.coach.nombre} (${e.jugadores.length}/3 jugadores)`).join('\n'));

      return message.reply({ embeds: [embed] });
    }

    if (subcomando === 'info') {
      const query = args.slice(1).join(' ');
      if (!query) return message.reply('❌ Uso: `!superliga-equipo info <nombre_equipo>`');

      const resultado = await buscarEquipo(query, EquipoSuperliga);
      if (typeof resultado === 'string') return message.reply(resultado);
      const equipo = resultado;

      const msg = await message.reply('<a:loading:1461897825439711468> Generando visuales del equipo, por favor espera...');
      
      try {
          const fetchAvatar = async (id) => {
              try {
                  const u = await client.users.fetch(id, { force: true });
                  return u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 }) || null;
              } catch { return null; }
          };

          const buffersPlantilla = [];
          const integrantes = [equipo.coach, ...equipo.jugadores];
          let equipoModificado = false;

          for (const mem of integrantes) {
              // Generar y guardar stats si no existen
              const m = mem.mediaInicial || mem.media || 80;
              if (!mem.stats || Object.keys(mem.stats).length < 6) {
                  const { generarStatsAleatorias } = await import('../../utils/visual/cardGenerator.js');
                  mem.stats = generarStatsAleatorias(m);
                  equipoModificado = true;
              }

              let buffer = null;
              if (mem.carta) {
                  const pth = path.join(process.cwd(), mem.carta);
                  if (fs.existsSync(pth)) {
                      try { buffer = fs.readFileSync(pth); } catch {}
                  }
              }
              if (!buffer) {
                  const avatar = await fetchAvatar(mem.id);
                  const data = {
                      nombre: mem.nombre,
                      id: mem.id,
                      avatar,
                      media: mem.media || 80,
                      mediaInicial: mem.mediaInicial || mem.media || 80,
                      pais: mem.pais || 'Argentina',
                      escudo: equipo.escudo,
                      esCoach: mem === equipo.coach,
                      stats: mem.stats
                  };
                  buffer = await generarCarta(data);
              }
              buffersPlantilla.push(buffer);
          }

          if (equipoModificado) {
              await equipo.save();
          }

          const imgPlantilla = await generarImagenPlantilla(equipo.nombre, equipo.escudo, buffersPlantilla);
          const attachPlantilla = new AttachmentBuilder(imgPlantilla, { name: 'plantilla.png' });

          const options = [
              { label: 'Plantilla', description: 'Ver las cartas de la plantilla actual', value: 'plantilla', emoji: '👥' },
              { label: 'Temporada Actual', description: 'Rendimiento en la liga en curso', value: 'temporada', emoji: '📊' },
              { label: 'Economía', description: 'Finanzas y evolución de valor', value: 'economia', emoji: '💰' }
          ];

          if (equipo.historialJugadores && Object.keys(equipo.historialJugadores).length > 0) {
              options.push({ label: 'Historial de Plantillas', description: 'Jugadores históricos del club', value: 'historial', emoji: '📜' });
          }
          if (equipo.libroTraspasos && equipo.libroTraspasos.length > 0) {
              options.push({ label: 'Libro de Traspasos', description: 'Últimos movimientos del mercado', value: 'traspasos', emoji: '🤝' });
          }

          const menuRow = new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                  .setCustomId('select_equipo_info')
                  .setPlaceholder('Selecciona una categoría...')
                  .addOptions(options)
          );

          await msg.edit({ content: '', files: [attachPlantilla], components: [menuRow] });

          const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 300000 });
          const imageCache = { plantilla: attachPlantilla };

          collector.on('collect', async (i) => {
              if (i.user.id !== message.author.id) return i.reply({ content: '❌ Solo quien pidió la info puede usar el menú.', ephemeral: true });
              
              await i.deferUpdate();
              const value = i.values[0];

              if (imageCache[value]) {
                  return i.editReply({ files: [imageCache[value]] });
              }

              let newAttach;
              if (value === 'temporada') {
                  const ligaActual = await Superliga.findOne({ actual: true });
                  let pj = 0, pg = 0, pp = 0, gf = 0, gc = 0, pts = 0;
                  if (ligaActual) {
                      const equipoId = equipo._id?.$oid ?? equipo._id;
                      const eqNombre = equipo.nombre;
                      ligaActual.fechas.forEach(f => {
                        const enc = f.partidos ?? f.encuentros;
                        enc.forEach(p => {
                              if (!p.finalizado) return;
                              if (p.localId === equipoId || p.visitanteId === equipoId || p.localNombre === eqNombre || p.visitanteNombre === eqNombre) {
                                  const esLocal = (p.localId === equipoId || p.localNombre === eqNombre);
                                  pj++;
                                  gf += esLocal ? p.golesTotalLocal : p.golesTotalVisitante;
                                  gc += esLocal ? p.golesTotalVisitante : p.golesTotalLocal;
                                  
                                  let pml = p.puntosMiniLocal ?? 0;
                                  let pmv = p.puntosMiniVisitante ?? 0;
                                  
                                  // Fallback si no hay puntosMiniLocal guardados
                                  const duelos = p.duelosIndividuales || p.miniPartidos;
                                  if (pml === 0 && pmv === 0 && duelos) {
                                      duelos.forEach(mp => {
                                          if (mp.finalizado) {
                                              if (mp.golesLocal > mp.golesVisitante) pml++;
                                              else if (mp.golesVisitante > mp.golesLocal) pmv++;
                                          }
                                      });
                                  }

                                  if (pml > pmv) { if (esLocal) { pg++; pts += 3; } else pp++; }
                                  else if (pmv > pml) { if (!esLocal) { pg++; pts += 3; } else pp++; }
                              }
                          });
                      });
                  }
                  const img = await generarImagenStatsTemporada(equipo.nombre, equipo.escudo, { pj, pg, pp, gf, gc, pts });
                  newAttach = new AttachmentBuilder(img, { name: 'temporada.png' });
              } 
              else if (value === 'economia') {
                  let totalSalarios = 0;
                  const playersData = await Promise.all(equipo.jugadores.map(async j => {
                      const media = j.media || 80;
                      const mediaIni = j.mediaInicial || media;
                      const valA = calcularValorJugador(media);
                      const valI = calcularValorJugador(mediaIni);
                      const salA = calcularSalario(media);
                      const salI = calcularSalario(mediaIni);
                      totalSalarios += salA;
                      let avatarUrl = null;
                      try {
                          const u = await client.users.fetch(j.id, { force: false });
                          avatarUrl = u.displayAvatarURL({ extension: 'png', forceStatic: true, size: 64 });
                      } catch {}
                      return { 
                          nombre: j.nombre,
                          avatarUrl,
                          valAStr: formatCurrency(valA), 
                          valIStr: formatCurrency(valI),
                          salAStr: formatCurrency(salA),
                          salIStr: formatCurrency(salI),
                          media, 
                          mediaIni 
                      };
                  }));

                  // --- NUEVO: Proyecciones de Fin de Temporada ---
                  let proyeccionVictorias = 0;
                  let proyeccionPremioLiga = 0;
                  let posicionActual = 0;
                  let totalEquipos = 0;

                  const SuperligaModel = (await import('../../models/superliga/Superliga.js')).default;
                  const ligaActiva = await SuperligaModel.findOne({ actual: true });
                  if (ligaActiva) {
                      // 1. Calcular victorias acumuladas en esta temporada
                      let victoriasTemporada = 0;
                      const eqId = equipo._id?.$oid ?? equipo._id;
                      ligaActiva.fechas.forEach(f => {
                          const enc = f.encuentros ?? f.partidos;
                          if (!enc) return;
                          enc.forEach(p => {
                              if (!p.finalizado) return;
                              // Superliga usa resultado.golesLocal/Visitante; SSC usa puntosMiniLocal/Visitante
                              const pml = p.resultado?.golesLocal ?? p.puntosMiniLocal ?? 0;
                              const pmv = p.resultado?.golesVisitante ?? p.puntosMiniVisitante ?? 0;
                              const localNombre = p.local?.nombre ?? p.localNombre;
                              const visitanteNombre = p.visitante?.nombre ?? p.visitanteNombre;
                              const esLocal = (p.localId === eqId || localNombre === equipo.nombre);
                              if (esLocal && pml > pmv) victoriasTemporada++;
                              else if (!esLocal && visitanteNombre === equipo.nombre && pmv > pml) victoriasTemporada++;
                          });
                      });
                      proyeccionVictorias = victoriasTemporada * 250000;

                      // 2. Calcular premio por posición proyectada
                      const allEquipos = await EquipoSuperliga.find({});
                      totalEquipos = allEquipos.length;
                      
                      // Calcular tabla resumida para saber posición
                      const tablaPos = allEquipos.map(e => {
                          const id = e._id?.$oid ?? e._id;
                          let pts = 0;
                          ligaActiva.fechas.forEach(f => {
                              const enc = f.encuentros ?? f.partidos;
                              if (!enc) return;
                              enc.forEach(p => {
                                  if (!p.finalizado) return;
                                  const pml = p.resultado?.golesLocal ?? p.puntosMiniLocal ?? 0;
                                  const pmv = p.resultado?.golesVisitante ?? p.puntosMiniVisitante ?? 0;
                                  const localNombre = p.local?.nombre ?? p.localNombre;
                                  const visitanteNombre = p.visitante?.nombre ?? p.visitanteNombre;
                                  if (localNombre === e.nombre) {
                                      if (pml > pmv) pts += 3;
                                      else if (pml === pmv) pts += 1;
                                  } else if (visitanteNombre === e.nombre) {
                                      if (pmv > pml) pts += 3;
                                      else if (pml === pmv) pts += 1;
                                  }
                              });
                          });
                          return { id, pts };
                      }).sort((a, b) => b.pts - a.pts);

                      posicionActual = tablaPos.findIndex(t => t.id === eqId) + 1;
                      if (posicionActual > 0 && totalEquipos > 1) {
                          const P = posicionActual;
                          const N = totalEquipos;
                          proyeccionPremioLiga = 1000000 + ((N - P) / (N - 1)) * 2000000;
                      }
                  }

                  const dinero = equipo.dinero || 0;
                  // Los ingresos totales ahora incluyen las proyecciones
                  const ingresosBase = (equipo.ingresosPartidos || 0) + (equipo.ingresosPosicion || 0);
                  const ingresosTotales = ingresosBase + proyeccionVictorias + proyeccionPremioLiga;
                  
                  const balance = ingresosTotales - totalSalarios;
                  const proyeccion = dinero + balance;

                  const ecoData = {
                      dineroStr: formatCurrency(dinero),
                      ingresosStr: formatCurrency(ingresosTotales),
                      salariosStr: formatCurrency(totalSalarios),
                      balance,
                      balanceStr: formatCurrency(balance),
                      proyeccion,
                      proyeccionStr: formatCurrency(proyeccion),
                      proyeccionVictoriasStr: formatCurrency(proyeccionVictorias),
                      proyeccionPremioLigaStr: formatCurrency(proyeccionPremioLiga),
                      posicionActual,
                      players: playersData
                  };
                  const img = await generarImagenEconomia(equipo.nombre, equipo.escudo, ecoData);
                  newAttach = new AttachmentBuilder(img, { name: 'economia.png' });
              }
              else if (value === 'historial') {
                  const currentIds = equipo.jugadores.map(j => j.id);
                  currentIds.push(equipo.coach.id);

                  let historicPlayers = [];
                  Object.keys(equipo.historialJugadores || {}).forEach(tempStr => {
                      equipo.historialJugadores[tempStr].forEach(hj => {
                          if (!currentIds.includes(hj.id)) {
                              let exist = historicPlayers.find(p => p.id === hj.id);
                              if (exist) {
                                  if (!exist.temporadas.includes(tempStr)) exist.temporadas.push(tempStr);
                              } else {
                                  historicPlayers.push({ ...hj, temporadas: [tempStr] });
                              }
                          }
                      });
                  });
                  
                  historicPlayers = historicPlayers.slice(-8);

                  const buffers = [];
                  const labels = [];
                  for (const hp of historicPlayers) {
                      let buffer = null;
                      if (hp.carta) {
                          const pth = path.join(process.cwd(), hp.carta);
                          if (fs.existsSync(pth)) {
                              try { buffer = fs.readFileSync(pth); } catch {}
                          }
                      }
                      if (!buffer) {
                          const avatar = await fetchAvatar(hp.id);
                          const data = {
                              nombre: hp.nombre,
                              id: hp.id,
                              avatar,
                              media: hp.media || 80,
                              mediaInicial: hp.media || 80,
                              pais: hp.pais || 'Argentina',
                              escudo: 'assets/equipos/vacio.png', 
                              esCoach: false,
                              stats: null
                          };
                          buffer = await generarCarta(data);
                      }
                      buffers.push(buffer);
                      labels.push(`Temp: ${hp.temporadas.join(', ')}`);
                  }

                  const img = await generarImagenHistorial(equipo.nombre, equipo.escudo, buffers, labels);
                  newAttach = new AttachmentBuilder(img, { name: 'historial.png' });
              }
              else if (value === 'traspasos') {
                  const traspasosList = equipo.libroTraspasos.slice(-8).reverse();
                  const todosEquipos = await EquipoSuperliga.find({});
                  const mapEscudos = {};
                  todosEquipos.forEach(e => mapEscudos[e.nombre] = e.escudo);

                  const tData = await Promise.all(traspasosList.map(async t => {
                      let avatarJug = null;
                      try {
                          // Intentar por ID si existe, sino por búsqueda de nombre en integrantes
                          const targetId = t.jugadorId || todosEquipos.find(e => e.jugadores.some(j => j.nombre === t.jugador))?.jugadores.find(j => j.nombre === t.jugador)?.id;
                          if (targetId) {
                              const u = await client.users.fetch(targetId, { force: false }).catch(() => null);
                              avatarJug = u?.displayAvatarURL({ extension: 'png', forceStatic: true, size: 128 });
                          }
                      } catch {}
                      
                      return {
                          tipo: t.tipo,
                          jugadorNombre: t.jugador,
                          avatarJugador: avatarJug,
                          fechaStr: new Date(t.fecha).toLocaleDateString('es-AR'),
                          montoStr: formatCurrency(t.monto || 0),
                          equipoRelacionado: t.equipoRelacionado,
                          escudoRelacionado: mapEscudos[t.equipoRelacionado] || null
                      };
                  }));

                  const img = await generarImagenTraspasos(equipo.nombre, equipo.escudo, tData);
                  newAttach = new AttachmentBuilder(img, { name: 'traspasos.png' });
              }

              imageCache[value] = newAttach;
              await i.editReply({ files: [newAttach] });
          });

          collector.on('end', () => {
              msg.edit({ components: [] }).catch(() => {});
          });

      } catch (err) {
          console.error("Error visual equipo:", err);
          return msg.edit('❌ Hubo un error generando las visuales del equipo.').catch(()=>{});
      }
      return;
    }

    return message.reply('❌ Subcomandos disponibles: `crear`, `agregar`, `asignar`, `listar`, `info`');
  }
};
