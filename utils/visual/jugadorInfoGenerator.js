import { renderToBuffer } from './renderPool.js';
import fs from 'fs';
import path from 'path';

const TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const getLogoAsync = async (src) => {
  if (!src) return TRANSPARENT_PNG;
  if (src.startsWith('data:')) {
    const mime = src.split(';')[0].split(':')[1];
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'].includes(mime)) return TRANSPARENT_PNG;
    return src;
  }
  if (src.startsWith('http')) {
    try {
      const res = await fetch(src);
      if (!res.ok) return TRANSPARENT_PNG;
      const type = res.headers.get('content-type') || 'image/png';
      if (!['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'].includes(type.split(';')[0])) return TRANSPARENT_PNG;
      const buffer = Buffer.from(await res.arrayBuffer());
      return `data:${type};base64,${buffer.toString('base64')}`;
    } catch { return TRANSPARENT_PNG; }
  }
  try {
    const fullPath = path.join(process.cwd(), src);
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).replace('.', '') || 'png';
      const buffer = fs.readFileSync(fullPath);
      return `data:image/${ext};base64,${buffer.toString('base64')}`;
    }
  } catch { return TRANSPARENT_PNG; }
  return TRANSPARENT_PNG;
};

/**
 * Genera una tarjeta visual premium con la información completa de un jugador:
 * - Avatar, nombre, ID/Discord tag
 * - Equipo Superliga actual (o Agente Libre)
 * - Títulos Oficiales ganados (conteo y lista)
 * - Títulos Amistosos ganados (conteo y lista)
 * - Top 3 historiales con más partidos jugados (H2H)
 * - Cantidad total de competiciones en las que participó
 * - Estadísticas globales (PTS, PJ, PG, PP, WO, GF, GC, DG, Winrate)
 * - Posición en el Ranking Histórico
 */
export async function generarTarjetaJugadorInfo({
  nombre,
  id,
  avatarBase64,
  rankingHistorico = 1,
  totalJugadores = 1,
  equipoSuperliga = null, // { nombre, escudo, rol } o null
  totalCompeticiones = 0,
  titulosOficiales = [],
  titulosAmistosos = [],
  stats = { pts: 0, pj: 0, pg: 0, pp: 0, wo: 0, gf: 0, gc: 0, dg: 0, winrate: 0 },
  topHistorial = [] // [{ rivalNombre, rivalAvatar, pj, pg, pe, pp, gf, gc, estado }]
}) {
  const width = 1000;
  const height = 750;

  const avatarSrc = avatarBase64 || TRANSPARENT_PNG;
  const clubEscudoSrc = equipoSuperliga?.escudo ? await getLogoAsync(equipoSuperliga.escudo) : null;

  // Procesar avatares de rivales del top 3
  const topHistorialProcesado = await Promise.all(topHistorial.slice(0, 3).map(async (h) => {
    let rivalAvatarSrc = null;
    if (h.rivalAvatar) {
      rivalAvatarSrc = await getLogoAsync(h.rivalAvatar);
    }
    return {
      ...h,
      rivalAvatarSrc
    };
  }));

  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${width}px`,
        height: `${height}px`,
        background: 'linear-gradient(135deg, #090d16 0%, #0f172a 45%, #1e1b4b 100%)',
        fontFamily: 'Inter',
        color: '#f8fafc',
        padding: '30px',
        boxSizing: 'border-box',
        justifyContent: 'space-between',
      },
      children: [
        // ── 1. HEADER ROW (Avatar + Nombre + Insignias + Superliga Club) ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              padding: '18px 24px',
            },
            children: [
              // Lado Izquierdo: Avatar + Nombre + ID
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px' },
                  children: [
                    avatarSrc && avatarSrc !== TRANSPARENT_PNG ? {
                      type: 'img',
                      props: {
                        src: avatarSrc,
                        style: {
                          width: '84px',
                          height: '84px',
                          borderRadius: '50%',
                          border: '3px solid #38bdf8',
                          boxShadow: '0 0 20px rgba(56, 189, 248, 0.3)',
                          objectFit: 'cover'
                        }
                      }
                    } : {
                      type: 'div',
                      props: {
                        style: {
                          width: '84px',
                          height: '84px',
                          borderRadius: '50%',
                          background: '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '36px',
                          fontWeight: 900,
                          color: '#ffffff',
                          border: '3px solid #38bdf8'
                        },
                        children: (nombre || '?')[0].toUpperCase()
                      }
                    },
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'column', gap: '4px' },
                        children: [
                          {
                            type: 'span',
                            props: {
                              style: { fontSize: '28px', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.5px' },
                              children: nombre
                            }
                          },
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' },
                              children: [
                                {
                                  type: 'span',
                                  props: {
                                    style: {
                                      fontSize: '12px',
                                      fontWeight: 700,
                                      color: '#94a3b8',
                                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                      padding: '3px 10px',
                                      borderRadius: '6px',
                                      letterSpacing: '0.5px'
                                    },
                                    children: `ID: ${id || 'N/A'}`
                                  }
                                },
                                {
                                  type: 'span',
                                  props: {
                                    style: {
                                      fontSize: '12px',
                                      fontWeight: 800,
                                      color: '#ffd700',
                                      backgroundColor: 'rgba(255, 215, 0, 0.12)',
                                      padding: '3px 10px',
                                      borderRadius: '6px',
                                      border: '1px solid rgba(255, 215, 0, 0.25)'
                                    },
                                    children: `🏆 Rank #${rankingHistorico} Histórico`
                                  }
                                },
                                {
                                  type: 'span',
                                  props: {
                                    style: {
                                      fontSize: '12px',
                                      fontWeight: 800,
                                      color: '#38bdf8',
                                      backgroundColor: 'rgba(56, 189, 248, 0.12)',
                                      padding: '3px 10px',
                                      borderRadius: '6px',
                                      border: '1px solid rgba(56, 189, 248, 0.25)'
                                    },
                                    children: `🎯 ${totalCompeticiones} Competiciones`
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              },

              // Lado Derecho: Club Superliga
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    background: equipoSuperliga ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                    border: `1px solid ${equipoSuperliga ? 'rgba(16, 185, 129, 0.3)' : 'rgba(100, 116, 139, 0.2)'}`,
                    borderRadius: '12px',
                    padding: '10px 16px',
                    minWidth: '210px'
                  },
                  children: [
                    {
                      type: 'span',
                      props: {
                        style: { fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' },
                        children: 'SUPERLIGA'
                      }
                    },
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', marginTop: '4px' },
                        children: [
                          clubEscudoSrc ? {
                            type: 'img',
                            props: { src: clubEscudoSrc, style: { width: '28px', height: '28px', objectFit: 'contain' } }
                          } : null,
                          {
                            type: 'span',
                            props: {
                              style: {
                                fontSize: '15px',
                                fontWeight: 800,
                                color: equipoSuperliga ? '#34d399' : '#cbd5e1'
                              },
                              children: equipoSuperliga ? `${equipoSuperliga.nombre}` : 'Agente Libre'
                            }
                          }
                        ].filter(Boolean)
                      }
                    },
                    equipoSuperliga?.rol ? {
                      type: 'span',
                      props: {
                        style: { fontSize: '11px', color: '#6ee7b7', fontWeight: 600, marginTop: '2px' },
                        children: `Rol: ${equipoSuperliga.rol}`
                      }
                    } : null
                  ].filter(Boolean)
                }
              }
            ]
          }
        },

        // ── 2. TITULOS SHOWCASE (OFICIALES Y AMISTOSOS) ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              gap: '20px',
              width: '100%',
              height: '190px'
            },
            children: [
              // Caja Títulos Oficiales
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    width: '50%',
                    background: 'rgba(255, 215, 0, 0.04)',
                    border: '1px solid rgba(255, 215, 0, 0.25)',
                    borderRadius: '14px',
                    padding: '16px',
                    boxSizing: 'border-box'
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
                          paddingBottom: '10px',
                          marginBottom: '10px'
                        },
                        children: [
                          {
                            type: 'span',
                            props: {
                              style: { fontSize: '15px', fontWeight: 900, color: '#ffd700', letterSpacing: '0.5px' },
                              children: '🏆 TÍTULOS OFICIALES'
                            }
                          },
                          {
                            type: 'span',
                            props: {
                              style: {
                                fontSize: '16px',
                                fontWeight: 900,
                                color: '#111827',
                                backgroundColor: '#ffd700',
                                padding: '2px 10px',
                                borderRadius: '12px'
                              },
                              children: `${titulosOficiales.length}`
                            }
                          }
                        ]
                      }
                    },
                    // Lista de títulos
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' },
                        children: titulosOficiales.length > 0 ? titulosOficiales.slice(0, 4).map(t => ({
                          type: 'div',
                          props: {
                            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' },
                            children: [
                              { type: 'span', props: { style: { color: '#ffd700', fontSize: '12px' }, children: '★' } },
                              { type: 'span', props: { style: { fontSize: '13px', fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: t } }
                            ]
                          }
                        })) : [{
                          type: 'span',
                          props: {
                            style: { fontSize: '13px', color: '#64748b', fontStyle: 'italic', marginTop: '10px' },
                            children: 'Sin títulos oficiales obtenidos aún.'
                          }
                        }]
                      }
                    },
                    titulosOficiales.length > 4 ? {
                      type: 'span',
                      props: { style: { fontSize: '11px', color: '#eab308', marginTop: '4px', fontWeight: 600 }, children: `+ ${titulosOficiales.length - 4} más...` }
                    } : null
                  ].filter(Boolean)
                }
              },

              // Caja Títulos Amistosos
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    width: '50%',
                    background: 'rgba(167, 139, 250, 0.04)',
                    border: '1px solid rgba(167, 139, 250, 0.25)',
                    borderRadius: '14px',
                    padding: '16px',
                    boxSizing: 'border-box'
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid rgba(167, 139, 250, 0.2)',
                          paddingBottom: '10px',
                          marginBottom: '10px'
                        },
                        children: [
                          {
                            type: 'span',
                            props: {
                              style: { fontSize: '15px', fontWeight: 900, color: '#a78bfa', letterSpacing: '0.5px' },
                              children: '🎖️ TÍTULOS AMISTOSOS'
                            }
                          },
                          {
                            type: 'span',
                            props: {
                              style: {
                                fontSize: '16px',
                                fontWeight: 900,
                                color: '#111827',
                                backgroundColor: '#a78bfa',
                                padding: '2px 10px',
                                borderRadius: '12px'
                              },
                              children: `${titulosAmistosos.length}`
                            }
                          }
                        ]
                      }
                    },
                    // Lista de títulos amistosos
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' },
                        children: titulosAmistosos.length > 0 ? titulosAmistosos.slice(0, 4).map(t => ({
                          type: 'div',
                          props: {
                            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' },
                            children: [
                              { type: 'span', props: { style: { color: '#a78bfa', fontSize: '12px' }, children: '✦' } },
                              { type: 'span', props: { style: { fontSize: '13px', fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: t } }
                            ]
                          }
                        })) : [{
                          type: 'span',
                          props: {
                            style: { fontSize: '13px', color: '#64748b', fontStyle: 'italic', marginTop: '10px' },
                            children: 'Sin títulos amistosos obtenidos aún.'
                          }
                        }]
                      }
                    },
                    titulosAmistosos.length > 4 ? {
                      type: 'span',
                      props: { style: { fontSize: '11px', color: '#c084fc', marginTop: '4px', fontWeight: 600 }, children: `+ ${titulosAmistosos.length - 4} más...` }
                    } : null
                  ].filter(Boolean)
                }
              }
            ]
          }
        },

        // ── 3. STATS STRIP (Rendimiento Global) ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '12px 20px',
              alignItems: 'center'
            },
            children: [
              { label: 'PTS', val: `${stats.pts}`, color: '#38bdf8' },
              { label: 'PJ', val: `${stats.pj}`, color: '#e2e8f0' },
              { label: 'PG', val: `${stats.pg}`, color: '#4ade80' },
              { label: 'PP', val: `${stats.pp}`, color: '#94a3b8' },
              { label: 'WO', val: `${stats.wo}`, color: stats.wo > 0 ? '#f87171' : '#64748b' },
              { label: 'GF', val: `${stats.gf}`, color: '#cbd5e1' },
              { label: 'GC', val: `${stats.gc}`, color: '#94a3b8' },
              { label: 'DG', val: `${stats.dg > 0 ? '+' : ''}${stats.dg}`, color: stats.dg > 0 ? '#4ade80' : (stats.dg < 0 ? '#f87171' : '#94a3b8') },
              { label: 'WINRATE', val: `${stats.winrate}%`, color: stats.winrate >= 50 ? '#4ade80' : '#f59e0b' }
            ].map(item => ({
              type: 'div',
              props: {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' },
                children: [
                  { type: 'span', props: { style: { fontSize: '11px', fontWeight: 800, color: '#64748b', letterSpacing: '0.8px' }, children: item.label } },
                  { type: 'span', props: { style: { fontSize: '18px', fontWeight: 900, color: item.color, marginTop: '2px' }, children: item.val } }
                ]
              }
            }))
          }
        },

        // ── 4. TOP 3 HISTORIALES (H2H Clásicos con más partidos) ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '14px 18px',
              height: '180px',
              boxSizing: 'border-box'
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
                  children: [
                    { type: 'span', props: { style: { fontSize: '14px', fontWeight: 900, color: '#f8fafc', letterSpacing: '0.5px' }, children: '⚔️ TOP 3 HISTORIALES CON MÁS PARTIDOS (H2H)' } },
                    { type: 'span', props: { style: { fontSize: '12px', fontWeight: 600, color: '#64748b' }, children: 'Rivalidades Directas' } }
                  ]
                }
              },
              {
                type: 'div',
                props: {
                  style: { display: 'flex', flexDirection: 'row', gap: '14px', width: '100%', height: '110px' },
                  children: topHistorialProcesado.length > 0 ? topHistorialProcesado.map(h => {
                    const badgeBg = h.estado === 'POSITIVO' ? '#16a34a' : (h.estado === 'NEGATIVO' ? '#dc2626' : '#4b5563');
                    return {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          width: '33.33%',
                          background: 'rgba(30, 41, 59, 0.7)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '10px',
                          padding: '10px 12px',
                          boxSizing: 'border-box'
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                              children: [
                                {
                                  type: 'div',
                                  props: {
                                    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', overflow: 'hidden' },
                                    children: [
                                      h.rivalAvatarSrc && h.rivalAvatarSrc !== TRANSPARENT_PNG ? {
                                        type: 'img',
                                        props: { src: h.rivalAvatarSrc, style: { width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover' } }
                                      } : {
                                        type: 'div',
                                        props: {
                                          style: { width: '26px', height: '26px', borderRadius: '50%', background: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#fff' },
                                          children: (h.rivalNombre || '?')[0].toUpperCase()
                                        }
                                      },
                                      {
                                        type: 'span',
                                        props: {
                                          style: { fontSize: '13.5px', fontWeight: 800, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' },
                                          children: h.rivalNombre
                                        }
                                      }
                                    ]
                                  }
                                },
                                {
                                  type: 'span',
                                  props: {
                                    style: { fontSize: '10px', fontWeight: 800, color: '#ffffff', backgroundColor: badgeBg, padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.5px' },
                                    children: h.estado
                                  }
                                }
                              ]
                            }
                          },
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' },
                              children: [
                                {
                                  type: 'span',
                                  props: {
                                    style: { fontSize: '13px', fontWeight: 900, color: '#38bdf8' },
                                    children: `${h.pj} PJ`
                                  }
                                },
                                {
                                  type: 'span',
                                  props: {
                                    style: { fontSize: '12px', fontWeight: 700, color: '#cbd5e1' },
                                    children: `${h.pg}V · ${h.pe}E · ${h.pp}D`
                                  }
                                }
                              ]
                            }
                          },
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '4px' },
                              children: [
                                { type: 'span', props: { children: `GF: ${h.gf}` } },
                                { type: 'span', props: { children: `GC: ${h.gc}` } },
                                { type: 'span', props: { style: { color: (h.gf - h.gc) >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }, children: `DG: ${(h.gf - h.gc) > 0 ? '+' : ''}${h.gf - h.gc}` } }
                              ]
                            }
                          }
                        ]
                      }
                    };
                  }) : [{
                    type: 'div',
                    props: {
                      style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: '#64748b', fontStyle: 'italic', fontSize: '13px' },
                      children: 'Sin historial de enfrentamientos directos registrados contra otros jugadores.'
                    }
                  }]
                }
              }
            ]
          }
        }
      ]
    }
  };

  return renderToBuffer(element, width, height, { scale: 1 });
}
