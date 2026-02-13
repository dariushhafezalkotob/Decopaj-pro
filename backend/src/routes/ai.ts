
import { FastifyInstance } from 'fastify';
import { GoogleGenAI, Type } from "@google/genai";
import { saveMedia, getMedia } from '../services/mediaService';
import fs from 'fs';
import path from 'path';

export default async function aiRoutes(server: FastifyInstance) {

    const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const mimeType = 'image/png';

    const resolveImageResource = async (input: string) => {
        if (!input) return null;

        console.log(`Resolving image: ${input.substring(0, 50)}${input.length > 50 ? '...' : ''}`);

        // Handle database-stored media URLs (e.g., /api/media/...)
        const mediaMatch = input.match(/\/api\/media\/(.+)$/);
        if (mediaMatch) {
            const mediaId = mediaMatch[1];
            console.log(`Fetching from database: ${mediaId}`);
            const media = await getMedia(mediaId);
            if (media) {
                console.log(`Media found in DB!`);
                return {
                    data: media.data,
                    mimeType: media.mimeType || mimeType
                };
            }
            console.warn(`Media NOT found in DB: ${mediaId}`);
            return null;
        }

        // Handle local file path (e.g., /public/shots/...)
        const publicMatch = input.match(/\/public\/(.+)$/);
        if (publicMatch) {
            const relPath = `public/${publicMatch[1].split('?')[0]}`; // Strip query params
            const filePath = path.join(process.cwd(), relPath);
            console.log(`Checking local path: ${filePath}`);

            if (fs.existsSync(filePath)) {
                console.log(`File found! Reading...`);
                return {
                    data: fs.readFileSync(filePath).toString('base64'),
                    mimeType
                };
            }
            console.warn(`Local file NOT found: ${filePath}. cwd is ${process.cwd()}`);
            return null;
        }

        // Handle Data URL
        if (input.includes('base64,')) {
            console.log(`Detected Data URL`);
            return {
                data: input.split('base64,')[1],
                mimeType: input.split(';')[0].split(':')[1] || mimeType
            };
        }

        // If it starts with http or /, and we reached here, it's a broken link we can't resolve
        if (input.startsWith('http') || input.startsWith('/')) {
            console.warn(`Unresolvable image link: ${input}`);
            return null;
        }

        // Assume raw base64
        console.log(`Assuming raw base64 data`);
        return { data: input, mimeType };
    };

    const generateImageSeedream = async (prompt: string, imageConfig?: any) => {
        const apiKey = process.env.KREA_API_KEY;
        if (!apiKey) throw new Error("KREA_API_KEY is not configured.");

        const initialResponse = await fetch('https://api.krea.ai/generate/image/bytedance/seedream-4.5', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: prompt,
                width: 1024,
                height: 576, // 16:9
                ...imageConfig
            })
        });

        if (!initialResponse.ok) {
            const error = await initialResponse.text();
            console.error("Krea Job Creation Error:", error);
            throw new Error(`Krea API Error: ${initialResponse.statusText}`);
        }

        const jobData: any = await initialResponse.json();
        const jobId = jobData.job_id || jobData.id;
        if (!jobId) throw new Error("Krea API did not return a job ID.");

        console.log(`Krea Job Created: ${jobId}. Polling for result...`);

        // Polling loop
        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s
        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 2000));
            const statusResponse = await fetch(`https://api.krea.ai/jobs/${jobId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!statusResponse.ok) {
                console.error(`Krea Status Check Failed for ${jobId}`);
                attempts++;
                continue;
            }

            const statusData: any = await statusResponse.json();
            console.log(`Job ${jobId} Status: ${statusData.status}`);

            if (statusData.status === 'completed') {
                return statusData.result || statusData.url || (statusData.data && statusData.data[0]?.url);
            }
            if (statusData.status === 'failed') {
                throw new Error(`Krea Job Failed: ${statusData.error || 'Unknown error'}`);
            }
            attempts++;
        }

        throw new Error("Krea generation timed out after 60 seconds.");
    };

    // 0. Health check (Public)
    server.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    server.addHook('preValidation', (request: any, reply, done) => {
        console.log(`Request: ${request.method} ${request.url}`);

        // Skip auth for health check
        if (request.url.endsWith('/health')) {
            return done();
        }

        if (!request.headers.authorization) {
            console.warn(`No Authorization header for ${request.url}`);
        }
        try {
            request.jwtVerify().then(() => done(), (err: any) => reply.send(err));
        } catch (err) {
            reply.send(err);
        }
    });

    // 1. Identify Entities
    server.post('/identify-entities', async (request: any, reply) => {
        const { script, globalCast } = request.body;
        const ai = getAI();

        const castNames = (globalCast || []).map((c: any) => c.name).join(", ");
        const prompt = `Identify all unique characters, locations, and important items in this film script.
      IMPORTANT: The following characters are already cast: [${castNames}]. 
      - DO NOT list these specific characters in your response if they are already in the cast list above.
      - ONLY identify NEW characters, LOCATIONS, and key PROPS/ITEMS.
      - Ensure names match the script exactly.
      Return as JSON.
      Script: "${script}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        entities: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    type: { type: Type.STRING, enum: ["character", "location", "item"] }
                                },
                                required: ["name", "type"]
                            }
                        }
                    },
                    required: ["entities"]
                }
            }
        });

        return JSON.parse(response.text || '{"entities": []}');
    });

    // 2. Full Decopaj
    server.post('/analyze-script', async (request: any, reply) => {
        const { script, assets } = request.body;
        const ai = getAI();

        const safeAssets = assets || [];
        const assetMapText = safeAssets.map((a: any) => `- ${a.name} (${a.type}): USE REF TAG "${a.refTag}"`).join('\n');

        const prompt = `Role: Professional Film Director & Cinematographer.
      Task: Technical 'Decopaj' (shot breakdown) of the provided script.
      
      MANDATORY PRODUCTION ASSETS (Mapping table):
      ${assetMapText}
      
      INSTRUCTIONS:
      1. Break the scene into logical Shots/Plans.
      2. For each shot, list the characters present in that frame.
      3. CRITICAL: For every character, object/item, AND environment/location, you MUST populate the "reference_image" field with the exact "image X" ref tag from the mapping table above if a matching asset exists.
      4. Provide detailed physical positioning and lighting effects specifically for those characters.
      5. Technical camera specs should be professional (e.g., 35mm lens, f/2.8, shallow depth of field).
      
      Script to process: "${script}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        shots: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    shot_id: { type: Type.STRING },
                                    plan_type: { type: Type.STRING },
                                    camera_specs: { type: Type.STRING },
                                    action_segment: { type: Type.STRING },
                                    relevant_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    visual_breakdown: {
                                        type: Type.OBJECT,
                                        properties: {
                                            scene: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    environment: { type: Type.OBJECT, properties: { location_type: { type: Type.STRING }, description: { type: Type.STRING }, reference_image: { type: Type.STRING } }, required: ["location_type", "description"] },
                                                    time: { type: Type.STRING },
                                                    mood: { type: Type.STRING },
                                                    color_palette: { type: Type.STRING }
                                                },
                                                required: ["environment", "time", "mood", "color_palette"]
                                            },
                                            characters: {
                                                type: Type.ARRAY,
                                                items: {
                                                    type: Type.OBJECT,
                                                    properties: {
                                                        name: { type: Type.STRING },
                                                        reference_image: { type: Type.STRING },
                                                        position: { type: Type.STRING },
                                                        appearance: { type: Type.OBJECT, properties: { description: { type: Type.STRING }, expression: { type: Type.STRING } }, required: ["description", "expression"] },
                                                        actions: { type: Type.STRING },
                                                        lighting_effect: { type: Type.STRING }
                                                    },
                                                    required: ["name", "reference_image", "position", "appearance", "actions", "lighting_effect"]
                                                }
                                            },
                                            objects: {
                                                type: Type.ARRAY,
                                                items: {
                                                    type: Type.OBJECT,
                                                    properties: {
                                                        name: { type: Type.STRING },
                                                        reference_image: { type: Type.STRING },
                                                        details: { type: Type.STRING },
                                                        action: { type: Type.STRING }
                                                    },
                                                    required: ["name", "details"]
                                                }
                                            },
                                            framing_composition: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    shot_type: { type: Type.STRING },
                                                    framing: { type: Type.STRING },
                                                    perspective: { type: Type.STRING }
                                                },
                                                required: ["shot_type", "framing", "perspective"]
                                            },
                                            camera: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    lens: { type: Type.OBJECT, properties: { focal_length_mm: { type: Type.NUMBER }, type: { type: Type.STRING } }, required: ["focal_length_mm", "type"] },
                                                    settings: { type: Type.OBJECT, properties: { aperture: { type: Type.STRING }, focus: { type: Type.STRING } }, required: ["aperture", "focus"] }
                                                },
                                                required: ["lens", "settings"]
                                            },
                                            lighting: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    key: { type: Type.STRING },
                                                    quality: { type: Type.STRING },
                                                    color_contrast: { type: Type.STRING }
                                                },
                                                required: ["key", "quality", "color_contrast"]
                                            }
                                        },
                                        required: ["scene", "characters", "camera", "lighting", "framing_composition"]
                                    }
                                },
                                required: ["shot_id", "plan_type", "visual_breakdown", "relevant_entities"]
                            }
                        }
                    },
                    required: ["shots"]
                }
            }
        });

        return JSON.parse(response.text || '{"shots": []}');
    });

    server.post('/analyze-custom-shot', async (request: any, reply) => {
        const { description, assets } = request.body;
        const ai = getAI();

        const mappingText = assets.map((a: any) => `- ${a.name} (${a.type}): use "${a.refTag}"`).join('\n');

        const prompt = `
      You are a cinematic director. Analyze the following manual shot description and create a technical cinematic breakdown.
      
      USER DESCRIPTION: "${description}"

      ASSET MAPPING TABLE (CRITICAL):
      ${mappingText}

      INSTRUCTIONS:
      1. Create a detailed Visual Breakdown for this single shot.
      2. CRITICAL: Use the "image X" ref tags from the mapping table above for the "reference_image" fields of characters, objects, and environment locations.
      3. If the user mentions a character, object, or location from the mapping table, you MUST use its refTag.
      4. If the user describes a location that matches one in the mapping table, use that location's details.

      Return a single ShotPlan object.
    `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        shot_id: { type: Type.STRING },
                        plan_type: { type: Type.STRING },
                        action_segment: { type: Type.STRING },
                        relevant_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                        visual_breakdown: {
                            type: Type.OBJECT,
                            properties: {
                                scene: {
                                    type: Type.OBJECT,
                                    properties: {
                                        environment: { type: Type.OBJECT, properties: { location_type: { type: Type.STRING }, description: { type: Type.STRING }, reference_image: { type: Type.STRING } }, required: ["location_type", "description"] },
                                        time: { type: Type.STRING },
                                        mood: { type: Type.STRING },
                                        color_palette: { type: Type.STRING }
                                    },
                                    required: ["environment", "time", "mood", "color_palette"]
                                },
                                characters: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            name: { type: Type.STRING },
                                            reference_image: { type: Type.STRING },
                                            position: { type: Type.STRING },
                                            appearance: { type: Type.OBJECT, properties: { description: { type: Type.STRING }, expression: { type: Type.STRING } }, required: ["description", "expression"] },
                                            actions: { type: Type.STRING },
                                            lighting_effect: { type: Type.STRING }
                                        },
                                        required: ["name", "reference_image", "position", "appearance", "actions", "lighting_effect"]
                                    }
                                },
                                objects: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            name: { type: Type.STRING },
                                            reference_image: { type: Type.STRING },
                                            details: { type: Type.STRING },
                                            action: { type: Type.STRING }
                                        },
                                        required: ["name", "details"]
                                    }
                                },
                                framing_composition: {
                                    type: Type.OBJECT,
                                    properties: {
                                        shot_type: { type: Type.STRING },
                                        framing: { type: Type.STRING },
                                        perspective: { type: Type.STRING }
                                    },
                                    required: ["shot_type", "framing", "perspective"]
                                },
                                camera: {
                                    type: Type.OBJECT,
                                    properties: {
                                        lens: { type: Type.OBJECT, properties: { focal_length_mm: { type: Type.NUMBER }, type: { type: Type.STRING } }, required: ["focal_length_mm", "type"] },
                                        settings: { type: Type.OBJECT, properties: { aperture: { type: Type.STRING }, focus: { type: Type.STRING } }, required: ["aperture", "focus"] }
                                    },
                                    required: ["lens", "settings"]
                                },
                                lighting: {
                                    type: Type.OBJECT,
                                    properties: {
                                        key: { type: Type.STRING },
                                        quality: { type: Type.STRING },
                                        color_contrast: { type: Type.STRING }
                                    },
                                    required: ["key", "quality", "color_contrast"]
                                }
                            },
                            required: ["scene", "characters", "camera", "lighting", "framing_composition"]
                        }
                    },
                    required: ["shot_id", "plan_type", "visual_breakdown", "relevant_entities"]
                }
            }
        });

        return JSON.parse(response.text || '{}');
    });

    // 3. Generate Image
    server.post('/generate-image', async (request: any, reply) => {
        const { shot, size, assets, projectName, sequenceTitle, projectId, sequenceId, model: requestedModel } = request.body;
        const ai = getAI();
        const parts: any[] = [];

        // High resolution model selection
        const model = 'gemini-3-pro-image-preview';

        const envRefTag = shot.visual_breakdown.scene.environment.reference_image;
        const locationAsset = assets.find((a: any) => a.refTag === envRefTag) || assets.find((a: any) => a.type === 'location' && shot.relevant_entities.includes(a.name));
        const locRes = await resolveImageResource(locationAsset?.imageData);
        if (locRes) {
            parts.push({ inlineData: { data: locRes.data, mimeType: locRes.mimeType } });
            parts.push({ text: `ENVIRONMENT REFERENCE [${locationAsset.refTag}]: ${locationAsset.name}. ${locationAsset.description}` });
        }

        for (const charShot of shot.visual_breakdown.characters) {
            const asset = assets.find((a: any) => a.refTag === charShot.reference_image) || assets.find((a: any) => a.name === charShot.name);
            const charRes = await resolveImageResource(asset?.imageData);
            if (charRes) {
                parts.push({ inlineData: { data: charRes.data, mimeType: charRes.mimeType } });
                parts.push({
                    text: `CHARACTER IDENTITY [${charShot.reference_image}]: "${charShot.name}".
        MANDATORY FACIAL FEATURES: Use the attached reference image for this character.
        FRAME POSITION: ${charShot.position}
        EXPRESSION: ${charShot.appearance.expression}
        APPEARANCE: ${charShot.appearance.description}
        ACTION: ${charShot.actions}
        LIGHTING ON THEM: ${charShot.lighting_effect}`
                });
            }
        }

        // Add Object references
        if (shot.visual_breakdown.objects) {
            for (const obj of shot.visual_breakdown.objects) {
                if (obj.reference_image) {
                    const asset = assets.find((a: any) => a.refTag === obj.reference_image) || assets.find((a: any) => a.name === obj.name);
                    const objRes = await resolveImageResource(asset?.imageData);
                    if (objRes) {
                        parts.push({ inlineData: { data: objRes.data, mimeType: objRes.mimeType } });
                        parts.push({ text: `OBJECT/ITEM REFERENCE [${obj.reference_image}]: "${obj.name}". Details: ${obj.details}` });
                    }
                }
            }
        }

        parts.push({
            text: `
      SCENE CONTEXT: "${shot.action_segment}"
      SHOT TYPE: ${shot.visual_breakdown.framing_composition.shot_type}, ${shot.visual_breakdown.framing_composition.framing}
      CAMERA DATA: Lens ${shot.visual_breakdown.camera.lens.focal_length_mm}mm, Aperture ${shot.visual_breakdown.camera.settings.aperture}
      ENVIRONMENT MOOD: ${shot.visual_breakdown.scene.mood}, Palette: ${shot.visual_breakdown.scene.color_palette}
      
      FINAL STYLE: Cinematic 8k film still, anamorphic lens, photorealistic, high-end production lighting. 
      IMPORTANT: Generate exactly one cinematic frame based on the technical breakdown and visual references provided. NO TEXT, LOGOS, OR CAPTIONS.
    `
        });

        const fullPrompt = parts.map(p => p.text || '').join('\n');

        try {
            if (requestedModel === 'seedream-4.5') {
                console.log(`Calling Seedream 4.5 (Krea) for shot ${shot.shot_id}...`);
                const startTime = Date.now();
                const imageUrl = await generateImageSeedream(fullPrompt);
                const duration = (Date.now() - startTime) / 1000;
                console.log(`Seedream responded in ${duration}s for shot ${shot.shot_id}`);

                // If it's a URL, we might want to fetch and save it, but saveMedia handles base64.
                // For now, return the URL directly or if it's base64, save it.
                if (imageUrl.startsWith('http')) {
                    return { image_url: imageUrl };
                }
                const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}`, imageUrl);
                return { image_url: savedUrl };
            }

            console.log(`Calling Gemini (${model}) for shot ${shot.shot_id}...`);
            const startTime = Date.now();
            const response = await ai.models.generateContent({
                model: model,
                contents: { parts },
                config: {
                    imageConfig: {
                        aspectRatio: "16:9"
                    }
                }
            });
            const duration = (Date.now() - startTime) / 1000;
            console.log(`Gemini responded in ${duration}s for shot ${shot.shot_id}`);

            if (response.candidates?.[0]?.finishReason) {
                console.log(`Finish reason for ${shot.shot_id}: ${response.candidates[0].finishReason}`);
            }

            const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (part?.inlineData?.data) {
                const imageUrl = await saveMedia(
                    `${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}`,
                    part.inlineData.data
                );
                return { image_url: imageUrl };
            }

            const errorMsg = response.candidates?.[0]?.finishReason === 'SAFETY'
                ? "Image blocked by safety filters. Try a different description."
                : "No image generated by the AI model.";
            console.warn(`Generation failed for ${shot.shot_id}:`, errorMsg, JSON.stringify(response.candidates?.[0] || {}, null, 2));
            throw new Error(errorMsg);
        } catch (err: any) {
            console.error(`Gemini ROUTE ERROR for ${shot.shot_id}:`, err.message);
            return reply.code(500).send({ message: err.message });
        }
    });

    // 4. Edit Shot
    server.post('/edit-shot', async (request: any, reply) => {
        const { originalBase64, editPrompt, shot, projectName, sequenceTitle, projectId, sequenceId, assets, model: requestedModel } = request.body;
        const ai = getAI();
        const mimeType = 'image/png';

        console.log(`Editing shot: ${shot.shot_id}, Original: ${typeof originalBase64 === 'string' ? originalBase64.substring(0, 50) : 'not a string'}...`);

        const imageRes = await resolveImageResource(originalBase64);
        if (!imageRes) throw new Error("No original image data provided.");
        const base64Data = imageRes.data;
        const currentMimeType = imageRes.mimeType;

        // STEP 1: Generate the new visual
        const genPromptText = `
    You are a professional film colorist and VFX supervisor.
    TASK: Modify the attached cinematic film still according to the instruction below.
    
    ORIGINAL CONTEXT: ${shot.plan_type} - ${shot.action_segment}
    EDIT INSTRUCTION: ${editPrompt}
    
    MAINTAIN: Keep the character identities, composition, and lens properties unless explicitly told to change them.
    RESULT: Output a single cinematic frame. NO TEXT, LOGOS, OR CAPTIONS.
  `;

        try {
            if (requestedModel === 'seedream-4.5') {
                console.log(`Calling Seedream 4.5 (Krea) to EDIT shot ${shot.shot_id}...`);
                const startTime = Date.now();
                // Krea image-to-image usually takes an image_url or base64
                const imageUrl = await generateImageSeedream(`${genPromptText}\nUse this image as reference.`, {
                    image_url: base64Data.startsWith('http') ? base64Data : `data:${currentMimeType};base64,${base64Data}`
                });
                const duration = (Date.now() - startTime) / 1000;
                console.log(`Seedream edit responded in ${duration}s for shot ${shot.shot_id}`);

                if (imageUrl.startsWith('http')) {
                    return { image_url: imageUrl, visual_breakdown: shot.visual_breakdown };
                }
                const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_${Date.now()}`, imageUrl);
                return { image_url: savedUrl, visual_breakdown: shot.visual_breakdown };
            }

            console.log(`Calling Gemini (gemini-3-pro-image-preview) to EDIT shot ${shot.shot_id}...`);
            const startTime = Date.now();
            const imgResponse = await ai.models.generateContent({
                model: 'gemini-3-pro-image-preview',
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType: currentMimeType } },
                        { text: genPromptText }
                    ]
                },
                config: { imageConfig: { aspectRatio: "16:9" } }
            });
            const duration = (Date.now() - startTime) / 1000;
            console.log(`Gemini edit responded in ${duration}s for shot ${shot.shot_id}`);

            if (imgResponse.candidates?.[0]?.finishReason) {
                console.log(`Edit finish reason for ${shot.shot_id}: ${imgResponse.candidates[0].finishReason}`);
            }

            const imgPart = imgResponse.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (!imgPart?.inlineData?.data) {
                const finishReason = imgResponse.candidates?.[0]?.finishReason;
                console.error(`Gemini failed to return image data. Reason: ${finishReason}`, JSON.stringify(imgResponse, null, 2));
                throw new Error(finishReason === 'SAFETY' ? "Edit blocked by safety filters." : "Visual update failed.");
            }

            console.log("Gemini image generation successful.");
            const newImageUrl = await saveMedia(
                `${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_${Date.now()}`,
                imgPart.inlineData.data
            );
            console.log(`Saved new image to: ${newImageUrl}`);

            return {
                image_url: newImageUrl,
                visual_breakdown: shot.visual_breakdown // Keep original
            };

        } catch (err: any) {
            console.error("Edit shot error:", err);
            return reply.code(500).send({ message: err.message });
        }
    });
}
