import '../database/polyfill.js';
import { generarTarjetaJugadorInfo } from '../utils/visual/jugadorInfoGenerator.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

async function testJugadorInfoCard() {
  console.log('🧪 Iniciando prueba de renderizado de Tarjeta de Información de Jugador...');

  const mockData = {
    nombre: 'Sabalero',
    id: '719284729182374910',
    avatarBase64: null,
    rankingHistorico: 1,
    totalJugadores: 45,
    equipoSuperliga: {
      nombre: 'Boca Juniors',
      escudo: 'assets/equipos/boca.png',
      rol: 'Coach'
    },
    totalCompeticiones: 12,
    titulosOficiales: [
      'Primera División - T1',
      'Coppa Platubi 2024',
      'Primera División - T3',
      'Coppa Platubi 2025'
    ],
    titulosAmistosos: [
      'Segunda División - T1',
      'Torneo Relámpago Apertura',
      'Copa Relámpago Navidad'
    ],
    stats: {
      pts: 142,
      pj: 58,
      pg: 48,
      pp: 9,
      wo: 1,
      gf: 194,
      gc: 62,
      dg: 132,
      winrate: 83
    },
    topHistorial: [
      {
        rivalNombre: 'DiabloRojo',
        rivalAvatar: null,
        pj: 14,
        pg: 10,
        pe: 1,
        pp: 3,
        gf: 42,
        gc: 18,
        estado: 'POSITIVO'
      },
      {
        rivalNombre: 'Millonario99',
        rivalAvatar: null,
        pj: 12,
        pg: 6,
        pe: 2,
        pp: 4,
        gf: 28,
        gc: 22,
        estado: 'POSITIVO'
      },
      {
        rivalNombre: 'Cuervo_SanLo',
        rivalAvatar: null,
        pj: 9,
        pg: 3,
        pe: 1,
        pp: 5,
        gf: 15,
        gc: 21,
        estado: 'NEGATIVO'
      }
    ]
  };

  console.log('🎨 Generando tarjeta visual con Satori + Resvg...');
  const pngBuffer = await generarTarjetaJugadorInfo(mockData);

  const scratchDir = join(process.cwd(), 'scratch');
  if (!existsSync(scratchDir)) mkdirSync(scratchDir, { recursive: true });

  const outputPath = join(scratchDir, 'test_jugador_tarjeta.png');
  writeFileSync(outputPath, pngBuffer);
  console.log(`  ✅ Tarjeta generada con éxito: ${outputPath} (${pngBuffer.length} bytes)`);

  console.log('🎉 ¡Prueba de Tarjeta de Jugador completada con éxito!');
  process.exit(0);
}

testJugadorInfoCard().catch(err => {
  console.error('❌ Error en prueba de tarjeta de jugador:', err);
  process.exit(1);
});
