import '../database/polyfill.js';
import { createInterface } from 'readline';
import 'colors';
import { listAllBackups, restoreBackup } from '../database/backupManager.js';

async function askQuestion(query) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let targetPath = null;

  for (const arg of args) {
    if (arg.startsWith('--path=')) {
      targetPath = arg.split('=')[1];
    } else if (!arg.startsWith('-')) {
      targetPath = arg;
    }
  }

  const allBackups = await listAllBackups();

  if (allBackups.length === 0) {
    console.log('[Restore CLI] No se encontraron backups locales en la carpeta backups/'.yellow);
    process.exit(0);
  }

  if (!targetPath) {
    console.log('\n========================================'.bold.cyan);
    console.log('📦 BACKUPS LOCALES DISPONIBLES'.bold.cyan);
    console.log('========================================'.bold.cyan);

    allBackups.forEach((b, index) => {
      const tierBadge = `[${b.tier.toUpperCase()}]`.padEnd(10).magenta;
      const docsInfo = b.manifest ? `${b.manifest.totalDocuments} docs` : 'desconocido';
      const colInfo = b.manifest ? `${b.manifest.totalCollections} colecciones` : '';
      console.log(`[${index + 1}] ${tierBadge} ${b.folderName} (${docsInfo}, ${colInfo})`);
    });
    console.log('========================================\n'.bold.cyan);

    const selection = await askQuestion('👉 Ingrese el NÚMERO del backup que desea restaurar (o escribe "q" para cancelar): ');

    if (!selection || selection.toLowerCase() === 'q') {
      console.log('Restauración cancelada.'.gray);
      process.exit(0);
    }

    const idx = parseInt(selection, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= allBackups.length) {
      console.error('Número de selección no válido.'.red);
      process.exit(1);
    }

    targetPath = allBackups[idx].fullPath;
  }

  console.log(`\n⚠️  ATENCIÓN: Se reemplazarán los datos actuales en MongoDB con el contenido de:`.bold.yellow);
  console.log(`📁 ${targetPath}`.cyan);

  const confirm = await askQuestion('\n¿Está seguro de continuar? (s/N): ');
  if (confirm.toLowerCase() !== 's' && confirm.toLowerCase() !== 'si' && confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('Operación cancelada.'.gray);
    process.exit(0);
  }

  console.log('\n[Restore CLI] Restaurando base de datos...'.cyan);

  try {
    const summary = await restoreBackup(targetPath);
    console.log('\n========================================'.bold.green);
    console.log('✅ BASE DE DATOS RESTAURADA CON ÉXITO'.bold.green);
    console.log('========================================'.bold.green);
    console.log(`📦 Colecciones restauradas: ${summary.restoredCollections}`);
    console.log(`📄 Documentos restaurados: ${summary.restoredDocuments}`);
    console.log('----------------------------------------'.gray);
    for (const [coll, count] of Object.entries(summary.details)) {
      console.log(`  • ${coll}: ${count} docs`);
    }
    console.log('========================================\n'.bold.green);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR AL RESTAURAR BACKUP:'.bold.red, err.message);
    process.exit(1);
  }
}

main();
