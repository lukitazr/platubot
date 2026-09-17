import '../database/polyfill.js';
import * as XLSX from 'xlsx';
import { parseAndImportExcelLeague } from '../utils/excelParser.js';
import Jugador from '../models/Jugador.js';
import Primera from '../models/Primera.js';

async function testExcelIgnorar() {
  console.log('🧪 Iniciando prueba de cargarexcel con jugadores a ignorar...');

  // 1. Crear un workbook en memoria
  const wsData = [
    ['Superliga Platubi Test'],
    [''],
    ['F1', '', '', ''],
    ['Alice', '3', '1', 'Bob'],
    ['Pepe', '0', '3', 'Charlie'], // Este partido debe ser ignorado
    ['David', '2', '2', 'Alice'],
    [''],
    ['F2', '', '', ''],
    ['Bob', '4', '0', 'David'],
    ['Charlie', '1', '2', 'Pepe'], // Este partido debe ser ignorado
    ['Alice', '2', '0', 'Charlie'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Superliga');

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 2. Procesar ignorando a 'Pepe'
  console.log('📄 Importando Excel ignorando a "Pepe"...');
  const res = await parseAndImportExcelLeague(excelBuffer, {
    sheetName: 'Superliga',
    ignorar: 'Pepe'
  });

  console.log('\n📊 Resultados de la importación:');
  console.log(`- Fechas procesadas: ${res.totalFechas}`);
  console.log(`- Partidos procesados: ${res.totalPartidos}`);
  console.log(`- Partidos ignorados: ${res.partidosIgnorados}`);
  console.log(`- Jugadores en tabla: ${res.tabla.length}`);
  console.log(`- Jugadores excluidos: ${res.jugadoresIgnorados.join(', ')}`);

  console.log('\n📋 Tabla Final:');
  console.table(res.tabla.map(j => ({
    Jugador: j.nombre,
    PJ: j.pj,
    PG: j.pg,
    PE: j.pe,
    PP: j.pp,
    GF: j.gf,
    GC: j.gc,
    PTS: j.puntos
  })));

  // Verificaciones
  const pepeInTable = res.tabla.some(j => j.nombre.toLowerCase() === 'pepe');
  if (pepeInTable) {
    throw new Error('❌ Fallo: "Pepe" sigue apareciendo en la tabla de posiciones.');
  }

  const pepeMatches = res.liga.partidos.flatMap(f => f.partidos).filter(p =>
    p.localNombre.toLowerCase() === 'pepe' || p.visitanteNombre.toLowerCase() === 'pepe'
  );
  if (pepeMatches.length > 0) {
    throw new Error('❌ Fallo: Hay partidos de "Pepe" guardados en la liga.');
  }

  if (res.partidosIgnorados !== 2) {
    throw new Error(`❌ Fallo: Se esperaban 2 partidos ignorados, se obtuvieron ${res.partidosIgnorados}`);
  }

  console.log('\n✅ ¡Prueba de jugadores ignorados superada exitosamente!');
  process.exit(0);
}

testExcelIgnorar().catch(err => {
  console.error('❌ Error en prueba:', err);
  process.exit(1);
});
