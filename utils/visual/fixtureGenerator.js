import { renderToBuffer } from './renderPool.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getFlagUrl } from './countryHelper.js';

// ── Helpers Visuales ────────────────────────────────────────────────────────

function avatarElement(urlOrMiembros, nombre, t, size = 32) {
    let miembros = Array.isArray(urlOrMiembros) ? urlOrMiembros : null;
    let url = typeof urlOrMiembros === 'string' ? urlOrMiembros : null;

    if (miembros && miembros.length >= 2) {
        const m1 = miembros[0] || {};
        const m2 = miembros[1] || {};
        const safeUrl1 = typeof m1.avatar === 'string' ? m1.avatar : getFlagUrl(m1.nombre || nombre);
        const safeUrl2 = typeof m2.avatar === 'string' ? m2.avatar : getFlagUrl(m2.nombre || nombre);

        return {
            type: 'div',
            props: {
                style: { position: 'relative', width: `${size + 12}px`, height: `${size}px`, flexShrink: 0, display: 'flex' },
                children: [
                    {
                        type: 'div',
                        props: {
                            style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#111', border: `1px solid ${t.borde}44`, overflow: 'hidden', position: 'absolute', left: '12px', display: 'flex' },
                            children: safeUrl2 ? { type: 'img', props: { src: safeUrl2, width: size, height: size, style: { objectFit: 'cover' } } } : { type: 'span', props: { style: { margin: 'auto', fontSize: `${size * 0.4}px` }, children: '👤' } }
                        }
                    },
                    {
                        type: 'div',
                        props: {
                            style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#111', border: `1px solid ${t.borde}44`, overflow: 'hidden', position: 'absolute', left: 0, display: 'flex' },
                            children: safeUrl1 ? { type: 'img', props: { src: safeUrl1, width: size, height: size, style: { objectFit: 'cover' } } } : { type: 'span', props: { style: { margin: 'auto', fontSize: `${size * 0.4}px` }, children: '👤' } }
                        }
                    }
                ]
            }
        };
    }

    const flagUrl = getFlagUrl(nombre);
    const finalUrl = url || flagUrl;

    if (typeof finalUrl === 'string' && finalUrl.length > 0) {
        return {
            type: 'img',
            props: {
                src: finalUrl,
                width: size,
                height: size,
                style: { borderRadius: '50%', objectFit: 'cover', border: `1px solid ${t.borde}44`, background: t.secundario }
            }
        };
    }

    const initial = (nombre || '?')[0].toUpperCase();
    return {
        type: 'div',
        props: {
            style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: t.secundario, border: `1px solid ${t.borde}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `${t.texto}88`, fontSize: `${size * 0.4}px`, fontWeight: 700 },
            children: initial
        }
    };
}

// ── Generador Base ─────────────────────────────────────────────────────────


/**
 * Genera una imagen del fixture con un diseño moderno.
 * @param {Object} options 
 * @param {string} options.titulo 
 * @param {string} options.subtitulo 
 * @param {Array} options.partidos [{ local, visitante, resultado, ganador, avatarL, avatarV, ida, vuelta, desempate }]
 * @param {Object} options.tema { primario, secundario, acento, texto, borde }
 */
export async function generarFixtureImagen(options) {
    const { titulo, subtitulo, partidos, tema, tipoEncuentro } = options;
    
    const t = {
        primario: tema?.primario || '#1a1a2e',
        secundario: tema?.secundario || '#16213e',
        acento: tema?.acento || '#e94560',
        texto: tema?.texto || '#ffffff',
        borde: tema?.borde || '#0f3460',
    };

    const rowHeight = 70;
    const headerHeight = 150;

    // Determinar columnas según cantidad de partidos
    const cols = partidos.length > 8 ? 2 : 1;
    const width = cols === 2 ? 1500 : 800;

    // Calcular altura total considerando duelos individuales y encabezados de fecha
    let col1Height = 0;
    let col2Height = 0;
    
    partidos.forEach((p, idx) => {
        const duels = p.duelosIndividuales?.length || 0;
        const fechaExtra = p.fechaLabel ? 32 : 0;
        const matchHeight = rowHeight + (duels * 40) + fechaExtra + 20; // 20px de padding/gap
        if (cols === 1) {
            col1Height += matchHeight;
        } else {
            if (idx < Math.ceil(partidos.length / 2)) {
                col1Height += matchHeight;
            } else {
                col2Height += matchHeight;
            }
        }
    });

    const maxColsHeight = Math.max(col1Height, col2Height);
    const totalHeight = headerHeight + maxColsHeight + 40;

    const bgProps = { 
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
        background: `linear-gradient(180deg, ${t.secundario} 0%, ${t.primario} 100%)` 
    };

    const rows = partidos.map((p, i) => {
        const isIdaVuelta = (tipoEncuentro === 'ida_vuelta' || p.tipoEncuentro === 'ida_vuelta') && Boolean(p.vuelta);
        const done = p.resultado && p.resultado !== 'Pendiente';
        
        let marcadorElement;

        if (isIdaVuelta) {
            // Diseño para Ida y Vuelta (Múltiples cajitas)
            const scores = [];
            if (p.ida) scores.push({ label: 'IDA', val: p.ida.finalizado ? `${p.ida.golesLocal}-${p.ida.golesVisitante}` : 'VS' });
            if (p.vuelta) scores.push({ label: 'VUE', val: p.vuelta.finalizado ? `${p.vuelta.golesVisitante}-${p.vuelta.golesLocal}` : 'VS' }); // Invertido porque equipo 2 es local en vuelta
            if (p.desempate?.finalizado) scores.push({ label: 'DES', val: `${p.desempate.golesLocal}-${p.desempate.golesVisitante}` });

            marcadorElement = {
                type: 'div',
                props: {
                    style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', width: '200px' },
                    children: scores.map(s => ({
                        type: 'div',
                        props: {
                            style: { 
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                width: '60px', height: '48px', background: 'rgba(0,0,0,0.5)', 
                                border: `1px solid ${s.val !== 'VS' ? t.acento : t.borde}`, borderRadius: '6px'
                            },
                            children: [
                                { type: 'div', props: { style: { fontSize: '9px', fontWeight: 800, color: s.val !== 'VS' ? t.acento : `${t.texto}44`, marginBottom: '2px' }, children: s.label } },
                                { type: 'div', props: { style: { fontSize: '14px', fontWeight: 900, color: s.val !== 'VS' ? t.texto : `${t.texto}22` }, children: s.val } }
                            ]
                        }
                    }))
                }
            };
        } else {
            // Diseño Original para Partido Único
            marcadorElement = {
                type: 'div',
                props: {
                    style: { 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        width: '140px', height: '44px', background: `${t.secundario}cc`, 
                        border: `1px solid ${t.borde}`, borderRadius: '4px',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                    },
                    children: [
                        { 
                            type: 'div', 
                            props: { 
                                style: { fontSize: '22px', fontWeight: 900, color: done ? t.acento : t.texto, letterSpacing: '2px' },
                                children: done ? p.resultado : 'VS'
                            } 
                        }
                    ]
                }
            };
        }
        
        const matchRow = {
            type: 'div',
            props: {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: `${rowHeight}px`, position: 'relative' },
                children: [
                    // Local
                    {
                        type: 'div',
                        props: {
                            style: { display: 'flex', alignItems: 'center', gap: '15px', flex: 1, justifyContent: 'flex-end', paddingRight: '20px' },
                            children: [
                                { type: 'div', props: { style: { fontSize: '18px', fontWeight: 800, color: p.ganador === p.local ? t.acento : t.texto, textAlign: 'right' }, children: p.local } },
                                avatarElement(p.avatarL, p.local, t, 42)
                            ]
                        }
                    },
                    // Marcador Central (Dinámico)
                    marcadorElement,
                    // Visitante
                    {
                        type: 'div',
                        props: {
                            style: { display: 'flex', alignItems: 'center', gap: '15px', flex: 1, justifyContent: 'flex-start', paddingLeft: '20px' },
                            children: [
                                avatarElement(p.avatarV, p.visitante, t, 42),
                                { type: 'div', props: { style: { fontSize: '18px', fontWeight: 800, color: p.ganador === p.visitante ? t.acento : t.texto }, children: p.visitante } }
                            ]
                        }
                    }
                ]
            }
        };

        const duelElements = [];
        if (p.duelosIndividuales && p.duelosIndividuales.length > 0) {
            const duelMargin = cols === 2 ? '2px 30px' : '2px 80px';
            p.duelosIndividuales.forEach(d => {
                const dDone = d.finalizado || (typeof d.golesLocal === 'number' && typeof d.golesVisitante === 'number');
                const dRes = dDone ? `${d.golesLocal}-${d.golesVisitante}` : 'VS';
                const lName = d.localJugadorNombre || d.localNombre || d.local || 'Jugador Local';
                const vName = d.visitanteJugadorNombre || d.visitanteNombre || d.visitante || 'Jugador Visitante';

                duelElements.push({
                    type: 'div',
                    props: {
                        style: { 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', 
                            height: '36px', background: 'rgba(0,0,0,0.2)', margin: duelMargin, 
                            borderRadius: '6px', border: `1px dashed ${t.borde}44` 
                        },
                        children: [
                            // Local Jugador
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'flex-end', paddingRight: '15px' },
                                    children: [
                                        { type: 'div', props: { style: { fontSize: '12px', fontWeight: 700, color: dDone && d.golesLocal > d.golesVisitante ? t.acento : `${t.texto}cc` }, children: lName } },
                                        avatarElement(d.avatarLocal, lName, t, 22)
                                    ].filter(Boolean)
                                }
                            },
                            // Score Cajita
                            {
                                type: 'div',
                                props: {
                                    style: { 
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                        width: '60px', height: '24px', background: 'rgba(0,0,0,0.5)', 
                                        borderRadius: '4px', border: `1px solid ${dDone ? t.acento : `${t.borde}aa`}` 
                                    },
                                    children: [
                                        { type: 'div', props: { style: { fontSize: '11px', fontWeight: 800, color: dDone ? t.texto : `${t.texto}44` }, children: dRes } }
                                    ]
                                }
                            },
                            // Visitante Jugador
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, justifyContent: 'flex-start', paddingLeft: '15px' },
                                    children: [
                                        avatarElement(d.avatarVisitante, vName, t, 22),
                                        { type: 'div', props: { style: { fontSize: '12px', fontWeight: 700, color: dDone && d.golesVisitante > d.golesLocal ? t.acento : `${t.texto}cc` }, children: vName } }
                                    ].filter(Boolean)
                                }
                            }
                        ]
                    }
                });
            });
        }

        const fechaBadge = p.fechaLabel ? {
            type: 'div',
            props: {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: `linear-gradient(90deg, ${t.acento}33 0%, rgba(0,0,0,0.4) 100%)`,
                    borderLeft: `4px solid ${t.acento}`,
                    padding: '4px 14px',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    width: '100%'
                },
                children: [
                    {
                        type: 'span',
                        props: {
                            style: {
                                fontSize: '12px',
                                fontWeight: 900,
                                color: t.acento,
                                letterSpacing: '2px',
                                textTransform: 'uppercase'
                            },
                            children: p.fechaLabel
                        }
                    },
                    p.grupo ? {
                        type: 'span',
                        props: {
                            style: {
                                fontSize: '11px',
                                fontWeight: 700,
                                color: `${t.texto}88`,
                                textTransform: 'uppercase'
                            },
                            children: `Grupo ${p.grupo}`
                        }
                    } : null
                ].filter(Boolean)
            }
        } : null;

        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', gap: '4px', borderBottom: `1px solid ${t.borde}22`, paddingBottom: '10px', marginBottom: '10px' },
                children: [fechaBadge, matchRow, ...duelElements].filter(Boolean)
            }
        };
    });

    const column1Rows = rows.slice(0, Math.ceil(rows.length / 2));
    const column2Rows = rows.slice(Math.ceil(rows.length / 2));

    const root = {
        type: 'div',
        props: {
            style: { display: 'flex', flexDirection: 'column', width: `${width}px`, height: `${totalHeight}px`, background: t.primario, color: t.texto, fontFamily: 'Inter', position: 'relative' },
            children: [
                { type: 'div', props: { style: bgProps } },
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '40px', paddingBottom: '30px', position: 'relative' },
                        children: [
                            { type: 'div', props: { style: { fontSize: '32px', fontWeight: 900, color: t.texto, letterSpacing: '4px', textTransform: 'uppercase' }, children: titulo || 'FIXTURE' } },
                            subtitulo ? { type: 'div', props: { style: { fontSize: '14px', fontWeight: 700, color: t.primario, background: t.acento, padding: '4px 20px', borderRadius: '20px', letterSpacing: '3px', textTransform: 'uppercase', marginTop: '10px' }, children: subtitulo } } : null
                        ].filter(Boolean)
                    }
                },
                {
                    type: 'div',
                    props: {
                        style: { 
                            display: 'flex', 
                            flexDirection: 'row', 
                            padding: '10px 40px', 
                            position: 'relative',
                            width: '100%',
                            gap: '40px'
                        },
                        children: cols === 1 ? [
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', flexDirection: 'column', width: '100%' },
                                    children: rows
                                }
                            }
                        ] : [
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', flexDirection: 'column', flex: 1 },
                                    children: column1Rows
                                }
                            },
                            {
                                type: 'div',
                                props: {
                                    style: { display: 'flex', flexDirection: 'column', flex: 1 },
                                    children: column2Rows
                                }
                            }
                        ]
                    }
                }
            ]
        }
    };

    return await renderToBuffer(root, width, totalHeight);
}
