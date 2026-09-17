import 'colors';
import Jugador from '../models/Jugador.js';
import Equipos from '../models/superliga/Equipos.js';
import { connectDB } from '../database/connection.js';

async function testIDModelSystem() {
  console.log('=== VERIFICANDO SISTEMA DE MODELOS POR ID (ACTIVE-RECORD NO-SQL) ==='.cyan);

  await connectDB();

  // 1. Test findById (using Discord ID or _id)
  const jugadorOriginal = await Jugador.findOne({});
  if (!jugadorOriginal) {
    throw new Error('No se encontraron jugadores para probar.');
  }

  const targetId = jugadorOriginal.id || jugadorOriginal._id;
  console.log(`[Test 1] Buscando jugador por ID: ${targetId}`.yellow);

  const jugador = await Jugador.findById(targetId);
  console.log(`✔ Encontrado: ${jugador.nombre} (ID: ${jugador._getId()})`.green);

  // 2. Test direct property mutation + doc.save()
  const titulosPrev = jugador.titulos || 0;
  jugador.titulos = titulosPrev + 1;
  jugador.campoNuevoPrueba = 'ID-Centric Success';
  await jugador.save();
  console.log(`[Test 2] doc.save() ejecutado por ID. Títulos actualizados: ${jugador.titulos}`.green);

  // Re-fetch to ensure persistence in MongoDB by ID
  const jugadorVerificado = await Jugador.findById(targetId);
  if (jugadorVerificado.titulos !== titulosPrev + 1 || jugadorVerificado.campoNuevoPrueba !== 'ID-Centric Success') {
    throw new Error('Falló la verificación del guardado por ID.');
  }
  console.log(`✔ Verificado en MongoDB por ID: campoNuevoPrueba="${jugadorVerificado.campoNuevoPrueba}"`.green);

  // 3. Test doc.update(data)
  await jugadorVerificado.update({ campoNuevoPrueba: 'Updated Inline' });
  const docTrasUpdate = await Jugador.findById(targetId);
  console.log(`[Test 3] doc.update() ejecutado. Resultado: "${docTrasUpdate.campoNuevoPrueba}"`.green);

  // 4. Test Model.updateById(id, data)
  await Jugador.updateById(targetId, { titulos: titulosPrev });
  const docTrasUpdateById = await Jugador.findById(targetId);
  console.log(`[Test 4] Jugador.updateById() ejecutado. Títulos restaurados a: ${docTrasUpdateById.titulos}`.green);

  // 5. Test Model.upsertById(id, data)
  const testIdTemp = '9999888877776666';
  await Jugador.upsertById(testIdTemp, {
    nombre: 'JugadorPruebaID',
    ligaActual: 'Liga Test',
    titulos: 5
  });
  const docUpserted = await Jugador.findById(testIdTemp);
  console.log(`[Test 5] Jugador.upsertById() creado: ${docUpserted.nombre} (Titulos: ${docUpserted.titulos})`.green);

  // 6. Test doc.delete()
  await docUpserted.delete();
  const docBorrado = await Jugador.findById(testIdTemp);
  if (docBorrado !== null) {
    throw new Error('El documento no fue eliminado correctamente.');
  }
  console.log(`[Test 6] doc.delete() por ID verificado. Registro eliminado.`.green);

  console.log('\n=== ¡TODOS LOS TESTS DE MODELOS POR ID COMPLETADOS CON ÉXITO! ==='.bold.green);
  process.exit(0);
}

testIDModelSystem().catch(err => {
  console.error('❌ Error en test de modelos por ID:'.red, err);
  process.exit(1);
});
