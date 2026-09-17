import '../database/polyfill.js';
import * as XLSX from 'xlsx';
import { connectDB } from '../database/connection.js';
import { parseAndImportExcelLeague } from '../utils/excelParser.js';
import Jugador from '../models/Jugador.js';

async function runTest() {
  console.log('--- TEST DE CARGA E IMPORTACIÓN DE LIGA DESDE EXCEL ---');
  await connectDB();

  const data = [
    ['SUPERLIGA PLATUBI'],
    [],
    ['F1', '', '', '', '', 'F2', '', '', ''],
    ['ters', 5, 0, 'Jusstin', '', 'Sabajero', 3, 5, 'ters'],
    ['Rodrii', 5, 4, 'MilanArg', '', 'Rodrii', 5, 3, 'Bau'],
    ['Prestianni', 4, 5, 'Mauri', '', 'Prestianni', 3, 5, 'Mauri'],
    ['Neykerr', 1, 5, 'Augusto', '', 'Neykerr', 5, 2, 'Augusto'],
    ['Leon', 4, 5, 'camiloRP', '', 'Leon', 2, 5, 'camiloRP'],
    ['Bau', 5, 5, 'levinsito', '', 'Bau', 1, 5, 'levinsito'],
    ['Here', 5, 4, 'Bencarp', '', 'Here', 5, 4, 'Bencarp'],
    ['Xavier', 5, 4, 'Ciro', '', 'Xavier', 4, 5, 'Ciro'],
    ['Saraleguismo', 3, 5, 'Saletrox', '', 'Ciro', 1, 5, 'Saraleguismo'],
    ['Sabajero', 5, 2, 'Gonza', '', 'Gonza', 5, 2, 'Saletrox'],
    [],
    ['F3', '', '', '', '', 'F4', '', '', ''],
    ['Here', 'X', 'X', 'Jusstin', '', 'Jusstin', 0, 3, 'Mauri'],
    ['Prestianni', '', '', 'Bau', '', 'Sabajero', 0, 0, 'Rodrii'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Superliga T1');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const res = await parseAndImportExcelLeague(buf, { sheetName: 'Superliga T1' });

  console.log(`\n✅ Liga creada en DB: "${res.liga.nombreLiga}"`);
  console.log(`- Fechas procesadas: ${res.totalFechas}`);
  console.log(`- Total partidos: ${res.totalPartidos}`);
  console.log(`- Campeón: ${res.campeon?.nombre} con ${res.campeon?.puntos} Pts`);

  console.log('\nTodos los jugadores creados en DB:');
  const allJugadores = await Jugador.find({});
  for (const j of allJugadores) {
    const raw = j.toJSON ? j.toJSON() : j;
    console.log(`- ID: ${raw.id || raw._id} | Nombre: ${raw.nombre} | PG: ${raw.partidosGanadosHistorico || 0} | PP: ${raw.partidosPerdidosHistorico || 0} | WO: ${raw.woHistorico || 0} | GF: ${raw.golesAFavorHistorico || 0} | GC: ${raw.golesEnContraHistorico || 0} | Títulos: ${raw.titulos || 0}`);
  }

  process.exit(0);
}

runTest().catch(err => {
  console.error('Error en test:', err);
  process.exit(1);
});
