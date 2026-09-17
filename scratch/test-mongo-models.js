import 'colors';
import Jugador from '../models/Jugador.js';
import Equipos from '../models/superliga/Equipos.js';
import Torneo from '../models/copas/Torneo.js';

async function test() {
  console.log('--- TEST MODELOS MONGODB ---'.cyan);
  
  const jugadores = await Jugador.find({});
  console.log(`Jugadores encontrados: ${jugadores.length}`.green);

  const equipo = await Equipos.findOne({});
  console.log(`Equipo encontrado: ${equipo?.nombre} - Presupuesto: ${equipo?.dinero}`.green);

  const torneos = await Torneo.find({});
  console.log(`Torneos encontrados: ${torneos.length}`.green);

  console.log('--- TEST COMPLETADO CON ÉXITO ---'.bold.green);
  process.exit(0);
}

test().catch(err => {
  console.error('Error en test de modelos:', err);
  process.exit(1);
});
