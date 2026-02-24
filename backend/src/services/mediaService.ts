import { Media } from '../models';

export const saveMedia = async (id: string, base64Data: string, mimeType: string = 'image/png'): Promise<string> => {
    console.log(`Saving media: ${id}, type: ${mimeType}, data prefix: ${base64Data.substring(0, 30)}...`);
    const data = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    try {
        await Media.findOneAndUpdate(
            { id },
            { data, mimeType },
            { upsert: true, new: true }
        );
        console.log(`Media ${id} saved successfully.`);
    } catch (err: any) {
        console.error(`Failed to save media ${id}:`, err.message);
        throw err;
    }

    // Return the virtual URL that our new route will handle
    return `/api/media/${id}`;
};

export const getMedia = async (id: string) => {
    return await Media.findOne({ id });
};
