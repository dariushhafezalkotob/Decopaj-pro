
import { FastifyInstance } from 'fastify';
import { GoogleGenAI, Type } from "@google/genai";
import { saveMedia, getMedia } from '../services/mediaService';
import fs from 'fs';
import path from 'path';
import { checkSequenceContinuity } from '../services/continuityService';

export default async function aiRoutes(server: FastifyInstance) {

    // Increase Fastify server timeouts for potentially long AI operations
    server.server.keepAliveTimeout = 300000; // 5 minutes
    server.server.headersTimeout = 301000; // Must be greater than keepAliveTimeout

    const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const mimeType = 'image/png';

    // Global job store
    const activeJobs = new Map<string, {
        status: 'processing' | 'completed' | 'failed',
        data?: any,
        error?: string
    }>();

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
            if (modelPath.includes('edit') && payload.image_url) {
                payload.images = [payload.image_url];
                delete payload.image_url;
            } else if (modelPath.includes('edit') && !payload.images) {
                if (!imageConfig || !imageConfig.images) {
                    console.warn("WARNING: Using an edit model endpoint for Text-to-Image generation without input images. Switching to 'sequential' model.");
                    modelPath = 'bytedance/seedream-v4.5/sequential';
                }
            }
        }

        // Ensure images are strictly strings (URLs or Data URIs) if provided
        if (payload.images && Array.isArray(payload.images)) {
            // No changes needed
        }

        // Clean logging of payload (hide raw base64)
        const logPayload = { ...payload };
        if (logPayload.images) {
            logPayload.images = logPayload.images.map((img: string) =>
                img.length > 100 ? `${img.substring(0, 50)}... [Base64 Data Truncated]` : img
            );
        }
        console.log("Wavespeed Payload Debug:", JSON.stringify(logPayload, null, 2));

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

        console.log(`Wavespeed Job Created: ${requestId}. Polling every 3s (Max 5m)...`);

        // Polling loop
        let attempts = 0;
        const pollingIntervalMs = 2000; // 2 seconds
        const maxAttempts = 150; // 150 * 2s = 300s (5 minutes)

        while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, pollingIntervalMs));

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for status check

                const statusResponse = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!statusResponse.ok) {
                    console.warn(`Attempt ${attempts + 1}/${maxAttempts}: Wavespeed Status Check Failed (${statusResponse.status})`);
                    attempts++;
                    continue;
                }

                const statusJson: any = await statusResponse.json();
                const data = statusJson.data || statusJson;
                const status = data.status || 'unknown';

                console.log(`Attempt ${attempts + 1}/${maxAttempts}: Job ${requestId} Status: ${status}`);

                if (status === 'completed' || status === 'succeeded') {
                    const url = (data.outputs && data.outputs[0]) || data.output_url || data.url || data.image_url || data.output;
                    if (url) return url;
                    console.warn(`Job ${requestId} marked ${status} but no URL found yet. Full Response:`, JSON.stringify(statusJson));
                }
                if (status === 'failed') {
                    throw new Error(`Wavespeed Job Failed: ${data.error || 'Unknown error'}`);
                }
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.warn(`Attempt ${attempts + 1}/${maxAttempts}: Status check request timed out.`);
                } else {
                    console.error(`Attempt ${attempts + 1}/${maxAttempts}: Polling error:`, err.message);
                }
            }
            attempts++;
        }

        throw new Error(`Wavespeed generation timed out after 5 minutes (${maxAttempts} attempts).`);
    };

    server.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // 0.1 Async Job Status (Public but requires auth check manually if needed, or rely on jobId secrecy)
    server.get('/job-status/:jobId', async (request: any, reply) => {
        const { jobId } = request.params;
        const job = activeJobs.get(jobId);
        if (!job) return reply.code(404).send({ message: "Job not found" });
        return job;
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
      4. STATEFUL CONTINUITY: Characters must maintain their state (outfits, accessories like helmets, baggage) across shots unless an action explicitly changes it. 
         - If a character puts on a helmet in Shot 1, they MUST be wearing it in Shot 2, 3, etc., until the script says "takes off helmet".
         - Consistently describe their appearance to match previous frames unless logically changed.
      5. Provide detailed physical positioning and lighting effects specifically for those characters.
      6. Technical camera specs should be professional (e.g., 35mm lens, f/2.8, shallow depth of field).
      
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
            // ASYNC WRAPPER: Return jobId immediately for Seedream/Flux Comic
            if (requestedModel === 'seedream-4.5' || requestedModel === 'flux-comic') {
                const jobId = `${requestedModel === 'flux-comic' ? 'comic' : 'gen'}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                activeJobs.set(jobId, { status: 'processing' });

                // Start background process
                (async () => {
                    try {
                        console.log(`[JOB ${jobId}] Starting background task for model: ${requestedModel}`);
                        const startTime = Date.now();
                        let imageUrl: string | undefined;

                        if (requestedModel === 'flux-comic') {
                            // --- PHASE 1: GEMINI BASE GENERATION ---
                            console.log(`[JOB ${jobId}] Phase 1: Gemini Base Generation...`);
                            const geminiModel = 'gemini-3-pro-image-preview';
                            const response = await ai.models.generateContent({
                                model: geminiModel,
                                contents: { parts },
                                config: { imageConfig: { aspectRatio: "16:9" } }
                            });

                            const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
                            if (!part?.inlineData?.data) {
                                throw new Error(`Phase 1 Gemini failed: ${response.candidates?.[0]?.finishReason || 'No image data'}`);
                            }

                            const base64Data = part.inlineData.data;
                            const geminiDataUri = `data:image/png;base64,${base64Data}`;

                            // --- PHASE 2: FLUX-KLEIN RESTYLING ---
                            console.log(`[JOB ${jobId}] Phase 2: Flux-Klein Restyling...`);
                            const fluxModelPath = 'wavespeed-ai/flux-2-klein-9b/edit-lora';
                            const fluxConfig = {
                                images: [geminiDataUri],
                                width: 1280,
                                height: 720,
                                loras: [
                                    { path: "https://huggingface.co/dariushh/Klein_Style_V3/resolve/main/comic_klein_style_V1.safetensors", scale: 1.65 },
                                    { path: "dariushh/Comic_lines_style", scale: 0.8 }
                                ],
                                seed: -1
                            };
                            const comicPrompt = "make it comic_klein_style, Comic_lines. \nkeep this image darkness and brightness, Keep this image lighting.";
                            imageUrl = await generateImageSeedream(comicPrompt, fluxConfig, fluxModelPath);

                        } else {
                            // --- STANDARD SEEDREAM 4.5 GENERATION ---
                            let modelPath = process.env.WAVESPEED_MODEL_PATH || 'bytedance/seedream-v4.5/sequential';
                            const referenceImages: string[] = [];
                            for (const p of parts) {
                                if (p.inlineData?.data && p.inlineData.mimeType) {
                                    referenceImages.push(`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
                                }
                            }

                            if (referenceImages.length > 0) {
                                console.log(`[JOB ${jobId}] Using 'edit-sequential' with ${referenceImages.length} refs.`);
                                modelPath = 'bytedance/seedream-v4.5/edit-sequential';
                            } else if (modelPath.includes('edit')) {
                                modelPath = 'bytedance/seedream-v4.5/sequential';
                            }

                            imageUrl = await generateImageSeedream(fullPrompt, {
                                images: referenceImages,
                                width: 1344,
                                height: 768
                            }, modelPath);
                        }

                        const finalUrl = (imageUrl && imageUrl.startsWith('http'))
                            ? imageUrl
                            : await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}${requestedModel === 'flux-comic' ? '_comic' : ''}`, imageUrl || '');

                        activeJobs.set(jobId, { status: 'completed', data: { image_url: finalUrl } });
                        console.log(`[JOB ${jobId}] Completed in ${(Date.now() - startTime) / 1000}s`);

                        // Cleanup job after 1h
                        setTimeout(() => activeJobs.delete(jobId), 3600000);
                    } catch (err: any) {
                        console.error(`[JOB ${jobId}] Failed:`, err.message);
                        activeJobs.set(jobId, { status: 'failed', error: err.message });
                    }
                })();

                return { jobId };
            }

            // 2. GEMINI GENERATION (Synchronous - usually < 30s)
            if (requestedModel !== 'seedream-4.5' && requestedModel !== 'flux-comic') {
                console.log(`Calling Gemini (${model}) for shot ${shot.shot_id}...`);
                const startTime = Date.now();
                const response = await ai.models.generateContent({
                    model: model,
                    contents: { parts },
                    config: { imageConfig: { aspectRatio: "16:9" } }
                });
                const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
                if (part?.inlineData?.data) {
                    const imageUrl = await saveMedia(
                        `${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}`,
                        part.inlineData.data
                    );
                    return { image_url: imageUrl };
                }
                throw new Error("No image generated.");
            }
        } catch (err: any) {
            console.error(`ERROR for ${shot.shot_id}:`, err.message);
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
            // ASYNC WRAPPER for SEEDREAM/FLUX
            if (requestedModel === 'seedream-4.5' || requestedModel === 'flux-comic') {
                const jobId = `edit_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                activeJobs.set(jobId, { status: 'processing' });

                (async () => {
                    try {
                        const startTime = Date.now();
                        console.log(`[JOB ${jobId}] Starting background EDIT for: ${requestedModel}`);

                        let imageUrl: string | undefined;

                        if (requestedModel === 'seedream-4.5') {
                            imageUrl = await generateImageSeedream(`${genPromptText}\nUse this image as reference.`, {
                                image_url: (base64Data && base64Data.startsWith('http')) ? base64Data : `data:${currentMimeType};base64,${base64Data}`
                            }, 'bytedance/seedream-v4.5/edit');
                        } else if (requestedModel === 'flux-comic') {
                            const fluxModelPath = 'wavespeed-ai/flux-2-klein-9b/edit-lora';
                            const imageConfig = {
                                images: [(base64Data && base64Data.startsWith('http')) ? base64Data : `data:${currentMimeType};base64,${base64Data}`],
                                width: 1280, height: 720,
                                loras: [
                                    { path: "https://huggingface.co/dariushh/Klein_Style_V3/resolve/main/comic_klein_style_V1.safetensors", scale: 1.65 },
                                    { path: "dariushh/Comic_lines_style", scale: 0.8 }
                                ],
                                seed: -1
                            };
                            const comicPrompt = "make it comic_klein_style, Comic_lines. \nkeep this image darkness and brightness, Keep this image lighting.";
                            imageUrl = await generateImageSeedream(comicPrompt, imageConfig, fluxModelPath);
                        }

                        const finalUrl = (imageUrl && imageUrl.startsWith('http'))
                            ? imageUrl
                            : await saveMedia(`${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_${Date.now()}`, imageUrl || '');

                        activeJobs.set(jobId, { status: 'completed', data: { image_url: finalUrl, visual_breakdown: shot.visual_breakdown } });
                        console.log(`[JOB ${jobId}] Edit completed in ${(Date.now() - startTime) / 1000}s`);
                        setTimeout(() => activeJobs.delete(jobId), 3600000);
                    } catch (err: any) {
                        console.error(`[JOB ${jobId}] Edit failed:`, err.message);
                        activeJobs.set(jobId, { status: 'failed', error: err.message });
                    }
                })();

                return { jobId };
            }

            // Synchronous Gemini Edit
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

            const imgPart = imgResponse.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (!imgPart?.inlineData?.data) {
                const finishReason = imgResponse.candidates?.[0]?.finishReason;
                console.error(`Gemini failed to return image data. Reason: ${finishReason}`, JSON.stringify(imgResponse, null, 2));
                throw new Error(finishReason === 'SAFETY' ? "Edit blocked by safety filters." : "Visual update failed.");
            }

            const newImageUrl = await saveMedia(
                `${projectId || 'global'}_${sequenceId || 'default'}_shot_${shot.shot_id}_edit_${Date.now()}`,
                imgPart.inlineData.data
            );

            return {
                image_url: newImageUrl,
                visual_breakdown: shot.visual_breakdown
            };

        } catch (err: any) {
            console.error("Edit shot error:", err);
            return reply.code(500).send({ message: err.message });
        }
    });

    // 5. Check Continuity
    server.post('/check-continuity', async (request: any, reply) => {
        const { shots, assets } = request.body;
        try {
            const issues = checkSequenceContinuity(shots, assets);
            return { issues };
        } catch (err: any) {
            console.error("Continuity check error:", err);
            return reply.code(500).send({ message: err.message });
        }
    });
}
