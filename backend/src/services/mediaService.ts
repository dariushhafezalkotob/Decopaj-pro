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

    // Convert Buffer back to base64 for consumers that expect it (like AI service)
    // but the raw buffer is also available in the 'data' field
    return {
        id: media.id,
        data: (media.data as Buffer).toString('base64'),
        mimeType: media.mimeType,
        rawBuffer: media.data as Buffer
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
