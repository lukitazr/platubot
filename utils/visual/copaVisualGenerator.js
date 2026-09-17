import { renderToBuffer } from './renderPool.js';
import { existsSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getFlagUrl } from './countryHelper.js';
import { getAvatarBase64 } from './avatarUtils.js';

// ── Helpers de Utilidad ──────────────────────────────────────────────────────

function sanitizeHex(val, fallback = '#1a1a2e') {
    if (!val || typeof val !== 'string') return fallback;
    const matches = val.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
    if (matches && matches.length > 0) return matches[0];
    if (/^[0-9a-fA-F]{6}$/.test(val.trim())) return `#${val.trim()}`;
    return fallback;
}

function getTheme(tema = {}) {
    return {
        primario: sanitizeHex(tema.primario, '#1a1a2e'),
        secundario: sanitizeHex(tema.secundario, '#16213e'),
        acento: sanitizeHex(tema.acento, '#e94560'),
        texto: sanitizeHex(tema.texto, '#ffffff'),
        borde: sanitizeHex(tema.borde, '#0f3460'),
    };
}

function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return 'transparent';
    if (!hex.startsWith('#')) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Cache de Avatares en Memoria (LRU simple) ────────────────────────────────
const avatarCache = new Map();
const MAX_CACHE = 200;

function setCached(key, value) {
    if (avatarCache.size >= MAX_CACHE) {
        const oldest = avatarCache.keys().next().value;
        avatarCache.delete(oldest);
    }
    avatarCache.set(key, value);
}

export async function getSafeAvatarAsync(avatarUrl) {
    if (!avatarUrl) return null;
    if (avatarUrl.startsWith('data:')) return avatarUrl;
    if (avatarCache.has(avatarUrl)) return avatarCache.get(avatarUrl);
    try {
        const b64 = await getAvatarBase64(avatarUrl);
        if (b64) {
            setCached(avatarUrl, b64);
            return b64;
        }
    } catch (e) {}
    return null;
}

function getSafeAvatar(avatarUrl) {
    if (!avatarUrl) return null;
    if (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:')) return avatarUrl;
    if (avatarCache.has(avatarUrl)) return avatarCache.get(avatarUrl);
    try {
        if (existsSync(avatarUrl)) {
            const buffer = readFileSync(avatarUrl);
            const ext = avatarUrl.split('.').pop() || 'png';
            const data = `data:image/${ext};base64,${buffer.toString('base64')}`;
            setCached(avatarUrl, data);
            return data;
        }
    } catch (e) {}
    return null;
}

export async function preProcessAvatars(torneo) {
    if (!torneo) return;
    
    // 1. Torneo logo
    if (torneo.logo) {
        torneo.logo = await getSafeAvatarAsync(torneo.logo);
    }

    // 2. Torneo equipos
    if (torneo.equipos) {
        await Promise.all(torneo.equipos.map(async eq => {
            if (eq.avatar) {
                eq.avatar = await getSafeAvatarAsync(eq.avatar);
            }
            if (eq.miembros) {
                await Promise.all(eq.miembros.map(async m => {
                    if (m.avatar) {
                        m.avatar = await getSafeAvatarAsync(m.avatar);
                    }
                }));
            }
        }));
    }

    // 3. Torneo llaves (brackets matches)
    if (torneo.llaves) {
        const promises = [];
        for (const phase in torneo.llaves) {
            const matches = torneo.llaves[phase] || [];
            for (const match of matches) {
                if (match.equipo1) {
                    promises.push((async () => {
                        match.equipo1.avatar = await getSafeAvatarAsync(match.equipo1.avatar);
                        if (match.equipo1.miembros) {
                            await Promise.all(match.equipo1.miembros.map(async m => {
                                m.avatar = await getSafeAvatarAsync(m.avatar);
                            }));
                        }
                    })());
                }
                if (match.equipo2) {
                    promises.push((async () => {
                        match.equipo2.avatar = await getSafeAvatarAsync(match.equipo2.avatar);
                        if (match.equipo2.miembros) {
                            await Promise.all(match.equipo2.miembros.map(async m => {
                                m.avatar = await getSafeAvatarAsync(m.avatar);
                            }));
                        }
                    })());
                }
            }
        }
        await Promise.all(promises);
    }
}

function avatarElement(urlOrEquipo, nombre, t, size = 28, filter = 'none') {
  const isObject = urlOrEquipo && typeof urlOrEquipo === 'object';
  const equipo = isObject ? urlOrEquipo : null;
  const url = isObject ? equipo.avatar : urlOrEquipo;
  const teamNombre = nombre || equipo?.nombre;

  if (equipo && equipo.miembros && equipo.miembros.length === 2) {
      const safeUrl1 = getSafeAvatar(equipo.miembros[0].avatar || getFlagUrl(equipo.miembros[0].nombre));
      const safeUrl2 = getSafeAvatar(equipo.miembros[1].avatar || getFlagUrl(equipo.miembros[1].nombre));
      
      return {
          type: 'div',
          props: {
              style: { position: 'relative', width: `${size + 10}px`, height: `${size}px`, flexShrink: 0, display: 'flex', filter: filter },
              children: [
                  {
                      type: 'div',
                      props: {
                          style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#111', border: `1px solid ${hexToRgba(t.borde, 0.25)}`, overflow: 'hidden', position: 'absolute', left: '10px', display: 'flex' },
                          children: safeUrl2 ? { type: 'img', props: { src: safeUrl2, width: size, height: size, style: { objectFit: 'cover' } } } : { type: 'span', props: { style: { margin: 'auto', fontSize: `${size*0.4}px` }, children: '👤' } }
                      }
                  },
                  {
                      type: 'div',
                      props: {
                          style: { width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#111', border: `1px solid ${hexToRgba(t.borde, 0.25)}`, overflow: 'hidden', position: 'absolute', left: 0, display: 'flex' },
                          children: safeUrl1 ? { type: 'img', props: { src: safeUrl1, width: size, height: size, style: { objectFit: 'cover' } } } : { type: 'span', props: { style: { margin: 'auto', fontSize: `${size*0.4}px` }, children: '👤' } }
                      }
                  }
              ]
          }
      };
  }

  // Normal single avatar
  const flagUrl = getFlagUrl(teamNombre);
  const safeUrl = getSafeAvatar(url || flagUrl);
  
  return {
    type: 'div',
    props: {
      style: {
        width: `${size}px`, height: `${size}px`, borderRadius: '6px',
        background: '#111', flexShrink: 0, overflow: 'hidden', display: 'flex',
        filter: filter, border: `1px solid ${hexToRgba(t.borde, 0.2)}`
      },
      children: safeUrl ? {
        type: 'img',
        props: { src: safeUrl, width: size, height: size, style: { objectFit: 'cover' } }
      } : {
        type: 'div',
        props: {
          style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hexToRgba(t.texto, 0.25), fontSize: `${Math.round(size * 0.45)}px`, fontWeight: 800 },
          children: (teamNombre && teamNombre !== 'TBD') ? teamNombre[0].toUpperCase() : '?'
        }
      }
    }
  };
}

// ── Renderizado ─────────────────────────────────────────────────────────────

const emojiCache = {};


// ── Lógica de Bracket Premium ─────────────────────────────────────────────

function buildTeamRowBracket(equipo, isWinner, isLoser, isBye, gIda, gVue, gDes, t, size, reversed = false) {
    const { rowH } = size;
    const borderColor = isWinner ? t.acento : isLoser ? '#ef4444' : 'transparent';
    const bg = isWinner ? hexToRgba(t.acento, 0.12) : isLoser ? 'rgba(239,68,68,0.12)' : 'transparent';
    const nameColor = isWinner ? t.acento : isLoser ? '#fca5a5' : '#e2e8f0';
    const scoreBg = isWinner ? t.acento : isLoser ? '#7f1d1d' : hexToRgba(t.borde, 0.4);
    const scoreColor = isWinner ? t.primario : isLoser ? '#fca5a5' : '#94a3b8';
    const avFilter = isLoser ? 'grayscale(100%)' : 'none';

    const scoreText = isBye ? 'B' : (gIda !== undefined && gIda !== null ? `${gIda}` : '-');
    const scoreTextVuelta = (gVue !== undefined && gVue !== null) ? `${gVue}` : null;
    const scoreTextDes = (gDes !== undefined && gDes !== null) ? `${gDes}` : null;

    const scoreSz = Math.round(rowH * 0.7);
    const scoreContainer = {
        type: 'div',
        props: {
            style: { display: 'flex', gap: '4px' },
            children: [
                { type: 'div', props: { style: { minWidth: `${scoreSz}px`, height: `${scoreSz}px`, borderRadius: '6px', background: scoreBg, color: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(scoreSz*0.55)}px`, fontWeight: 900, padding: '0 8px' }, children: scoreText } },
                scoreTextVuelta !== null ? { type: 'div', props: { style: { minWidth: `${scoreSz}px`, height: `${scoreSz}px`, borderRadius: '4px', background: scoreBg, color: scoreColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(scoreSz*0.55)}px`, fontWeight: 900, opacity: 0.8, padding: '0 8px' }, children: scoreTextVuelta } } : null,
                scoreTextDes !== null ? { type: 'div', props: { style: { minWidth: `${scoreSz}px`, height: `${scoreSz}px`, borderRadius: '4px', background: t.acento, color: t.primario, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(scoreSz*0.55)}px`, fontWeight: 900, padding: '0 8px', border: '1px solid #ffffff' }, children: scoreTextDes } } : null
            ]
        }
    };

    const avatar = avatarElement(equipo, equipo.nombre, t, rowH - 12, avFilter);
    const name = { 
        type: 'div', 
        props: { 
            style: { 
                flex: 1, fontSize: `${Math.round(rowH*0.4)}px`, fontWeight: isWinner ? 900 : 500, color: nameColor, 
                textAlign: reversed ? 'right' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' 
            }, 
            children: isBye ? 'BYE' : equipo.nombre || 'TBD' 
        } 
    };

    const children = reversed ? [scoreContainer, name, avatar] : [avatar, name, scoreContainer];

    return {
        type: 'div',
        props: {
            style: { 
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', 
                padding: '0 20px', height: `${rowH}px`, background: bg,
                borderLeft: !reversed ? `4px solid ${borderColor}` : 'none',
                borderRight: reversed ? `4px solid ${borderColor}` : 'none',
            },
            children
        }
    };
}

function buildMatchCardBracket(llave, t, size, reversed = false, isFinal = false) {
    const { cardW } = size;
    const { equipo1, equipo2, ida, vuelta, desempate, ganador } = llave;
    const done = !!ganador;
    const isWinner1 = ganador === equipo1?.discordId;
    const isWinner2 = ganador === equipo2?.discordId;
    const isTBD = !equipo1?.discordId && !equipo2?.discordId;

    return {
        type: 'div',
        props: {
            style: { 
                width: `${cardW + (vuelta ? 40 : 0) + (desempate ? 40 : 0)}px`, background: hexToRgba(t.secundario, 0.98), border: `2px solid ${isFinal ? t.acento : hexToRgba(t.borde, 0.5)}`, 
                borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column', 
                boxShadow: isFinal ? `0 0 40px ${hexToRgba(t.acento, 0.3)}` : '0 15px 40px rgba(0,0,0,0.6)', opacity: isTBD ? 0.4 : 1 
            },
            children: [
                buildTeamRowBracket(equipo1 || { nombre: 'TBD' }, isWinner1, done && !isWinner1, equipo1?.discordId === 'BYE', ida?.golesLocal, vuelta?.golesVisitante, desempate?.golesLocal, t, size, reversed),
                { type: 'div', props: { style: { height: '1.5px', background: hexToRgba(t.borde, 0.2), width: '100%' } } },
                buildTeamRowBracket(equipo2 || { nombre: 'TBD' }, isWinner2, done && !isWinner2, equipo2?.discordId === 'BYE', ida?.golesVisitante, vuelta?.golesLocal, desempate?.golesVisitante, t, size, reversed)
            ]
        }
    };
}

function buildConnectors(fromTops, toTops, xStart, width, color, cardH, direction = 'right') {
    const lines = [];
    const xMid = xStart + width / 2;
    for (let i = 0; i < toTops.length; i++) {
        const yA = fromTops[i * 2] + cardH / 2;
        const yB = fromTops[i * 2 + 1] !== undefined ? fromTops[i * 2 + 1] + cardH / 2 : yA;
        const yT = toTops[i] + cardH / 2;
        const yMid = (yA + yB) / 2;
        const lineStyle = { position: 'absolute', background: color, height: '2px' };

        if (direction === 'right') {
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yA}px`, width: `${width/2}px` } } });
            if (fromTops[i * 2 + 1] !== undefined) {
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yB}px`, width: `${width/2}px` } } });
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yA, yB)}px`, width: '2px', height: `${Math.abs(yB - yA)}px` } } });
            }
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yMid, yT)}px`, width: '2px', height: `${Math.abs(yT - yMid) + 2}px` } } });
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yT}px`, width: `${width/2}px` } } });
        } else {
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yA}px`, width: `${width/2}px` } } });
            if (fromTops[i * 2 + 1] !== undefined) {
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${yB}px`, width: `${width/2}px` } } });
                lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yA, yB)}px`, width: '2px', height: `${Math.abs(yB - yA)}px` } } });
            }
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xMid}px`, top: `${Math.min(yMid, yT)}px`, width: '2px', height: `${Math.abs(yT - yMid) + 2}px` } } });
            lines.push({ type: 'div', props: { style: { ...lineStyle, left: `${xStart}px`, top: `${yT}px`, width: `${width/2}px` } } });
        }
    }
    return lines;
}

function buildBracketHeaderElement(torneo, t) {
    const logoSrc = torneo.logo ? getSafeAvatar(torneo.logo) : null;
    
    const children = [];
    if (logoSrc) {
        children.push({
            type: 'img',
            props: { src: logoSrc, width: 64, height: 64, style: { borderRadius: '50%', objectFit: 'cover', marginBottom: '16px' } }
        });
    }
    children.push({ type: 'div', props: { style: { fontSize: '42px', fontWeight: 900, color: t.texto, letterSpacing: '10px', textShadow: `0 0 30px ${t.acento}66` }, children: torneo.nombre?.toUpperCase() } });
    children.push({ type: 'div', props: { style: { fontSize: '13px', fontWeight: 600, color: t.acento, textTransform: 'uppercase', letterSpacing: '6px', marginTop: '10px', opacity: 0.8 }, children: 'Brackets de Eliminación Directa' } });

    return {
        type: 'div',
        props: {
            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: '30px', position: 'relative' },
            children: children
        }
    };
}

export async function generarBracketCopa(torneo) {
    await preProcessAvatars(torneo);
    const t = getTheme(torneo.tema);
    const phases = torneo.fasesEliminatoria || ['Semifinales', 'Final'];
    const nPhases = phases.length;

    const isSmall = nPhases <= 2;
    const sizeNormal = { cardW: 200, cardH: 100, rowH: 48 };
    const sizeLarge = { cardW: 320, cardH: 140, rowH: 68 };
    
    const currentSize = isSmall ? sizeLarge : sizeNormal;
    const finalSize = { cardW: Math.round(currentSize.cardW * 1.15), cardH: Math.round(currentSize.cardH * 1.15), rowH: Math.round(currentSize.rowH * 1.15) };

    const wingData = phases.map((phaseName, idx) => {
        const matches = (torneo.llaves && torneo.llaves[phaseName]) || [];
        if (idx === nPhases - 1) return { label: '🏆 FINAL', center: matches[0] };
        const mid = Math.ceil(matches.length / 2);
        return { label: phaseName.toUpperCase(), left: matches.slice(0, mid), right: matches.slice(mid).reverse() };
    });

    const maxMatchesSide = Math.max(
        0,
        ...wingData.slice(0, nPhases - 1).map(w => Math.max(w.left?.length || 0, w.right?.length || 0))
    );

    const matchSpacing = 40;
    const verticalPad = 80;
    const headerHeight = torneo.logo ? 240 : 180;
    const wingH = maxMatchesSide * (currentSize.cardH + matchSpacing) - matchSpacing;
    const areaH = Math.max(wingH, finalSize.cardH) + verticalPad;
    const CANVAS_H = headerHeight + areaH;

    const columnW = currentSize.cardW + 80;
    const xCenter = 150 + (nPhases - 1) * columnW;
    const CANVAS_W = xCenter * 2;

    const elements = [];
    const leftTopsHistory = [];
    const rightTopsHistory = [];

    const yOffset = headerHeight;

    for (let pIdx = 0; pIdx < nPhases - 1; pIdx++) {
        const w = wingData[pIdx];
        const nMatches = w.left?.length || 0;
        if (nMatches === 0) continue;

        const xLeft = 100 + pIdx * columnW;
        const xRight = CANVAS_W - 100 - pIdx * columnW - currentSize.cardW - (w.left[0]?.vuelta ? 40 : 0) - (w.left[0]?.desempate ? 40 : 0);

        const groupH = areaH / nMatches;
        
        const leftTops = [];
        const rightTops = [];

        for (let mIdx = 0; mIdx < nMatches; mIdx++) {
            const y = yOffset + mIdx * groupH + groupH / 2 - currentSize.cardH / 2;
            
            leftTops.push(y);
            elements.push({ type: 'div', props: { style: { position: 'absolute', left: `${xLeft}px`, top: `${y}px`, display: 'flex' }, children: [buildMatchCardBracket(w.left[mIdx], t, currentSize, false)] } });

            if (w.right && w.right[mIdx]) {
                rightTops.push(y);
                elements.push({ type: 'div', props: { style: { position: 'absolute', left: `${xRight}px`, top: `${y}px`, display: 'flex' }, children: [buildMatchCardBracket(w.right[mIdx], t, currentSize, true)] } });
            }
        }

        leftTopsHistory.push(leftTops);
        rightTopsHistory.push(rightTops);
    }

    for (let pIdx = 0; pIdx < leftTopsHistory.length - 1; pIdx++) {
        const xStartL = 100 + pIdx * columnW + currentSize.cardW + (wingData[pIdx].left[0]?.vuelta ? 40 : 0) + (wingData[pIdx].left[0]?.desempate ? 40 : 0);
        const conWL = columnW - currentSize.cardW - (wingData[pIdx].left[0]?.vuelta ? 40 : 0) - (wingData[pIdx].left[0]?.desempate ? 40 : 0);
        elements.push(...buildConnectors(leftTopsHistory[pIdx], leftTopsHistory[pIdx + 1], xStartL, conWL, hexToRgba(t.acento, 0.4), currentSize.cardH, 'right'));

        const xStartR = CANVAS_W - 100 - (pIdx + 1) * columnW;
        elements.push(...buildConnectors(rightTopsHistory[pIdx], rightTopsHistory[pIdx + 1], xStartR, conWL, hexToRgba(t.acento, 0.4), currentSize.cardH, 'left'));
    }

    if (leftTopsHistory.length > 0) {
        const pIdx = leftTopsHistory.length - 1;
        const xStartL = 100 + pIdx * columnW + currentSize.cardW + (wingData[pIdx].left[0]?.vuelta ? 40 : 0) + (wingData[pIdx].left[0]?.desempate ? 40 : 0);
        const conWL = xCenter - xStartL;
        const finalTop = yOffset + areaH / 2 - finalSize.cardH / 2;
        elements.push(...buildConnectors(leftTopsHistory[pIdx], [finalTop], xStartL, conWL, hexToRgba(t.acento, 0.5), currentSize.cardH, 'right'));

        const xStartR = xCenter + finalSize.cardW + (wingData[nPhases - 1].center?.vuelta ? 40 : 0) + (wingData[nPhases - 1].center?.desempate ? 40 : 0);
        const conWR = (CANVAS_W - 100 - pIdx * columnW) - xStartR;
        elements.push(...buildConnectors(rightTopsHistory[pIdx], [finalTop], xStartR, conWR, hexToRgba(t.acento, 0.5), currentSize.cardH, 'left'));
    }

    const finalMatch = wingData[nPhases - 1]?.center;
    if (finalMatch) {
        const x_Final = xCenter;
        const maxFinalW = finalSize.cardW + (finalMatch.vuelta ? 40 : 0) + (finalMatch.desempate ? 40 : 0);
        
        elements.push({
            type: 'div',
            props: {
                style: { position: 'absolute', left: `${x_Final + maxFinalW/2 - 60}px`, top: `${yOffset + areaH/2 - finalSize.cardH/2 - 50}px`, display: 'flex', flexDirection: 'column', alignItems: 'center' },
                children: [
                    { type: 'div', props: { style: { fontSize: '10px', color: t.acento, fontWeight: 900, letterSpacing: '3px', marginBottom: '4px' }, children: '🏆 GRAN FINAL' } }
                ]
            }
        });
        
        const finalW = finalSize.cardW + (finalMatch.vuelta ? 40 : 0) + (finalMatch.desempate ? 40 : 0);
        const centeredX = x_Final + (maxFinalW - finalW) / 2;
        
        elements.push({ type: 'div', props: { style: { position: 'absolute', left: `${centeredX}px`, top: `${yOffset + areaH/2 - finalSize.cardH/2}px`, display: 'flex' }, children: [buildMatchCardBracket(finalMatch, t, finalSize, false, true)] } });
    }

    const root = {
        type: 'div',
        props: {
            style: { display: 'flex', width: `${CANVAS_W}px`, height: `${CANVAS_H}px`, background: t.primario, color: t.texto, fontFamily: 'Inter', position: 'relative', overflow: 'hidden' },
            children: [
                { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: `linear-gradient(180deg, ${hexToRgba(t.secundario, 0.7)} 0%, ${t.primario} 100%)` } } },
                { type: 'div', props: { style: { position: 'absolute', top: '50%', left: '50%', width: '1000px', height: '1000px', background: `radial-gradient(circle, ${hexToRgba(t.acento, 0.07)} 0%, transparent 70%)`, transform: 'translate(-50%, -50%)' } } },
                buildBracketHeaderElement(torneo, t),
                ...elements
            ]
        }
    };
    const scale = nPhases > 4 ? 1.5 : 2;
    return await renderToBuffer(root, CANVAS_W, CANVAS_H, { scale });
}

// ── Tablas y Participantes (Sin cambios) ───────────────────────────────────

function buildHeaderElement(torneo, titulo, subtitulo, t) {
    const logoSrc = torneo.logo ? getSafeAvatar(torneo.logo) : null;
    
    if (logoSrc) {
        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px' },
                children: [
                    {
                        type: 'div',
                        props: {
                            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px' },
                            children: [
                                {
                                    type: 'img',
                                    props: { src: logoSrc, width: 36, height: 36, style: { borderRadius: '50%', objectFit: 'cover' } }
                                },
                                {
                                    type: 'div',
                                    props: { style: { fontSize: '22px', fontWeight: 700, color: '#ffffff', letterSpacing: '1px' }, children: titulo }
                                }
                            ]
                        }
                    },
                    subtitulo ? { type: 'div', props: { style: { fontSize: '11px', opacity: 0.5, letterSpacing: '2px', textTransform: 'uppercase', marginTop: '4px' }, children: subtitulo } } : null
                ]
            }
        };
    } else {
        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px' },
                children: [
                    { type: 'div', props: { style: { fontSize: '22px', fontWeight: 700, color: '#ffffff', letterSpacing: '1px' }, children: `🏆 ${titulo}` } },
                    subtitulo ? { type: 'div', props: { style: { fontSize: '11px', opacity: 0.5, letterSpacing: '2px', textTransform: 'uppercase', marginTop: '4px' }, children: subtitulo } } : null
                ]
            }
        };
    }
}

function renderGroupTableComponent(gName, groupEquipos, colWidths, cols, t, torneo, isMultiGroup = false, singleTableWidth = 594) {
    const rowHeight = 40;
    const rows = groupEquipos.map((e, idx) => {
        const dif = (e.gf || 0) - (e.gc || 0);
        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'row', alignItems: 'center', height: `${rowHeight}px`, background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', borderBottom: `1px solid ${hexToRgba(t.borde, 0.15)}` },
                children: [
                    { type: 'div', props: { style: { width: `${colWidths[0]}px`, textAlign: 'center', fontSize: '14px', fontWeight: 700, paddingLeft: '10px', color: idx < (torneo.clasificadosPorGrupo || 2) ? '#ffd700' : t.texto }, children: `${idx + 1}` } },
                    { type: 'div', props: { style: { width: `${colWidths[1]}px`, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: '8px', overflow: 'hidden' }, children: [avatarElement(e, e.nombre, t), { type: 'div', props: { style: { fontSize: '14px', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: e.nombre } }] } },
                    ...[e.pj || 0, e.pg || 0, e.pe || 0, e.pp || 0, e.gf || 0, e.gc || 0, dif, e.puntos || 0].map((val, vi) => ({
                        type: 'div',
                        props: { style: { width: `${colWidths[vi + 2]}px`, textAlign: 'center', fontSize: '13px', fontWeight: vi === 7 ? 700 : 400, color: vi === 7 ? t.acento : vi === 6 ? (val > 0 ? '#2ecc71' : val < 0 ? '#e74c3c' : '#a0a0c0') : '#d0d0d0' }, children: `${val > 0 && vi === 6 ? '+' : ''}${val}` }
                    }))
                ]
            }
        };
    });

    return {
        type: 'div',
        props: {
            style: { 
                display: 'flex', 
                flexDirection: 'column', 
                marginBottom: isMultiGroup ? '0px' : '20px', 
                background: 'rgba(0,0,0,0.2)', 
                borderRadius: '12px', 
                border: `1px solid ${hexToRgba(t.borde, 0.3)}`, 
                padding: '15px', 
                width: isMultiGroup ? `${singleTableWidth}px` : '100%' 
            },
            children: [
                {
                    type: 'div',
                    props: {
                        style: { display: 'flex', alignItems: 'center', marginBottom: '10px' },
                        children: [
                            { type: 'div', props: { style: { fontSize: '18px', fontWeight: 900, color: t.acento, letterSpacing: '1px' }, children: `GRUPO ${gName}` } }
                        ]
                    }
                },
                { 
                    type: 'div', 
                    props: { 
                        style: { display: 'flex', flexDirection: 'row', background: hexToRgba(t.acento, 0.1), borderRadius: '8px 8px 0 0', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(t.acento, 0.25)}` }, 
                        children: cols.map((col, i) => ({ type: 'div', props: { style: { width: `${colWidths[i]}px`, textAlign: i === 1 ? 'left' : 'center', fontSize: '12px', fontWeight: 700, color: t.acento, textTransform: 'uppercase', letterSpacing: '0.5px', paddingLeft: i === 1 ? '8px' : '0' }, children: col } })) 
                    } 
                },
                ...rows
            ]
        }
    };
}

async function renderTablaBase(torneo, equipos, titulo, subtitulo, grupoSel = null) {
    await preProcessAvatars(torneo);
    const t = getTheme(torneo.tema);
    const cols = ['', 'Jugador', 'PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'DG', 'PTS'];
    
    const selectedGroup = grupoSel?.toUpperCase();
    const hasSelectedGroup = selectedGroup && equipos.some(e => e.grupo?.toUpperCase() === selectedGroup);

    if (hasSelectedGroup) {
        const filteredEquipos = equipos.filter(e => e.grupo?.toUpperCase() === selectedGroup);
        filteredEquipos.sort((a,b) => b.puntos - a.puntos || (b.gf-b.gc) - (a.gf-a.gc) || b.gf - a.gf);

        const colWidths = [40, 260, 48, 48, 48, 48, 48, 48, 48, 56];
        const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 40;
        const rowHeight = 40;
        const headerHeight = torneo.logo ? 120 : 80;
        const totalHeight = headerHeight + 48 + filteredEquipos.length * rowHeight + 30;

        const rows = filteredEquipos.map((e, idx) => {
            const dif = (e.gf || 0) - (e.gc || 0);
            return {
                type: 'div',
                props: {
                    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', height: `${rowHeight}px`, background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', borderBottom: `1px solid ${hexToRgba(t.borde, 0.15)}` },
                    children: [
                        { type: 'div', props: { style: { width: `${colWidths[0]}px`, textAlign: 'center', fontSize: '14px', fontWeight: 700, paddingLeft: '10px', color: idx < (torneo.clasificadosPorGrupo || 1) ? '#ffd700' : t.texto }, children: `${idx + 1}` } },
                        { type: 'div', props: { style: { width: `${colWidths[1]}px`, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: '8px', overflow: 'hidden' }, children: [avatarElement(e, e.nombre, t), { type: 'div', props: { style: { fontSize: '14px', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: e.nombre } }] } },
                        ...[e.pj || 0, e.pg || 0, e.pe || 0, e.pp || 0, e.gf || 0, e.gc || 0, dif, e.puntos || 0].map((val, vi) => ({
                            type: 'div',
                            props: { style: { width: `${colWidths[vi + 2]}px`, textAlign: 'center', fontSize: '13px', fontWeight: vi === 7 ? 700 : 400, color: vi === 7 ? t.acento : vi === 6 ? (val > 0 ? '#2ecc71' : val < 0 ? '#e74c3c' : '#a0a0c0') : '#d0d0d0' }, children: `${val > 0 && vi === 6 ? '+' : ''}${val}` }
                        }))
                    ]
                }
            };
        });

        const root = {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', width: `${totalWidth}px`, height: `${totalHeight}px`, background: `linear-gradient(135deg, ${t.primario} 0%, ${t.secundario} 100%)`, fontFamily: 'Inter', color: '#e0e0e0', padding: '20px' },
                children: [
                    buildHeaderElement(torneo, titulo, `Grupo ${selectedGroup}`, t),
                    { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', background: hexToRgba(t.acento, 0.1), borderRadius: '8px 8px 0 0', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(t.acento, 0.25)}` }, children: cols.map((col, i) => ({ type: 'div', props: { style: { width: `${colWidths[i]}px`, textAlign: i === 1 ? 'left' : 'center', fontSize: '12px', fontWeight: 700, color: t.acento, textTransform: 'uppercase', letterSpacing: '0.5px', paddingLeft: i === 1 ? '8px' : '0' }, children: col } })) } },
                    ...rows
                ]
            }
        };
        return await renderToBuffer(root, totalWidth, totalHeight);
    }

    const hasGroups = equipos.some(e => e.grupo);

    if (hasGroups) {
        const groups = {};
        equipos.forEach(e => {
            const gName = e.grupo || 'A';
            if (!groups[gName]) groups[gName] = [];
            groups[gName].push(e);
        });
        
        const sortedGroupNames = Object.keys(groups).sort();
        sortedGroupNames.forEach(gName => {
            groups[gName].sort((a,b) => b.puntos - a.puntos || (b.gf-b.gc) - (a.gf-a.gc) || b.gf - a.gf);
        });

        const isMultiGroup = sortedGroupNames.length > 1;
        const colWidths = isMultiGroup 
            ? [40, 180, 42, 42, 42, 42, 42, 42, 42, 50] 
            : [40, 260, 48, 48, 48, 48, 48, 48, 48, 56]; 
            
        const singleTableWidth = colWidths.reduce((s, w) => s + w, 0) + 30;
        const totalWidth = isMultiGroup ? (singleTableWidth * 2) + 90 : singleTableWidth + 40;
        
        const headerHeight = torneo.logo ? 120 : 80;
        const getGroupHeight = (gEquipos) => 10 + 30 + 30 + (gEquipos.length * 40) + 20;
        
        let groupsAreaHeight = 0;
        if (isMultiGroup) {
            for (let i = 0; i < sortedGroupNames.length; i += 2) {
                const h1 = getGroupHeight(groups[sortedGroupNames[i]]);
                const h2 = sortedGroupNames[i + 1] ? getGroupHeight(groups[sortedGroupNames[i + 1]]) : 0;
                groupsAreaHeight += Math.max(h1, h2) + 30; // 30px gap
            }
            if (groupsAreaHeight > 0) groupsAreaHeight -= 30;
        } else {
            groupsAreaHeight = getGroupHeight(groups[sortedGroupNames[0]]);
        }
        
        const totalHeight = headerHeight + groupsAreaHeight + 60;
        const groupElements = sortedGroupNames.map(gName => 
            renderGroupTableComponent(gName, groups[gName], colWidths, cols, t, torneo, isMultiGroup, singleTableWidth)
        );
        
        const root = {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', width: `${totalWidth}px`, height: `${totalHeight}px`, background: `linear-gradient(135deg, ${t.primario} 0%, ${t.secundario} 100%)`, fontFamily: 'Inter', color: '#e0e0e0', padding: '30px' },
                children: [
                    buildHeaderElement(torneo, titulo, subtitulo, t),
                    {
                        type: 'div',
                        props: {
                            style: { 
                                display: 'flex', 
                                flexDirection: 'row', 
                                flexWrap: 'wrap', 
                                justifyContent: 'center', 
                                width: '100%', 
                                gap: '30px',
                                marginTop: '10px'
                            },
                            children: groupElements
                        }
                    }
                ]
            }
        };
        
        return await renderToBuffer(root, totalWidth, totalHeight);
    } else {
        const colWidths = [40, 260, 48, 48, 48, 48, 48, 48, 48, 56];
        const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 40;
        const rowHeight = 40;
        const headerHeight = torneo.logo ? 120 : 80;
        const totalHeight = headerHeight + 48 + equipos.length * rowHeight + 30;

        const rows = equipos.map((e, idx) => {
            const dif = (e.gf || 0) - (e.gc || 0);
            return {
                type: 'div',
                props: {
                    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', height: `${rowHeight}px`, background: idx % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)', borderBottom: `1px solid ${hexToRgba(t.borde, 0.15)}` },
                    children: [
                        { type: 'div', props: { style: { width: `${colWidths[0]}px`, textAlign: 'center', fontSize: '14px', fontWeight: 700, paddingLeft: '10px', color: idx < (torneo.clasificadosPorGrupo || 1) ? '#ffd700' : t.texto }, children: `${idx + 1}` } },
                        { type: 'div', props: { style: { width: `${colWidths[1]}px`, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: '8px', overflow: 'hidden' }, children: [avatarElement(e, e.nombre, t), { type: 'div', props: { style: { fontSize: '14px', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: e.nombre } }] } },
                        ...[e.pj || 0, e.pg || 0, e.pe || 0, e.pp || 0, e.gf || 0, e.gc || 0, dif, e.puntos || 0].map((val, vi) => ({
                            type: 'div',
                            props: { style: { width: `${colWidths[vi + 2]}px`, textAlign: 'center', fontSize: '13px', fontWeight: vi === 7 ? 700 : 400, color: vi === 7 ? t.acento : vi === 6 ? (val > 0 ? '#2ecc71' : val < 0 ? '#e74c3c' : '#a0a0c0') : '#d0d0d0' }, children: `${val > 0 && vi === 6 ? '+' : ''}${val}` }
                        }))
                    ]
                }
            };
        });

        const root = {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', width: `${totalWidth}px`, height: `${totalHeight}px`, background: `linear-gradient(135deg, ${t.primario} 0%, ${t.secundario} 100%)`, fontFamily: 'Inter', color: '#e0e0e0', padding: '20px' },
                children: [
                    buildHeaderElement(torneo, titulo, subtitulo, t),
                    { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', background: hexToRgba(t.acento, 0.1), borderRadius: '8px 8px 0 0', padding: '8px 0', borderBottom: `1px solid ${hexToRgba(t.acento, 0.25)}` }, children: cols.map((col, i) => ({ type: 'div', props: { style: { width: `${colWidths[i]}px`, textAlign: i === 1 ? 'left' : 'center', fontSize: '12px', fontWeight: 700, color: t.acento, textTransform: 'uppercase', letterSpacing: '0.5px', paddingLeft: i === 1 ? '8px' : '0' }, children: col } })) } },
                    ...rows
                ]
            }
        };
        return await renderToBuffer(root, totalWidth, totalHeight);
    }
}

function buildParticipantsHeaderElement(torneo, t) {
    const logoSrc = torneo.logo ? getSafeAvatar(torneo.logo) : null;
    
    if (logoSrc) {
        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' },
                children: [
                    {
                        type: 'div',
                        props: {
                            style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px' },
                            children: [
                                {
                                    type: 'img',
                                    props: { src: logoSrc, width: 36, height: 36, style: { borderRadius: '50%', objectFit: 'cover' } }
                                },
                                {
                                    type: 'div',
                                    props: { style: { fontSize: '24px', fontWeight: 900, color: t.texto, letterSpacing: '1px' }, children: '👥 PARTICIPANTES' }
                                }
                            ]
                        }
                    },
                    { type: 'div', props: { style: { fontSize: '11px', color: t.acento, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginTop: '4px' }, children: torneo.nombre } }
                ]
            }
        };
    } else {
        return {
            type: 'div',
            props: {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' },
                children: [
                    { type: 'div', props: { style: { fontSize: '24px', fontWeight: 900, color: t.texto, letterSpacing: '1px' }, children: `👥 PARTICIPANTES` } },
                    { type: 'div', props: { style: { fontSize: '11px', color: t.acento, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginTop: '4px' }, children: torneo.nombre } }
                ]
            }
        };
    }
}

export async function generarImagenParticipantes(torneo) {
    await preProcessAvatars(torneo);
    const t = getTheme(torneo.tema);
    const equipos = [...torneo.equipos].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const colCount = equipos.length > 12 ? 2 : 1;
    const itemsPerCol = Math.ceil(equipos.length / colCount);
    const rowHeight = 46;
    const width = colCount === 2 ? 720 : 400;
    const headerHeight = torneo.logo ? 160 : 120;
    const height = headerHeight + (itemsPerCol * rowHeight) + 40;

    const renderColumn = (items) => ({
        type: 'div',
        props: {
            style: { display: 'flex', flexDirection: 'column', flex: 1, gap: '4px' },
            children: items.map((e, idx) => ({
                type: 'div',
                props: {
                    style: { display: 'flex', alignItems: 'center', padding: '8px 16px', background: hexToRgba(t.secundario, 0.5), borderRadius: '8px', border: `1px solid ${hexToRgba(t.borde, 0.25)}` },
                    children: [
                        { type: 'div', props: { style: { fontSize: '12px', color: t.acento, fontWeight: 800, width: '24px' }, children: `${equipos.indexOf(e) + 1}.` } },
                        avatarElement(e, e.nombre, t, 30),
                        { type: 'div', props: { style: { fontSize: '14px', fontWeight: 600, color: t.texto, flex: 1, overflow: 'hidden', whiteSpace: 'nowrap' }, children: e.nombre } }
                    ]
                }
            }))
        }
    });

    const root = {
        type: 'div',
        props: {
            style: { display: 'flex', flexDirection: 'column', width: `${width}px`, height: `${height}px`, background: t.primario, padding: '32px', fontFamily: 'Inter' },
            children: [
                buildParticipantsHeaderElement(torneo, t),
                { type: 'div', props: { style: { display: 'flex', gap: '20px' }, children: colCount === 2 ? [renderColumn(equipos.slice(0, itemsPerCol)), renderColumn(equipos.slice(itemsPerCol))] : [renderColumn(equipos)] } }
            ]
        }
    };
    return await renderToBuffer(root, width, height);
}

export async function generarTablaImagenCopa(torneo, tabla, titulo, grupoSel = null) {
    return await renderTablaBase(torneo, tabla, titulo, 'Tabla de Posiciones', grupoSel);
}

export async function generarPreviewTema(nombre, tema, logo = null) {
    const mockTabla = [
        { nombre: 'Ejemplo Local', avatar: '', puntos: 9, pj: 3, pg: 3, pe: 0, pp: 0, gf: 10, gc: 2 },
        { nombre: 'Ejemplo Visitante', avatar: '', puntos: 6, pj: 3, pg: 2, pe: 0, pp: 1, gf: 5, gc: 4 }
    ];
    return await renderTablaBase({ tema, clasificadosPorGrupo: 1, logo }, mockTabla, nombre, 'Vista Previa del Diseño');
}
