import dotenv from 'dotenv';
import connectDB from '../db';
import { Media, Project } from '../models';

dotenv.config();

const isMediaUrl = (value: unknown): string | null => {
    if (typeof value === 'string' && value.startsWith('/api/media/')) {
        return value.replace('/api/media/', '');
    }
    return null;
};

async function run() {
    console.log('Starting cleanup of orphaned media...');
    await connectDB();

    const projects = await Project.find({});
    const referencedMediaIds = new Set<string>();

    const trackEntityMedia = (entity: any) => {
        const id = isMediaUrl(entity?.imageData);
        if (id) referencedMediaIds.add(id);
    };

    for (const project of projects as any[]) {
        (project.globalAssets || []).forEach(trackEntityMedia);
        (project.globalCast || []).forEach(trackEntityMedia);

        (project.sequences || []).forEach((seq: any) => {
            (seq.assets || []).forEach(trackEntityMedia);
            (seq.shots || []).forEach((shot: any) => {
                const id = isMediaUrl(shot?.image_url);
                if (id) referencedMediaIds.add(id);
            });
        });
    }

    console.log(`Found ${referencedMediaIds.size} referenced media items.`);

    const allMedia = await Media.find({}, { id: 1 });
    const orphanIds: string[] = [];

    for (const media of allMedia) {
        if (!referencedMediaIds.has(media.id)) {
            orphanIds.push(media.id);
        }
    }

    if (orphanIds.length > 0) {
        console.log(`Found ${orphanIds.length} orphaned media items. Deleting...`);
        const result = await Media.deleteMany({ id: { $in: orphanIds } });
        console.log(`Successfully deleted ${result.deletedCount || 0} orphaned media items.`);
    } else {
        console.log('No orphaned media items found.');
    }

    console.log('Cleanup complete.');
    process.exit(0);
}

run().catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});
