import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const BIN_DIR = join(process.cwd(), 'bin');
const DATA_DIR = join(process.cwd(), 'mongodb_data');

if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const mongodPath = join(BIN_DIR, 'mongod.exe');
const mongoshPath = join(BIN_DIR, 'mongosh.exe');

async function downloadAndExtract(url, zipName, targetExeName) {
  const zipPath = join(BIN_DIR, zipName);
  console.log(`Descargando ${zipName}...`);
  
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  await Bun.write(zipPath, buffer);
  
  console.log(`Extrayendo ${zipName}...`);
  execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}\\temp_${zipName}' -Force"`);
  
  // Buscar el .exe extraído y moverlo a bin/
  const foundExe = execSync(`powershell -Command "Get-ChildItem '${BIN_DIR}\\temp_${zipName}' -Recurse -Filter '${targetExeName}' | Select-Object -ExpandProperty FullName"`).toString().trim();
  
  if (foundExe && existsSync(foundExe)) {
    const dest = join(BIN_DIR, targetExeName);
    execSync(`powershell -Command "Copy-Item '${foundExe}' '${dest}' -Force"`);
    console.log(`¡${targetExeName} instalado correctamente en ${dest}!`);
  } else {
    throw new Error(`No se pudo encontrar ${targetExeName} en ${zipName}`);
  }
  
  // Limpiar temporales
  execSync(`powershell -Command "Remove-Item '${zipPath}' -Force; Remove-Item '${BIN_DIR}\\temp_${zipName}' -Recurse -Force"`);
}

async function main() {
  if (!existsSync(mongodPath)) {
    console.log('MongoDB Server (mongod.exe) no encontrado. Instalando...');
    await downloadAndExtract(
      'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.14.zip',
      'mongodb.zip',
      'mongod.exe'
    );
  } else {
    console.log(`mongod.exe ya está presente en ${mongodPath}`);
  }

  if (!existsSync(mongoshPath)) {
    console.log('mongosh (mongosh.exe) no encontrado. Instalando...');
    await downloadAndExtract(
      'https://downloads.mongodb.com/compass/mongosh-2.3.9-win32-x64.zip',
      'mongosh.zip',
      'mongosh.exe'
    );
  } else {
    console.log(`mongosh.exe ya está presente en ${mongoshPath}`);
  }

  console.log('\n--- INSTALACIÓN LOCAL COMPLETADA ---');
  console.log(`bin/mongod.exe: ${existsSync(mongodPath)}`);
  console.log(`bin/mongosh.exe: ${existsSync(mongoshPath)}`);
}

main().catch(err => {
  console.error('Error durante la instalación local de MongoDB:', err);
  process.exit(1);
});
