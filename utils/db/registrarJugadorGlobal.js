import { syncUserGlobal } from "./globalUserSync.js";

export default async function registrarJugadorGlobal(n, id, liga) {
  try {
    const jugador = await syncUserGlobal(id, { nombre: n, ligaActual: liga });
    return { success: true, message: 'Jugador registrado y sincronizado globalmente.', data: jugador };
  } catch (error) {
    console.error('Error en registrarJugadorGlobal:', error);
    return { success: false, message: 'Error al registrar jugador global.', error };
  }
}