import '../database/polyfill.js';
import { connectDB } from '../database/connection.js';
import { parseAndImportExcelLeague } from '../utils/excelParser.js';
import 'colors';
import * as XLSX from 'xlsx';

async function main() {
  const filePath = process.argv[2];
  const sheetName = process.argv[3];

  if (!filePath) {
    console.log('Uso: bun scripts/import-excel-liga.js <ruta-al-excel.xlsx> [nombre-hoja]'.yellow);
    process.exit(1);
  }

  console.log(`[Excel Import] Conectando a la base de datos...`.cyan);
  await connectDB();

  console.log(`[Excel Import] Leyendo archivo: ${filePath}...`.cyan);

  try {
    const workbook = XLSX.readFile(filePath);
    const sheetsToProcess = sheetName ? [sheetName] : workbook.SheetNames;

    for (const sName of sheetsToProcess) {
      console.log(`\n[Excel Import] Procesando hoja: "${sName}"...`.bold.yellow);
      const res = await parseAndImportExcelLeague(filePath, { sheetName: sName });

      console.log(`✅ Liga guardada exitosamente: "${res.liga.nombreLiga}"`.green);
      console.log(`   - Fechas importadas: ${res.totalFechas}`);
      console.log(`   - Partidos procesados: ${res.totalPartidos}`);
      console.log(`   - Jugadores en tabla: ${res.tabla.length}`);
      if (res.campeon) {
        console.log(`   - 🏆 Campeón: ${res.campeon.nombre} (${res.campeon.puntos} Pts, DG ${res.campeon.dif})`.magenta.bold);
      }

      console.log('\nTabla de Posiciones final:'.bold.white);
      console.table(
        res.tabla.map((j, idx) => ({
          Pos: idx + 1,
          Jugador: j.nombre,
          PJ: j.pj,
          PG: j.pg,
          PP: j.pp,
          WO: j.wo,
          GF: j.gf,
          GC: j.gc,
          DG: j.dif,
          Pts: j.puntos
        }))
      );
    }

    console.log('\n[Excel Import] Proceso finalizado con éxito.'.bold.green);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Error durante la importación:`.red, error.message);
    process.exit(1);
  }
}

main();
