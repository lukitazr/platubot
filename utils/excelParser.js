import '../database/polyfill.js';
import * as XLSX from 'xlsx';
import Jugador from '../models/Jugador.js';
import Primera from '../models/Primera.js';
import Coppa from '../models/copas/Coppa.js';
import { normalizeTitulos, awardTitle } from './torneos/titulosHelper.js';

export function slugifyName(name) {
  if (!name) return 'jugador_desconocido';
  return String(name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Parsea los goles y determina el estado del partido a partir de las celdas de resultado.
 */
function parseScoreValues(glCell, gvCell) {
  const glClean = String(glCell || '').replace(/\u00A0/g, ' ').trim();
  const gvClean = String(gvCell || '').replace(/\u00A0/g, ' ').trim();
  const glUpper = glClean.toUpperCase();
  const gvUpper = gvClean.toUpperCase();

  // 1. Verificar si la primera celda contiene el resultado combinado (ej. "5 - 1", "5:1", "X - X", "3-0")
  const combinedMatch = glClean.match(/^(\d+|X|W\.?O\.?)[\s:-]+(\d+|X|W\.?O\.?)$/i);
  if (combinedMatch && !gvClean) {
    const s1 = combinedMatch[1].toUpperCase();
    const s2 = combinedMatch[2].toUpperCase();

    if (s1 === 'X' || s2 === 'X' || s1.includes('WO') || s2.includes('WO')) {
      return { finalizado: true, isDoubleWO: true, isWO: false, golesLocal: 0, golesVisitante: 0 };
    }
    const n1 = parseInt(s1, 10);
    const n2 = parseInt(s2, 10);
    if (!isNaN(n1) && !isNaN(n2)) {
      const isWO = (n1 === 3 && n2 === 0) || (n1 === 0 && n2 === 3);
      const isDoubleWO = n1 === 0 && n2 === 0;
      return { finalizado: true, isDoubleWO, isWO, golesLocal: n1, golesVisitante: n2 };
    }
  }

  // 2. Celdas separadas
  const isBothEmpty = glClean === '' && gvClean === '';
  const hasX = glUpper === 'X' || gvUpper === 'X' || glUpper.includes('WO') || gvUpper.includes('WO');

  const glNum = parseInt(glClean, 10);
  const gvNum = parseInt(gvClean, 10);
  const isBothZero = !isNaN(glNum) && !isNaN(gvNum) && glNum === 0 && gvNum === 0;

  if (hasX || isBothEmpty || isBothZero) {
    return { finalizado: true, isDoubleWO: true, isWO: false, golesLocal: 0, golesVisitante: 0 };
  }

  if (!isNaN(glNum) && !isNaN(gvNum)) {
    const isWO = (glNum === 3 && gvNum === 0) || (glNum === 0 && gvNum === 3);
    return { finalizado: true, isDoubleWO: false, isWO, golesLocal: glNum, golesVisitante: gvNum };
  }

  // Partido pendiente o no finalizado
  return { finalizado: false, isDoubleWO: false, isWO: false, golesLocal: null, golesVisitante: null };
}

/**
 * Escanea una hoja de cálculo y extrae partidos estructurados por fecha.
 */
export function extractFechasFromSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!matrix || !matrix.length) return { leagueTitle: null, fechas: [] };

  let leagueTitle = null;

  // Buscar título de la liga en las primeras 5 filas
  for (let r = 0; r < Math.min(5, matrix.length); r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      const cellVal = String(matrix[r][c] || '').replace(/\u00A0/g, ' ').trim();
      if (cellVal.toLowerCase().includes('superliga') || cellVal.toLowerCase().includes('liga') || cellVal.toLowerCase().includes('league')) {
        leagueTitle = cellVal;
        break;
      }
    }
    if (leagueTitle) break;
  }

  const fechaHeaderMap = new Map(); // fechaNum -> { row, col }

  // Encontrar todas las celdas que sean cabeceras de fecha F1, F2... o Fecha 1, Fecha 2...
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').replace(/\u00A0/g, ' ').trim();
      const match = cell.match(/^(?:F|Fecha|Ronda)[\s:-]*(\d+)/i);
      if (match) {
        const fechaNum = parseInt(match[1], 10);
        if (!fechaHeaderMap.has(fechaNum)) {
          fechaHeaderMap.set(fechaNum, { row: r, col: c });
        }
      }
    }
  }

  const sortedFechaNums = Array.from(fechaHeaderMap.keys()).sort((a, b) => a - b);
  const fechas = [];

  for (const fechaNum of sortedFechaNums) {
    const { row: startRow, col: startCol } = fechaHeaderMap.get(fechaNum);
    const partidos = [];

    let consecutiveBlanks = 0;
    let r = startRow + 1;

    while (r < matrix.length) {
      const row = matrix[r];
      if (!row) {
        consecutiveBlanks++;
        if (consecutiveBlanks >= 2) break;
        r++;
        continue;
      }

      const col0 = String(row[startCol] || '').replace(/\u00A0/g, ' ').trim();
      const col1 = String(row[startCol + 1] || '').replace(/\u00A0/g, ' ').trim();
      const col2 = String(row[startCol + 2] || '').replace(/\u00A0/g, ' ').trim();
      const col3 = String(row[startCol + 3] || '').replace(/\u00A0/g, ' ').trim();

      // Si la fila está completamente vacía en este bloque de columnas
      if (!col0 && !col1 && !col2 && !col3) {
        consecutiveBlanks++;
        if (consecutiveBlanks >= 2) break;
        r++;
        continue;
      }

      consecutiveBlanks = 0;

      // Detener lectura si encontramos otra cabecera de Fecha o la Tabla de posiciones
      if (/^(?:F|Fecha|Ronda)[\s:-]*\d+/i.test(col0) || col0.toLowerCase().includes('tabla')) {
        break;
      }

      // Ignorar encabezados internos de columnas
      if (['jugador', 'local', 'rival', 'f', 'l/v', 'visita', 'visitante'].includes(col0.toLowerCase())) {
        r++;
        continue;
      }

      let localCell = col0;
      let visitanteCell = col3 || col2;
      let glCell = col1;
      let gvCell = col3 ? col2 : '';

      if (col3 === '' && col2 !== '' && isNaN(parseInt(col2, 10)) && col2.toUpperCase() !== 'X') {
        // Formato 3 columnas: [Local] [ResultadoCombinado] [Visitante]
        visitanteCell = col2;
        glCell = col1;
        gvCell = '';
      }

      if (localCell && visitanteCell && localCell !== visitanteCell) {
        const scoreInfo = parseScoreValues(glCell, gvCell);

        partidos.push({
          _id: `${Date.now()}_F${fechaNum}_${Math.random().toString(36).slice(2, 7)}`,
          localNombre: localCell,
          visitanteNombre: visitanteCell,
          ...scoreInfo
        });
      }

      r++;
    }

    if (partidos.length > 0) {
      fechas.push({
        numero: fechaNum,
        partidos
      });
    }
  }

  return { leagueTitle, fechas };
}

/**
 * Lee un Buffer o archivo de Excel e importa la liga procesando partido por partido
 */
export async function parseAndImportExcelLeague(excelInput, options = {}) {
  const workbook = typeof excelInput === 'string'
    ? XLSX.readFile(excelInput)
    : XLSX.read(excelInput, { type: 'buffer' });

  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    throw new Error('El archivo de Excel no contiene hojas válidas.');
  }

  const selectedSheetName = options.sheetName || sheetNames[0];
  const sheet = workbook.Sheets[selectedSheetName];
  if (!sheet) {
    throw new Error(`No se encontró la hoja "${selectedSheetName}" en el Excel.`);
  }

  const { leagueTitle: extractedTitle, fechas } = extractFechasFromSheet(sheet);
  if (!fechas.length) {
    throw new Error(`No se detectaron fechas ni partidos en la hoja "${selectedSheetName}".`);
  }

  const leagueTitle = options.nombreLiga || extractedTitle || selectedSheetName || 'Superliga Platubi (Histórica)';

  // Manejo de jugadores a ignorar
  const rawIgnored = options.ignorar || options.ignoredPlayers || options.jugadoresIgnorar || [];
  const ignoredList = (Array.isArray(rawIgnored) ? rawIgnored : String(rawIgnored).split(/[,;\n]+/))
    .map(s => s.trim())
    .filter(Boolean);

  const isPlayerIgnored = (nameOrId) => {
    if (!nameOrId || !ignoredList.length) return false;
    const clean = String(nameOrId).trim().toLowerCase();
    const slug = slugifyName(nameOrId);
    return ignoredList.some(ig => {
      const igClean = ig.trim().toLowerCase();
      const igSlug = slugifyName(ig);
      return clean === igClean || slug === igSlug;
    });
  };

  // 1. Filtrar partidos que involucren a un jugador ignorado
  let totalPartidosIgnorados = 0;
  const filteredFechas = [];

  for (const fecha of fechas) {
    const validPartidos = [];
    for (const p of fecha.partidos) {
      if (isPlayerIgnored(p.localNombre) || isPlayerIgnored(p.visitanteNombre)) {
        totalPartidosIgnorados++;
        continue;
      }
      validPartidos.push(p);
    }
    if (validPartidos.length > 0) {
      filteredFechas.push({
        ...fecha,
        partidos: validPartidos
      });
    }
  }

  // 2. Recopilar todos los participantes únicos de los partidos válidos
  const uniquePlayerNames = new Set();
  for (const fecha of filteredFechas) {
    for (const p of fecha.partidos) {
      if (p.localNombre && !isPlayerIgnored(p.localNombre)) uniquePlayerNames.add(p.localNombre.trim());
      if (p.visitanteNombre && !isPlayerIgnored(p.visitanteNombre)) uniquePlayerNames.add(p.visitanteNombre.trim());
    }
  }

  const allDbPlayers = await Jugador.find({}).catch(() => []);
  const playerMap = new Map(); // nombreNormalizado -> JugadorDoc

  for (const rawName of uniquePlayerNames) {
    const norm = rawName.toLowerCase().trim();
    let playerDoc = allDbPlayers.find(p => p.nombre.toLowerCase().trim() === norm);

    if (!playerDoc) {
      const customId = slugifyName(rawName);
      // Crear nuevo jugador en MongoDB con id = <nombre_normalizado>
      playerDoc = await Jugador.create({
        id: customId,
        nombre: rawName,
        ligaActual: 'Sin Liga',
        titulos: { oficiales: [], amistosos: [] },
        partidosGanadosHistorico: 0,
        partidosPerdidosHistorico: 0,
        woHistorico: 0,
        golesAFavorHistorico: 0,
        golesEnContraHistorico: 0,
        historial: []
      });
      allDbPlayers.push(playerDoc);
    }

    playerMap.set(norm, playerDoc);
  }

  // Asignar localId y visitanteId a cada partido válido
  for (const fecha of filteredFechas) {
    for (const p of fecha.partidos) {
      const locDoc = playerMap.get(p.localNombre.toLowerCase().trim());
      const visDoc = playerMap.get(p.visitanteNombre.toLowerCase().trim());
      p.localId = locDoc ? String(locDoc.id || locDoc._id) : slugifyName(p.localNombre);
      p.visitanteId = visDoc ? String(visDoc.id || visDoc._id) : slugifyName(p.visitanteNombre);
    }
  }

  // 3. Procesamiento encuentro por encuentro de la Tabla de la Liga, H2H y Stats Globales
  const standingsMap = new Map(); // userId -> object

  for (const rawName of uniquePlayerNames) {
    const norm = rawName.toLowerCase().trim();
    const doc = playerMap.get(norm);
    const userId = String(doc.id || doc._id);

    standingsMap.set(userId, {
      id: userId,
      nombre: doc.nombre,
      pj: 0,
      pg: 0,
      pe: 0,
      pp: 0,
      wo: 0,
      gf: 0,
      gc: 0,
      dif: 0,
      puntos: 0
    });
  }

  // Recorrer partidos fecha a fecha (solo partidos válidos no ignorados)
  for (const fecha of filteredFechas) {
    for (const p of fecha.partidos) {
      if (!p.finalizado) continue;

      const locDoc = playerMap.get(p.localNombre.toLowerCase().trim());
      const visDoc = playerMap.get(p.visitanteNombre.toLowerCase().trim());
      if (!locDoc || !visDoc) continue;

      const locId = String(locDoc.id || locDoc._id);
      const visId = String(visDoc.id || visDoc._id);

      const locStand = standingsMap.get(locId);
      const visStand = standingsMap.get(visId);

      locStand.pj += 1;
      visStand.pj += 1;

      // Asegurar arrays de historial H2H en docs
      if (!Array.isArray(locDoc.historial)) locDoc.historial = [];
      if (!Array.isArray(visDoc.historial)) visDoc.historial = [];

      let h2hLoc = locDoc.historial.find(h => String(h.rivalId) === visId);
      if (!h2hLoc) {
        h2hLoc = { rivalId: visId, rivalNombre: visDoc.nombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
        locDoc.historial.push(h2hLoc);
      }

      let h2hVis = visDoc.historial.find(h => String(h.rivalId) === locId);
      if (!h2hVis) {
        h2hVis = { rivalId: locId, rivalNombre: locDoc.nombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
        visDoc.historial.push(h2hVis);
      }

      h2hLoc.pj += 1;
      h2hVis.pj += 1;

      if (p.isDoubleWO) {
        // Doble WO (X - X): Penalización de 2 pts y -3 DG a cada uno
        locStand.pp += 1;
        locStand.pe += 1; // WO en tabla
        locStand.wo += 1;
        locStand.gc += 3;
        locStand.puntos -= 2;

        visStand.pp += 1;
        visStand.pe += 1; // WO en tabla
        visStand.wo += 1;
        visStand.gc += 3;
        visStand.puntos -= 2;

        // Stats globales
        locDoc.partidosPerdidosHistorico = (locDoc.partidosPerdidosHistorico || 0) + 1;
        locDoc.woHistorico = (locDoc.woHistorico || 0) + 1;
        locDoc.golesEnContraHistorico = (locDoc.golesEnContraHistorico || 0) + 3;

        visDoc.partidosPerdidosHistorico = (visDoc.partidosPerdidosHistorico || 0) + 1;
        visDoc.woHistorico = (visDoc.woHistorico || 0) + 1;
        visDoc.golesEnContraHistorico = (visDoc.golesEnContraHistorico || 0) + 3;

        // H2H
        h2hLoc.pe += 1;
        h2hLoc.gc += 3;
        h2hVis.pe += 1;
        h2hVis.gc += 3;
      } else {
        const gl = p.golesLocal || 0;
        const gv = p.golesVisitante || 0;

        locStand.gf += gl;
        locStand.gc += gv;
        visStand.gf += gv;
        visStand.gc += gl;

        locDoc.golesAFavorHistorico = (locDoc.golesAFavorHistorico || 0) + gl;
        locDoc.golesEnContraHistorico = (locDoc.golesEnContraHistorico || 0) + gv;
        visDoc.golesAFavorHistorico = (visDoc.golesAFavorHistorico || 0) + gv;
        visDoc.golesEnContraHistorico = (visDoc.golesEnContraHistorico || 0) + gl;

        h2hLoc.gf += gl;
        h2hLoc.gc += gv;
        h2hVis.gf += gv;
        h2hVis.gc += gl;

        if (gl > gv) {
          // Gana local
          locStand.pg += 1;
          locStand.puntos += 3;
          locDoc.partidosGanadosHistorico = (locDoc.partidosGanadosHistorico || 0) + 1;
          h2hLoc.pg += 1;

          visStand.pp += 1;
          h2hVis.pp += 1;
          visDoc.partidosPerdidosHistorico = (visDoc.partidosPerdidosHistorico || 0) + 1;

          if (p.isWO) {
            // Perdedor por WO sufre penalización de -2 pts
            visStand.pe += 1; // WO en tabla
            visStand.wo += 1;
            visStand.puntos -= 2;
            visDoc.woHistorico = (visDoc.woHistorico || 0) + 1;
          }
        } else if (gv > gl) {
          // Gana visitante
          visStand.pg += 1;
          visStand.puntos += 3;
          visDoc.partidosGanadosHistorico = (visDoc.partidosGanadosHistorico || 0) + 1;
          h2hVis.pg += 1;

          locStand.pp += 1;
          h2hLoc.pp += 1;
          locDoc.partidosPerdidosHistorico = (locDoc.partidosPerdidosHistorico || 0) + 1;

          if (p.isWO) {
            // Perdedor por WO sufre penalización de -2 pts
            locStand.pe += 1; // WO en tabla
            locStand.wo += 1;
            locStand.puntos -= 2;
            locDoc.woHistorico = (locDoc.woHistorico || 0) + 1;
          }
        }
      }
    }
  }

  // Recalcular diferencia de gol y ordenar tabla
  const tablaJugadores = Array.from(standingsMap.values()).map(s => {
    s.dif = s.gf - s.gc;
    return s;
  });

  tablaJugadores.sort((a, b) => {
    if (b.puntos !== a.puntos) return b.puntos - a.puntos;
    if (b.dif !== a.dif) return b.dif - a.dif;
    return b.gf - a.gf;
  });

  // Asignar título al Campeón (primer puesto)
  if (tablaJugadores.length > 0) {
    const campeonInfo = tablaJugadores[0];
    const campeonDoc = playerMap.get(campeonInfo.nombre.toLowerCase().trim());
    if (campeonDoc) {
      const normTitulos = normalizeTitulos(campeonDoc.titulos);
      normTitulos.oficiales.push(leagueTitle || 'Primera División');
      campeonDoc.titulos = normTitulos;
    }
  }

  // Guardar todos los documentos de Jugador actualizados en DB
  for (const doc of playerMap.values()) {
    await doc.save();
  }

  // Crear y guardar la temporada en la colección Primera
  const nuevaLiga = await Primera.create({
    nombreLiga: leagueTitle,
    fechaDeInicio: new Date(),
    fechaDeFin: new Date(),
    jugadores: tablaJugadores,
    partidos: filteredFechas
  });

  return {
    liga: nuevaLiga,
    tipo: 'liga',
    totalFechas: filteredFechas.length,
    totalPartidos: filteredFechas.reduce((acc, f) => acc + f.partidos.length, 0),
    partidosIgnorados: totalPartidosIgnorados,
    jugadoresIgnorados: ignoredList,
    tabla: tablaJugadores,
    campeon: tablaJugadores[0] || null,
    sheetNames
  };
}

/**
 * Normaliza nombres de fases comunes (ej: FP -> Fase Previa, OF -> Octavos, etc.)
 */
export function normalizePhaseName(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const t = rawToken.replace(/\u00A0/g, ' ').trim();
  const u = t.toUpperCase();

  if (/^(?:FP|FASE\s*PREVIA|PREVIA|16AVOS|DIECISEISAVOS|32AVOS|R1|RONDA\s*1)$/i.test(u)) return 'Fase Previa';
  if (/^(?:OF|OCTAVOS|OCTAVOS\s*DE\s*FINAL|8VOS|OCTAVO)$/i.test(u)) return 'Octavos';
  if (/^(?:CF|CUARTOS|CUARTOS\s*DE\s*FINAL|4TOS|CUARTO)$/i.test(u)) return 'Cuartos';
  if (/^(?:SF|SEMIS|SEMIFINAL|SEMIFINALES|SEMI\s*FINAL|SEMI-FINAL)$/i.test(u)) return 'Semifinales';
  if (/^(?:FINAL|F|FINALES)$/i.test(u)) return 'Final';
  if (/^(?:3P|3ER\s*PUESTO|3ER\s*LUGAR|TERCER\s*PUESTO|TERCER\s*LUGAR)$/i.test(u)) return 'Tercer Puesto';

  return null;
}

/**
 * Retorna el peso de orden estándar de una fase para ordenar llaves en un bracket.
 */
export function getPhaseOrderWeight(normName) {
  const n = String(normName || '').toLowerCase();
  if (n.includes('previa') || n.includes('16') || n.includes('32')) return 1;
  if (n.includes('octavo')) return 2;
  if (n.includes('cuarto')) return 3;
  if (n.includes('semi')) return 4;
  if (n.includes('final') && !n.includes('semi') && !n.includes('octavo') && !n.includes('cuarto')) return 5;
  if (n.includes('tercer') || n.includes('3')) return 6;
  return 10;
}

function slugifyPhase(normName) {
  const n = String(normName || '').toLowerCase();
  if (n.includes('previa') || n.includes('16') || n.includes('32')) return 'fp';
  if (n.includes('octavo')) return 'oct';
  if (n.includes('cuarto')) return 'cua';
  if (n.includes('semi')) return 'sem';
  if (n.includes('final') && !n.includes('semi') && !n.includes('octavo') && !n.includes('cuarto')) return 'fin';
  if (n.includes('tercer')) return 'ter';
  return slugifyName(normName).slice(0, 3);
}

function isValidPlayerName(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.replace(/\u00A0/g, ' ').trim();
  if (s.length === 0) return false;
  const upper = s.toUpperCase();

  // Ignorar cabeceras de fase
  if (normalizePhaseName(s)) return false;
  // Ignorar resultados puros / W.O. / guiones / conectores
  if (/^(?:X|WO|W\.O\.|VS|\-|\+|\||\d+|\d+[\s:-]+\d+)$/i.test(s)) return false;
  // Ignorar títulos o banners de hoja
  if (upper.includes('COPA') || upper.includes('COPPA') || upper.includes('SUPERLIGA') || upper.includes('TABLA')) return false;

  return true;
}

/**
 * Parsea los goles de ida y vuelta para una serie de eliminación directa en base a celdas individuales.
 * Las 'X' o 'WO' indican que el jugador que las tiene perdió por W.O. (3-0 para el rival).
 */
function parseKnockoutMatchScores(p1, p2, s1_1, s1_2, s2_1, s2_2) {
  const isWO = (c) => {
    const s = String(c || '').replace(/\u00A0/g, ' ').trim().toUpperCase();
    return s === 'X' || s.includes('WO');
  };

  const isBlank = (c) => {
    return String(c || '').replace(/\u00A0/g, ' ').trim() === '';
  };

  const toNum = (c) => {
    const s = String(c || '').replace(/\u00A0/g, ' ').trim();
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };

  // --- PARTIDO 1 (IDA: Local = p1, Visitante = p2) ---
  let ida = { golesLocal: null, golesVisitante: null, finalizado: false, isWO: false, isDoubleWO: false };
  const p1_wo_1 = isWO(s1_1);
  const p2_wo_1 = isWO(s2_1);
  const num1_1 = toNum(s1_1);
  const num2_1 = toNum(s2_1);

  if (p1_wo_1 && p2_wo_1) {
    ida = { golesLocal: 0, golesVisitante: 0, finalizado: true, isWO: false, isDoubleWO: true };
  } else if (p2_wo_1) {
    // p2 perdió por WO -> p1 gana 3-0
    ida = { golesLocal: 3, golesVisitante: 0, finalizado: true, isWO: true, isDoubleWO: false };
  } else if (p1_wo_1) {
    // p1 perdió por WO -> p2 gana 0-3
    ida = { golesLocal: 0, golesVisitante: 3, finalizado: true, isWO: true, isDoubleWO: false };
  } else if (num1_1 !== null && num2_1 !== null) {
    ida = { golesLocal: num1_1, golesVisitante: num2_1, finalizado: true, isWO: false, isDoubleWO: false };
  }

  // --- PARTIDO 2 (VUELTA: Local = p2, Visitante = p1) ---
  let vuelta = null;
  const hasVueltaCol = !isBlank(s1_2) || !isBlank(s2_2) || isWO(s1_2) || isWO(s2_2);

  if (hasVueltaCol) {
    vuelta = { golesLocal: null, golesVisitante: null, finalizado: false, isWO: false, isDoubleWO: false };
    const p1_wo_2 = isWO(s1_2);
    const p2_wo_2 = isWO(s2_2);
    const num1_2 = toNum(s1_2); // Goles de p1 (visitante)
    const num2_2 = toNum(s2_2); // Goles de p2 (local)

    if (p1_wo_2 && p2_wo_2) {
      vuelta = { golesLocal: 0, golesVisitante: 0, finalizado: true, isWO: false, isDoubleWO: true };
    } else if (p2_wo_2) {
      // p2 perdió por WO en vuelta (local) -> p2: 0, p1: 3
      vuelta = { golesLocal: 0, golesVisitante: 3, finalizado: true, isWO: true, isDoubleWO: false };
    } else if (p1_wo_2) {
      // p1 perdió por WO en vuelta (visitante) -> p2: 3, p1: 0
      vuelta = { golesLocal: 3, golesVisitante: 0, finalizado: true, isWO: true, isDoubleWO: false };
    } else if (num1_2 !== null && num2_2 !== null) {
      vuelta = { golesLocal: num2_2, golesVisitante: num1_2, finalizado: true, isWO: false, isDoubleWO: false };
    }
  }

  const desempate = { golesLocal: null, golesVisitante: null, finalizado: false };

  // --- DETERMINAR GANADOR GLOBAL ---
  let ganador = null;
  if (ida.finalizado && (!vuelta || vuelta.finalizado)) {
    const tot1 = (ida.golesLocal ?? 0) + (vuelta?.golesVisitante ?? 0);
    const tot2 = (ida.golesVisitante ?? 0) + (vuelta?.golesLocal ?? 0);

    if (tot1 > tot2) {
      ganador = p1;
    } else if (tot2 > tot1) {
      ganador = p2;
    } else {
      if (p2_wo_1 || isWO(s2_2)) ganador = p1;
      else if (p1_wo_1 || isWO(s1_2)) ganador = p2;
    }
  }

  return { ida, vuelta, desempate, ganador };
}

/**
 * Detecta si una hoja de Excel corresponde a una Coppa (eliminatoria directa) o a una Liga regular.
 */
export function detectExcelSheetType(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!matrix || !matrix.length) return 'desconocido';

  let coppaScore = 0;
  let ligaScore = 0;

  for (let r = 0; r < Math.min(15, matrix.length); r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      const cell = String(matrix[r][c] || '').replace(/\u00A0/g, ' ').trim().toUpperCase();
      if (!cell) continue;

      if (/^(?:FP|OF|CF|SF|FINAL|FASE\s*PREVIA|OCTAVOS|CUARTOS|SEMIFINAL|SEMIFINALES|BRACKET|LLAVES)$/i.test(cell)) {
        coppaScore += 3;
      }
      if (cell.includes('COPPA') || cell.includes('COPA PLATUBI')) {
        coppaScore += 4;
      }
      if (/^(?:F\d+|FECHA\s*\d+|RONDA\s*\d+)$/i.test(cell) || cell.includes('TABLA DE POSICIONES') || cell.includes('SUPERLIGA')) {
        ligaScore += 3;
      }
    }
  }

  return coppaScore > ligaScore ? 'coppa' : 'liga';
}

/**
 * Extrae la estructura completa de una Coppa (fases, llaves ida/vuelta, participantes, campeón) desde una hoja Excel.
 */
export function extractCoppaFromSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!matrix || !matrix.length) return { coppaTitle: null, fases: [], llaves: {}, equipos: [], campeon: null };

  let coppaTitle = null;

  // 1. Buscar título en las primeras 5 filas
  for (let r = 0; r < Math.min(5, matrix.length); r++) {
    for (let c = 0; c < (matrix[r] || []).length; c++) {
      const cellVal = String(matrix[r][c] || '').replace(/\u00A0/g, ' ').trim();
      if (cellVal.toLowerCase().includes('copa') || cellVal.toLowerCase().includes('coppa') || cellVal.toLowerCase().includes('torneo')) {
        coppaTitle = cellVal;
        break;
      }
    }
    if (coppaTitle) break;
  }

  // 2. Encontrar la fila con cabeceras de fase
  let headerRowIndex = -1;
  const phaseCols = [];

  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const row = matrix[r];
    if (!row) continue;

    const foundInRow = [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').replace(/\u00A0/g, ' ').trim();
      if (!cell) continue;

      const norm = normalizePhaseName(cell);
      if (norm) {
        foundInRow.push({
          raw: cell,
          normName: norm,
          col: c,
          orderWeight: getPhaseOrderWeight(norm)
        });
      }
    }

    if (foundInRow.length >= 2 || (foundInRow.length === 1 && (foundInRow[0].normName === 'Final' || foundInRow[0].normName === 'Octavos'))) {
      headerRowIndex = r;
      phaseCols.push(...foundInRow);
      break;
    }
  }

  if (headerRowIndex === -1 || !phaseCols.length) {
    throw new Error('No se detectaron cabeceras de fases eliminatorias (FP, OF, CF, SF, FINAL) en la hoja de Excel.');
  }

  // Ordenar fases por peso o posición de columna
  phaseCols.sort((a, b) => a.orderWeight !== b.orderWeight ? a.orderWeight - b.orderWeight : a.col - b.col);

  const fasesEliminatoria = [];
  const llaves = {};
  const allEquiposSet = new Set();

  for (const pInfo of phaseCols) {
    const { normName, col } = pInfo;
    if (!fasesEliminatoria.includes(normName)) {
      fasesEliminatoria.push(normName);
    }
    llaves[normName] = llaves[normName] || [];

    const startCol = col;
    let r = headerRowIndex + 1;

    while (r < matrix.length) {
      const row = matrix[r];
      if (!row) { r++; continue; }

      let name1Col = startCol;
      let name1 = String(row[startCol] || '').replace(/\u00A0/g, ' ').trim();
      if (!isValidPlayerName(name1) && row[startCol + 1]) {
        const alt = String(row[startCol + 1] || '').replace(/\u00A0/g, ' ').trim();
        if (isValidPlayerName(alt)) {
          name1 = alt;
          name1Col = startCol + 1;
        }
      }

      if (!isValidPlayerName(name1)) {
        r++;
        continue;
      }

      // Buscar Jugador 2 en filas subsiguientes
      let r2 = r + 1;
      let name2 = '';
      while (r2 < Math.min(r + 4, matrix.length)) {
        const nextRow = matrix[r2];
        if (nextRow) {
          const cand = String(nextRow[name1Col] || nextRow[startCol] || '').replace(/\u00A0/g, ' ').trim();
          if (isValidPlayerName(cand) && cand.toLowerCase() !== name1.toLowerCase()) {
            name2 = cand;
            break;
          }
        }
        r2++;
      }

      if (!name2) {
        r++;
        continue;
      }

      // Extraer celdas de resultado para Jugador 1 y Jugador 2
      const s1_1 = String(matrix[r][name1Col + 1] || '').replace(/\u00A0/g, ' ').trim();
      const s1_2 = String(matrix[r][name1Col + 2] || '').replace(/\u00A0/g, ' ').trim();

      const s2_1 = String(matrix[r2][name1Col + 1] || '').replace(/\u00A0/g, ' ').trim();
      const s2_2 = String(matrix[r2][name1Col + 2] || '').replace(/\u00A0/g, ' ').trim();

      const matchId = `${slugifyPhase(normName)}_${llaves[normName].length + 1}`;
      const { ida, vuelta, desempate, ganador } = parseKnockoutMatchScores(name1, name2, s1_1, s1_2, s2_1, s2_2);

      allEquiposSet.add(name1);
      allEquiposSet.add(name2);

      const llaveObj = {
        id: matchId,
        equipo1: { nombre: name1, discordId: null },
        equipo2: { nombre: name2, discordId: null },
        ida,
        vuelta,
        desempate,
        ganador
      };

      llaves[normName].push(llaveObj);
      r = r2 + 1;
    }
  }

  // Pase secundario: resolver ganadores en caso de empate si uno de ellos avanzó a la siguiente ronda
  for (let f = 0; f < fasesEliminatoria.length - 1; f++) {
    const curFase = fasesEliminatoria[f];
    const nextFase = fasesEliminatoria[f + 1];
    const nextMatches = llaves[nextFase] || [];
    const nextPlayers = new Set();
    nextMatches.forEach(m => {
      if (m.equipo1?.nombre) nextPlayers.add(m.equipo1.nombre.toLowerCase().trim());
      if (m.equipo2?.nombre) nextPlayers.add(m.equipo2.nombre.toLowerCase().trim());
    });

    for (const m of (llaves[curFase] || [])) {
      if (!m.ganador) {
        const p1Norm = (m.equipo1?.nombre || '').toLowerCase().trim();
        const p2Norm = (m.equipo2?.nombre || '').toLowerCase().trim();
        if (nextPlayers.has(p1Norm) && !nextPlayers.has(p2Norm)) {
          m.ganador = m.equipo1.nombre;
        } else if (nextPlayers.has(p2Norm) && !nextPlayers.has(p1Norm)) {
          m.ganador = m.equipo2.nombre;
        }
      }
    }
  }

  // Campeón del torneo (ganador de la Final)
  const finalPhase = fasesEliminatoria[fasesEliminatoria.length - 1];
  const finalMatch = (llaves[finalPhase] || [])[0];
  const campeon = finalMatch?.ganador || null;

  return {
    coppaTitle,
    fases: fasesEliminatoria,
    llaves,
    equipos: Array.from(allEquiposSet),
    campeon
  };
}

/**
 * Lee un Buffer o archivo de Excel e importa una Coppa procesando llave por llave,
 * actualizando historiales H2H, estadísticas globales y otorgando el título oficial al campeón.
 */
export async function parseAndImportExcelCoppa(excelInput, options = {}) {
  const workbook = typeof excelInput === 'string'
    ? XLSX.readFile(excelInput)
    : XLSX.read(excelInput, { type: 'buffer' });

  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    throw new Error('El archivo de Excel no contiene hojas válidas.');
  }

  const selectedSheetName = options.sheetName || sheetNames[0];
  const sheet = workbook.Sheets[selectedSheetName];
  if (!sheet) {
    throw new Error(`No se encontró la hoja "${selectedSheetName}" en el Excel.`);
  }

  const extracted = extractCoppaFromSheet(sheet);
  const coppaTitle = options.nombreTorneo || options.nombreLiga || extracted.coppaTitle || selectedSheetName || 'Coppa Platubi (Histórica)';
  const fasesEliminatoria = extracted.fases;
  const llaves = extracted.llaves;

  // Manejo de ignorar jugadores
  const rawIgnored = options.ignorar || options.ignoredPlayers || options.jugadoresIgnorar || [];
  const ignoredList = (Array.isArray(rawIgnored) ? rawIgnored : String(rawIgnored).split(/[,;\n]+/))
    .map(s => s.trim())
    .filter(Boolean);

  const isPlayerIgnored = (nameOrId) => {
    if (!nameOrId || !ignoredList.length) return false;
    const clean = String(nameOrId).trim().toLowerCase();
    const slug = slugifyName(nameOrId);
    return ignoredList.some(ig => {
      const igClean = ig.trim().toLowerCase();
      const igSlug = slugifyName(ig);
      return clean === igClean || slug === igSlug;
    });
  };

  // Recopilar participantes únicos válidos
  const uniquePlayerNames = new Set();
  for (const fase of fasesEliminatoria) {
    for (const l of (llaves[fase] || [])) {
      if (l.equipo1?.nombre && !isPlayerIgnored(l.equipo1.nombre)) uniquePlayerNames.add(l.equipo1.nombre.trim());
      if (l.equipo2?.nombre && !isPlayerIgnored(l.equipo2.nombre)) uniquePlayerNames.add(l.equipo2.nombre.trim());
    }
  }

  const allDbPlayers = await Jugador.find({}).catch(() => []);
  const playerMap = new Map();

  for (const rawName of uniquePlayerNames) {
    const norm = rawName.toLowerCase().trim();
    let playerDoc = allDbPlayers.find(p => p.nombre.toLowerCase().trim() === norm);

    if (!playerDoc) {
      const customId = slugifyName(rawName);
      playerDoc = await Jugador.create({
        id: customId,
        nombre: rawName,
        ligaActual: 'Sin Liga',
        titulos: { oficiales: [], amistosos: [] },
        partidosGanadosHistorico: 0,
        partidosPerdidosHistorico: 0,
        woHistorico: 0,
        golesAFavorHistorico: 0,
        golesEnContraHistorico: 0,
        historial: []
      });
      allDbPlayers.push(playerDoc);
    }

    playerMap.set(norm, playerDoc);
  }

  // Vincular discordId/id a todas las llaves y participantes
  for (const fase of fasesEliminatoria) {
    for (const l of (llaves[fase] || [])) {
      const doc1 = playerMap.get((l.equipo1?.nombre || '').toLowerCase().trim());
      const doc2 = playerMap.get((l.equipo2?.nombre || '').toLowerCase().trim());
      if (doc1) l.equipo1.discordId = String(doc1.id || doc1._id);
      if (doc2) l.equipo2.discordId = String(doc2.id || doc2._id);
      if (l.ganador) {
        const docG = playerMap.get((l.ganador || '').toLowerCase().trim());
        if (docG) l.ganador = String(docG.id || docG._id);
      }
    }
  }

  // Procesamiento de estadísticas y H2H partido por partido
  let totalPartidos = 0;
  let totalWOs = 0;

  for (const fase of fasesEliminatoria) {
    for (const l of (llaves[fase] || [])) {
      const doc1 = playerMap.get((l.equipo1?.nombre || '').toLowerCase().trim());
      const doc2 = playerMap.get((l.equipo2?.nombre || '').toLowerCase().trim());
      if (!doc1 || !doc2) continue;

      const p1Id = String(doc1.id || doc1._id);
      const p2Id = String(doc2.id || doc2._id);

      if (!Array.isArray(doc1.historial)) doc1.historial = [];
      if (!Array.isArray(doc2.historial)) doc2.historial = [];

      let h2h1 = doc1.historial.find(h => String(h.rivalId) === p2Id);
      if (!h2h1) {
        h2h1 = { rivalId: p2Id, rivalNombre: doc2.nombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
        doc1.historial.push(h2h1);
      }
      let h2h2 = doc2.historial.find(h => String(h.rivalId) === p1Id);
      if (!h2h2) {
        h2h2 = { rivalId: p1Id, rivalNombre: doc1.nombre, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
        doc2.historial.push(h2h2);
      }

      // Procesar Partido de Ida
      if (l.ida && l.ida.finalizado) {
        totalPartidos++;
        const gl = l.ida.golesLocal ?? 0;
        const gv = l.ida.golesVisitante ?? 0;

        doc1.golesAFavorHistorico = (doc1.golesAFavorHistorico || 0) + gl;
        doc1.golesEnContraHistorico = (doc1.golesEnContraHistorico || 0) + gv;
        doc2.golesAFavorHistorico = (doc2.golesAFavorHistorico || 0) + gv;
        doc2.golesEnContraHistorico = (doc2.golesEnContraHistorico || 0) + gl;

        h2h1.pj += 1; h2h1.gf += gl; h2h1.gc += gv;
        h2h2.pj += 1; h2h2.gf += gv; h2h2.gc += gl;

        if (l.ida.isDoubleWO) {
          totalWOs += 2;
          doc1.woHistorico = (doc1.woHistorico || 0) + 1;
          doc2.woHistorico = (doc2.woHistorico || 0) + 1;
          doc1.partidosPerdidosHistorico = (doc1.partidosPerdidosHistorico || 0) + 1;
          doc2.partidosPerdidosHistorico = (doc2.partidosPerdidosHistorico || 0) + 1;
          h2h1.pe += 1; h2h2.pe += 1;
        } else if (gl > gv) {
          doc1.partidosGanadosHistorico = (doc1.partidosGanadosHistorico || 0) + 1;
          doc2.partidosPerdidosHistorico = (doc2.partidosPerdidosHistorico || 0) + 1;
          h2h1.pg += 1; h2h2.pp += 1;
          if (l.ida.isWO) {
            totalWOs += 1;
            doc2.woHistorico = (doc2.woHistorico || 0) + 1;
          }
        } else if (gv > gl) {
          doc2.partidosGanadosHistorico = (doc2.partidosGanadosHistorico || 0) + 1;
          doc1.partidosPerdidosHistorico = (doc1.partidosPerdidosHistorico || 0) + 1;
          h2h2.pg += 1; h2h1.pp += 1;
          if (l.ida.isWO) {
            totalWOs += 1;
            doc1.woHistorico = (doc1.woHistorico || 0) + 1;
          }
        } else {
          h2h1.pe += 1; h2h2.pe += 1;
        }
      }

      // Procesar Partido de Vuelta (local = doc2, visitante = doc1)
      if (l.vuelta && l.vuelta.finalizado) {
        totalPartidos++;
        const gl = l.vuelta.golesLocal ?? 0;     // Goles doc2
        const gv = l.vuelta.golesVisitante ?? 0; // Goles doc1

        doc2.golesAFavorHistorico = (doc2.golesAFavorHistorico || 0) + gl;
        doc2.golesEnContraHistorico = (doc2.golesEnContraHistorico || 0) + gv;
        doc1.golesAFavorHistorico = (doc1.golesAFavorHistorico || 0) + gv;
        doc1.golesEnContraHistorico = (doc1.golesEnContraHistorico || 0) + gl;

        h2h2.pj += 1; h2h2.gf += gl; h2h2.gc += gv;
        h2h1.pj += 1; h2h1.gf += gv; h2h1.gc += gl;

        if (l.vuelta.isDoubleWO) {
          totalWOs += 2;
          doc1.woHistorico = (doc1.woHistorico || 0) + 1;
          doc2.woHistorico = (doc2.woHistorico || 0) + 1;
          doc1.partidosPerdidosHistorico = (doc1.partidosPerdidosHistorico || 0) + 1;
          doc2.partidosPerdidosHistorico = (doc2.partidosPerdidosHistorico || 0) + 1;
          h2h1.pe += 1; h2h2.pe += 1;
        } else if (gl > gv) {
          doc2.partidosGanadosHistorico = (doc2.partidosGanadosHistorico || 0) + 1;
          doc1.partidosPerdidosHistorico = (doc1.partidosPerdidosHistorico || 0) + 1;
          h2h2.pg += 1; h2h1.pp += 1;
          if (l.vuelta.isWO) {
            totalWOs += 1;
            doc1.woHistorico = (doc1.woHistorico || 0) + 1;
          }
        } else if (gv > gl) {
          doc1.partidosGanadosHistorico = (doc1.partidosGanadosHistorico || 0) + 1;
          doc2.partidosPerdidosHistorico = (doc2.partidosPerdidosHistorico || 0) + 1;
          h2h1.pg += 1; h2h2.pp += 1;
          if (l.vuelta.isWO) {
            totalWOs += 1;
            doc2.woHistorico = (doc2.woHistorico || 0) + 1;
          }
        } else {
          h2h1.pe += 1; h2h2.pe += 1;
        }
      }
    }
  }

  // Determinar Campeón y otorgar título oficial
  let campeonDoc = null;
  const finalPhase = fasesEliminatoria[fasesEliminatoria.length - 1];
  const finalMatch = (llaves[finalPhase] || [])[0];
  if (finalMatch && finalMatch.ganador) {
    const rawWinner = finalMatch.ganador;
    campeonDoc = Array.from(playerMap.values()).find(
      p => String(p.id || p._id) === String(rawWinner) || p.nombre.toLowerCase().trim() === String(rawWinner).toLowerCase().trim()
    );
    if (campeonDoc) {
      const normTitulos = normalizeTitulos(campeonDoc.titulos);
      normTitulos.oficiales.push(coppaTitle || 'Coppa Platubi');
      campeonDoc.titulos = normTitulos;
    }
  }

  // Guardar todos los jugadores
  for (const doc of playerMap.values()) {
    await doc.save();
  }

  // Crear y guardar la Coppa
  const equiposArray = Array.from(playerMap.values()).map(p => ({
    nombre: p.nombre,
    discordId: String(p.id || p._id)
  }));

  const nuevaCoppa = await Coppa.create({
    nombre: coppaTitle,
    prefix: 'coppa',
    estado: 'Finalizado',
    fasesEliminatoria,
    faseActual: Math.max(0, fasesEliminatoria.length - 1),
    equipos: equiposArray,
    llaves,
    tipoEncuentro: 'ida_vuelta'
  });

  return {
    coppa: nuevaCoppa,
    tipo: 'coppa',
    nombreTorneo: coppaTitle,
    fases: fasesEliminatoria,
    totalFases: fasesEliminatoria.length,
    totalPartidos,
    participantes: equiposArray,
    campeon: campeonDoc ? { nombre: campeonDoc.nombre, id: campeonDoc.id || campeonDoc._id } : null,
    totalWOs,
    sheetNames
  };
}

/**
 * Función unificada para importar cualquier tipo de torneo (Liga o Coppa) desde Excel.
 */
export async function parseAndImportExcel(excelInput, options = {}) {
  const workbook = typeof excelInput === 'string'
    ? XLSX.readFile(excelInput)
    : XLSX.read(excelInput, { type: 'buffer' });

  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    throw new Error('El archivo de Excel no contiene hojas válidas.');
  }

  const selectedSheetName = options.sheetName || sheetNames[0];
  const sheet = workbook.Sheets[selectedSheetName];
  if (!sheet) {
    throw new Error(`No se encontró la hoja "${selectedSheetName}" en el Excel.`);
  }

  const detectedType = options.tipoTorneo || detectExcelSheetType(sheet);
  if (detectedType === 'coppa') {
    return parseAndImportExcelCoppa(excelInput, options);
  } else {
    return parseAndImportExcelLeague(excelInput, options);
  }
}

