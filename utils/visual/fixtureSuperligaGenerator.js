import { renderToBuffer } from './renderPool.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolvePlayers } from '../db/userResolver.js';

function getShieldB64(escudoPath) {
    if (!escudoPath) return null;
    try {
        const fullPath = join(process.cwd(), escudoPath);
        if (existsSync(fullPath)) {
            const buffer = readFileSync(fullPath);
            return `data:image/png;base64,${buffer.toString('base64')}`;
        }
    } catch (e) {}
    return null;
}

async function fetchPlayerMap(partidos, client) {
  const playerIds = new Set();
  partidos.forEach(p => {
    const duelos = p.duelosIndividuales || p.miniPartidos || [];
    duelos.forEach(d => {
      const idL = d.jugadorLocalId || d.localJugadorId || d.localJugador;
      const idV = d.jugadorVisitanteId || d.visitanteJugadorId || d.visitanteJugador;
      if (idL && idL !== 'BYE') playerIds.add(String(idL));
      if (idV && idV !== 'BYE') playerIds.add(String(idV));
    });
  });

  return await resolvePlayers(playerIds, client);
}

export async function generarFixtureSuperligaImagen(partidos, numeroFecha, temporada, equiposDB, client = null) {
  const playerMap = await fetchPlayerMap(partidos, client);

  const THEME = {
    bg: '#0a0e14',
    oceanic: '#2ecc71',
    text: '#ffffff',
    textMuted: '#94a3b8',
    cardBg: '#161d26',
    border: 'rgba(46, 204, 113, 0.25)',
    winnerColor: '#f1c40f',
    duelBg: 'rgba(0, 0, 0, 0.3)'
  };

  const width = 1000;
  const matchCardHeight = 320; 
  const headerHeight = 220;
  const hasMultipleFechas = partidos.some(p => p.fechaLabel || p.fechaNumero);
  const cardExtra = hasMultipleFechas ? 40 : 0;
  const totalHeight = headerHeight + (partidos.length * (matchCardHeight + cardExtra + 30)) + 60;

  const getJugadorNombre = (id) => {
    if (!id || id === 'BYE') return 'TBD';
    const idStr = String(id);
    const pResolved = playerMap.get(idStr);
    if (pResolved?.nombre) return pResolved.nombre;
    for (const eq of (equiposDB || [])) {
        if (eq.coach && (String(eq.coach.id) === idStr || String(eq.coach.discordId) === idStr)) return eq.coach.nombre;
        const jug = eq.jugadores?.find(j => String(typeof j === 'string' ? j : j.id) === idStr);
        if (jug) return typeof jug === 'string' ? `Jugador (${idStr.slice(-4)})` : jug.nombre;
    }
    return `Jugador (${idStr.slice(-4)})`;
  };

  const mainTitle = typeof numeroFecha === 'number'
    ? `JORNADA ${numeroFecha}`
    : (String(numeroFecha).toUpperCase().startsWith('FECHA') || String(numeroFecha).toUpperCase().startsWith('JORNADA')
      ? String(numeroFecha).toUpperCase()
      : `JORNADA ${numeroFecha}`);

  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${width}px`,
        height: `${totalHeight}px`,
        backgroundColor: THEME.bg,
        fontFamily: 'Inter',
        color: THEME.text,
        padding: '60px',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '50px' },
            children: [
                { type: 'span', props: { style: { fontSize: '72px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-2px', lineHeight: 1, textAlign: 'center' }, children: mainTitle } },
                { type: 'div', props: { style: { width: '400px', height: '6px', backgroundColor: THEME.oceanic, marginTop: '10px', boxShadow: `0 0 20px ${THEME.oceanic}` } } },
                { type: 'span', props: { style: { fontSize: '20px', color: THEME.textMuted, marginTop: '15px', fontWeight: 600 }, children: temporada.toUpperCase() } }
            ]
          }
        },

        ...partidos.map((p) => {
            const eqL = equiposDB.find(e => e.nombre === p.localNombre);
            const eqV = equiposDB.find(e => e.nombre === p.visitanteNombre);
            const shieldL = getShieldB64(eqL?.escudo);
            const shieldV = getShieldB64(eqV?.escudo);

            const setsL = p.puntosMiniLocal ?? p.resultado?.golesLocal ?? 0;
            const setsV = p.puntosMiniVisitante ?? p.resultado?.golesVisitante ?? 0;
            const duelos = p.duelosIndividuales || p.miniPartidos || [];
            
            const fechaBadge = (p.fechaLabel || p.fechaNumero) ? {
                type: 'div',
                props: {
                    style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        paddingBottom: '8px',
                        marginBottom: '14px',
                        width: '100%'
                    },
                    children: [
                        {
                            type: 'span',
                            props: {
                                style: {
                                    fontSize: '14px',
                                    fontWeight: 900,
                                    color: THEME.oceanic,
                                    letterSpacing: '2px',
                                    textTransform: 'uppercase'
                                },
                                children: p.fechaLabel ? p.fechaLabel.toUpperCase() : `JORNADA ${p.fechaNumero}`
                            }
                        },
                        p.tipo ? {
                            type: 'span',
                            props: {
                                style: {
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    color: THEME.textMuted,
                                    textTransform: 'uppercase'
                                },
                                children: p.tipo
                            }
                        } : null
                    ].filter(Boolean)
                }
            } : null;

            return {
                type: 'div',
                props: {
                    style: {
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: THEME.cardBg,
                        borderRadius: '24px',
                        marginBottom: '30px',
                        padding: '25px',
                        width: '100%',
                        border: `1px solid ${THEME.border}`,
                    },
                    children: [
                        fechaBadge,
                        {
                            type: 'div',
                            props: {
                                style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '20px' },
                                children: [
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', alignItems: 'center', width: '320px' },
                                            children: [
                                                shieldL ? { type: 'img', props: { src: shieldL, style: { width: '60px', height: '60px', objectFit: 'contain', marginRight: '20px' } } } : null,
                                                { type: 'span', props: { style: { fontSize: '26px', fontWeight: 900, color: p.finalizado && setsL > setsV ? THEME.winnerColor : THEME.text }, children: p.localNombre.toUpperCase() } }
                                            ]
                                        }
                                    },
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
                                            children: [
                                                { 
                                                  type: 'div', 
                                                  props: {
                                                    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', padding: '8px 20px', minWidth: '160px', borderRadius: '12px', border: `2px solid ${THEME.oceanic}66` },
                                                    children: [
                                                      { type: 'div', props: { style: { width: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '48px', fontWeight: 900, color: THEME.oceanic }, children: p.finalizado ? `${setsL}` : '-' } },
                                                      { type: 'span', props: { style: { fontSize: '24px', margin: '0 10px', color: THEME.textMuted }, children: ':' } },
                                                      { type: 'div', props: { style: { width: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '48px', fontWeight: 900, color: THEME.oceanic }, children: p.finalizado ? `${setsV}` : '-' } }
                                                    ]
                                                  }
                                                },
                                            ]
                                        }
                                    },
                                    {
                                        type: 'div',
                                        props: {
                                            style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: '320px' },
                                            children: [
                                                { type: 'span', props: { style: { fontSize: '26px', fontWeight: 900, color: p.finalizado && setsV > setsL ? THEME.winnerColor : THEME.text, textAlign: 'right' }, children: p.visitanteNombre.toUpperCase() } },
                                                shieldV ? { type: 'img', props: { src: shieldV, style: { width: '60px', height: '60px', objectFit: 'contain', marginLeft: '20px' } } } : null,
                                            ]
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            type: 'div',
                            props: {
                                style: { 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    width: '100%', 
                                    backgroundColor: THEME.duelBg, 
                                    borderRadius: '16px', 
                                    padding: '10px' 
                                },
                                children: [0, 1, 2].map((idx) => {
                                    const duelo = duelos[idx];
                                    const idL = duelo?.jugadorLocalId || duelo?.localJugadorId || duelo?.localJugador;
                                    const idV = duelo?.jugadorVisitanteId || duelo?.visitanteJugadorId || duelo?.visitanteJugador;
                                    const avL = playerMap.get(String(idL))?.avatar;
                                    const avV = playerMap.get(String(idV))?.avatar;
                                    const nombreL = getJugadorNombre(idL);
                                    const nombreV = getJugadorNombre(idV);
                                    const gl = duelo?.golesLocal;
                                    const gv = duelo?.golesVisitante;
                                    const jugadito = typeof gl === 'number' && typeof gv === 'number';
                                    const winL = jugadito && gl > gv;
                                    const winV = jugadito && gv > gl;

                                    return {
                                        type: 'div',
                                        props: {
                                            style: { 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'space-between', 
                                                padding: '8px 15px', 
                                                borderBottom: idx < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none' 
                                            },
                                            children: [
                                                { 
                                                  type: 'div', 
                                                  props: { 
                                                    style: { display: 'flex', alignItems: 'center', width: '40%' }, 
                                                    children: [
                                                      avL ? { type: 'img', props: { src: avL, style: { width: '32px', height: '32px', borderRadius: '50%', marginRight: '10px', border: winL ? `2px solid ${THEME.oceanic}` : 'none' } } } : { type: 'div', props: { style: { width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#334155', marginRight: '10px' } } },
                                                      { type: 'span', props: { style: { fontSize: '16px', fontWeight: 700, color: winL ? THEME.oceanic : THEME.text }, children: nombreL } }
                                                    ]
                                                  } 
                                                },
                                                { 
                                                  type: 'div', 
                                                  props: { 
                                                    style: { 
                                                      display: 'flex',
                                                      justifyContent: 'center',
                                                      alignItems: 'center',
                                                      width: '100px', 
                                                      fontSize: '18px', 
                                                      fontWeight: 900, 
                                                      color: jugadito ? THEME.text : THEME.textMuted,
                                                      backgroundColor: '#00000044',
                                                      borderRadius: '6px',
                                                      padding: '4px 0'
                                                    }, 
                                                    children: jugadito ? `${gl} - ${gv}` : 'VS' 
                                                  } 
                                                },
                                                { 
                                                  type: 'div', 
                                                  props: { 
                                                    style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: '40%' }, 
                                                    children: [
                                                      { type: 'span', props: { style: { fontSize: '16px', fontWeight: 700, color: winV ? THEME.oceanic : THEME.text, textAlign: 'right' }, children: nombreV } },
                                                      avV ? { type: 'img', props: { src: avV, style: { width: '32px', height: '32px', borderRadius: '50%', marginLeft: '10px', border: winV ? `2px solid ${THEME.oceanic}` : 'none' } } } : { type: 'div', props: { style: { width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#334155', marginLeft: '10px' } } },
                                                    ]
                                                  } 
                                                },
                                            ]
                                        }
                                    };
                                })
                            }
                        }
                    ]
                }
            };
        })
      ]
    }
  };

  return renderToBuffer(element, width, totalHeight);
}
