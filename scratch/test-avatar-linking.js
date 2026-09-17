import '../database/polyfill.js';
import { connectDB } from '../database/connection.js';
import Jugador from '../models/Jugador.js';
import { getOrCachePlayerAvatar } from '../utils/visual/avatarCache.js';

async function runTest() {
  console.log('--- TEST DE VINCULACIÓN Y CACHEO DE AVATARES POR DISCORD ID ---');
  await connectDB();

  // 1. Crear o actualizar un jugador de prueba histórico con ID genérico 'ters_test' y discordId
  const testDiscordId = '751663890441699409';
  let p = await Jugador.findById('ters_test');
  if (!p) {
    p = await Jugador.create({
      id: 'ters_test',
      nombre: 'Ters Test',
      discordId: testDiscordId,
      avatar: null
    });
  } else {
    await p.update({ discordId: testDiscordId });
  }

  console.log('Jugador en DB antes de resolver avatar:', {
    _id: p._id,
    nombre: p.nombre,
    discordId: p.discordId,
    avatar: p.avatar
  });

  // Mock del cliente de Discord
  const mockClient = {
    users: {
      fetch: async (id) => ({
        displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
      })
    }
  };

  console.log('Ejecutando getOrCachePlayerAvatar("ters_test", mockClient)...');
  const base64Avatar = await getOrCachePlayerAvatar('ters_test', mockClient);

  const updatedP = await Jugador.findById('ters_test');
  console.log('\nJugador en DB después de resolver avatar:', {
    _id: updatedP._id,
    nombre: updatedP.nombre,
    discordId: updatedP.discordId,
    avatar: updatedP.avatar,
    hasBase64: !!base64Avatar,
    base64Prefix: base64Avatar ? base64Avatar.slice(0, 30) : null
  });

  console.log('\n--- PRUEBA COMPLETADA CON ÉXITO ---');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Error en test:', err);
  process.exit(1);
});
