import fs from 'fs';
import path from 'path';
import { Media } from '../models';

const PUBLIC_MEDIA_DIR = path.join(process.cwd(), 'public', 'media');

if (!fs.existsSync(PUBLIC_MEDIA_DIR)) {
    fs.mkdirSync(PUBLIC_MEDIA_DIR, { recursive: true });
}

const toSafeFileName = (id: string) => id.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
const extFromMime = (mimeType: string) => {
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('webp')) return 'webp';
    return 'png';
};

export const saveMedia = async (id: string, base64Data: string, mimeType: string = 'image/png'): Promise<string> => {
    console.log(`Saving media (filesystem-first): ${id}, type: ${mimeType}, data prefix: ${base64Data.substring(0, 30)}...`);
    const data = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    try {
        const safeName = toSafeFileName(id);
        const ext = extFromMime(mimeType);
        const fileName = `${safeName}.${ext}`;
        const filePath = path.join(PUBLIC_MEDIA_DIR, fileName);
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
        console.log(`Media ${id} saved to disk: ${filePath}`);
        return `/public/media/${fileName}`;
    } catch (err: any) {
        console.error(`Filesystem save failed for media ${id}, falling back to DB:`, err.message);
        await Media.findOneAndUpdate(
            { id },
            { data, mimeType },
            { upsert: true, new: true }
        );
        console.log(`Media ${id} saved in DB fallback.`);
        return `/api/media/${id}`;
    }
};

export const getMedia = async (id: string) => {
    return await Media.findOne({ id });
};
