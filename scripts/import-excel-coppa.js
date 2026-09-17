import '../database/polyfill.js';
import { connectDB } from '../database/connection.js';
import { parseAndImportExcelCoppa } from '../utils/excelParser.js';
import 'colors';
import * as XLSX from 'xlsx';

async function main() {
  const filePath = process.argv[2];
  const sheetName = process.argv[3];

  if (!filePath) {
    console.log('Uso: bun scripts/import-excel-coppa.js <ruta-al-excel.xlsx> [nombre-hoja]'.yellow);
    process.exit(1);
  }

  console.log(`[Coppa Excel Import] Conectando a la base de datos...`.cyan);
  await connectDB();

  console.log(`[Coppa Excel Import] Leyendo archivo: ${filePath}...`.cyan);

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetsToProcess = sheetName ? [sheetName] : workbook.SheetNames;

    for (const sName of sheetsToProcess) {
      console.log(`\n[Coppa Excel Import] Procesando hoja: "${sName}"...`.bold.yellow);
      const res = await parseAndImportExcelCoppa(filePath, { sheetName: sName });

      console.log(`✅ Coppa guardada exitosamente: "${res.nombreTorneo}"`.green);
      console.log(`   - Fases: ${res.fases.join(' → ')}`);
      console.log(`   - Partidos procesados: ${res.totalPartidos}`);
      console.log(`   - Participantes: ${res.participantes.length}`);
      if (res.totalWOs > 0) {
        console.log(`   - W.O. registrados: ${res.totalWOs}`.yellow);
      }
      if (res.campeon) {
        console.log(`   - 🏆 Campeón: ${res.campeon.nombre}`.magenta.bold);
      }
    }

    console.log('\n[Coppa Excel Import] Proceso finalizado con éxito.'.bold.green);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error durante la importación de la Coppa:`.red, error.message);
    process.exit(1);
  }
}

main();
