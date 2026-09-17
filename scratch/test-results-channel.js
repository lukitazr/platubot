import 'colors';
import Primera from '../models/Primera.js';
import Coppa from '../models/copas/Coppa.js';
import Superliga from '../models/superliga/Superliga.js';
import Torneo from '../models/copas/Torneo.js';
import { connectDB } from '../database/connection.js';
import { findPendingMatchesForUser } from '../utils/matchFinder.js';

async function testResultsChannel() {
  console.log('=== TESTEANDO CANAL DE RESULTADOS EN FIND PENDING MATCHES ==='.cyan);
  await connectDB();

  const userId = '8888111122223333';
  const rivalId = '9999111122223333';

  // 1. Primera con canalResultados custom
  const docPrimera = await Primera.create({
    nombreLiga: 'Liga Test',
    canalResultados: '111222333444555666',
    partidos: [{
      numero: 1,
      partidos: [{
        _id: 'match-prim-1',
        localId: userId,
        visitanteId: rivalId,
        localNombre: 'LocalPrim',
        visitanteNombre: 'VisPrim',
        finalizado: false
      }]
    }]
  });

  // 2. Torneo personalizado con canalResultados custom
  const docTorneo = await Torneo.create({
    nombre: 'Torneo Test',
    prefix: 'ttest',
    canalResultados: '777888999000111222',
    estado: 'EnCurso',
    enfrentamientosGrupos: [{
      _id: 'match-torneo-1',
      local: 'LocalTorneo',
      visitante: 'VisTorneo',
      localId: userId,
      visitanteId: rivalId,
      completado: false,
      resultado: 'Pendiente'
    }]
  });

  // 3. Superliga
  const docSuperliga = await Superliga.create({
    temporada: 99,
    actual: true,
    canalResultados: '333444555666777888',
    fechas: [{
      numero: 1,
      encuentros: [{
        _id: 'match-sl-1',
        localId: userId,
        visitanteId: rivalId,
        localNombre: 'LocalSL',
        visitanteNombre: 'VisSL',
        finalizado: false
      }]
    }]
  });

  // 4. Coppa
  const docCoppa = await Coppa.create({
    nombre: 'Coppa Test',
    estado: 'EnCurso',
    canalResultados: '444555666777888999',
    fasesEliminatoria: ['Final'],
    faseActual: 0,
    llaves: {
      'Final': [{
        id: 'match-coppa-1',
        equipo1: { discordId: userId, nombre: 'LocalCoppa' },
        equipo2: { discordId: rivalId, nombre: 'VisCoppa' },
        ganador: null
      }]
    }
  });

  const matches = await findPendingMatchesForUser(userId);
  console.log(`Encontrados ${matches.length} partidos pendientes:`.yellow);

  const pMatch = matches.find(m => m.matchId === 'match-prim-1');
  const tMatch = matches.find(m => m.matchId === 'match-torneo-1');
  const sMatch = matches.find(m => m.matchId === 'match-sl-1');
  const cMatch = matches.find(m => m.matchId === 'match-coppa-1');

  console.log('Primera canalResultados:', pMatch?.canalResultados);
  console.log('Torneo canalResultados:', tMatch?.canalResultados);
  console.log('Superliga canalResultados:', sMatch?.canalResultados);
  console.log('Coppa canalResultados:', cMatch?.canalResultados);

  if (pMatch?.canalResultados !== '111222333444555666') throw new Error('Primera canalResultados mismatch');
  if (tMatch?.canalResultados !== '777888999000111222') throw new Error('Torneo canalResultados mismatch');
  if (sMatch?.canalResultados !== '333444555666777888') throw new Error('Superliga canalResultados mismatch');
  if (cMatch?.canalResultados !== '444555666777888999') throw new Error('Coppa canalResultados mismatch');

  // Limpieza
  await docPrimera.delete();
  await docTorneo.delete();
  await docSuperliga.delete();
  await docCoppa.delete();

  console.log('✅ TODOS LOS CANALES DE RESULTADOS FUERON ASIGNADOS Y DEVUELTOS CORRECTAMENTE!'.bold.green);
  process.exit(0);
}

testResultsChannel().catch(err => {
  console.error('❌ Error en test de canales de resultados:'.red, err);
  process.exit(1);
});
