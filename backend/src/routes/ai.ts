
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

    const generateImageSeedream = async (prompt: string, imageConfig?: any, modelPathOverride?: string) => {
        const apiKey = process.env.WAVESPEED_API_KEY;
        // Default to sequential for new generation
        let modelPath = modelPathOverride || process.env.WAVESPEED_MODEL_PATH || 'bytedance/seedream-v4.5/sequential';

        if (!apiKey) {
            throw new Error("WAVESPEED_API_KEY is not configured.");
        }

        console.log(`Calling Wavespeed.ai (Path: ${modelPath}) for prompt: ${prompt.substring(0, 50)}...`);

        // Prepare payload correctly
        const payload: any = {
            prompt: prompt,
            enable_sync_mode: false,
            enable_base64_output: false,
            ...imageConfig
        };

        // FLUX FIX: Flux expects 'size' as string "WxH" and 'images' array.
        // It does NOT accept 'width' and 'height' as separate fields like Seedream might.
        if (modelPath.includes('flux')) {
            if (payload.width && payload.height) {
                payload.size = `${payload.width}*${payload.height}`;
                delete payload.width;
                delete payload.height;
            }
            // Ensure images is an array if present
            if (payload.image_url) {
                payload.images = [payload.image_url];
                delete payload.image_url;
            }
            // Ensure loras are passed through (already in imageConfig)
        } else {
            // Existing logic for Seedream
            if (modelPath.includes('/edit') && payload.image_url) {
                payload.images = [payload.image_url];
                delete payload.image_url;
            } else if (modelPath.includes('/edit') && !payload.images) {
                if (!imageConfig || !imageConfig.images) {
                    console.warn("WARNING: Using an edit model endpoint for Text-to-Image generation without input images. Switching to 'sequential' model.");
                    modelPath = 'bytedance/seedream-v4.5/sequential';
                }
            }
        }

        // Ensure images are strictly strings (URLs or Data URIs) if provided
        if (payload.images && Array.isArray(payload.images)) {
            // Wavespeed accepts array of strings.
            // No specific cleaning needed if they are already valid URLs/DataURIs
        }

        console.log("Flux Payload Debug:", JSON.stringify(payload, null, 2));

        // POST to start the job
        const initialResponse = await fetch(`https://api.wavespeed.ai/api/v3/${modelPath}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!initialResponse.ok) {
            const error = await initialResponse.text();
            console.error("Wavespeed Job Creation Error:", error);
            throw new Error(`Wavespeed API Error: ${initialResponse.statusText} - ${error}`);
        }

        const jobData: any = await initialResponse.json();
        // User examples show it's in data.id
        const requestId = (jobData.data && jobData.data.id) || jobData.request_id || jobData.id || (jobData.data && jobData.data.request_id);

        if (!requestId) {
            console.error("Wavespeed response missing request id. Full response:", JSON.stringify(jobData));
            throw new Error("Wavespeed API did not return a request ID.");
        }

        console.log(`Wavespeed Job Created: ${requestId}. Polling for result...`);

        // Polling loop
        let attempts = 0;
        const maxAttempts = 120; // 120 * 1s = 120s (Matching user's example polling frequency but keeping 120s total)
        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            const statusResponse = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!statusResponse.ok) {
                console.warn(`Wavespeed Status Check Failed for ${requestId}: ${statusResponse.status}`);
                attempts++;
                continue;
            }

            const statusJson: any = await statusResponse.json();
            const data = statusJson.data || statusJson;
            const status = data.status || 'unknown';

            console.log(`Job ${requestId} Status: ${status}`);

            if (status === 'completed' || status === 'succeeded') {
                // User example: resultUrl = data.outputs[0]
                const url = (data.outputs && data.outputs[0]) || data.output_url || data.url || data.image_url || data.output;
                if (url) return url;

                console.warn(`Job ${requestId} marked ${status} but no URL found yet. Full Response:`, JSON.stringify(statusJson));
            }
            if (status === 'failed') {
                throw new Error(`Wavespeed Job Failed: ${data.error || 'Unknown error'}`);
            }
            attempts++;
        }

        throw new Error("Wavespeed generation timed out after 120 seconds.");
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

                                            n: { type: Type.STRING }
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

        let fullPrompt = parts.map(p => p.text || '').join('\n');

        try {
            if (requestedModel === 'seedream-4.5') {
                console.log(`Calling Seedream 4.5 (Wavespeed) for shot ${shot.shot_id}...`);
                const startTime = Date.now();

                // Explicitly force the T2I model path for generation, or allow env override ONLY if it's not an edit path
                // But safest is to default to sequential for T2I if env is ambiguous
                let modelPath = process.env.WAVESPEED_MODEL_PATH || 'bytedance/seedream-v4.5/sequential';

                // Extract any inline images from parts to send as reference images
                const referenceImages: string[] = [];
                for (const p of parts) {
                    if (p.inlineData && p.inlineData.data && p.inlineData.mimeType) {
                        referenceImages.push(`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
                    }
                }

                // If we have reference images, we MUST use the edit-sequential endpoint to utilize them
                if (referenceImages.length > 0) {
                    console.log(`Found ${referenceImages.length} reference images. Switching to 'edit-sequential' model.`);
                    modelPath = 'bytedance/seedream-v4.5/edit-sequential';

                    // Enforce style preservation via prompt engineering
                    // The user explicitly asked for style preservation.
                    fullPrompt += "\nIMPORTANT: Maintain the exact visual style, color palette, and aesthetics of the provided reference images.";
                } else if (modelPath && modelPath.includes('/edit')) {
                    console.warn(`WAVESPEED_MODEL_PATH is set to an edit model (${modelPath}) but we are performing Text-to-Image. Ignoring ENV and using default sequential.`);
                    modelPath = 'bytedance/seedream-v4.5/sequential';
                }

                // Determine resolution based on size or default to 16:9 (1344x768 is common for SDXL-class 16:9)
                // If the frontend sends specific dimensions in 'size', use them.
                // Otherwise, hardcode a cinematic 16:9 ratio to match Gemini's setting.
                const width = 1344;
                const height = 768;

                const imageConfig: any = {
                    images: referenceImages,
                    width,
                    height
                };

                const imageUrl = await generateImageSeedream(fullPrompt, imageConfig, modelPath);
                const duration = (Date.now() - startTime) / 1000;
                console.log(`Seedream responded in ${duration}s for shot ${shot.shot_id}`);

                if (imageUrl && imageUrl.startsWith('http')) {
                    return { image_url: imageUrl };
                }
                const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}`, imageUrl || '');
                return { image_url: savedUrl };
            }

            // GEMINI GENERATION (Common for default and Flux-Comic pre-pass)
            // If model is Gemini OR Flux-Comic (which needs a base image), we run Gemini first.
            if (requestedModel !== 'seedream-4.5') {
                console.log(`Calling Gemini (${model}) for shot ${shot.shot_id}...`);
                const startTime = Date.now();

                // If Flux-Comic, we might want to ensure Gemini is fast/preview quality or just standard?
                // Using standard 'gemini-3-pro-image-preview' as set above.

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
                    let finalImageData = part.inlineData.data;

                    // --- FLUX COMIC POST-PROCESSING ---
                    if (requestedModel === 'flux-comic') {
                        console.log("Flux Comic active: Pipe Gemini output to Wavespeed Edit...");
                        const fluxStartTime = Date.now();
                        const modelPath = 'wavespeed-ai/flux-2-klein-9b/edit-lora';

                        // Prepare the specific comic style prompt
                        const comicPrompt = "translate this image to Comic_Flux style. strictly maintain original colors, saturation and contrast. do not alter the color palette.";

                        const imageConfig = {
                            images: [`data:image/jpeg;base64,${finalImageData}`], // Use Gemini output as input
                            width: 1280,
                            height: 720,
                            loras: [
                                {
                                    path: "https://huggingface.co/dariushh/Comic_Flux2_V1_lora/resolve/main/Comic_Klein_V1.safetensors",
                                    scale: 1.5 // Increased to 1.5 as requested
                                }
                            ],
                            seed: -1
                        };

                        console.log("----------------------------------------------------------------");
                        console.log("FLUX COMIC PIPELINE PROMPT:", comicPrompt);
                        console.log("LORA CONFIG:", JSON.stringify(imageConfig.loras));
                        console.log("----------------------------------------------------------------");

                        try {
                            const comicImageUrl = await generateImageSeedream(comicPrompt, imageConfig, modelPath);
                            const fluxDuration = (Date.now() - fluxStartTime) / 1000;
                            console.log(`Flux Comic post-process finished in ${fluxDuration}s`);

                            if (comicImageUrl && comicImageUrl.startsWith('http')) {
                                return { image_url: comicImageUrl };
                            }
                            // If it returned a base64 or something else (unlikely with current logic but handle it)
                            // generateImageSeedream usually returns a URL from Wavespeed
                            const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_comic`, comicImageUrl || '');
                            return { image_url: savedUrl };

                        } catch (err: any) {
                            console.error("Flux Comic Pipeline Failed, falling back to Gemini image:", err);
                            // Fallback: continue to save Gemini image
                        }
                    }

                    // Standard Gemini Save (or Fallback)
                    const imageUrl = await saveMedia(
                        `${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}`,
                        finalImageData
                    );
                    return { image_url: imageUrl };
                }

                // Error handling for Gemini failure
                const errorMsg = response.candidates?.[0]?.finishReason === 'SAFETY'
                    ? "Image blocked by safety filters. Try a different description."
                    : "No image generated by the AI model.";
                console.warn(`Generation failed for ${shot.shot_id}:`, errorMsg, JSON.stringify(response.candidates?.[0] || {}, null, 2));
                throw new Error(errorMsg);
            }

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

        // Handling HTTP URLs for Seedream (bypass formatting if it's a URL)
        let base64Data: string;
        let currentMimeType: string = 'image/png';

        if (!imageRes) {
            if (requestedModel === 'seedream-4.5' && typeof originalBase64 === 'string' && originalBase64.startsWith('http')) {
                console.log("Input is a URL, passing directly to Seedream.");
                base64Data = originalBase64;
            } else {
                throw new Error("No original image data provided.");
            }
        } else {
            base64Data = imageRes.data;
            currentMimeType = imageRes.mimeType;
        }

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
                    image_url: (base64Data && base64Data.startsWith('http')) ? base64Data : `data:${currentMimeType};base64,${base64Data}`
                }, 'bytedance/seedream-v4.5/edit'); // Explicitly use edit for editing
                const duration = (Date.now() - startTime) / 1000;
                console.log(`Seedream edit responded in ${duration}s for shot ${shot.shot_id}`);

                if (imageUrl && imageUrl.startsWith('http')) {
                    return { image_url: imageUrl, visual_breakdown: shot.visual_breakdown };
                }
                const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_${Date.now()}`, imageUrl || '');
                return { image_url: savedUrl, visual_breakdown: shot.visual_breakdown };
            }

            if (requestedModel === 'flux-comic') {
                console.log(`Calling Flux Comic to EDIT shot ${shot.shot_id}...`);
                const startTime = Date.now();
                const modelPath = 'wavespeed-ai/flux-2-klein-9b/edit-lora';

                const imageConfig = {
                    images: [(base64Data && base64Data.startsWith('http')) ? base64Data : `data:${currentMimeType};base64,${base64Data}`],
                    width: 1280,
                    height: 720,
                    loras: [
                        {
                            path: "https://huggingface.co/dariushh/Comic_Flux2_V1_lora/resolve/main/Comic_Klein_V1.safetensors",
                            scale: 0.78
                        }
                    ],
                    seed: -1
                };

                const comicPrompt = `Comic_Klein, ${editPrompt}. Maintain composition of the input image.`;

                console.log("----------------------------------------------------------------");
                console.log("FINAL FLUX COMIC EDIT PROMPT:", comicPrompt);
                console.log("LORA CONFIG:", JSON.stringify(imageConfig.loras));
                console.log("----------------------------------------------------------------");

                const imageUrl = await generateImageSeedream(comicPrompt, imageConfig, modelPath);
                const duration = (Date.now() - startTime) / 1000;
                console.log(`Flux Comic edit responded in ${duration}s for shot ${shot.shot_id}`);

                if (imageUrl && imageUrl.startsWith('http')) {
                    return { image_url: imageUrl, visual_breakdown: shot.visual_breakdown };
                }
                const savedUrl = await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_comic_${Date.now()}`, imageUrl || '');
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
