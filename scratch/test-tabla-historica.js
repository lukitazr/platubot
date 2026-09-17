import '../database/polyfill.js';
import Jugador from '../models/Jugador.js';
import { generarTablaHistoricaImagen } from '../utils/visual/tablaHistoricaGenerator.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

async function runTest() {
  console.log('🧪 Iniciando prueba de Tabla Histórica (Simulación Multi-Página)...');

  // Crear 45 jugadores de prueba para asegurar paginación completa (3 páginas)
  const mockPlayers = [];
  for (let i = 1; i <= 45; i++) {
    const ofi = i === 1 ? 3 : (i === 2 ? 2 : (i <= 6 ? 1 : 0));
    const ami = i % 2 === 0 ? (i % 4) + 1 : 0;
    // Jugador 10 tendrá 15 títulos amistosos pero 0 oficiales para probar que no supera a los de títulos oficiales
    const titulos = {
      oficiales: Array.from({ length: i === 10 ? 0 : ofi }, (_, idx) => `Oficial #${idx + 1}`),
      amistosos: Array.from({ length: i === 10 ? 15 : ami }, (_, idx) => `Amistoso #${idx + 1}`)
    };

    mockPlayers.push({
      id: `player_${i}`,
      nombre: `Jugador ${i}`,
      titulos,
      partidosGanadosHistorico: Math.max(0, 50 - i),
      partidosPerdidosHistorico: Math.floor(i / 2),
      woHistorico: i % 5 === 0 ? 3 : 0,
      golesAFavorHistorico: 150 - i * 2,
      golesEnContraHistorico: 50 + i,
    });
  }

  const { normalizeTitulos } = await import('../utils/torneos/titulosHelper.js');

  const players = mockPlayers.map(j => {
    const norm = normalizeTitulos(j.titulos);
    const titulosOficiales = norm.oficiales.length;
    const titulosAmistosos = norm.amistosos.length;
    const pg = Number(j.partidosGanadosHistorico) || 0;
    const pp = Number(j.partidosPerdidosHistorico) || 0;
    const wo = Number(j.woHistorico) || 0;
    const gf = Number(j.golesAFavorHistorico) || 0;
    const gc = Number(j.golesEnContraHistorico) || 0;
    const dg = gf - gc;
    const pj = pg + pp + wo;
    const pts = (pg * 3) - (wo * 2);

    return {
      id: String(j.id || j.nombre),
      nombre: j.nombre,
      avatar: '',
      titulosOficiales,
      titulosAmistosos,
      titulos: titulosOficiales,
      pg,
      pp,
      wo,
      gf,
      gc,
      dg,
      pj,
      pts,
    };
  });

  // Ordenamiento estricto por Títulos Oficiales (los amistosos no infieren en el ranking)
  players.sort((a, b) => {
    if (b.titulosOficiales !== a.titulosOficiales) return b.titulosOficiales - a.titulosOficiales;
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.pg !== a.pg) return b.pg - a.pg;
    if (a.wo !== b.wo) return a.wo - b.wo;
    if (b.dg !== a.dg) return b.dg - a.dg;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.nombre.localeCompare(b.nombre);
  });

  // Verificar que Jugador 10 (con 15 amistosos y 0 oficiales) esté detrás de los que tienen títulos oficiales
  const rankJ10 = players.findIndex(p => p.id === 'player_10') + 1;
  console.log(`  - Posición de Jugador 10 (15 amistosos, 0 oficiales): #${rankJ10}`);
  if (rankJ10 <= 6) {
    throw new Error('Error: Jugador con solo títulos amistosos superó a jugadores con títulos oficiales en el ranking.');
  }

  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(players.length / PAGE_SIZE) || 1;
  console.log(`📊 Total jugadores: ${players.length} | Total páginas: ${totalPages}`);

  const scratchDir = join(process.cwd(), 'scratch');
  if (!existsSync(scratchDir)) mkdirSync(scratchDir, { recursive: true });

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const startIdx = pageIdx * PAGE_SIZE;
    const pagePlayers = players.slice(startIdx, startIdx + PAGE_SIZE);
    const startRank = startIdx + 1;

    console.log(`🎨 Renderizando Página ${pageIdx + 1}/${totalPages} (${pagePlayers.length} jugadores)...`);
    const pngBuffer = await generarTablaHistoricaImagen({
      players: pagePlayers,
      paginaActual: pageIdx + 1,
      totalPaginas: totalPages,
      totalJugadores: players.length,
      startRank,
    });

    const outputPath = join(scratchDir, `tabla_historica_multipage_p${pageIdx + 1}.png`);
    writeFileSync(outputPath, pngBuffer);
    console.log(`  ✅ Guardada: ${outputPath} (${pngBuffer.length} bytes)`);
  }

  console.log('🎉 ¡Todas las páginas renderizadas correctamente!');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('❌ Error en prueba:', err);
  process.exit(1);
});
