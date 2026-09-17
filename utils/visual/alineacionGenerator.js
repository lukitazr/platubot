import { renderToBuffer } from './renderPool.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Coordenadas hardcodeadas (trasladadas desde s.json)
const POSITIONS = {
    dt_local:           { x: 1226, y: 459, width: 160, height: 242 },
    jugador_local1:     { x: 376,  y: 292, width: 146, height: 222 },
    jugador_local2:     { x: 619,  y: 443, width: 146, height: 222 },
    jugador_local3:     { x: 868,  y: 291, width: 146, height: 222 },
    dt_visitante:       { x: 145,  y: 0,   width: 132, height: 200 },
    jugador_visitante1: { x: 383,  y: 64,  width: 132, height: 200 },
    jugador_visitante2: { x: 634,  y: 0,   width: 132, height: 200 },
    jugador_visitante3: { x: 876,  y: 64,  width: 132, height: 200 },
    escudo_local:       { x: 51,   y: 487, width: 180, height: 180 },
    escudo_visitante:   { x: 1110, y: 11,  width: 135, height: 135 },
};

const CANVAS = { width: 1400, height: 714 };
const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';


function toBase64(src) {
    if (!src) return TRANSPARENT_PNG;
    if (src.startsWith('data:')) return src;
    if (src.startsWith('http')) return src; // Satori handles URLs
    try {
        const fullPath = src.startsWith('/') || src.includes(':') ? src : join(process.cwd(), src);
        if (existsSync(fullPath)) {
            const buf = readFileSync(fullPath);
            const ext = fullPath.endsWith('.jpg') || fullPath.endsWith('.jpeg') ? 'jpeg' : 'png';
            return `data:image/${ext};base64,${buf.toString('base64')}`;
        }
    } catch {}
    return TRANSPARENT_PNG;
}

/**
 * Genera la imagen de alineación para un partido.
 * 
 * @param {Object} params
 * @param {string} params.bgPath - Path al fondo (assets/bg/sl_bg.png)
 * @param {string} params.escudoLocal - Path/URL escudo local
 * @param {string} params.escudoVisitante - Path/URL escudo visitante
 * @param {string} params.dtLocalCard - Base64 de la carta del DT local
 * @param {string} params.dtVisitanteCard - Base64 de la carta del DT visitante
 * @param {Array<string|null>} params.jugadoresLocalCards - Array de 3 base64 de cartas (o nulls)
 * @param {Array<string>} params.jugadoresVisitanteCards - Array de 3 base64 de cartas
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generarAlineacion({
    bgPath = 'assets/bg/sl_bg.png',
    escudoLocal,
    escudoVisitante,
    dtLocalCard,
    dtVisitanteCard,
    jugadoresLocalCards = [null, null, null],
    jugadoresVisitanteCards = [],
}) {
    const bgB64 = toBase64(bgPath);

    // Build positioned elements
    const positionedElements = [];

    // Background
    positionedElements.push({
        type: 'img',
        props: {
            src: bgB64,
            style: { position: 'absolute', top: 0, left: 0, width: `${CANVAS.width}px`, height: `${CANVAS.height}px`, objectFit: 'cover' }
        }
    });

    // Helper: place a card image at a specific position
    const placeCard = (posKey, cardB64) => {
        const pos = POSITIONS[posKey];
        if (!pos || !cardB64) return;
        
        positionedElements.push({
            type: 'img',
            props: {
                src: cardB64,
                style: {
                    position: 'absolute',
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${pos.width}px`,
                    height: `${pos.height}px`,
                    objectFit: 'contain',
                }
            }
        });
    };

    // Place shields
    const placeShield = (posKey, src) => {
        const pos = POSITIONS[posKey];
        if (!pos || !src) return;
        positionedElements.push({
            type: 'img',
            props: {
                src: toBase64(src),
                style: {
                    position: 'absolute',
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${pos.width}px`,
                    height: `${pos.height}px`,
                    objectFit: 'contain',
                }
            }
        });
    };

    placeShield('escudo_local', escudoLocal);
    placeShield('escudo_visitante', escudoVisitante);

    // DTs
    placeCard('dt_local', dtLocalCard);
    placeCard('dt_visitante', dtVisitanteCard);

    // Visitantes (siempre los 3)
    for (let i = 0; i < 3; i++) {
        if (jugadoresVisitanteCards[i]) {
            placeCard(`jugador_visitante${i + 1}`, jugadoresVisitanteCards[i]);
        }
    }

    // Locales (progresivo, puede ser null)
    for (let i = 0; i < 3; i++) {
        if (jugadoresLocalCards[i]) {
            placeCard(`jugador_local${i + 1}`, jugadoresLocalCards[i]);
        }
    }

    const element = {
        type: 'div',
        props: {
            style: {
                position: 'relative',
                width: `${CANVAS.width}px`,
                height: `${CANVAS.height}px`,
                display: 'flex',
                fontFamily: 'Inter',
            },
            children: positionedElements
        }
    };

    return renderToBuffer(element, CANVAS.width, CANVAS.height);
}

/**
 * Genera una imagen tipo tabla/fixture con los enfrentamientos individuales (sin goles).
 * Se usa cuando hay más de 3 duelos.
 *
 * @param {Object} params
 * @param {string} params.titulo - Título del match (ej: "Alfa vs Beta")
 * @param {string} params.subtitulo - Subtítulo (ej: "Torneo de Equipos - Fecha 1")
 * @param {Array<{localNombre: string, visitanteNombre: string, localAvatar?: string, visitanteAvatar?: string}>} params.duelos
 * @param {Object} params.tema - { primario, secundario, acento, texto, borde }
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generarAlineacionTabla({
    titulo = 'Alineación',
    subtitulo = '',
    duelos = [],
    tema = {},
}) {
    const t = {
        primario: tema.primario || '#1a1a2e',
        secundario: tema.secundario || '#16213e',
        acento: tema.acento || '#e94560',
        texto: tema.texto || '#ffffff',
        borde: tema.borde || '#0f3460',
    };

    const ROW_H = 70;
    const HEADER_H = 120;
    const WIDTH = 800;
    const totalHeight = HEADER_H + duelos.length * ROW_H + 40;

    const avatarEl = (src, nombre) => {
        if (src) {
            return {
                type: 'img',
                props: {
                    src,
                    width: 40,
                    height: 40,
                    style: { borderRadius: '50%', objectFit: 'cover', border: `2px solid ${t.borde}66`, background: t.secundario }
                }
            };
        }
        const initial = (nombre || '?')[0].toUpperCase();
        return {
            type: 'div',
            props: {
                style: { width: '40px', height: '40px', borderRadius: '50%', background: t.secundario, border: `2px solid ${t.borde}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `${t.texto}88`, fontSize: '16px', fontWeight: 700 },
                children: initial
            }
        };
    };

    const rows = duelos.map((d, idx) => ({
        type: 'div',
        props: {
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: `${ROW_H}px`, width: '100%',
                background: idx % 2 === 0 ? `${t.secundario}88` : `${t.primario}88`,
                borderBottom: `1px solid ${t.borde}33`,
                padding: '0 20px',
            },
            children: [
                // Duelo number
                {
                    type: 'div',
                    props: {
                        style: { width: '50px', fontSize: '13px', fontWeight: 700, color: t.acento, textAlign: 'center' },
                        children: `#${idx + 1}`
                    }
                },
                // Local side
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-end', paddingRight: '16px' },
                        children: [
                            {
                                type: 'div',
                                props: {
                                    style: { fontSize: '16px', fontWeight: 700, color: t.texto, textAlign: 'right' },
                                    children: d.localNombre || '⏳ Pendiente'
                                }
                            },
                            avatarEl(d.localAvatar, d.localNombre)
                        ]
                    }
                },
                // VS badge
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '60px', height: '36px',
                            background: `${t.secundario}cc`, border: `1px solid ${t.borde}`,
                            borderRadius: '4px'
                        },
                        children: { type: 'div', props: { style: { fontSize: '14px', fontWeight: 900, color: t.acento }, children: 'VS' } }
                    }
                },
                // Visitante side
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-start', paddingLeft: '16px' },
                        children: [
                            avatarEl(d.visitanteAvatar, d.visitanteNombre),
                            {
                                type: 'div',
                                props: {
                                    style: { fontSize: '16px', fontWeight: 700, color: t.texto },
                                    children: d.visitanteNombre || '⏳ Pendiente'
                                }
                            }
                        ]
                    }
                },
            ]
        }
    }));

    const element = {
        type: 'div',
        props: {
            style: {
                position: 'relative',
                width: `${WIDTH}px`,
                height: `${totalHeight}px`,
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter',
                background: `linear-gradient(180deg, ${t.secundario} 0%, ${t.primario} 100%)`,
            },
            children: [
                // Header
                {
                    type: 'div',
                    props: {
                        style: {
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            height: `${HEADER_H}px`, width: '100%',
                            borderBottom: `2px solid ${t.acento}`,
                            padding: '10px 0',
                        },
                        children: [
                            { type: 'div', props: { style: { fontSize: '26px', fontWeight: 900, color: t.texto, letterSpacing: '1px' }, children: titulo } },
                            subtitulo ? { type: 'div', props: { style: { fontSize: '14px', fontWeight: 500, color: `${t.texto}99`, marginTop: '6px' }, children: subtitulo } } : null
                        ].filter(Boolean)
                    }
                },
                // Rows
                ...rows
            ]
        }
    };

    return renderToBuffer(element, WIDTH, totalHeight);
}
