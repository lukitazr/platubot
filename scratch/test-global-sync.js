import 'colors';
import Jugador from '../models/Jugador.js';
import Equipos from '../models/superliga/Equipos.js';
import { connectDB } from '../database/connection.js';
import { syncUserGlobal, recordMatchResultGlobal } from '../utils/db/globalUserSync.js';

async function testGlobalSyncSystem() {
  console.log('=== VERIFICANDO SISTEMA DE SINCRONIZACIÓN Y STATS RELACIONALES ==='.cyan);

  await connectDB();

  const idLocal = '1111222233334444';
  const idVisitante = '5555666677778888';

  // 1. Probar syncUserGlobal
  console.log('\n[Test 1] Sincronizando usuario global...'.yellow);
  const player1 = await syncUserGlobal(idLocal, { nombre: 'AlphaPlayer', ligaActual: 'Primera Platubi' });
  const player2 = await syncUserGlobal(idVisitante, { nombre: 'BetaPlayer', ligaActual: 'Primera Platubi' });

  console.log(`✔ Usuario 1 registrado/sincronizado: ${player1.nombre} (ID: ${player1._getId()})`.green);
  console.log(`✔ Usuario 2 registrado/sincronizado: ${player2.nombre} (ID: ${player2._getId()})`.green);

  // 2. Probar recordMatchResultGlobal (Partido 1: Alpha 3 - 1 Beta)
  console.log('\n[Test 2] Registrando resultado de partido (Alpha 3 - 1 Beta)...'.yellow);
  const res1 = await recordMatchResultGlobal({
    localUserId: idLocal,
    visitanteUserId: idVisitante,
    localNombre: 'AlphaPlayer',
    visitanteNombre: 'BetaPlayer',
    golesLocal: 3,
    golesVisitante: 1,
    context: 'Test Liga'
  });

  if (!res1.success) throw new Error('Error al registrar partido 1');

  // Verificar stats de Alpha
  const alphaDb1 = await Jugador.findById(idLocal);
  console.log(`✔ Alpha Player -> Partidos Ganados: ${alphaDb1.partidosGanadosHistorico}, GF: ${alphaDb1.golesAFavorHistorico}, GC: ${alphaDb1.golesEnContraHistorico}`.green);

  // Verificar stats de Beta
  const betaDb1 = await Jugador.findById(idVisitante);
  console.log(`✔ Beta Player -> Partidos Perdidos: ${betaDb1.partidosPerdidosHistorico}, GF: ${betaDb1.golesAFavorHistorico}, GC: ${betaDb1.golesEnContraHistorico}`.green);

  // Verificar H2H (Historial frente a frente)
  const h2hAlpha = alphaDb1.historial.find(h => String(h.rivalId) === idVisitante);
  console.log(`✔ H2H Alpha vs Beta -> PJ: ${h2hAlpha.pj}, PG: ${h2hAlpha.pg}, GF: ${h2hAlpha.gf}, GC: ${h2hAlpha.gc}`.green);

  // 3. Probar Partido 2 (Alpha 1 - 2 Beta)
  console.log('\n[Test 3] Registrando segundo partido (Alpha 1 - 2 Beta)...'.yellow);
  await recordMatchResultGlobal({
    localUserId: idLocal,
    visitanteUserId: idVisitante,
    localNombre: 'AlphaPlayer',
    visitanteNombre: 'BetaPlayer',
    golesLocal: 1,
    golesVisitante: 2,
    context: 'Test Liga Fecha 2'
  });

  const alphaDb2 = await Jugador.findById(idLocal);
  const h2hAlpha2 = alphaDb2.historial.find(h => String(h.rivalId) === idVisitante);
  console.log(`✔ H2H Actualizado Alpha vs Beta -> PJ: ${h2hAlpha2.pj}, PG: ${h2hAlpha2.pg}, PP: ${h2hAlpha2.pp}, GF: ${h2hAlpha2.gf}, GC: ${h2hAlpha2.gc}`.green);

  // 4. Limpieza de usuarios de prueba
  console.log('\n[Test 4] Limpiando registros de prueba...'.yellow);
  await alphaDb2.delete();
  const betaDb2 = await Jugador.findById(idVisitante);
  await betaDb2.delete();
  console.log(`✔ Registros de prueba eliminados correctamente.`.green);

  console.log('\n=== ¡TODAS LAS PRUEBAS DE SINCRONIZACIÓN Y STATS COMPLETADAS CON ÉXITO! ==='.bold.green);
  process.exit(0);
}

testGlobalSyncSystem().catch(err => {
  console.error('❌ Error en test de sincronización global:'.red, err);
  process.exit(1);
});
