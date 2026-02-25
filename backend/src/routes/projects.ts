
import { FastifyInstance } from 'fastify';
import { Project, Media } from '../models';
import { saveMedia, deleteProjectMedia } from '../services/mediaService';

const processProjectImages = async (projectId: string, data: any) => {
    // Process global assets (new)
    if (data.globalAssets) {
        for (const entity of data.globalAssets) {
            if (entity.imageData && entity.imageData.startsWith('data:image')) {
                entity.imageData = await saveMedia(
                    `${projectId}_asset_${entity.id}`,
                    entity.imageData,
                    entity.mimeType || 'image/png'
                );
            }
        }
    }

    // Process global cast (legacy)
    if (data.globalCast) {
        for (const entity of data.globalCast) {
            if (entity.imageData && entity.imageData.startsWith('data:image')) {
                entity.imageData = await saveMedia(
                    `${projectId}_cast_${entity.id}`,
                    entity.imageData,
                    entity.mimeType || 'image/png'
                );
            }
        }
    }

    // Process sequences
    if (data.sequences) {
        for (const seq of data.sequences) {
            // Process sequence assets
            if (seq.assets) {
                for (const asset of seq.assets) {
                    if (asset.imageData && asset.imageData.startsWith('data:image')) {
                        asset.imageData = await saveMedia(
                            `${projectId}_seq_${seq.id}_asset_${asset.id}`,
                            asset.imageData,
                            asset.mimeType || 'image/png'
                        );
                    }
                }
            }
            // Process shots (if they have generated images)
            if (seq.shots) {
                for (const shot of seq.shots) {
                    if (shot.image_url && shot.image_url.startsWith('data:image')) {
                        shot.image_url = await saveMedia(
                            `${projectId}_shot_${shot.shot_id}`,
                            shot.image_url
                        );
                    }
                }
            }
        }
    }
};

export default async function projectRoutes(server: FastifyInstance) {

    server.addHook('preValidation', (request: any, reply, done) => {
        try {
            request.jwtVerify().then(() => done(), (err: any) => reply.send(err));
        } catch (err) {
            reply.send(err);
        }
    });

    server.get('/', async (request: any, reply) => {
        const userId = request.user.id;
        const projects = await Project.find({ user_id: userId });
        return projects;
    });

    server.post('/', async (request: any, reply) => {
        const userId = request.user.id;
        const data = request.body;
        const tempId = data.id || `proj-${Date.now()}`;
        await processProjectImages(tempId, data);
        console.log("Creating project for user:", userId);

        // Assign generic ID if missing or used from frontend generic logic
        const project = await Project.create({
            ...data,
            user_id: userId,
            // If frontend sends an ID, we might store it, or let Mongo generate _id. 
            // For sync compatibility, we keep their ID but secure it with user_id.
        });
        return project;
    });

    server.put('/:projectId', async (request: any, reply) => {
        console.log("REQUEST CAME")
        const userId = request.user.id;
        const { projectId } = request.params;
        const data = request.body;

        const bodySize = JSON.stringify(data).length;
        console.log(`Updating project: ${projectId}, Payload size: ${bodySize} chars`);

        const updateData = { ...data };
        await processProjectImages(projectId, updateData);
        delete updateData._id;
        delete updateData.__v;
        delete updateData.user_id;

        // Try finding by custom 'id' first, then fallback to Mongoose '_id' if the parameter looks like an ObjectId
        let query: any = { id: projectId, user_id: userId };

        // If query by 'id' fails or if projectId looks like a Mongo ID, we might need to be more flexible
        // But for consistency with frontend 'id' field, we focus on {id: projectId}

        console.log("Searching for project with query:", JSON.stringify(query));

        let project = await Project.findOneAndUpdate(
            query,
            updateData,
            { new: true }
        );

        if (!project && projectId.match(/^[0-9a-fA-F]{24}$/)) {
            console.log("Project not found by 'id' field, trying by '_id'...");
            project = await Project.findOneAndUpdate(
                { _id: projectId, user_id: userId },
                updateData,
                { new: true }
            );
        }

        if (!project) {
            console.warn(`Project not found: ${projectId} for user ${userId}`);
            return reply.code(404).send({ message: "Project not found or unauthorized" });
        }

        console.log("Project updated successfully");
        return project;
    });

    server.delete('/:projectId', async (request: any, reply) => {
        const userId = request.user.id;
        const { projectId } = request.params;

        let query: any = { id: projectId, user_id: userId };
        let project = await Project.findOneAndDelete(query);

        if (!project && projectId.match(/^[0-9a-fA-F]{24}$/)) {
            project = await Project.findOneAndDelete({ _id: projectId, user_id: userId });
        }

        if (project) {
            await deleteProjectMedia(projectId);
        }

        return { message: "Deleted" };
    });

    // Endpoint to sync full list or bulk update could go here
    server.post('/sync', async (request: any, reply) => {
        const userId = request.user.id;
        const projects: any[] = request.body;

        // Simple sync strategy: upsert all
        for (const p of projects) {
            await processProjectImages(p.id, p);
            await Project.findOneAndUpdate(
                { id: p.id, user_id: userId },
                { ...p, user_id: userId },
                { upsert: true, new: true }
            );
        }
        return { message: "Synced" };
    });

    // Temporary endpoint to trigger orphan cleanup (Supports both GET and POST for convenience)
    server.get('/cleanup', async (request: any, reply) => {
        // ... recycle the POST logic ...
        return await triggerCleanup(request, reply);
    });

    server.post('/cleanup', async (request: any, reply) => {
        return await triggerCleanup(request, reply);
    });

    async function triggerCleanup(request: any, reply: any) {
        // Simple orphan cleanup logic integrated into route
        const projects = await Project.find({});
        const referencedMediaIds = new Set<string>();

        const trackEntityMedia = (entity: any) => {
            if (typeof entity?.imageData === 'string' && entity.imageData.startsWith('/api/media/')) {
                referencedMediaIds.add(entity.imageData.replace('/api/media/', ''));
            }
        };

        for (const project of projects as any[]) {
            (project.globalAssets || []).forEach(trackEntityMedia);
            (project.globalCast || []).forEach(trackEntityMedia);

            (project.sequences || []).forEach((seq: any) => {
                (seq.assets || []).forEach(trackEntityMedia);
                (seq.shots || []).forEach((shot: any) => {
                    if (typeof shot?.image_url === 'string' && shot.image_url.startsWith('/api/media/')) {
                        referencedMediaIds.add(shot.image_url.replace('/api/media/', ''));
                    }
                });
            });
        }

        const allMedia = await Media.find({}, { id: 1 }).lean();
        const orphanIds: string[] = [];

        for (const media of allMedia) {
            if (!referencedMediaIds.has(media.id)) {
                orphanIds.push(media.id);
            }
        }

        let deletedCount = 0;
        if (orphanIds.length > 0) {
            const result = await Media.deleteMany({ id: { $in: orphanIds } });
            deletedCount = result.deletedCount || 0;
        }

        return {
            message: "Cleanup complete",
            referencedCount: referencedMediaIds.size,
            deletedCount
        };
    }
}
