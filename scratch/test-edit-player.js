import '../database/polyfill.js';
import { connectDB } from '../database/connection.js';
import Jugador from '../models/Jugador.js';
import Primera from '../models/Primera.js';
import { editPlayer } from '../utils/db/editPlayer.js';

async function testEditPlayer() {
  console.log('--- TEST DE EDICIÓN GLOBAL DE JUGADORES (!editarjugador) ---');
  await connectDB();

  const testId = 'test_edit_player';

  // 1. Crear jugador de prueba
  let p = await Jugador.findById(testId);
  if (!p) {
    p = await Jugador.create({
      id: testId,
      nombre: 'Nombre Antiguo',
      titulos: 0,
      partidosGanadosHistorico: 5,
      partidosPerdidosHistorico: 5,
      woHistorico: 0,
      golesAFavorHistorico: 20,
      golesEnContraHistorico: 20
    });
  }

  // 2. Crear liga de prueba con partidos
  const testLiga = await Primera.create({
    nombreLiga: 'Liga Test Editar Jugador',
    activa: false,
    fechaDeInicio: new Date(),
    jugadores: [
      { id: testId, nombre: 'Nombre Antiguo', pj: 10, pg: 5, pe: 0, pp: 5, gf: 20, gc: 20, puntos: 15 }
    ],
    partidos: [
      {
        numero: 1,
        partidos: [
          {
            _id: 'match_edit_1',
            localId: testId,
            localNombre: 'Nombre Antiguo',
            visitanteId: 'rival',
            visitanteNombre: 'Rival',
            golesLocal: 3,
            golesVisitante: 0,
            finalizado: true
          }
        ]
      }
    ]
  });

  console.log('Jugador antes de la edición:', {
    id: p._id || p.id,
    nombre: p.nombre,
    titulos: p.titulos,
    pg: p.partidosGanadosHistorico
  });

  // Mock del cliente Discord para test
  const mockClient = {
    users: {
      fetch: async () => ({
        displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png'
      })
    }
  };

  console.log('\nEjecutando editPlayer con nuevos valores...');
  const res = await editPlayer(
    testId,
    {
      nombre: 'Nombre Editado Pro',
      discordId: '751663890441699409',
      titulos: 3,
      pg: 15,
      pp: 2,
      wo: 1,
      gf: 60,
      gc: 15
    },
    mockClient
  );

  console.log('\nResultado de editPlayer:', {
    success: res.success,
    finalId: res.finalId,
    finalName: res.finalName,
    affectedCompeticiones: res.affectedCompeticiones,
    affectedPartidos: res.affectedPartidos,
    hasCachedAvatar: res.hasCachedAvatar
  });

  const updatedP = await Jugador.findById(testId) || await Jugador.findById('751663890441699409');
  const updatedLiga = await Primera.findById(testLiga._id);

  console.log('\nJugador después de la edición:', {
    id: updatedP._id || updatedP.id,
    nombre: updatedP.nombre,
    discordId: updatedP.discordId,
    titulos: updatedP.titulos,
    pg: updatedP.partidosGanadosHistorico,
    pp: updatedP.partidosPerdidosHistorico,
    avatar: updatedP.avatar
  });

  console.log('\nLiga Re-linkeada:', {
    jugadorLiga: updatedLiga.jugadores[0],
    partido1: updatedLiga.partidos[0].partidos[0]
  });

  // Limpiar prueba
  await Primera.deleteById(testLiga._id);
  await Jugador.deleteById(testId);

  console.log('\n✅ TEST COMPLETADO CON ÉXITO');
  process.exit(0);
}

testEditPlayer().catch(err => {
  console.error('Error en testEditPlayer:', err);
  process.exit(1);
});
