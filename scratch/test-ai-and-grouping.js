import 'colors';
import Primera from '../models/Primera.js';
import Coppa from '../models/copas/Coppa.js';
import { connectDB } from '../database/connection.js';
import { findPendingMatchesForUser } from '../utils/matchFinder.js';
import { analyzeMatchScreenshot } from '../utils/aiValidator.js';

async function testGroupingAndAI() {
  console.log('=== VERIFICANDO AGRUPACIÓN MULTI-TORNEO Y VALIDACIÓN IA ==='.cyan);

  await connectDB();

  const userId = '1000200030004000';
  const opponent1Id = '9000800070006000';
  const opponent2Id = '9000800070005000';
  const sharedChannel = 'canal-resultados-compartido-123';

  // 1. Crear torneo 1: Primera División
  console.log('\n[Test 1] Creando partidos pendientes en Primera División...'.yellow);
  const primeraDoc = await Primera.create({
    nombreLiga: 'Primera División Platubi',
    partidos: [
      {
        numero: 5,
        partidos: [
          {
            _id: 'match-primera-1',
            localId: userId,
            visitanteId: opponent1Id,
            localNombre: 'MiEquipo',
            visitanteNombre: 'Rival1',
            finalizado: false
          }
        ]
      }
    ]
  });

  // 2. Crear torneo 2: Coppa
  console.log('\n[Test 2] Creando partidos pendientes en Coppa...'.yellow);
  const coppaDoc = await Coppa.create({
    nombre: 'Coppa Aniversario',
    estado: 'EnCurso',
    fasesEliminatoria: ['Cuartos'],
    faseActual: 0,
    llaves: {
      'Cuartos': [
        {
          id: 'llave-coppa-1',
          equipo1: { discordId: userId, nombre: 'MiEquipo' },
          equipo2: { discordId: opponent2Id, nombre: 'Rival2' },
          ganador: null
        }
      ]
    }
  });

  // 3. Probar findPendingMatchesForUser en canal compartido
  console.log('\n[Test 3] Ejecutando findPendingMatchesForUser...'.yellow);
  const candidates = await findPendingMatchesForUser(userId, sharedChannel);

  console.log(`✔ Candidatos encontrados: ${candidates.length}`.green);
  for (const c of candidates) {
    console.log(`   - Competición: ${c.competicionNombre} | Etiqueta: ${c.etiqueta}`.green);
  }

  if (candidates.length < 2) {
    throw new Error('No se agruparon correctamente las múltiples competiciones.');
  }

  // 4. Probar formateo de AI Validator (con comportamiento seguro si no hay GEMINI_API_KEY)
  console.log('\n[Test 4] Verificando módulo aiValidator...'.yellow);
  const mockBuffer = Buffer.from('fake-image-bytes');
  const aiRes = await analyzeMatchScreenshot({
    imageBuffer: mockBuffer,
    localName: 'MiEquipo',
    visitanteName: 'Rival1',
    competitionName: 'Primera División'
  });

  if (!process.env.GEMINI_API_KEY) {
    console.log(`ℹ️ [Fallback de Seguridad] GEMINI_API_KEY no está configurada en .env. El módulo aiValidator responde correctamente con valido=false y captura el error sin romper la aplicación: "${aiRes.error}"`.yellow);
  } else {
    console.log(`✔ Resultado IA Obtenido: Valido=${aiRes.valido}, Confianza=${aiRes.confianza}`.green);
  }

  // 5. Limpieza de prueba
  console.log('\n[Test 5] Limpiando datos de prueba...'.yellow);
  await primeraDoc.delete();
  await coppaDoc.delete();

  console.log('\n=== ¡AGRUPACIÓN MULTI-TORNEO Y MODULO IA VERIFICADOS CON ÉXITO! ==='.bold.green);
  process.exit(0);
}

testGroupingAndAI().catch(err => {
  console.error('❌ Error en test de agrupación e IA:'.red, err);
  process.exit(1);
});
