import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

// Ensure public directory exists
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

export const sanitize = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
};

export const saveProjectImage = async (
    params: {
        projectName: string;
        sequenceTitle: string;
        imageId: string;
        base64Data: string;
    }
): Promise<string> => {
    const { projectName, sequenceTitle, imageId, base64Data } = params;

    // Remove base64 header if present
    const data = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    // Create directory structure: public/projects/[project]/[sequence]
    const relDirPath = path.join('projects', sanitize(projectName), sanitize(sequenceTitle));
    const fullDirPath = path.join(PUBLIC_DIR, relDirPath);

    if (!fs.existsSync(fullDirPath)) {
        fs.mkdirSync(fullDirPath, { recursive: true });
    }

    const fileName = `${sanitize(imageId)}.png`;
    const filePath = path.join(fullDirPath, fileName);

    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

    // Return the URL relative to static root
    // Example: /public/projects/my_project/scene_1/img_123.png
    return `/public/${relDirPath.replace(/\\/g, '/')}/${fileName}`;
};
