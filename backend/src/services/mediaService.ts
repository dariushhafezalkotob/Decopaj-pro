import { Media } from '../models';

export const saveMedia = async (id: string, base64Data: string, mimeType: string = 'image/png'): Promise<string> => {
    console.log(`Saving media: ${id}, type: ${mimeType}, data prefix: ${base64Data.substring(0, 30)}...`);
    const rawData = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buffer = Buffer.from(rawData, 'base64');

    try {
        await Media.findOneAndUpdate(
            { id },
            { data: buffer, mimeType },
            { upsert: true, new: true }
        );
        console.log(`Media ${id} saved successfully as Binary.`);
    } catch (err: any) {
        console.error(`Failed to save media ${id}:`, err.message);
        throw err;
    }

    // Return the virtual URL that our new route will handle
    return `/api/media/${id}`;
};

export const getMedia = async (id: string) => {
    const media = await Media.findOne({ id });
    if (!media) return null;

    const data = media.data as Buffer;

    // Check if this is legacy base64 data stored as a string in the DB (now wrapped in a Buffer by Mongoose)
    // Legacy PNG base64 starts with 'iVBOR', JPEG starts with '/9j/'
    // New binary PNG starts with 0x89 0x50 0x4E 0x47
    const preview = data.slice(0, 10).toString('utf8');
    const isLegacyBase64 = preview.startsWith('iVBOR') || preview.startsWith('/9j/') || preview.startsWith('data:image');

    let base64Data = isLegacyBase64 ? data.toString('utf8') : data.toString('base64');

    // Strip prefix if it exists in the string
    if (base64Data.includes('base64,')) {
        base64Data = base64Data.split('base64,')[1];
    }
    const rawBuffer = isLegacyBase64 ? Buffer.from(base64Data.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64') : data;

    return {
        id: media.id,
        data: base64Data,
        mimeType: media.mimeType,
        rawBuffer: rawBuffer
    };
};

export const deleteProjectMedia = async (projectId: string): Promise<number> => {
    console.log(`Deleting all media for project: ${projectId}`);
    // Media IDs are prefixed with projectId (e.g., projectId_shot_1)
    const result = await Media.deleteMany({
        id: { $regex: new RegExp(`^${projectId}_`) }
    });
    console.log(`Deleted ${result.deletedCount || 0} media items for project ${projectId}.`);
    return result.deletedCount || 0;
};

export const getMediaByIds = async (ids: string[]) => {
    return await Media.find({ id: { $in: ids } });
};
