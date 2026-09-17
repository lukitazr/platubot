import '../database/polyfill.js';
import * as XLSX from 'xlsx';
import { connectDB } from '../database/connection.js';
import Jugador from '../models/Jugador.js';
import Coppa from '../models/copas/Coppa.js';
import { 
  detectExcelSheetType, 
  extractCoppaFromSheet, 
  parseAndImportExcelCoppa,
  parseAndImportExcel 
} from '../utils/excelParser.js';
import { generarBracketImagen } from '../utils/visual/bracketCoppaGenerator.js';
import 'colors';

async function runTest() {
  console.log('🧪 Iniciando prueba de importación de Coppa desde Excel...'.cyan.bold);
  await connectDB();

  // 1. Construir matriz Excel idéntica a la imagen del usuario
  // Estructura:
  // Fila 0: Banner título
  // Fila 1: Cabeceras de fase: FP (col B), OF (col F), CF (col J), SF (col N), FINAL (col R)
  // Filas siguientes: Tarjetas de 2 filas por partido con 2 columnas de goles

  const rows = [];
  rows[0] = ['', 'COPA PLATUBI 2'];
  rows[1] = ['', 'FP', '', '', '', 'OF', '', '', '', 'CF', '', '', '', 'SF', '', '', '', 'FINAL'];

  // Función helper para colocar una llave en la matriz
  const placeMatch = (colIdx, rowIdx, p1Name, p1_s1, p1_s2, p2Name, p2_s1, p2_s2) => {
    while (rows.length <= rowIdx + 1) rows.push([]);
    rows[rowIdx][colIdx] = p1Name;
    rows[rowIdx][colIdx + 1] = p1_s1;
    rows[rowIdx][colIdx + 2] = p1_s2;

    rows[rowIdx + 1][colIdx] = p2Name;
    rows[rowIdx + 1][colIdx + 1] = p2_s1;
    rows[rowIdx + 1][colIdx + 2] = p2_s2;
  };

  // --- FP (Col 1) ---
  placeMatch(1, 3, 'Camilo', '', '', 'Seychelles', 'X', 'X');
  placeMatch(1, 9, 'Gabriel', '5', '7', 'Neykerr', '4', '5');
  placeMatch(1, 15, 'Joe', '5', '5', 'Maticavs', '1', '3');
  placeMatch(1, 21, 'Edelatuca', '5', '6', 'Absolute', '3', '5');

  // --- OF (Col 5) ---
  placeMatch(5, 3, 'Ters', 'X', 'X', 'Camilo', '', '');
  placeMatch(5, 6, 'Xavier', '2', '5', 'MilanArg', '5', '4');
  placeMatch(5, 9, 'Sabalero', '4', '8', 'Gabriel', '5', '6');
  placeMatch(5, 12, 'Saraleguismo', '4', '2', 'Augusto', '5', '5');
  placeMatch(5, 15, 'Bau', '5', '3', 'Joe', '4', '5');
  placeMatch(5, 18, 'Levin', '5', '3', 'Saletrox', '4', '5');
  placeMatch(5, 21, 'Prestianni', '5', '5', 'Edelatuca', '1', '4');
  placeMatch(5, 24, 'Bencarp', '4', '3', 'Mauri', '5', '5');

  // --- CF (Col 9) ---
  placeMatch(9, 4, 'Camilo', '3', '4', 'MilanArg', '5', '5');
  placeMatch(9, 10, 'Sabalero', '5', '5', 'Augusto', '4', '0');
  placeMatch(9, 16, 'Joe', '2', '5', 'Saletrox', '5', '1');
  placeMatch(9, 22, 'Prestianni', '4', '5', 'Mauri', '5', '2');

  // --- SF (Col 13) ---
  placeMatch(13, 7, 'MilanArg', '', '', 'Sabalero', 'X', 'X');
  placeMatch(13, 19, 'Joe', '3', '5', 'Prestianni', '5', '2');

  // --- FINAL (Col 17) ---
  placeMatch(17, 13, 'MilanArg', '3', '0', 'Joe', '5', '5');

  // Crear Workbook en memoria
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Copa Platubi 2');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 2. Test detectExcelSheetType
  const detected = detectExcelSheetType(ws);
  console.log(`[Test 1] Detección de tipo de hoja: "${detected}"`.yellow);
  if (detected !== 'coppa') {
    throw new Error(`Se esperaba tipo 'coppa' pero se detectó '${detected}'`);
  }
  console.log('  ✅ Detección correcta como Coppa.'.green);

  // 3. Test extractCoppaFromSheet
  const extracted = extractCoppaFromSheet(ws);
  console.log(`[Test 2] Extracción de fases: [${extracted.fases.join(', ')}]`.yellow);
  console.log(`   - Título: ${extracted.coppaTitle}`);
  console.log(`   - Participantes extraídos: ${extracted.equipos.length}`);
  console.log(`   - Campeón inferido: ${extracted.campeon}`);

  if (extracted.fases.length !== 5) {
    throw new Error(`Se esperaban 5 fases pero se extrajeron ${extracted.fases.length}`);
  }
  if (extracted.campeon?.toLowerCase() !== 'joe') {
    throw new Error(`Se esperaba que el campeón fuera 'Joe', pero se obtuvo '${extracted.campeon}'`);
  }
  console.log('  ✅ Extracción de estructura validada con éxito.'.green);

  // 4. Test parseAndImportExcelCoppa
  console.log('\n[Test 3] Importando Coppa a MongoDB...'.yellow);
  const res = await parseAndImportExcelCoppa(buffer, { sheetName: 'Copa Platubi 2' });

  console.log(`   - Coppa guardada: "${res.coppa.nombre}"`.green);
  console.log(`   - Total partidos: ${res.totalPartidos}`);
  console.log(`   - Total WOs: ${res.totalWOs}`);
  console.log(`   - Campeón final: ${res.campeon.nombre}`);

  if (res.campeon.nombre.toLowerCase() !== 'joe') {
    throw new Error(`El campeón importado debería ser Joe.`);
  }

  // 5. Verificar títulos y stats en Jugador
  const joeDoc = await Jugador.findOne({
    $or: [{ id: 'joe' }, { nombre: new RegExp('^joe$', 'i') }]
  });
  if (!joeDoc) throw new Error('No se encontró el documento de Joe en DB.');
  console.log(`   - Títulos de Joe:`, joeDoc.titulos);
  const tieneTitulo = (joeDoc.titulos?.oficiales || []).some(t => t.includes('COPA PLATUBI 2') || t.includes('Copa Platubi 2'));
  if (!tieneTitulo) {
    throw new Error('Joe no recibió el título oficial de la Copa Platubi 2.');
  }
  console.log('  ✅ Joe tiene el título oficial adjudicado.'.green);

  // 6. Test Generación visual de Bracket
  console.log('\n[Test 4] Generando imagen del bracket con 5 fases...'.yellow);
  const dummyClient = {
    users: {
      fetch: async () => null
    }
  };
  const pngBuffer = await generarBracketImagen(res.coppa, dummyClient);
  console.log(`   - Buffer PNG generado: ${pngBuffer.length} bytes`.green);
  if (!pngBuffer || pngBuffer.length < 1000) {
    throw new Error('El buffer de la imagen del bracket es inválido.');
  }
  console.log('  ✅ Generador visual procesó las 5 fases sin errores.'.green);

  // Limpieza de prueba
  await Coppa.deleteOne({ _id: res.coppa._id });
  console.log('\n🎉 ¡TODOS LOS TESTS PASARON EXITOSAMENTE!'.bold.green);
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n❌ ERROR EN EL TEST:'.red, err);
  process.exit(1);
});
