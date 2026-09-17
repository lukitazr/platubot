import Jugador from '../../models/Jugador.js';

/**
 * Normaliza cualquier formato de títulos (número, array simple, nulo o ya estructurado)
 * al formato estándar: { oficiales: string[], amistosos: string[] }
 * 
 * @param {any} titulos - Dato crudo de títulos
 * @returns {{ oficiales: string[], amistosos: string[] }}
 */
export function normalizeTitulos(titulos) {
  if (!titulos) {
    return { oficiales: [], amistosos: [] };
  }

  // Si es un número (formato legacy previo)
  if (typeof titulos === 'number') {
    const count = Math.max(0, parseInt(titulos, 10) || 0);
    return {
      oficiales: Array.from({ length: count }, (_, i) => `Título Oficial #${i + 1}`),
      amistosos: []
    };
  }

  // Si es un array simple (asumimos oficiales)
  if (Array.isArray(titulos)) {
    return {
      oficiales: titulos.map(t => typeof t === 'string' ? t : (t?.nombre || String(t))),
      amistosos: []
    };
  }

  // Si es un objeto
  if (typeof titulos === 'object') {
    const oficiales = Array.isArray(titulos.oficiales)
      ? titulos.oficiales.map(t => typeof t === 'string' ? t : (t?.nombre || String(t)))
      : (typeof titulos.oficiales === 'number' ? Array.from({ length: Math.max(0, titulos.oficiales) }, (_, i) => `Título Oficial #${i + 1}`) : []);

    const amistosos = Array.isArray(titulos.amistosos)
      ? titulos.amistosos.map(t => typeof t === 'string' ? t : (t?.nombre || String(t)))
      : (typeof titulos.amistosos === 'number' ? Array.from({ length: Math.max(0, titulos.amistosos) }, (_, i) => `Título Amistoso #${i + 1}`) : []);

    return { oficiales, amistosos };
  }

  return { oficiales: [], amistosos: [] };
}

/**
 * Obtiene las cantidades numéricas de títulos oficiales, amistosos y totales.
 * 
 * @param {any} titulos
 * @returns {{ oficiales: number, amistosos: number, total: number }}
 */
export function getTitulosCount(titulos) {
  const norm = normalizeTitulos(titulos);
  return {
    oficiales: norm.oficiales.length,
    amistosos: norm.amistosos.length,
    total: norm.oficiales.length + norm.amistosos.length
  };
}

/**
 * Adjudica un título (oficial o amistoso) a un jugador en la base de datos.
 * 
 * @param {object|string} playerDocOrIdentifier - Documento de Jugador o ID/Nombre
 * @param {object} options
 * @param {string} options.nombreTorneo - Nombre del torneo/título ganado
 * @param {boolean} options.esOficial - true si es oficial, false si es amistoso
 * @returns {Promise<{ success: boolean, playerDoc?: object, error?: string }>}
 */
export async function awardTitle(playerDocOrIdentifier, { nombreTorneo = 'Torneo Ganado', esOficial = true } = {}) {
  try {
    let doc = playerDocOrIdentifier;

    if (!doc || typeof doc === 'string') {
      const idStr = String(playerDocOrIdentifier).trim();
      doc = await Jugador.findOne({
        $or: [
          { _id: idStr },
          { id: idStr },
          { discordId: idStr },
          { nombre: new RegExp(`^${idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        ]
      }).catch(() => null);
    }

    if (!doc) {
      return { success: false, error: 'Jugador no encontrado para adjudicar título.' };
    }

    const norm = normalizeTitulos(doc.titulos);
    const titleEntry = String(nombreTorneo || (esOficial ? 'Título Oficial' : 'Título Amistoso')).trim();

    if (esOficial) {
      norm.oficiales.push(titleEntry);
    } else {
      norm.amistosos.push(titleEntry);
    }

    doc.titulos = norm;
    if (doc.save && typeof doc.save === 'function') {
      await doc.save();
    } else {
      await Jugador.updateById(doc.id || doc._id, { titulos: norm });
    }

    return { success: true, playerDoc: doc };
  } catch (error) {
    console.error('[TitulosHelper] Error al otorgar título:', error);
    return { success: false, error: error.message };
  }
}
