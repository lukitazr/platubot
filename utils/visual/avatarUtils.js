import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

const AVATAR_CACHE_DIR = join(process.cwd(), 'cache', 'avatars');

export async function getAvatarBase64(avatarUrl) {
    if (!avatarUrl) return null;

    if (!existsSync(AVATAR_CACHE_DIR)) {
        mkdirSync(AVATAR_CACHE_DIR, { recursive: true });
    }

    // 1. Si es una ruta local en disco
    if (!avatarUrl.startsWith('http')) {
        try {
            const localPath = join(process.cwd(), avatarUrl);
            const targetPath = existsSync(localPath) ? localPath : (existsSync(avatarUrl) ? avatarUrl : null);
            if (targetPath) {
                const buffer = readFileSync(targetPath);
                return `data:image/png;base64,${buffer.toString('base64')}`;
            }
        } catch (e) { }
        return null;
    }

    // 2. Si es una URL remota de Discord o HTTP
    try {
        // Forzar extensión .png y remover formato .gif / .webp incompatible con Satori
        let cleanUrl = avatarUrl.replace(/\.gif(\?.*)?$/i, '.png$1').replace(/\.webp(\?.*)?$/i, '.png$1');
        if (!cleanUrl.includes('.png')) {
            const urlObj = new URL(cleanUrl);
            urlObj.pathname = urlObj.pathname.replace(/\.[a-zA-Z0-9]+$/, '') + '.png';
            cleanUrl = urlObj.toString();
        }

        const hashKey = cleanUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
        const cacheFilePath = join(AVATAR_CACHE_DIR, `${hashKey}.png`);

        if (existsSync(cacheFilePath)) {
            const buffer = readFileSync(cacheFilePath);
            if (buffer.length > 50 && !buffer.toString('utf8', 0, 10).startsWith('{')) {
                return `data:image/png;base64,${buffer.toString('base64')}`;
            }
        }

        const response = await axios.get(cleanUrl, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        const buffer = Buffer.from(response.data);
        if (buffer.length > 50 && !buffer.toString('utf8', 0, 10).startsWith('{')) {
            writeFileSync(cacheFilePath, buffer);
            return `data:image/png;base64,${buffer.toString('base64')}`;
        }
        return null;
    } catch (e) {
        // Fallback en caso de error de red
        return null;
    }
}
