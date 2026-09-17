/**
 * Genera un bracket de eliminación directa balanceado.
 * @param {Array} equipos 
 * @param {string} tipoEncuentro 'unico' o 'ida_vuelta'
 */
export default function generarBracket(equipos, tipoEncuentro = 'ida_vuelta') {
  // Shuffle aleatorio (Fisher-Yates)
  const shuffled = equipos.map(e => {
    const plain = (e && typeof e.toObject === 'function') ? e.toObject() : e;
    return {
      ...plain,
      discordId: plain.discordId || plain.propietario || plain.nombre
    };
  });
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Calcular potencia de 2 más cercana superior o igual
  const n = shuffled.length;
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const numByes = bracketSize - n;

  const slots = [...shuffled];
  for (let i = 0; i < numByes; i++) {
    slots.push({ nombre: 'BYE', discordId: 'BYE' });
  }

  const seeded = seedBracket(slots, bracketSize);

  const fasesPorTamaño = {
    2:  ['Final'],
    4:  ['Semifinales', 'Final'],
    8:  ['Cuartos', 'Semifinales', 'Final'],
    16: ['Octavos', 'Cuartos', 'Semifinales', 'Final'],
    32: ['Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinales', 'Final'],
    64: ['Treintaidosavos', 'Dieciseisavos', 'Octavos', 'Cuartos', 'Semifinales', 'Final'],
  };

  const fasesEliminatoria = fasesPorTamaño[bracketSize] ?? generarNombresFases(bracketSize);

  const llaves = {};
  const primeraFase = fasesEliminatoria[0];
  const matchesR1 = [];

  for (let i = 0; i < seeded.length; i += 2) {
    const eq1 = seeded[i];
    const eq2 = seeded[i + 1];
    const isBye = eq1.discordId === 'BYE' || eq2.discordId === 'BYE';

    const llave = {
      id: `${primeraFase.toLowerCase().slice(0, 3)}_${Math.floor(i / 2) + 1}`,
      equipo1: eq1.discordId !== 'BYE' ? eq1 : eq2,
      equipo2: eq2.discordId !== 'BYE' ? eq2 : eq1,
      ida: { golesLocal: null, golesVisitante: null, finalizado: false },
      vuelta: tipoEncuentro === 'unico' ? null : { golesLocal: null, golesVisitante: null, finalizado: false },
      desempate: tipoEncuentro === 'unico' ? null : { golesLocal: null, golesVisitante: null, finalizado: false },
      ganador: null,
    };

    if (isBye) {
      const winner = eq1.discordId !== 'BYE' ? eq1 : eq2;
      llave.equipo2 = { nombre: 'BYE', discordId: 'BYE' };
      llave.ida.golesLocal = 3; llave.ida.golesVisitante = 0; llave.ida.finalizado = true;
      if (llave.vuelta) { llave.vuelta.golesLocal = 3; llave.vuelta.golesVisitante = 0; llave.vuelta.finalizado = true; }
      llave.ganador = winner.discordId || winner.nombre;
    }

    matchesR1.push(llave);
  }

  llaves[primeraFase] = matchesR1;

  for (let f = 1; f < fasesEliminatoria.length; f++) {
    const fase = fasesEliminatoria[f];
    const prevFase = fasesEliminatoria[f - 1];
    const numMatches = llaves[prevFase].length / 2;
    const matchesFase = [];

    for (let i = 0; i < numMatches; i++) {
      matchesFase.push({
        id: `${fase.toLowerCase().slice(0, 3)}_${i + 1}`,
        equipo1: { nombre: 'TBD', discordId: null },
        equipo2: { nombre: 'TBD', discordId: null },
        ida: { golesLocal: null, golesVisitante: null, finalizado: false },
        vuelta: tipoEncuentro === 'unico' ? null : { golesLocal: null, golesVisitante: null, finalizado: false },
        desempate: tipoEncuentro === 'unico' ? null : { golesLocal: null, golesVisitante: null, finalizado: false },
        ganador: null,
      });
    }

    llaves[fase] = matchesFase;
  }

  return {
    fasesEliminatoria,
    llaves,
    equipos: shuffled.filter(e => e.discordId !== 'BYE'),
  };
}

/**
 * Distribuye los equipos en el bracket de forma que los BYEs queden
 * lo más repartidos posible (estándar de torneos).
 */
function seedBracket(slots, bracketSize) {
  // Separar reales y BYEs
  const reales = slots.filter(s => s.discordId !== 'BYE');
  const byes = slots.filter(s => s.discordId === 'BYE');

  // Crear bracket vacío
  const bracket = new Array(bracketSize).fill(null);

  // Generar posiciones estándar de seeding
  const positions = generateSeedPositions(bracketSize);

  // Colocar equipos reales primero, luego BYEs
  const ordenados = [...reales, ...byes];
  for (let i = 0; i < bracketSize; i++) {
    bracket[positions[i]] = ordenados[i];
  }

  return bracket;
}

/**
 * Genera el orden de posiciones de seeding estándar para un bracket.
 * Para un bracket de 8: [0, 7, 3, 4, 1, 6, 2, 5]
 * Esto asegura que el seed 1 vs seed 8, 4 vs 5, 2 vs 7, 3 vs 6.
 */
function generateSeedPositions(size) {
  if (size === 1) return [0];
  const half = generateSeedPositions(size / 2);
  const result = [];
  for (const pos of half) {
    result.push(pos * 2);
    result.push(size - 1 - pos * 2);
  }
  return result;
}

/**
 * Genera nombres de fases para brackets muy grandes (fallback).
 */
function generarNombresFases(bracketSize) {
  const fases = [];
  let current = bracketSize;
  while (current >= 2) {
    if (current === 2) fases.push('Final');
    else if (current === 4) fases.push('Semifinales');
    else if (current === 8) fases.push('Cuartos');
    else if (current === 16) fases.push('Octavos');
    else fases.push(`Ronda de ${current}`);
    current /= 2;
  }
  return fases.reverse();
}

/**
 * Avanza la fase actual de la coppa.
 * Toma los ganadores de la fase actual y los coloca en la siguiente.
 * @param {object} coppa — documento de la coppa
 * @returns {string|null} nombre de la nueva fase, o null si ya terminó
 */
export function avanzarFase(coppa) {
  const faseIdx = coppa.faseActual;
  const fases = coppa.fasesEliminatoria;

  if (faseIdx >= fases.length - 1) return null; // Ya estamos en la final o más allá

  const faseActualNombre = fases[faseIdx];
  const siguienteFaseNombre = fases[faseIdx + 1];
  const llavesActuales = coppa.llaves[faseActualNombre];
  const llavesSiguientes = coppa.llaves[siguienteFaseNombre];

  // Colocar ganadores en la siguiente fase
  for (let i = 0; i < llavesActuales.length; i += 2) {
    const ganador1 = getEquipoById(llavesActuales[i], llavesActuales[i].ganador);
    const ganador2 = getEquipoById(llavesActuales[i + 1], llavesActuales[i + 1].ganador);
    const matchIdx = Math.floor(i / 2);

    llavesSiguientes[matchIdx].equipo1 = ganador1 ? { ...ganador1 } : { nombre: 'TBD', discordId: null };
    llavesSiguientes[matchIdx].equipo2 = ganador2 ? { ...ganador2 } : { nombre: 'TBD', discordId: null };
  }

  coppa.faseActual = faseIdx + 1;
  return siguienteFaseNombre;
}

function getEquipoById(llave, discordId) {
  if (!discordId) return null;
  if ((llave.equipo1.discordId || llave.equipo1.nombre) === discordId) return llave.equipo1;
  if ((llave.equipo2.discordId || llave.equipo2.nombre) === discordId) return llave.equipo2;
  return null;
}

/**
 * Determina el ganador de una llave (ida + vuelta, desempate si empate global).
 * @returns {string|null} discordId del ganador, o null si no se ha definido aún
 */
export function determinarGanadorLlave(llave) {
  if (!llave.ida.finalizado || !llave.vuelta.finalizado) return null;

  const globalEq1 = llave.ida.golesLocal + llave.vuelta.golesVisitante;
  const globalEq2 = llave.ida.golesVisitante + llave.vuelta.golesLocal;

  if (globalEq1 > globalEq2) return llave.equipo1.discordId || llave.equipo1.nombre;
  if (globalEq2 > globalEq1) return llave.equipo2.discordId || llave.equipo2.nombre;

  // Empate global → necesita desempate
  if (!llave.desempate.finalizado) return null;

  if (llave.desempate.golesLocal > llave.desempate.golesVisitante) return llave.equipo1.discordId || llave.equipo1.nombre;
  if (llave.desempate.golesVisitante > llave.desempate.golesLocal) return llave.equipo2.discordId || llave.equipo2.nombre;

  // Si el desempate también es empate (no debería pasar), equipo1 avanza
  return llave.equipo1.discordId || llave.equipo1.nombre;
}
