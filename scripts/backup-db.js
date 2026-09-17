import '../database/polyfill.js';
import 'colors';
import { createBackup, BACKUP_TIERS } from '../database/backupManager.js';

async function main() {
  const args = process.argv.slice(2);
  let tier = 'manual';

  for (const arg of args) {
    if (arg.startsWith('--tier=')) {
      tier = arg.split('=')[1];
    } else if (!arg.startsWith('-')) {
      tier = arg;
    }
  }

  const validTiers = [...Object.keys(BACKUP_TIERS), 'manual'];
  if (!validTiers.includes(tier)) {
    console.log(`[Backup CLI] Nivel '${tier}' no reconocido. Niveles válidos: ${validTiers.join(', ')}`.yellow);
    console.log(`[Backup CLI] Usando nivel 'manual'...`.gray);
    tier = 'manual';
  }

  console.log(`[Backup CLI] Iniciando backup local bajo nivel: ${tier.toUpperCase()}...`.cyan);

  try {
    const result = await createBackup(tier);
    console.log('\n========================================'.bold.green);
    console.log('✅ BACKUP COMPLETADO CON ÉXITO'.bold.green);
    console.log('========================================'.bold.green);
    console.log(`📁 Directorio: ${result.backupPath}`);
    console.log(`⏱️  Nivel: ${result.tier}`);
    console.log(`📦 Colecciones respaldadas: ${result.manifest.totalCollections}`);
    console.log(`📄 Documentos totales: ${result.manifest.totalDocuments}`);
    console.log(`💾 Tamaño aproximado: ${(result.manifest.totalBytes / 1024).toFixed(2)} KB`);
    console.log('----------------------------------------'.gray);
    for (const [coll, info] of Object.entries(result.manifest.collections)) {
      console.log(`  • ${coll}: ${info.documents} docs (${(info.bytes / 1024).toFixed(1)} KB)`);
    }
    console.log('========================================\n'.bold.green);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR DURANTE EL BACKUP:'.bold.red, err.message);
    process.exit(1);
  }
}

main();
