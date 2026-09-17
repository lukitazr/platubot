import fs from 'fs';
import path from 'path';

export default async function descargarImagen(url, filename, folder = 'logos') {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`No se pudo descargar la imagen: ${response.statusText}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const extension = url.split('.').pop().split('?')[0] || 'png';
        const filePath = path.join(process.cwd(), 'assets', folder, `${filename}.${extension}`);
        fs.writeFileSync(filePath, buffer);
        return `assets/${folder}/${filename}.${extension}`;
    } catch (error) {
        console.error('❌ Error al descargar la imagen:', error);
        return null;
    }
}