import 'colors';
import { isResultInputChannel } from '../utils/submission.js';
import { connectDB } from '../database/connection.js';

async function testChannelFiltering() {
  console.log('=== VERIFICANDO FILTRADO DE CANALES ENTRADA VS SALIDA ==='.cyan);

  await connectDB();

  const canalPrimera = process.env.CANAL_RESULTADOS_PRIMERA;
  const canalCoppa = process.env.CANAL_RESULTADOS_COPPA;
  const canalAprobacion = process.env.CANAL_APROBACION;
  const canalAleatorio = '123456789012345678';

  // 1. Probar Canales de Entrada Válidos (INPUT)
  const isInputPrimera = await isResultInputChannel(canalPrimera);
  console.log(`[Test 1] Canal Entrada Primera (${canalPrimera}): ${isInputPrimera}`.green);
  if (!isInputPrimera) throw new Error('Falló la validación del canal de entrada de Primera.');

  const isInputCoppa = await isResultInputChannel(canalCoppa);
  console.log(`[Test 2] Canal Entrada Coppa (${canalCoppa}): ${isInputCoppa}`.green);
  if (!isInputCoppa) throw new Error('Falló la validación del canal de entrada de Coppa.');

  // 2. Probar Canal de Salida / Aprobación (OUTPUT)
  const isInputAprobacion = await isResultInputChannel(canalAprobacion);
  console.log(`[Test 3] Canal Salida/Aprobación (${canalAprobacion}) descartado como Input: ${!isInputAprobacion}`.green);
  if (isInputAprobacion) throw new Error('El canal de aprobación NO debe ser aceptado como canal de entrada de resultados.');

  // 3. Probar Canal Aleatorio Desconocido
  const isInputAleatorio = await isResultInputChannel(canalAleatorio);
  console.log(`[Test 4] Canal Aleatorio Desconocido descartado: ${!isInputAleatorio}`.green);
  if (isInputAleatorio) throw new Error('Canal aleatorio no configurado fue aceptado por error.');

  console.log('\n=== ¡FILTRADO DE CANALES ENTRADA/SALIDA VERIFICADO CON ÉXITO! ==='.bold.green);
  process.exit(0);
}

testChannelFiltering().catch(err => {
  console.error('❌ Error en test de filtrado de canales:'.red, err);
  process.exit(1);
});
