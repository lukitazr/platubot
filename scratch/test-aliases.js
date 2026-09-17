import '../database/polyfill.js';
import Jugador from '../models/Jugador.js';
import { editPlayer } from '../utils/db/editPlayer.js';

async function testAliases() {
  console.log('🧪 Iniciando prueba de aliases...');

  // Crear o buscar jugador de prueba
  let jugador = await Jugador.findOne({ id: 'test_alias_user' });
  if (!jugador) {
    jugador = await Jugador.create({
      id: 'test_alias_user',
      nombre: 'UsuarioPrueba',
      aliases: ['gamertag_antiguo']
    });
  }

  // 1. Agregar alias
  console.log('1. Agregando alias...');
  await editPlayer('test_alias_user', { aliases: 'gamer123, pro_player_99', appendAlias: true });
  jugador = await Jugador.findOne({ id: 'test_alias_user' });
  console.log('Aliases actuales:', jugador.aliases);

  if (!jugador.aliases.includes('gamer123') || !jugador.aliases.includes('pro_player_99')) {
    throw new Error('Fallo al agregar aliases.');
  }

  // 2. Limpiar jugador de prueba
  await Jugador.deleteById('test_alias_user');
  console.log('✅ Prueba de aliases completada con éxito.');
  process.exit(0);
}

testAliases().catch(err => {
  console.error('❌ Error en prueba:', err);
  process.exit(1);
});
