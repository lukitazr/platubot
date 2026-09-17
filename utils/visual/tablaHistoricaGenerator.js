import { renderToBuffer } from './renderPool.js';
import { getOrCachePlayerAvatar } from './avatarCache.js';
import { resolvePlayers } from '../db/userResolver.js';

// ── Fetch avatares para los jugadores de la página ─────────────────────────

async function fetchAvatars(players, client) {
  const avatars = new Map();
  const playerIds = players.map(p => p.id || p.discordId || p._id).filter(Boolean);
  const playerMap = await resolvePlayers(playerIds, client).catch(() => new Map());

  const promises = players.map(async (j) => {
    const idStr = String(j.id || j.discordId || j._id || j.nombre);
    const base64Avatar = await getOrCachePlayerAvatar(idStr, client, playerMap).catch(() => null);
    avatars.set(idStr, base64Avatar);
  });

  await Promise.all(promises);
  return avatars;
}

function avatarElement(url, nombre) {
  if (url) {
    return {
      type: 'img',
      props: {
        src: url,
        width: 30,
        height: 30,
        style: {
          borderRadius: '50%',
          marginRight: '10px',
          flexShrink: 0,
          border: '1.5px solid rgba(255, 255, 255, 0.2)',
        },
      },
    };
  }

  // Placeholder: círculo con la inicial del jugador
  const initial = (nombre || '?')[0].toUpperCase();
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63'];
  const colorIndex = (nombre || '?').charCodeAt(0) % colors.length;

  return {
    type: 'div',
    props: {
      style: {
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        background: colors[colorIndex],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 800,
        color: '#ffffff',
        marginRight: '10px',
        flexShrink: 0,
        border: '1.5px solid rgba(255, 255, 255, 0.2)',
      },
      children: initial,
    },
  };
}

// ── Generador visual de la Tabla Histórica ──────────────────────────────────

export async function generarTablaHistoricaImagen({
  players = [],
  paginaActual = 1,
  totalPaginas = 1,
  totalJugadores = 0,
  startRank = 1
}, client = null) {
  const avatars = await fetchAvatars(players, client);

  // Columnas: Posición, Jugador, Títulos Oficiales, Títulos Amistosos, PTS, PJ, PG, PP, WO, GF, GC, DG
  const cols = ['#', 'JUGADOR', '🏆 OFI', '🎖️ AMI', 'PTS', 'PJ', 'PG', 'PP', 'WO', 'GF', 'GC', 'DG'];
  const colWidths = [38, 222, 54, 54, 58, 44, 44, 44, 44, 44, 44, 50];
  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 40; // 780 + 40 = 820px
  const rowHeight = 39;
  const headerSectionHeight = 118;
  const footerSectionHeight = 36;
  const totalHeight = headerSectionHeight + (players.length * rowHeight) + footerSectionHeight;

  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${totalWidth}px`,
        height: `${totalHeight}px`,
        background: 'linear-gradient(145deg, #090d16 0%, #111827 50%, #1b1636 100%)',
        fontFamily: 'Inter',
        color: '#e2e8f0',
        padding: '18px 20px',
        boxSizing: 'border-box',
      },
      children: [
        // 1. Cabecera principal (Título + Subtítulo con insignias)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '14px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '23px',
                    fontWeight: 900,
                    color: '#ffd700',
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                  },
                  children: '🏆 TABLA HISTÓRICA PLATUBI',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#94a3b8',
                    letterSpacing: '0.5px',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          background: 'rgba(255, 215, 0, 0.12)',
                          color: '#facc15',
                          border: '1px solid rgba(255, 215, 0, 0.3)',
                          padding: '2px 10px',
                          borderRadius: '12px',
                          fontWeight: 700,
                        },
                        children: `Página ${paginaActual} de ${totalPaginas}`,
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          padding: '2px 10px',
                          borderRadius: '12px',
                          fontWeight: 700,
                        },
                        children: `${totalJugadores} Jugadores Registrados`,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

        // 2. Encabezados de la Tabla
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.07)',
              borderBottom: '2px solid rgba(255, 215, 0, 0.4)',
              borderRadius: '8px 8px 0 0',
              padding: '8px 0',
            },
            children: cols.map((col, i) => ({
              type: 'div',
              props: {
                style: {
                  width: `${colWidths[i]}px`,
                  textAlign: i === 1 ? 'left' : 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: i === 2 ? '#ffd700' : (i === 3 ? '#a78bfa' : (i === 4 ? '#38bdf8' : '#94a3b8')),
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  paddingLeft: i === 1 ? '10px' : '0',
                },
                children: col,
              },
            })),
          },
        },

        // 3. Filas de datos
        ...players.map((j, idx) => {
          const rank = startRank + idx;
          const idStr = String(j.id || j.discordId || j._id || j.nombre);
          const avatarUrl = avatars.get(idStr);

          // Estilos para podio (1ro, 2do, 3ro)
          const isGold = rank === 1;
          const isSilver = rank === 2;
          const isBronze = rank === 3;

          const rankColor = isGold
            ? '#ffd700'
            : isSilver
              ? '#e2e8f0'
              : isBronze
                ? '#f59e0b'
                : '#94a3b8';

          const rowBg = isGold
            ? 'rgba(255, 215, 0, 0.08)'
            : isSilver
              ? 'rgba(226, 232, 240, 0.05)'
              : isBronze
                ? 'rgba(245, 158, 11, 0.05)'
                : (idx % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.045)');

          const borderBottom = idx === players.length - 1
            ? 'none'
            : '1px solid rgba(255, 255, 255, 0.05)';

          return {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: `${rowHeight}px`,
                background: rowBg,
                borderBottom,
              },
              children: [
                // Posición
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[0]}px`,
                      textAlign: 'center',
                      fontSize: '13px',
                      fontWeight: isGold || isSilver || isBronze ? 900 : 700,
                      color: rankColor,
                    },
                    children: `${rank}`,
                  },
                },

                // Avatar + Nombre
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[1]}px`,
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingLeft: '6px',
                      overflow: 'hidden',
                    },
                    children: [
                      avatarElement(avatarUrl, j.nombre),
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '13.5px',
                            fontWeight: isGold ? 800 : 600,
                            color: isGold ? '#ffd700' : '#ffffff',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                          children: j.nombre,
                        },
                      },
                    ],
                  },
                },

                // TÍTULOS OFICIALES
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[2]}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12.5px',
                      fontWeight: 800,
                      color: (j.titulosOficiales ?? (typeof j.titulos === 'number' ? j.titulos : (Array.isArray(j.titulos?.oficiales) ? j.titulos.oficiales.length : 0))) > 0 ? '#ffd700' : '#64748b',
                    },
                    children: (j.titulosOficiales ?? (typeof j.titulos === 'number' ? j.titulos : (Array.isArray(j.titulos?.oficiales) ? j.titulos.oficiales.length : 0))) > 0 ? `🏆 ${j.titulosOficiales ?? j.titulos}` : '0',
                  },
                },

                // TÍTULOS AMISTOSOS
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[3]}px`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12.5px',
                      fontWeight: 800,
                      color: (j.titulosAmistosos ?? (Array.isArray(j.titulos?.amistosos) ? j.titulos.amistosos.length : 0)) > 0 ? '#a78bfa' : '#64748b',
                    },
                    children: (j.titulosAmistosos ?? (Array.isArray(j.titulos?.amistosos) ? j.titulos.amistosos.length : 0)) > 0 ? `🎖️ ${j.titulosAmistosos ?? (j.titulos?.amistosos?.length || 0)}` : '0',
                  },
                },

                // PTS (Puntos Históricos)
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[4]}px`,
                      textAlign: 'center',
                      fontSize: '14px',
                      fontWeight: 900,
                      color: '#38bdf8',
                    },
                    children: `${j.pts}`,
                  },
                },

                // PJ
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[5]}px`,
                      textAlign: 'center',
                      fontSize: '12.5px',
                      color: '#cbd5e1',
                    },
                    children: `${j.pj}`,
                  },
                },

                // PG
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[6]}px`,
                      textAlign: 'center',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      color: j.pg > 0 ? '#4ade80' : '#cbd5e1',
                    },
                    children: `${j.pg}`,
                  },
                },

                // PP
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[7]}px`,
                      textAlign: 'center',
                      fontSize: '12.5px',
                      color: '#94a3b8',
                    },
                    children: `${j.pp}`,
                  },
                },

                // WO (Resta peso / penalización)
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[8]}px`,
                      textAlign: 'center',
                      fontSize: '12.5px',
                      fontWeight: j.wo > 0 ? 800 : 400,
                      color: j.wo > 0 ? '#f87171' : '#64748b',
                    },
                    children: `${j.wo}`,
                  },
                },

                // GF
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[9]}px`,
                      textAlign: 'center',
                      fontSize: '12px',
                      color: '#cbd5e1',
                    },
                    children: `${j.gf}`,
                  },
                },

                // GC
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[10]}px`,
                      textAlign: 'center',
                      fontSize: '12px',
                      color: '#94a3b8',
                    },
                    children: `${j.gc}`,
                  },
                },

                // DG
                {
                  type: 'div',
                  props: {
                    style: {
                      width: `${colWidths[11]}px`,
                      textAlign: 'center',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      color: j.dg > 0 ? '#4ade80' : (j.dg < 0 ? '#f87171' : '#94a3b8'),
                    },
                    children: `${j.dg > 0 ? '+' : ''}${j.dg}`,
                  },
                },
              ],
            },
          };
        }),

        // 4. Footer discreto
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '10px',
              paddingTop: '6px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: '11px',
              color: '#64748b',
            },
            children: [
              {
                type: 'span',
                props: {
                  children: 'Criterio: Títulos > PTS Históricos > PG (W.O. resta 2 pts)',
                },
              },
              {
                type: 'span',
                props: {
                  children: 'Platubot • Sistema Oficial',
                },
              },
            ],
          },
        },
      ],
    },
  };

  return renderToBuffer(element, totalWidth, totalHeight);
}
