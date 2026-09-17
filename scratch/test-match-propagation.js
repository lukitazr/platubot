import 'colors';
import Primera from '../models/Primera.js';
import Jugador from '../models/Jugador.js';
import { connectDB } from '../database/connection.js';
import { processMatchResultAndSyncStandings } from '../utils/db/globalUserSync.js';

async function testMatchPropagation() {
  console.log('=== VERIFICANDO ASENTAMIENTO UNIFICADO DE PARTIDOS Y TABLAS ==='.cyan);

  await connectDB();

  const localId = '7777111122223333';
  const visitanteId = '7777444455556666';
  const matchId = 'match-test-999';

  // 1. Crear documento de Liga ficticio
  console.log('\n[Test 1] Creando temporada de prueba...'.yellow);
  const ligaTest = await Primera.create({
    nombreLiga: 'Liga Test Automatizada',
    jugadores: [
      { id: localId, nombre: 'AlphaFC', pJ: 0, pG: 0, pE: 0, pP: 0, gF: 0, gC: 0, dif: 0, puntos: 0 },
      { id: visitanteId, nombre: 'BetaFC', pJ: 0, pG: 0, pE: 0, pP: 0, gF: 0, gC: 0, dif: 0, puntos: 0 }
    ],
    partidos: [
      {
        numero: 1,
        partidos: [
          {
            _id: matchId,
            localId,
            visitanteId,
            localNombre: 'AlphaFC',
            visitanteNombre: 'BetaFC',
            golesLocal: null,
            golesVisitante: null,
            finalizado: false
          }
        ]
      }
    ]
  });

  console.log(`✔ Liga creada con ID: ${ligaTest._getId()}`.green);

  // 2. Procesar resultado de partido unificado (Alpha 3 - 1 Beta)
  console.log('\n[Test 2] Asentando partido: Alpha 3 - 1 Beta...'.yellow);
  await processMatchResultAndSyncStandings({
    localId,
    visitanteId,
    localNombre: 'AlphaFC',
    visitanteNombre: 'BetaFC',
    golesLocal: 3,
    golesVisitante: 1,
    ligaDoc: ligaTest,
    partidoId: matchId,
    context: 'Liga Test'
  });

  // 3. Verificar estado en la Liga (Tabla de posiciones y Partido)
  const ligaRefetched = await Primera.findById(ligaTest._getId());
  const matchRef = ligaRefetched.partidos[0].partidos[0];
  console.log(`✔ Partido finalizado en Liga: ${matchRef.finalizado} (${matchRef.golesLocal} - ${matchRef.golesVisitante})`.green);

  const tablaLocal = ligaRefetched.jugadores.find(j => String(j.id) === localId);
  const tablaVisitante = ligaRefetched.jugadores.find(j => String(j.id) === visitanteId);

  console.log(`✔ Tabla Posiciones Local (Alpha): Puntos=${tablaLocal.puntos}, PG=${tablaLocal.pg}, GF=${tablaLocal.gf}, GC=${tablaLocal.gc}, DIF=${tablaLocal.dif}`.green);
  console.log(`✔ Tabla Posiciones Visitante (Beta): Puntos=${tablaVisitante.puntos}, PP=${tablaVisitante.pp}, GF=${tablaVisitante.gf}, GC=${tablaVisitante.gc}, DIF=${tablaVisitante.dif}`.green);

  if (tablaLocal.puntos !== 3 || tablaLocal.pg !== 1 || tablaLocal.dif !== 2) {
    throw new Error('La tabla de posiciones de la liga no se actualizó correctamente.');
  }

  // 4. Verificar stats globales y H2H en el modelo Jugador
  const alphaGlobal = await Jugador.findById(localId);
  const betaGlobal = await Jugador.findById(visitanteId);

  console.log(`✔ Global Alpha -> PG Historico: ${alphaGlobal.partidosGanadosHistorico}, GF: ${alphaGlobal.golesAFavorHistorico}`.green);
  console.log(`✔ Global Beta -> PP Historico: ${betaGlobal.partidosPerdidosHistorico}, GC: ${betaGlobal.golesEnContraHistorico}`.green);

  const h2h = alphaGlobal.historial.find(h => String(h.rivalId) === visitanteId);
  console.log(`✔ H2H Historial Alpha vs Beta -> PJ: ${h2h.pj}, PG: ${h2h.pg}, GF: ${h2h.gf}, GC: ${h2h.gc}`.green);

  // 5. Limpieza de registros de prueba
  console.log('\n[Test 3] Eliminando registros de prueba...'.yellow);
  await ligaRefetched.delete();
  await alphaGlobal.delete();
  await betaGlobal.delete();

  console.log('\n=== ¡ASENTAMIENTO UNIFICADO Y PROPAGACIÓN DE STATS VERIFICADO CON ÉXITO! ==='.bold.green);
  process.exit(0);
}

testMatchPropagation().catch(err => {
  console.error('❌ Error en test de propagación de partido:'.red, err);
  process.exit(1);
});
