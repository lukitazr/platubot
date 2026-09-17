import '../database/polyfill.js';
import Jugador from '../models/Jugador.js';
import { normalizeTitulos, getTitulosCount, awardTitle } from '../utils/torneos/titulosHelper.js';
import { mergePlayers } from '../utils/db/mergePlayers.js';
import { editPlayer } from '../utils/db/editPlayer.js';

import { connectDB } from '../database/connection.js';

async function testTitulosSystem() {
  await connectDB();
  console.log('🧪 Iniciando prueba integral del nuevo sistema de Títulos (Oficiales vs Amistosos)...');

  // Test 1: Normalización de formatos
  console.log('\n[1] Probando normalizeTitulos...');
  const fromNum = normalizeTitulos(3);
  console.log('  - Desde número 3:', fromNum);
  if (fromNum.oficiales.length !== 3 || fromNum.amistosos.length !== 0) {
    throw new Error('Falló normalización desde número');
  }

  const fromObj = normalizeTitulos({ oficiales: ['Primera Ed. 1', 'Coppa 2024'], amistosos: ['Segunda Ed. 1'] });
  console.log('  - Desde objeto:', fromObj);
  if (fromObj.oficiales.length !== 2 || fromObj.amistosos.length !== 1) {
    throw new Error('Falló normalización desde objeto');
  }

  const counts = getTitulosCount(fromObj);
  console.log('  - Conteo:', counts);
  if (counts.oficiales !== 2 || counts.amistosos !== 1 || counts.total !== 3) {
    throw new Error('Falló getTitulosCount');
  }
  console.log('  ✅ normalizeTitulos y getTitulosCount funcionando OK.');

  // Test 2: awardTitle
  console.log('\n[2] Probando awardTitle...');
  await Jugador.deleteById('test_player_titles_1').catch(() => {});
  await Jugador.deleteById('test_player_titles_source').catch(() => {});

  const testPlayer = await Jugador.create({
    id: 'test_player_titles_1',
    nombre: 'Test Player Titles',
    titulos: { oficiales: [], amistosos: [] }
  });

  await awardTitle(testPlayer, { nombreTorneo: 'Primera División - T1', esOficial: true });
  await awardTitle(testPlayer, { nombreTorneo: 'Coppa Platubi', esOficial: true });
  await awardTitle(testPlayer, { nombreTorneo: 'Segunda División - T1', esOficial: false });

  const refreshedPlayer = await Jugador.findById('test_player_titles_1');
  console.log('  - Títulos actualizados:', refreshedPlayer.titulos);
  if (refreshedPlayer.titulos.oficiales.length !== 2 || refreshedPlayer.titulos.amistosos.length !== 1) {
    throw new Error('Falló adjudicación de títulos oficiales y amistosos');
  }
  console.log('  ✅ awardTitle funcionando OK.');

  // Test 3: editPlayer
  console.log('\n[3] Probando editPlayer con nuevos campos...');
  await editPlayer('test_player_titles_1', {
    titulosOficiales: 4,
    titulosAmistosos: 2
  });

  const editedPlayer = await Jugador.findById('test_player_titles_1');
  console.log('  - Tras editPlayer:', editedPlayer.titulos);
  if (editedPlayer.titulos.oficiales.length !== 4 || editedPlayer.titulos.amistosos.length !== 2) {
    throw new Error('Falló editPlayer con títulos oficiales y amistosos');
  }
  console.log('  ✅ editPlayer con títulos funcionando OK.');

  // Test 4: mergePlayers
  console.log('\n[4] Probando mergePlayers...');
  const sourcePlayer = await Jugador.create({
    id: 'test_player_titles_source',
    nombre: 'Source Player Titles',
    titulos: {
      oficiales: ['Torneo Antiguo 1'],
      amistosos: ['Amistoso Antiguo 1']
    },
    partidosGanadosHistorico: 5
  });

  const mergeRes = await mergePlayers('test_player_titles_1', 'test_player_titles_source');
  if (!mergeRes.success) {
    throw new Error(`Falló merge: ${mergeRes.reason}`);
  }

  const mergedTarget = await Jugador.findById('test_player_titles_1');
  console.log('  - Tras merge:', mergedTarget.titulos);
  if (mergedTarget.titulos.oficiales.length !== 5 || mergedTarget.titulos.amistosos.length !== 3) {
    throw new Error(`Esperaba 5 oficiales y 3 amistosos, obtuvo: ${JSON.stringify(mergedTarget.titulos)}`);
  }
  console.log('  ✅ mergePlayers con títulos funcionando OK.');

  // Cleanup
  await Jugador.deleteById('test_player_titles_1').catch(() => {});
  await Jugador.deleteById('test_player_titles_source').catch(() => {});

  console.log('\n🎉 ¡Todas las pruebas del sistema de títulos pasaron exitosamente!');
  process.exit(0);
}

testTitulosSystem().catch(err => {
  console.error('❌ Error en prueba:', err);
  process.exit(1);
});
