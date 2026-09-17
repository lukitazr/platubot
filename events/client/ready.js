import { init as initBackup } from '../../database/backupManager.js';
import { connectDB } from '../../database/connection.js';

export default {
  name: 'clientReady',
  once: true,
  run: async (client) => {
    try {
      await connectDB();
      console.log(`🍃 SISTEMA DE BASE DE DATOS LOCAL MONGODB INICIADO`.green);
    } catch (e) {
      console.error('Error al conectar con MongoDB:'.red, e);
    }

    console.log(`SESIÓN INICIADA COMO ${client.user.tag}`.green);

    // Initialize backup system and HTTP server
    try {
      await initBackup(client);
    } catch (err) {
      console.error('Failed to initialize backup system and API server:', err);
    }
  }
}
