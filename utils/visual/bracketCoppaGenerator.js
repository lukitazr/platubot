import { renderToBuffer } from './renderPool.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolvePlayers, getResolvedName } from '../db/userResolver.js';
import { getOrCachePlayerAvatar } from './avatarCache.js';
import { getAvatarBase64 } from './avatarUtils.js';

// ── Background Image ────────────────────────────────────────────────────────
function getBgImageB64() {
  try {
    const bgPath = join(process.cwd(), 'assets', 'bg', 'coppa_bg.png');
    const buffer = readFileSync(bgPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

// ── Layout Constants (Adjusted to fit 1280px) ────────────────────────────────
const CANVAS_W = 1280;
const CANVAS_H = 640;
const CARD_W = 150;
const CARD_H = 70;
const ROW_H = 34;
const GAP_X = 40;
const PAD_X = 25;

const THEME = {
  winGreen: '#22c55e',
  loseRed: '#ef4444',
  winGreenText: '#4ade80',
  loseRedText: '#fca5a5',
  winGreenBg: 'rgba(34,197,94,0.14)',
  loseRedBg: 'rgba(239,68,68,0.12)',
  scoreBgWin: '#166534',
  scoreBgLose: '#7f1d1d',
  scoreBgNormal: '#1e293b',
  scoreColorWin: '#86efac',
  scoreColorLose: '#fca5a5',
  scoreColorNormal: '#94a3b8',
  connectorColor: 'rgba(74, 222, 128, 0.4)',
};

// ── Fetch avatares y resolución relacional ──────────────────────────────────
async function fetchPlayerMap(coppa, client) {
  const userIds = new Set();
  (coppa.equipos || []).forEach(e => {
    const id = typeof e === 'string' ? e : (e.discordId || e.id || e.nombre);
    if (id) userIds.add(String(id).trim());
  });
  const llavesObj = coppa.llaves || {};
  for (const phase in llavesObj) {
    const matches = llavesObj[phase] || [];
    matches.forEach(m => {
      if (m.equipo1?.discordId) userIds.add(String(m.equipo1.discordId).trim());
      if (m.equipo1?.nombre) userIds.add(String(m.equipo1.nombre).trim());
      if (m.equipo2?.discordId) userIds.add(String(m.equipo2.discordId).trim());
      if (m.equipo2?.nombre) userIds.add(String(m.equipo2.nombre).trim());
    });
  }

  const resolved = await resolvePlayers(userIds, client);
  const avatarMap = new Map();

  await Promise.all(Array.from(userIds).map(async id => {
    const idStr = String(id).trim();
    let base64 = await getOrCachePlayerAvatar(idStr, client, resolved).catch(() => null);

    if (!base64 && resolved.has(idStr)) {
      const rawAv = resolved.get(idStr)?.avatar;
      if (rawAv) {
        base64 = await getAvatarBase64(rawAv).catch(() => null);
      }
    }

    const resObj = resolved.get(idStr) || {};
    avatarMap.set(idStr, {
      ...resObj,
      avatar: base64 || null
    });
  }));

  return avatarMap;
}

// ── Card Component ──────────────────────────────────────────────────────────
function buildTeamRow(equipo, isWinner, isLoser, isBye, gIda, gVue, playerMap, reversed = false) {
  const idStr = String(equipo?.discordId || equipo?.id || equipo?.nombre || '');
  const resolvedObj = playerMap.get(idStr) || playerMap.get(String(equipo?.nombre || '').trim());

  let avatarUrl = resolvedObj?.avatar || null;
  if (avatarUrl && !avatarUrl.startsWith('data:') && !avatarUrl.startsWith('http')) {
    avatarUrl = null;
  }

  const nombreText = isBye ? 'BYE' : getResolvedName(idStr, playerMap, equipo?.nombre || 'TBD');

  const borderColor = isWinner ? THEME.winGreen : isLoser ? THEME.loseRed : 'transparent';
  const bg = isWinner ? THEME.winGreenBg : isLoser ? THEME.loseRedBg : 'transparent';
  const nameColor = isWinner ? THEME.winGreenText : isLoser ? THEME.loseRedText : '#e2e8f0';
  const scoreBg = isWinner ? THEME.scoreBgWin : isLoser ? THEME.scoreBgLose : THEME.scoreBgNormal;
  const scoreColor = isWinner ? THEME.scoreColorWin : isLoser ? THEME.scoreColorLose : THEME.scoreColorNormal;
  const avFilter = isLoser ? 'grayscale(100%)' : 'none';

  const scoreText = isBye ? 'B' : (gIda !== null ? `${gIda}` : '-');
  const scoreTextVuelta = gVue !== null ? `${gVue}` : null;

  const imgSz = ROW_H - 8;
  const avatarEl = {
    type: 'div',
    props: {
      style: {
        width: `${imgSz}px`, height: `${imgSz}px`, borderRadius: '4px',
        background: '#111', flexShrink: 0, overflow: 'hidden', display: 'flex',
        filter: avFilter,
      },
      children: avatarUrl ? {
        type: 'img',
        props: { src: avatarUrl, width: imgSz, height: imgSz }
      } : {
        type: 'div',
        props: {
          style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: `${Math.round(imgSz * 0.4)}px` },
          children: isBye ? 'B' : (equipo.nombre ? equipo.nombre[0].toUpperCase() : '?')
        }
      }
    }
  };

  const nameEl = {
    type: 'div',
    props: {
      style: {
        flex: 1, fontSize: '10.5px', fontWeight: isWinner ? 800 : 500, color: nameColor,
        textAlign: reversed ? 'right' : 'left',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      },
      children: isBye ? 'BYE' : equipo.nombre || 'TBD'
    }
  };

  const scoreSz = Math.round(ROW_H * 0.65);
  const scoreContainer = {
    type: 'div',
    props: {
        style: { display: 'flex', flexDirection: 'row', gap: '2px' },
        children: [
            {
                type: 'div',
                props: {
                    style: {
                        minWidth: `${scoreSz}px`, height: `${scoreSz}px`, borderRadius: '4px',
                        background: scoreBg, color: scoreColor, fontWeight: 900,
                        fontSize: `${Math.round(scoreSz * 0.55)}px`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    },
                    children: scoreText
                }
            },
            scoreTextVuelta !== null ? {
                type: 'div',
                props: {
                    style: {
                        minWidth: `${scoreSz}px`, height: `${scoreSz}px`, borderRadius: '4px',
                        background: scoreBg, color: scoreColor, fontWeight: 900, opacity: 0.8,
                        fontSize: `${Math.round(scoreSz * 0.55)}px`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                    },
                    children: scoreTextVuelta
                }
            } : null
        ]
    }
  };

  const children = reversed ? [scoreContainer, nameEl, avatarEl] : [avatarEl, nameEl, scoreContainer];

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px',
        padding: '0 8px', height: `${ROW_H}px`, background: bg,
        borderLeft: !reversed ? `3px solid ${borderColor}` : 'none',
        borderRight: reversed ? `3px solid ${borderColor}` : 'none',
      },
      children
    }
  };
}

function buildMatchCard(llave, avatars, reversed = false, cardWidth = CARD_W) {
  const { equipo1, equipo2, ida, vuelta, desempate, ganador } = llave || {};
  const done = !!ganador;
  const eq1 = equipo1 || { nombre: 'TBD', discordId: null };
  const eq2 = equipo2 || { nombre: 'TBD', discordId: null };
  const isTBD = !eq1.discordId && !eq2.discordId;

  return {
    type: 'div',
    props: {
      style: {
        width: `${cardWidth}px`, background: 'rgba(2,44,22,0.82)', border: '1px solid rgba(5, 150, 105, 0.2)',
        borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 15px rgba(0,0,0,0.5)', opacity: isTBD ? 0.35 : 1
      },
      children: [
        buildTeamRow(eq1, ganador === eq1.discordId || (typeof ganador === 'string' && ganador.toLowerCase() === (eq1.nombre || '').toLowerCase()), done && ganador !== eq1.discordId, eq1.discordId === 'BYE' || eq1.nombre === 'BYE', ida?.golesLocal ?? null, vuelta?.golesVisitante ?? null, avatars, reversed),
        { type: 'div', props: { style: { height: '1px', background: 'rgba(5, 150, 105, 0.1)', width: '100%' } } },
        buildTeamRow(eq2, ganador === eq2.discordId || (typeof ganador === 'string' && ganador.toLowerCase() === (eq2.nombre || '').toLowerCase()), done && ganador !== eq2.discordId, eq2.discordId === 'BYE' || eq2.nombre === 'BYE', ida?.golesVisitante ?? null, vuelta?.golesLocal ?? null, avatars, reversed),
      ]
    }
  };
}

// ── Connectors ──────────────────────────────────────────────────────────────
function buildConnectors(fromTops, toTops, xStart, width, direction = 'right') {
    const lines = [];
    const xMid = xStart + width / 2;
    const xEnd = xStart + width;

    for (let i = 0; i < toTops.length; i++) {
        const yA = fromTops[i * 2] !== undefined ? fromTops[i * 2] + CARD_H / 2 : toTops[i] + CARD_H / 2;
        const yB = fromTops[i * 2 + 1] !== undefined ? fromTops[i * 2 + 1] + CARD_H / 2 : yA;
        const yT = toTops[i] + CARD_H / 2;
        const yMid = (yA + yB) / 2;

        // Common style
        const lineStyle = { position: 'absolute', background: THEME.connectorColor };

        if (direction === 'right') {
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yA}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
            if (fromTops[i * 2 + 1] !== undefined) {
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yB}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yA, yB)}px`, width: '1.5px', height: `${Math.abs(yB - yA)}px` } } });
            }
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yMid, yT)}px`, width: '1.5px', height: `${Math.abs(yT - yMid) + 1.5}px` } } });
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yT}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
        } else {
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yA}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
            if (fromTops[i * 2 + 1] !== undefined) {
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yB}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yA, yB)}px`, width: '1.5px', height: `${Math.abs(yB - yA)}px` } } });
            }
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yMid, yT)}px`, width: '1.5px', height: `${Math.abs(yT - yMid) + 1.5}px` } } });
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yT}px`, width: `${Math.max(1, width/2)}px`, height: '1.5px' } } });
        }
    }
    return lines;
}

// ── Main Generator ──────────────────────────────────────────────────────────
export async function generarBracketImagen(coppa, client) {
  const avatars = await fetchPlayerMap(coppa, client);
  const bgB64 = getBgImageB64();

  const phases = coppa.fasesEliminatoria || Object.keys(coppa.llaves || {});
  const nPhases = phases.length;
  const areaH = 460;
  const yOffset = 110;

  const roundsPerWing = Math.max(1, nPhases - 1);
  const cardW = roundsPerWing > 3 ? 136 : CARD_W;
  const gapX = roundsPerWing > 3 ? 20 : GAP_X;
  const padX = roundsPerWing > 3 ? 18 : PAD_X;
  const colSpacing = cardW + gapX;
  const totalRequiredW = padX * 2 + (roundsPerWing * 2 + 1) * colSpacing;
  const CANVAS_W = Math.max(1280, totalRequiredW);
  const x_Final = (CANVAS_W - cardW) / 2;

  const x_L = Array.from({ length: roundsPerWing }, (_, i) => padX + i * colSpacing);
  const x_R = Array.from({ length: roundsPerWing }, (_, i) => CANVAS_W - padX - cardW - i * colSpacing);

  const wingData = phases.map((phaseName, idx) => {
    const matches = coppa.llaves?.[phaseName] || [];
    if (idx === nPhases - 1) return { label: '⚽ FINAL', center: matches[0] || null };
    const mid = Math.ceil(matches.length / 2);
    return {
      label: phaseName.toUpperCase(),
      left: matches.slice(0, mid),
      right: matches.slice(mid).reverse(),
    };
  });

  function getTops(n, areaH) {
    if (!n || n <= 0) return [];
    const sp = areaH / n;
    return Array.from({ length: n }, (_, i) => Math.round(i * sp + sp / 2) - CARD_H / 2);
  }

  const elements = [];

  // Left Wing
  for (let i = 0; i < nPhases - 1; i++) {
    const matches = wingData[i].left;
    if (!matches || !matches.length) continue;
    const x = x_L[i];
    const tops = getTops(matches.length, areaH);

    // Header
    elements.push({
      type: 'div',
      props: {
        style: { position: 'absolute', top: '75px', left: `${x}px`, width: `${cardW}px`, display: 'flex', justifyContent: 'center' },
        children: {
            type: 'div',
            props: {
                style: { fontSize: '10px', fontWeight: 800, color: '#4ade80', padding: '3px 10px', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '15px' },
                children: wingData[i].label
            }
        }
      }
    });

    matches.forEach((m, idx) => {
      elements.push({
        type: 'div',
        props: {
          style: { position: 'absolute', left: `${x}px`, top: `${yOffset + tops[idx]}px`, display: 'flex' },
          children: [buildMatchCard(m, avatars, false, cardW)]
        }
      });
    });

    if (i < nPhases - 1) {
        const nextX = i === nPhases - 2 ? x_Final : (x_L[i+1] ?? x_Final);
        const nextTops = i === nPhases - 2 ? [areaH/2 - CARD_H/2] : getTops(wingData[i+1]?.left?.length || 1, areaH);
        const connW = i === nPhases - 2 ? x_Final - (x + cardW) : gapX;
        elements.push(...buildConnectors(tops, nextTops, x + cardW, connW, 'right').map(l => ({ ...l, props: { ...l.props, style: { ...l.props.style, top: `${parseFloat(l.props.style.top) + yOffset}px` } } })));
    }
  }

  // Right Wing
  for (let i = 0; i < nPhases - 1; i++) {
    const matches = wingData[i].right;
    if (!matches || !matches.length) continue;
    const x = x_R[i];
    const tops = getTops(matches.length, areaH);

    // Header
    elements.push({
      type: 'div',
      props: {
        style: { position: 'absolute', top: '75px', left: `${x}px`, width: `${cardW}px`, display: 'flex', justifyContent: 'center' },
        children: {
            type: 'div',
            props: {
                style: { fontSize: '10px', fontWeight: 800, color: '#4ade80', padding: '3px 10px', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '15px' },
                children: wingData[i].label
            }
        }
      }
    });

    matches.forEach((m, idx) => {
      elements.push({
        type: 'div',
        props: {
          style: { position: 'absolute', left: `${x}px`, top: `${yOffset + tops[idx]}px`, display: 'flex' },
          children: [buildMatchCard(m, avatars, true, cardW)]
        }
      });
    });

    if (i < nPhases - 1) {
        const nextX = i === nPhases - 2 ? x_Final : (x_R[i+1] ?? x_Final);
        const nextTops = i === nPhases - 2 ? [areaH/2 - CARD_H/2] : getTops(wingData[i+1]?.right?.length || 1, areaH);
        const connW = i === nPhases - 2 ? (x) - (x_Final + cardW) : gapX;
        const connX = i === nPhases - 2 ? x_Final + cardW : x - gapX;
        elements.push(...buildConnectors(tops, nextTops, connX, connW, 'left').map(l => ({ ...l, props: { ...l.props, style: { ...l.props.style, top: `${parseFloat(l.props.style.top) + yOffset}px` } } })));
    }
  }

  // Final
  const finalMatch = wingData[nPhases - 1]?.center;
  if (finalMatch) {
    const topFinal = yOffset + areaH / 2 - CARD_H / 2;
    elements.push({
      type: 'div',
      props: {
        style: { position: 'absolute', top: '70px', left: `${x_Final}px`, width: `${cardW}px`, display: 'flex', justifyContent: 'center' },
        children: {
            type: 'div',
            props: {
                style: { fontSize: '11px', fontWeight: 900, letterSpacing: '2px', color: '#fbbf24', padding: '4px 14px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '15px' },
                children: '⚽ FINAL'
            }
        }
      }
    });
    elements.push({
      type: 'div',
      props: {
        style: { position: 'absolute', left: `${x_Final}px`, top: `${topFinal}px`, display: 'flex' },
        children: [buildMatchCard(finalMatch, avatars, false, cardW)]
      }
    });
  }

  const root = {
    type: 'div',
    props: {
      style: { display: 'flex', width: `${CANVAS_W}px`, height: `${CANVAS_H}px`, background: '#011c0e', color: '#fff', fontFamily: 'Inter', position: 'relative', overflow: 'hidden' },
      children: [
        bgB64 ? { type: 'img', props: { src: bgB64, width: CANVAS_W, height: CANVAS_H, style: { position: 'absolute', top: 0, left: 0, objectFit: 'cover' } } } : null,
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,10,5,0.4)' } } },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: '15px', position: 'relative' },
            children: [
              { type: 'div', props: { style: { fontSize: '28px', fontWeight: 900, color: '#4ade80', letterSpacing: '5px', textShadow: '0 0 15px rgba(74,222,128,0.4)' }, children: '⚽ COPA PLATUBI' } },
              { type: 'div', props: { style: { fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '2px' }, children: `COPPA - ${coppa.nombre || 'ELIMINACIÓN DIRECTA'}` } }
            ]
          }
        },
        ...elements
      ]
    }
  };

  return renderToBuffer(root, CANVAS_W, CANVAS_H);
}

