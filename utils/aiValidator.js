import { GoogleGenAI } from '@google/genai';

/**
 * Mapea los goles detectados en pantalla hacia el Local y Visitante esperados
 * evaluando los nombres/gamertags y aliases extraídos por OCR.
 */
function assignScoresByPlayerName(localName, visitanteName, j1Name, g1, j2Name, g2, localAliases = [], visitanteAliases = []) {
  const parsedG1 = Number.isFinite(g1) ? g1 : null;
  const parsedG2 = Number.isFinite(g2) ? g2 : null;

  if (parsedG1 === null && parsedG2 === null) {
    return { golesLocal: null, golesVisitante: null };
  }

  const normalize = (str) =>
    String(str || '')
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const nLocal = normalize(localName);
  const nVisitante = normalize(visitanteName);
  const nJ1 = normalize(j1Name);
  const nJ2 = normalize(j2Name);

  const localNamesList = [nLocal, ...localAliases.map(normalize)].filter(Boolean);
  const visitanteNamesList = [nVisitante, ...visitanteAliases.map(normalize)].filter(Boolean);

  const matchesAny = (targetName, list) => {
    if (!targetName) return false;
    return list.some(candidate => candidate && (targetName.includes(candidate) || candidate.includes(targetName)));
  };

  // Coincidencias de nombres considerando aliases
  const j1MatchesLocal = matchesAny(nJ1, localNamesList);
  const j1MatchesVisitante = matchesAny(nJ1, visitanteNamesList);
  const j2MatchesLocal = matchesAny(nJ2, localNamesList);
  const j2MatchesVisitante = matchesAny(nJ2, visitanteNamesList);

  // Si el Jugador 1 en captura es el Visitante o el Jugador 2 en captura es el Local -> Los goles están en orden inverso en pantalla
  const isInverted = (j1MatchesVisitante && !j1MatchesLocal) || (j2MatchesLocal && !j2MatchesVisitante);

  if (isInverted) {
    return {
      golesLocal: parsedG2 !== null ? parsedG2 : parsedG1,
      golesVisitante: parsedG1 !== null ? parsedG1 : parsedG2
    };
  }

  return {
    golesLocal: parsedG1 !== null ? parsedG1 : parsedG2,
    golesVisitante: parsedG2 !== null ? parsedG2 : parsedG1
  };
}

/**
 * Analiza una captura de pantalla de resultado usando el SDK oficial de Google Gemini (@google/genai).
 * Extrae los nombres y marcadores visibles, e infiere en el cliente a qué jugador pertenece cada puntaje.
 */
export async function analyzeMatchScreenshot({
  imageBuffer,
  mimeType = 'image/png',
  localName = 'Local',
  visitanteName = 'Visitante',
  localAliases = [],
  visitanteAliases = [],
  competitionName = 'Torneo',
  apiKey = process.env.GEMINI_API_KEY
}) {
  if (!apiKey) {
    return { valido: false, error: 'GEMINI_API_KEY no configurada' };
  }

  const base64Image = Buffer.isBuffer(imageBuffer)
    ? imageBuffer.toString('base64')
    : imageBuffer;

  const localAliasStr = Array.isArray(localAliases) && localAliases.length > 0
    ? ` (también conocido en juego como: ${localAliases.map(a => `"${a}"`).join(', ')})`
    : '';
  const visAliasStr = Array.isArray(visitanteAliases) && visitanteAliases.length > 0
    ? ` (también conocido en juego como: ${visitanteAliases.map(a => `"${a}"`).join(', ')})`
    : '';

  const prompt = `
Eres un árbitro asistente de IA para la competición '${competitionName}'.
Se adjunta una captura de pantalla del resultado final de un partido de videojuego deportivo.

OBJETIVO:
- Determinar si la imagen muestra un marcador válido del enfrentamiento esperado.
- Extraer los nombres/gamertags visibles y los goles legibles.
- No inventar datos. Si no hay suficiente evidencia, usa null, "desconocido" o false.

Enfrentamiento esperado:
- Jugador/Equipo A: "${localName}"${localAliasStr}
- Jugador/Equipo B: "${visitanteName}"${visAliasStr}

INSTRUCCIONES ESTRICTAS:
1. Solo evalúa la captura si corresponde a un marcador o resultado de partido. Si muestra menú, lobby, pausa, loading, leaderboard o una imagen no relacionada, considera que NO es un marcador válido.
2. Compara los nombres/gamertags visibles con los esperados o sus aliases/gamertags usando texto visible. Prioriza el texto explícito sobre logos, avatares o inferencias.
3. "coincidenciaNombres":
   - "ambos": si AMBOS nombres/aliases esperados se reconocen con claridad y son distinguibles entre sí.
   - "uno": si solo UNO de los dos nombres/aliases esperados se reconoce claramente, o si el texto visible es ambiguo y podría corresponder a uno de los esperados pero no se distingue con seguridad.
   - "ninguno": si NINGUNO de los nombres/aliases esperados se reconoce, si la imagen es ambigua, o si no es un marcador válido de partido.
4. "marcadorClaro": true solo si los goles aparecen como números legibles, consistentes y sin ambigüedad. Si los números están borrosos, incompletos, duplicados, superpuestos o no se puede asignar un resultado seguro, devuelve false.
5. No asumas nombres que no estén escritos claramente en la captura. Si solo aparece un lado del marcador o una parte del resultado, usa la información disponible y evita inventar.
6. "jugador1EnCaptura" / "golesJugador1": primer jugador/equipo visible y sus goles.
7. "jugador2EnCaptura" / "golesJugador2": segundo jugador/equipo visible y sus goles.
8. "reporte": describe brevemente qué se observó y por qué se aceptó o rechazó la captura. Máx. 100 caracteres.

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{
  "coincidenciaNombres": "ambos", "uno" o "ninguno",
  "marcadorClaro": true o false,
  "jugador1EnCaptura": "nombre/gamertag del primer jugador o equipo visible en pantalla",
  "golesJugador1": numero_entero_o_null,
  "jugador2EnCaptura": "nombre/gamertag del segundo jugador o equipo visible en pantalla",
  "golesJugador2": numero_entero_o_null,
  "reporte": "descripción de máximo 100 caracteres"
}
`;

  const fallbackModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ];

  try {
    const ai = new GoogleGenAI({ apiKey });

    let response = null;
    let lastError = null;

    for (const modelName of fallbackModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType
              }
            },
            prompt
          ],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        });

        if (response && response.text) {
          break; // Éxito con este modelo
        }
      } catch (err) {
        lastError = err;
        const isHighDemandOrRateLimit = err.message?.includes('503') || err.message?.includes('429') || err.message?.includes('high demand') || err.message?.includes('UNAVAILABLE');
        if (isHighDemandOrRateLimit) {
          console.warn(`[AI Validator] Modelo ${modelName} no disponible (503/429). Intentando con modelo alternativo...`);
          // Pequeña espera de 800ms antes del siguiente modelo
          await new Promise(res => setTimeout(res, 800));
          continue;
        } else {
          // Si es otro error fatal (ej. apiKey inválida), no reintentar
          throw err;
        }
      }
    }

    if (!response || !response.text) {
      return { valido: false, error: `No se pudo obtener respuesta de la API de Gemini tras intentar con modelos alternativos: ${lastError?.message || 'Error desconocido'}` };
    }

    const jsonText = typeof response.text === 'function' ? response.text() : String(response.text || '');
    const cleanText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleanText);

    const coincidencia = String(parsed.coincidenciaNombres || 'ninguno').toLowerCase();
    const marcadorClaro = Boolean(parsed.marcadorClaro);

    const j1Nombre = String(parsed.jugador1EnCaptura || parsed.equipo1Nombre || '');
    const j1Goles = parsed.golesJugador1 !== null && parsed.golesJugador1 !== undefined
      ? parseInt(parsed.golesJugador1)
      : (parsed.goles1 !== undefined ? parseInt(parsed.goles1) : (parsed.golesLocal !== undefined ? parseInt(parsed.golesLocal) : null));

    const j2Nombre = String(parsed.jugador2EnCaptura || parsed.equipo2Nombre || '');
    const j2Goles = parsed.golesJugador2 !== null && parsed.golesJugador2 !== undefined
      ? parseInt(parsed.golesJugador2)
      : (parsed.goles2 !== undefined ? parseInt(parsed.goles2) : (parsed.golesVisitante !== undefined ? parseInt(parsed.golesVisitante) : null));

    // Asignar los goles a Local y Visitante según correspondencia de nombres y aliases
    const { golesLocal, golesVisitante } = assignScoresByPlayerName(
      localName,
      visitanteName,
      j1Nombre,
      j1Goles,
      j2Nombre,
      j2Goles,
      localAliases,
      visitanteAliases
    );

    let valido = false;
    let confianza = 'baja';

    if (coincidencia === 'ambos' && marcadorClaro && Number.isFinite(golesLocal) && Number.isFinite(golesVisitante)) {
      // Ambos coinciden + marcador claro -> Aprobación / Autocompletado directo
      valido = true;
      confianza = 'alta';
    } else if (coincidencia === 'uno' || (coincidencia === 'ambos' && !marcadorClaro)) {
      // Solo uno coincide (o marcador borroso) -> Enviado a revisión manual
      valido = false;
      confianza = 'media';
    } else {
      // Ninguno coincide o imagen inválida -> Rechazo inmediato
      valido = false;
      confianza = 'baja';
    }

    return {
      valido,
      confianza,
      coincidenciaNombres: coincidencia,
      golesLocal,
      golesVisitante,
      reporte: String(parsed.reporte || '').slice(0, 100)
    };
  } catch (error) {
    console.error('[AI Validator] Error al analizar imagen con Gemini SDK:', error.message);
    return { valido: false, error: `Error de análisis IA: ${error.message}` };
  }
}
