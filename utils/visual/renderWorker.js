/**
 * renderWorker.js
 * Worker thread para renderizado Satori → Resvg.
 * Este archivo es ejecutado por Piscina en un hilo separado.
 * Las fuentes se cargan UNA SOLA VEZ cuando el worker se inicializa.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Carga de fuentes al iniciar el worker ─────────────────────────────────────
// Esto ocurre solo una vez por thread, no en cada tarea.

const CWD = process.cwd();
const FONT_PATH_INTER = join(CWD, 'assets', 'fonts', 'Inter-Bold.ttf');
const FONT_PATH_DINPRO = join(CWD, 'assets', 'fonts', 'DinProCondensedMedium.otf');
const FONT_URL_INTER = 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf';
const FONT_URL_OPENSANS = 'https://fonts.gstatic.com/s/opensans/v34/memvYaGs126MiZpBA-UvWbX2vVnXBbObj2OVTSKmu1aB.ttf';

let fontInter = null;
let fontDinPro = null;
let fontOpenSans = null;

async function loadFonts() {
    // Inter (fuente principal de la mayoría de generadores)
    if (!fontInter) {
        if (existsSync(FONT_PATH_INTER)) {
            fontInter = readFileSync(FONT_PATH_INTER);
        } else {
            try {
                const res = await fetch(FONT_URL_INTER);
                if (res.ok) fontInter = Buffer.from(await res.arrayBuffer());
            } catch (e) {
                console.error('[renderWorker] No se pudo cargar Inter:', e.message);
            }
        }
    }

    // DinPro (fuente del generador de cartas)
    if (!fontDinPro && existsSync(FONT_PATH_DINPRO)) {
        fontDinPro = readFileSync(FONT_PATH_DINPRO);
    }

    // Open Sans (fallback para cartas si DinPro no está)
    if (!fontOpenSans) {
        if (existsSync(FONT_PATH_INTER)) {
            fontOpenSans = readFileSync(FONT_PATH_INTER); // Reusar Inter como fallback
        } else {
            try {
                const res = await fetch(FONT_URL_OPENSANS);
                if (res.ok) fontOpenSans = Buffer.from(await res.arrayBuffer());
            } catch (e) {
                console.error('[renderWorker] No se pudo cargar Open Sans:', e.message);
            }
        }
    }
}

// Iniciar carga de fuentes inmediatamente al iniciar el worker
const fontsReady = loadFonts();

// ── Cache de emojis por worker ────────────────────────────────────────────────
const emojiCache = new Map();

async function loadEmoji(codepoints) {
    if (emojiCache.has(codepoints)) return emojiCache.get(codepoints);

    // Intentar emoji local primero
    const cleanCode = codepoints.replace(/-fe0f/g, '');
    const localPath = join(CWD, 'assets', 'emojis', `${cleanCode}.svg`);
    if (existsSync(localPath)) {
        try {
            const svgText = readFileSync(localPath, 'utf8');
            const data = `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`;
            emojiCache.set(codepoints, data);
            return data;
        } catch {}
    }

    // Fallback a CDN
    const url = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${cleanCode}.svg`;
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = `data:image/svg+xml;base64,${Buffer.from(await res.text()).toString('base64')}`;
            emojiCache.set(codepoints, data);
            return data;
        }
    } catch {}

    return undefined;
}

// ── Manejo robusto de imágenes para Satori ────────────────────────────────────
const TRANSPARENT_1X1_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const imgCache = new Map();

async function resolveImageUrl(src) {
    if (!src || typeof src !== 'string') return TRANSPARENT_1X1_PNG;
    
    // Si ya es un data URI base64 válido
    if (src.startsWith('data:image/')) {
        return src;
    }

    if (imgCache.has(src)) {
        return imgCache.get(src);
    }

    // Ruta de archivo local en disco
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
        try {
            const localPath = join(CWD, src);
            const targetPath = existsSync(localPath) ? localPath : (existsSync(src) ? src : null);
            if (targetPath) {
                const buffer = readFileSync(targetPath);
                if (buffer.length > 50) {
                    const ext = targetPath.split('.').pop() || 'png';
                    const dataUri = `data:image/${ext};base64,${buffer.toString('base64')}`;
                    imgCache.set(src, dataUri);
                    return dataUri;
                }
            }
        } catch (e) {}
        return TRANSPARENT_1X1_PNG;
    }

    // URL remota (Discord CDN, etc.)
    try {
        const res = await fetch(src, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(4000)
        });

        if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('image') || contentType.includes('octet-stream')) {
                const buffer = Buffer.from(await res.arrayBuffer());
                if (buffer.length > 50 && !buffer.toString('utf8', 0, 10).startsWith('{')) {
                    const mime = contentType.includes('image') ? contentType.split(';')[0] : 'image/png';
                    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
                    imgCache.set(src, dataUri);
                    return dataUri;
                }
            }
        }
    } catch (e) {}

    // Fallback si la imagen no existe (404), expiró o da error
    imgCache.set(src, TRANSPARENT_1X1_PNG);
    return TRANSPARENT_1X1_PNG;
}

async function sanitizeVdom(node) {
    if (!node || typeof node !== 'object') return node;

    if (Array.isArray(node)) {
        await Promise.all(node.map(child => sanitizeVdom(child)));
        return node;
    }

    if (node.type === 'img' && node.props) {
        if (node.props.src) {
            node.props.src = await resolveImageUrl(node.props.src);
        } else {
            node.props.src = TRANSPARENT_1X1_PNG;
        }
    }

    if (node.props && node.props.children) {
        if (Array.isArray(node.props.children)) {
            await Promise.all(node.props.children.map(child => sanitizeVdom(child)));
        } else if (typeof node.props.children === 'object') {
            await sanitizeVdom(node.props.children);
        }
    }

    return node;
}

// ── Función principal del worker ──────────────────────────────────────────────

/**
 * @param {object} task
 * @param {object}   task.element       - Árbol de elementos Satori (objeto JSON serializable)
 * @param {number}   task.width         - Ancho del canvas en px
 * @param {number}   task.height        - Alto del canvas en px
 * @param {number}   [task.scale=2]     - Factor de escala para Resvg (default: 2x)
 * @param {string}   [task.fontSet]     - 'default' | 'card' (determina qué fuentes usar)
 * @returns {Buffer} Buffer PNG
 */
export default async function renderTask({ element, width, height, scale = 2, fontSet = 'default' }) {
    // Esperar a que las fuentes estén listas (solo bloquea en el primer render)
    await fontsReady;

    // Sanitizar árbol VDOM asegurando que todas las imágenes sean Base64 válidas
    await sanitizeVdom(element);

    // Construir array de fuentes según fontSet
    const fonts = [];

    if (fontSet === 'card') {
        // cardGenerator usa DinPro + Open Sans
        if (fontDinPro) {
            fonts.push({ name: 'DinProCondensedMedium', data: fontDinPro, weight: 700, style: 'normal' });
        }
        if (fontOpenSans) {
            fonts.push({ name: 'Open Sans', data: fontOpenSans, weight: 700, style: 'normal' });
        }
        if (fontInter) {
            fonts.push({ name: 'Inter', data: fontInter, weight: 700, style: 'normal' });
        }
    } else {
        // Todos los demás generadores usan Inter
        if (fontInter) {
            fonts.push({ name: 'Inter', data: fontInter, weight: 700, style: 'normal' });
        }
        if (fontOpenSans) {
            fonts.push({ name: 'sans-serif', data: fontOpenSans, weight: 700, style: 'normal' });
        }
    }

    const svg = await satori(element, {
        width,
        height,
        fonts: fonts.length > 0 ? fonts : [{ name: 'sans-serif', data: Buffer.from([]), weight: 700, style: 'normal' }],
        loadAdditionalAsset: async (code, segment) => {
            if (code === 'emoji') {
                const codepoints = [...segment].map(c => c.codePointAt(0).toString(16)).join('-');
                return await loadEmoji(codepoints);
            }
            return undefined;
        }
    });

    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width * scale } });
    return Buffer.from(resvg.render().asPng());
}
