import dotenv from 'dotenv';
import connectDB from './db';
import { Media, Project } from './models';

dotenv.config();

const isDataUrl = (value: unknown) =>
    typeof value === 'string' && value.startsWith('data:image');

async function run() {
    await connectDB();

    const mediaCount = await Media.countDocuments();
    if (mediaCount > 0) {
        const mediaDeleteRes = await Media.deleteMany({});
        console.log(`Deleted ${mediaDeleteRes.deletedCount || 0} Media documents.`);
    } else {
        console.log('No Media documents to delete.');
    }

    const projects = await Project.find({});
    let projectsTouched = 0;
    let assetsStripped = 0;
    let shotsStripped = 0;

    for (const project of projects as any[]) {
        let changed = false;

        const stripEntityImage = (entity: any) => {
            if (isDataUrl(entity?.imageData)) {
                entity.imageData = undefined;
                changed = true;
                assetsStripped++;
            }
        };

        (project.globalAssets || []).forEach(stripEntityImage);
        (project.globalCast || []).forEach(stripEntityImage);

        (project.sequences || []).forEach((seq: any) => {
            (seq.assets || []).forEach(stripEntityImage);
            (seq.shots || []).forEach((shot: any) => {
                if (isDataUrl(shot?.image_url)) {
                    shot.image_url = undefined;
                    changed = true;
                    shotsStripped++;
                }
            });
        });

        if (changed) {
            await project.save();
            projectsTouched++;
        }
    }

    console.log(`Projects updated: ${projectsTouched}`);
    console.log(`Asset imageData fields stripped: ${assetsStripped}`);
    console.log(`Shot image_url data URLs stripped: ${shotsStripped}`);
    console.log('Quota cleanup complete.');
    process.exit(0);
}

run().catch((err) => {
    console.error('Quota cleanup failed:', err);
    process.exit(1);
});

