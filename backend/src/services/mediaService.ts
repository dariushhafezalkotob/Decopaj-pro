import { Media } from '../models';

export const saveMedia = async (id: string, base64Data: string, mimeType: string = 'image/png'): Promise<string> => {
    const data = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    await Media.findOneAndUpdate(
        { id },
        { data, mimeType },
        { upsert: true, new: true }
    );

    // Return the virtual URL that our new route will handle
    return `/api/media/${id}`;
};

export const getMedia = async (id: string) => {
    return await Media.findOne({ id });
};
