import '../database/polyfill.js';
import { connectDB } from '../database/connection.js';
import Jugador from '../models/Jugador.js';
import Primera from '../models/Primera.js';
import { mergePlayers } from '../utils/db/mergePlayers.js';

async function testMerge() {
  console.log('--- TEST DE FUSIÓN DE JUGADORES (!merge) ---');
  await connectDB();

  const targetId = '751663890441699409';
  const sourceId = 'ters_hist_test';

  // 1. Limpiar o crear jugador Destino (751663890441699409)
  let targetP = await Jugador.findById(targetId);
  if (!targetP) {
    targetP = await Jugador.create({
      id: targetId,
      nombre: 'Ters Discord',
      titulos: 1,
      partidosGanadosHistorico: 10,
      partidosPerdidosHistorico: 2,
      woHistorico: 0,
      golesAFavorHistorico: 50,
      golesEnContraHistorico: 20,
      historial: [{ rivalId: 'bencarp', rivalNombre: 'Bencarp', pj: 2, pg: 2, pe: 0, pp: 0, gf: 10, gc: 2 }]
    });
  }

  // 2. Crear jugador Origen (ters_hist_test)
  let sourceP = await Jugador.findById(sourceId);
  if (!sourceP) {
    sourceP = await Jugador.create({
      id: sourceId,
      nombre: 'Ters Historico',
      titulos: 2,
      partidosGanadosHistorico: 15,
      partidosPerdidosHistorico: 3,
      woHistorico: 1,
      golesAFavorHistorico: 75,
      golesEnContraHistorico: 30,
      historial: [{ rivalId: 'bencarp', rivalNombre: 'Bencarp', pj: 3, pg: 3, pe: 0, pp: 0, gf: 15, gc: 5 }]
    });
  }

  // 3. Crear una Liga de Prueba en Primera con partidos de sourceP
  const testLiga = await Primera.create({
    nombreLiga: 'Liga Test Merge',
    activa: false,
    fechaDeInicio: new Date(),
    jugadores: [
      { id: sourceId, nombre: 'Ters Historico', pj: 5, pg: 5, pe: 0, pp: 0, gf: 25, gc: 5, puntos: 15 },
      { id: 'bencarp', nombre: 'Bencarp', pj: 5, pg: 0, pe: 0, pp: 5, gf: 5, gc: 25, puntos: 0 }
    ],
    partidos: [
      {
        numero: 1,
        partidos: [
          {
            _id: 'match_test_1',
            localId: sourceId,
            localNombre: 'Ters Historico',
            visitanteId: 'bencarp',
            visitanteNombre: 'Bencarp',
            golesLocal: 5,
            golesVisitante: 1,
            finalizado: true
          }
        ]
      }
    ]
  });

  console.log('\n--- Datos Antes del Merge ---');
  console.log('Target (Destino):', { id: targetP.id, nombre: targetP.nombre, titulos: targetP.titulos, pg: targetP.partidosGanadosHistorico });
  console.log('Source (Origen):', { id: sourceP.id, nombre: sourceP.nombre, titulos: sourceP.titulos, pg: sourceP.partidosGanadosHistorico });

  console.log('\nEjecutando mergePlayers(targetId, sourceId)...');
  const res = await mergePlayers(targetId, sourceId);

  console.log('\nResultado del merge:', res);

  // 4. Verificaciones
  const postSource = await Jugador.findById(sourceId);
  const postTarget = await Jugador.findById(targetId);
  const postLiga = await Primera.findById(testLiga._id);

  console.log('\n--- Datos Después del Merge ---');
  console.log('¿Existe perfil Origen en DB?:', postSource !== null ? 'SÍ (ERROR)' : 'NO (CORRECTO - Eliminado)');
  console.log('Target (Destino) Stats:', {
    id: postTarget._id || postTarget.id,
    nombre: postTarget.nombre,
    titulos: postTarget.titulos, // Esperado: 1 + 2 = 3
    pg: postTarget.partidosGanadosHistorico, // Esperado: 10 + 15 = 25
    gf: postTarget.golesAFavorHistorico, // Esperado: 50 + 75 = 125
    historialBencarp: postTarget.historial?.find(h => h.rivalId === 'bencarp') // Esperado: pj: 5, pg: 5
  });

  console.log('\nLiga Re-linkeada:', {
    jugadoresLiga: postLiga.jugadores.map(j => ({ id: j.id, nombre: j.nombre })),
    partido1: postLiga.partidos[0].partidos[0]
  });

  // Limpiar datos de prueba creados
  await Primera.deleteById(testLiga._id);

  console.log('\n✅ TEST COMPLETADO CON ÉXITO');
  process.exit(0);
}

testMerge().catch(err => {
  console.error('Error en testMerge:', err);
  process.exit(1);
});
