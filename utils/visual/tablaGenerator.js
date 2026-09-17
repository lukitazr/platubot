import { renderToBuffer } from './renderPool.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { resolvePlayers } from '../db/userResolver.js';
import Jugador from '../../models/Jugador.js';
import { getOrCachePlayerAvatar } from './avatarCache.js';

// ── Calcular tabla de posiciones ───────────────────────────────────────────

export function calcularTabla(liga, playerMap = null) {
  const mapa = new Map();

  // Inicializar jugadores
  for (const j of (liga.jugadores || [])) {
    const idStr = String(typeof j === 'string' ? j : (j.id || j.discordId));
    const pResolved = playerMap?.get(idStr);
    const nombre = pResolved?.nombre || (typeof j === 'object' ? j.nombre : `Jugador (${idStr.slice(-4)})`);

    mapa.set(idStr, {
      nombre,
      id: idStr,
      pj: 0, pg: 0, pe: 0, pp: 0,
      gf: 0, gc: 0, dg: 0, pts: 0,
    });
  }

  // Procesar partidos finalizados
  for (const fecha of (liga.partidos ?? [])) {
    if (!Array.isArray(fecha?.partidos)) continue;
    for (const p of fecha.partidos) {
      if (!p.finalizado) continue;
      const local = mapa.get(String(p.localId || p.local));
      const visitante = mapa.get(String(p.visitanteId || p.visitante));
      if (!local || !visitante) continue;

      const gl = p.golesLocal;
      const gv = p.golesVisitante;

      local.pj++; visitante.pj++;
      local.gf += gl; local.gc += gv;
      visitante.gf += gv; visitante.gc += gl;

      const isDoubleWO = p.isDoubleWO || (gl === 0 && gv === 0);
      const isWO = p.isWO || (gl === 3 && gv === 0) || (gl === 0 && gv === 3);

      if (isDoubleWO) {
        local.pe++; local.pts -= 2; local.pp++;
        visitante.pe++; visitante.pts -= 2; visitante.pp++;
      } else if (gl > gv) {
        local.pg++; local.pts += 3;
        visitante.pp++;
        if (isWO) {
          visitante.pe++; visitante.pts -= 2;
        }
      } else if (gl < gv) {
        visitante.pg++; visitante.pts += 3;
        local.pp++;
        if (isWO) {
          local.pe++; local.pts -= 2;
        }
      }
    }
  }

  // Calcular diferencia de gol y ordenar
  const jugMap = new Map((liga.jugadores || []).map(j => [String(typeof j === 'string' ? j : (j.id || j.discordId)), j]));
  const tabla = [...mapa.values()].map(j => {
    const jugDb = jugMap.get(j.id);
    if (jugDb && typeof jugDb === 'object' && (jugDb.pg !== undefined || jugDb.puntos !== undefined)) {
      const pg = jugDb.pg ?? j.pg;
      const pe = jugDb.pe ?? j.pe;
      const pp = jugDb.pp ?? j.pp;
      const gf = jugDb.gf ?? j.gf;
      const gc = jugDb.gc ?? j.gc;
      return {
        ...j,
        pg, pe, pp, gf, gc,
        pj: jugDb.pj ?? (pg + pe + pp),
        dg: gf - gc,
        pts: jugDb.puntos ?? (pg * 3 - (pe * 2)),
      };
    }
    return { ...j, dg: j.gf - j.gc };
  });
  tabla.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
  return tabla;
}

// ── Fetch avatares ─────────────────────────────────────────────────────────

async function fetchAvatars(tabla, playerMap, client) {
  const avatars = new Map();
  const promises = tabla.map(async (j) => {
    const base64Avatar = await getOrCachePlayerAvatar(j.id, client, playerMap);
    avatars.set(j.id, base64Avatar);
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
        width: 28,
        height: 28,
        style: { borderRadius: '50%', marginRight: '8px', flexShrink: 0 },
      },
    };
  }
  // Placeholder: círculo con la inicial
  const initial = (nombre || '?')[0].toUpperCase();
  const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
  const colorIndex = (nombre || '?').charCodeAt(0) % colors.length;
  return {
    type: 'div',
    props: {
      style: {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: colors[colorIndex],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 700,
        color: '#ffffff',
        marginRight: '8px',
        flexShrink: 0,
      },
      children: initial,
    },
  };
}

// ── Paletas por división ────────────────────────────────────────────────────

const THEMES = {
  primera: {
    bg:         'linear-gradient(135deg, #1a0505 0%, #2e0909 50%, #450f0f 100%)',
    headerBg:   'rgba(220,38,38,0.18)',
    headerText: '#ff8080',
    accentLine: 'rgba(220,38,38,0.15)',
  },
  segunda: {
    bg:         'linear-gradient(135deg, #1a0d00 0%, #2e1800 50%, #452400 100%)',
    headerBg:   'rgba(234,88,12,0.18)',
    headerText: '#ffaa60',
    accentLine: 'rgba(234,88,12,0.15)',
  },
};

// ── Generar imagen de la tabla ─────────────────────────────────────────────

export async function generarTablaImagen(liga, client, div = 'primera') {
  const userIds = (liga.jugadores || []).map(j => typeof j === 'string' ? j : (j.id || j.discordId)).filter(Boolean);
  const playerMap = await resolvePlayers(userIds, client);
  const tabla = calcularTabla(liga, playerMap);
  const avatars = await fetchAvatars(tabla, playerMap, client);
  const theme = THEMES[div] ?? THEMES.primera;

  const cols = ['', 'Jugador', 'PJ', 'PG', 'WO', 'PP', 'GF', 'GC', 'DG', 'PTS'];
  const colWidths = [40, 260, 48, 48, 48, 48, 48, 48, 48, 56];
  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 40; // +padding
  const rowHeight = 40;
  const headerHeight = 50;
  const totalHeight = headerHeight + 48 + tabla.length * rowHeight + 30;

  // Satori JSX-like object tree
  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${totalWidth}px`,
        height: `${totalHeight}px`,
        background: theme.bg,
        fontFamily: 'Inter',
        color: '#e0e0e0',
        padding: '20px',
      },
      children: [
        // Título
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              fontSize: '22px',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '1px',
            },
            children: `🏆 ${liga.nombreLiga ?? 'Primera División'}`,
          },
        },
        // Header row
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              background: theme.headerBg,
              borderRadius: '8px 8px 0 0',
              padding: '8px 0',
            },
            children: cols.map((col, i) => ({
              type: 'div',
              props: {
                style: {
                  width: `${colWidths[i]}px`,
                  textAlign: i === 1 ? 'left' : 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: theme.headerText,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  paddingLeft: i === 1 ? '8px' : '0',
                },
                children: col,
              },
            })),
          },
        },
        // Data rows
        ...tabla.map((j, idx) => ({
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              height: `${rowHeight}px`,
              background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            },
            children: [
              // Posición
              {
                type: 'div',
                props: {
                  style: {
                    width: `${colWidths[0]}px`,
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                    paddingLeft: '10px',
                    color: idx < (liga.reglas?.puestosCampeon ?? 1)
                      ? '#ffd700'
                      : idx < (liga.reglas?.puestosCampeon ?? 1) + (liga.reglas?.puestosAscenso ?? 0)
                        ? '#2ecc71'
                        : tabla.length - idx <= (liga.reglas?.cantidadDescenso ?? 0)
                          ? '#e74c3c'
                          : '#e0e0e0',
                  },
                  children: `${idx + 1}`,
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
                    paddingLeft: '8px',
                    overflow: 'hidden',
                  },
                  children: [
                    avatarElement(avatars.get(j.id), j.nombre),
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#ffffff',
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
              // Stats
              ...[j.pj, j.pg, j.pe, j.pp, j.gf, j.gc, j.dg, j.pts].map((val, vi) => ({
                type: 'div',
                props: {
                  style: {
                    width: `${colWidths[vi + 2]}px`,
                    textAlign: 'center',
                    fontSize: '13px',
                    fontWeight: vi === 7 ? 700 : 400, // PTS en bold
                    color: vi === 7 ? '#ffd700' : vi === 6
                      ? (val > 0 ? '#2ecc71' : val < 0 ? '#e74c3c' : '#a0a0c0')
                      : '#d0d0d0',
                  },
                  children: `${val > 0 && vi === 6 ? '+' : ''}${val}`,
                },
              })),
            ],
          },
        })),
      ],
    },
  };

  return renderToBuffer(element, totalWidth, totalHeight);
}
