
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
        progress?: string,
        data?: any,
        error?: string
    }>();

    const resolveImageResource = async (input: string) => {
        if (!input) return null;

        console.log(`Resolving image: ${input.substring(0, 50)}${input.length > 50 ? '...' : ''}`);

        // Handle database-stored media URLs (e.g., /api/media/...)
        const mediaMatch = input.match(/\/api\/media\/([^?#\s]+)/);
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
        const publicMatch = input.match(/\/public\/([^?#\s]+)/);
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

        // Handle External URL
        if (input.startsWith('http')) {
            try {
                console.log(`Fetching external image: ${input}`);
                const response = await (globalThis as any).fetch(input);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const buffer = await response.arrayBuffer();
                const contentType = response.headers.get('content-type') || mimeType;
                return {
                    data: Buffer.from(buffer).toString('base64'),
                    mimeType: contentType
                };
            } catch (err: any) {
                console.warn(`Failed to fetch external image (${input}):`, err.message);
                return null;
            }
        }

        // Handle Data URL
        if (input.includes('base64,')) {
            console.log(`Detected Data URL`);
            return {
                data: input.split('base64,')[1],
                mimeType: input.split(';')[0].split(':')[1] || mimeType
            };
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
        const jobId = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        activeJobs.set(jobId, { status: 'processing' });

        // Start background process
        (async () => {
            try {
                const safeAssets = assets || [];
                const assetMapText = safeAssets.map((a: any) => `- ${a.name} (${a.type}): USE REF TAG "${a.refTag}"`).join('\n');

                // --- STAGE 1: Scene Pre-Analysis (Cast & Props) ---
                console.log(`[JOB ${jobId}] Stage 1: Scene Pre-Analysis...`);
                activeJobs.set(jobId, { status: 'processing', progress: 'Stage 1: Pre-Analysis (Characters & Costumes)...' });
                const stage1Prompt = `Role: Film Researcher & Costume Supervisor.
      Analyze the script and identify:
      1. Characters present and their specific outfits, accessories, or equipment mentioned (e.g., "biker leather suit", "red helmet", "heavy boots").
      2. Persistent props/objects in the environment.
      3. Environment mood and time of day.

      STRICT DIALOGUE ISOLATION (CRITICAL):
      - Anything mentioned INSIDE quotation marks (dialogue) is PHYSICALLY INVISIBLE. 
      - You MUST NOT list characters, outfits, or props that appear ONLY in dialogue.
      - Example: If a character says "I left my gun in the car", and the scene is in a kitchen, do NOT list "gun" or "car" as props unless the action description says they are there.
      - Example 2: If a character says "You look like a pirate", do NOT list "pirate hat" or "parrot" unless the action segment describes them wearing them.

      Script: "${script}"`;

                const stage1Response = await ai.models.generateContent({
                    model: 'gemini-3-pro-preview',
                    contents: stage1Prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                scene_context: {
                                    type: Type.OBJECT,
                                    properties: {
                                        characters: {
                                            type: Type.ARRAY,
                                            items: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    name: { type: Type.STRING },
                                                    outfit_description: { type: Type.STRING }
                                                },
                                                required: ["name", "outfit_description"]
                                            }
                                        },
                                        persistent_props: { type: Type.ARRAY, items: { type: Type.STRING } },
                                        environment: { type: Type.STRING },
                                        time_of_day: { type: Type.STRING }
                                    },
                                    required: ["characters", "persistent_props", "environment", "time_of_day"]
                                }
                            },
                            required: ["scene_context"]
                        }
                    }
                });

                const sceneContext = JSON.parse(stage1Response.text || '{}').scene_context;

                // --- STAGE 2: Shot Planning (Slug Generation) ---
                console.log(`[JOB ${jobId}] Stage 2: Shot Planning...`);
                activeJobs.set(jobId, { status: 'processing', progress: 'Stage 2: Planning Shots & Sequences...' });
                const stage2Prompt = `Role: Director & Cinematographer.
      Based on the Scene Analysis and Script, determine the exact number of technical shots needed.
      Provide a brief slug/summary for each shot.

      Scene Analysis: ${JSON.stringify(sceneContext)}
      Script: "${script}"`;

                const stage2Response = await ai.models.generateContent({
                    model: 'gemini-3-pro-preview',
                    contents: stage2Prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                shot_plan: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            index: { type: Type.NUMBER },
                                            summary: { type: Type.STRING },
                                            action_segment: { type: Type.STRING }
                                        },
                                        required: ["index", "summary", "action_segment"]
                                    }
                                }
                            },
                            required: ["shot_plan"]
                        }
                    }
                });

                const plannedShots = JSON.parse(stage2Response.text || '{}').shot_plan;

                // --- STAGE 3: Sequential Stateful Synthesis (The Continuity Loop) ---
                console.log(`[JOB ${jobId}] Stage 3: Stateful Synthesis (${plannedShots.length} shots)...`);

                const finalShots: any[] = [];
                let previousShotJSON: any = null;

                for (const plan of plannedShots) {
                    console.log(`[JOB ${jobId}] Generating Shot ${plan.index}...`);
                    activeJobs.set(jobId, {
                        status: 'processing',
                        progress: `Stage 3: Synthesizing Shot ${plan.index}/${plannedShots.length}...`
                    });

                    const stage3Prompt = `Role: Technical Director.
      Generate a technical JSON for Shot ${plan.index} of this sequence.
      
      MANDATORY PRODUCTION ASSETS (Mapping table):
      ${assetMapText}
      
      SCENE CONTEXT (Characters & Environment):
      ${JSON.stringify(sceneContext)}

      SHOT SUMMARY: "${plan.summary}"
      ACTION SEGMENT: "${plan.action_segment}"

      PREVIOUS SHOT STATE (CONTINUITY):
      ${previousShotJSON ? JSON.stringify(previousShotJSON) : "This is the first shot."}

      DIRECTOR LOGIC SYSTEM:
      - Angles: "low_angle", "worms_eye", "top_down", "dutch_tilt", "eye_level", "over_the_shoulder", "profile", "reflection", "silhouette", "one_point_perspective"
      - Sizes: "wide", "long", "medium", "medium_close_up", "close_up", "extreme_close_up", "full_body"
      
      STRICT CONTINUITY RULES:
      1. Characters MUST maintain the same appearance, outfits, and items from the PREVIOUS SHOT unless this segment explicitly describes a change.
      2. If a character had a helmet/hat/item in the previous shot, they MUST still have it here by default.
      3. Use the "notes" field to track state (e.g., "Maintains helmet from shot 1").
      4. Use provided ref tags (e.g., image 1) from asset map.
      5. MIRRORING RULE: Any clothing, armor, or accessory with a reference image (e.g., image 9) that a character is wearing MUST also be listed in the 'objects' array for this shot. This ensures the visual reference is applied correctly by the image generator.

      6. DIALOGUE & INTERACTION LOGIC (STRICT ISOLATION):
         - DIALOGUE IS VISUALLY INVISIBLE: Dialogue text (words characters say) is physically invisible. You MUST NOT add any nouns or items mentioned inside dialogue to the 'objects' array or 'relevant_entities'. (Example: If someone says "Suck a screw," do NOT add a screw to the scene).
         - DIALOGUE IS EMOTIONALLY MANDATORY: Dialogue is your PRIMARY source for character emotion. Use the subtext of the words to determine the character's 'expression', 'lighting_effect', and 'body language'. 
         - SPATIAL RELATIONS: Use dialogue flow to determine 'position' and 'eyeline'. Who is talking? Who is listening? Position characters so they are LOOKING at each other during the conversation.
         - SUMMARY: Dialogue = 0% Physical Props, 100% Emotional & Relational Context.
`;

                    const shotResponse = await ai.models.generateContent({
                        model: 'gemini-3-pro-preview',
                        contents: stage3Prompt,
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: Type.OBJECT,
                                properties: {
                                    shot_id: { type: Type.STRING },
                                    plan_type: { type: Type.STRING },
                                    camera_specs: { type: Type.STRING },
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
                                                    perspective: { type: Type.STRING },
                                                    camera_angle: { type: Type.STRING },
                                                    shot_size: { type: Type.STRING },
                                                    depth: { type: Type.STRING },
                                                    focus: { type: Type.STRING },
                                                    scale_emphasis: { type: Type.STRING }
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
                                                    color_contrast: { type: Type.STRING },
                                                    lighting_style: { type: Type.STRING }
                                                },
                                                required: ["key", "quality", "color_contrast"]
                                            },
                                            notes: { type: Type.ARRAY, items: { type: Type.STRING } }
                                        },
                                        required: ["scene", "characters", "camera", "lighting", "framing_composition"]
                                    }
                                },
                                required: ["shot_id", "plan_type", "visual_breakdown", "relevant_entities"]
                            }
                        }
                    });

                    const shotJSON = JSON.parse(shotResponse.text || '{}');
                    // Add the original action segment for reference
                    shotJSON.action_segment = plan.action_segment;

                    finalShots.push(shotJSON);
                    previousShotJSON = shotJSON; // Update for next iteration
                }

                activeJobs.set(jobId, { status: 'completed', data: { shots: finalShots } });
                console.log(`[JOB ${jobId}] Entire sequence generated successfully!`);
                setTimeout(() => activeJobs.delete(jobId), 3600000);
            } catch (err: any) {
                console.error(`[ANALYSIS JOB ${jobId}] Failed:`, err.message);
                activeJobs.set(jobId, { status: 'failed', error: err.message });
            }
        })();

        return { jobId };
    });

    server.post('/analyze-custom-shot', async (request: any, reply) => {
        const { description, assets } = request.body;
        const ai = getAI();
        const jobId = `custom_shot_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        activeJobs.set(jobId, { status: 'processing' });

        (async () => {
            try {
                const mappingText = assets.map((a: any) => `- ${a.name} (${a.type}): use "${a.refTag}"`).join('\n');

                const prompt = `
      You are a professional cinematic director. Analyze the following manual shot description and create a technical cinematic breakdown using the "Director Logic System".
      
      USER DESCRIPTION: "${description}"

      DIRECTOR LOGIC SYSTEM:
      1. CANONICAL TAXONOMY:
         - Angles: "low_angle", "worms_eye", "top_down", "dutch_tilt", "eye_level", "over_the_shoulder", "profile", "reflection", "silhouette", "one_point_perspective"
         - Sizes: "wide", "long", "medium", "medium_close_up", "close_up", "extreme_close_up", "full_body"
      
      2. CINEMATIC GRAMMAR:
         - POWER: low_angle. AWE/SCALE: worms_eye. VULNERABLE: top_down. CHAOS: dutch_tilt. INTIMACY: eye_level (CU/MCU). RESOLVE: eye_level (ECU). IDENTITY: reflection.
      
      ASSET MAPPING TABLE (CRITICAL):
      ${mappingText}

      INSTRUCTIONS:
      1. Create a detailed Visual Breakdown for this single shot.
      2. Use the "notes" field to justify your choice (e.g., "emotion=CHAOS", "intensity=0.9").
      3. CRITICAL: Use the "image X" ref tags from the mapping table for characters, objects, and environment locations.
      4. CONTINUITY: Persistent outfits/accessories must stay in the "objects" array.

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
                                                perspective: { type: Type.STRING },
                                                camera_angle: { type: Type.STRING },
                                                shot_size: { type: Type.STRING },
                                                depth: { type: Type.STRING },
                                                focus: { type: Type.STRING },
                                                scale_emphasis: { type: Type.STRING }
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
                                                color_contrast: { type: Type.STRING },
                                                lighting_style: { type: Type.STRING }
                                            },
                                            required: ["key", "quality", "color_contrast"]
                                        },
                                        notes: { type: Type.ARRAY, items: { type: Type.STRING } }
                                    },
                                    required: ["scene", "characters", "camera", "lighting", "framing_composition"]
                                }
                            },
                            required: ["shot_id", "plan_type", "visual_breakdown", "relevant_entities"]
                        }
                    }
                });

                const result = JSON.parse(response.text || '{}');
                activeJobs.set(jobId, { status: 'completed', data: result });
                setTimeout(() => activeJobs.delete(jobId), 3600000);
            } catch (err: any) {
                console.error(`[CUSTOM SHOT JOB ${jobId}] Failed:`, err.message);
                activeJobs.set(jobId, { status: 'failed', error: err.message });
            }
        })();

        return { jobId };
    });

    server.post('/generate-image', async (request: any, reply) => {
        const { shot, size, assets, projectName, sequenceTitle, projectId, sequenceId, model: requestedModel, previousShotUrl } = request.body;
        const ai = getAI();
        const parts: any[] = [];

        // High resolution model selection
        const model = 'gemini-3-pro-image-preview';

        const imageParts: { priority: number, part: any }[] = [];

        // 1. Add Previous Shot Context (Highest Priority)
        if (previousShotUrl) {
            const prevRes = await resolveImageResource(previousShotUrl);
            if (prevRes) {
                imageParts.push({
                    priority: 100,
                    part: [
                        { inlineData: { data: prevRes.data, mimeType: prevRes.mimeType } },
                        { text: `PREVIOUS SHOT REFERENCE: This is the exact frame that immediately precedes the current shot. Maintain visual continuity (characters, outfits, props, lighting) based on this image strictly.` }
                    ]
                });
            }
        }

        // 2. Add Environment Reference
        const envRefTag = shot.visual_breakdown.scene.environment.reference_image;
        const locationAsset = assets.find((a: any) => a.refTag === envRefTag) || assets.find((a: any) => a.type === 'location' && shot.relevant_entities.includes(a.name));
        const locRes = await resolveImageResource(locationAsset?.imageData);
        if (locRes) {
            imageParts.push({
                priority: 80,
                part: [
                    { inlineData: { data: locRes.data, mimeType: locRes.mimeType } },
                    { text: `ENVIRONMENT REFERENCE [${locationAsset.refTag}]: ${locationAsset.name}. ${locationAsset.description}` }
                ]
            });
        }

        // 3. Add Character references
        for (const charShot of shot.visual_breakdown.characters) {
            const asset = assets.find((a: any) => a.refTag === charShot.reference_image) || assets.find((a: any) => a.name === charShot.name);
            const charRes = await resolveImageResource(asset?.imageData);
            if (charRes) {
                imageParts.push({
                    priority: 95,
                    part: [
                        { inlineData: { data: charRes.data, mimeType: charRes.mimeType } },
                        {
                            text: `CHARACTER IDENTITY [${charShot.reference_image}]: "${charShot.name}".
        MANDATORY FACIAL FEATURES: Use this reference image.
        FRAME POSITION: ${charShot.position}
        EXPRESSION: ${charShot.appearance.expression}
        APPEARANCE: ${charShot.appearance.description}`
                        }
                    ]
                });
            }
        }

        // 4. Add Object references (Prioritizing Worn items like Suit/Helmet)
        if (shot.visual_breakdown.objects) {
            for (const obj of shot.visual_breakdown.objects) {
                if (obj.reference_image) {
                    const asset = assets.find((a: any) => a.refTag === obj.reference_image) || assets.find((a: any) => a.name === obj.name);
                    const objRes = await resolveImageResource(asset?.imageData);
                    if (objRes) {
                        const isWorn = ["suit", "helmet", "gloves", "outfit", "armor", "clothing"].some(k => obj.name.toLowerCase().includes(k));
                        imageParts.push({
                            priority: isWorn ? 90 : 60,
                            part: [
                                { inlineData: { data: objRes.data, mimeType: objRes.mimeType } },
                                { text: `OBJECT REFERENCE [${obj.reference_image}]: "${obj.name}". Details: ${obj.details}` }
                            ]
                        });
                    }
                }
            }
        }

        // --- REFERENCE LIMITER & MERGER ---
        // Gemini-3 performs best with high-priority images. We allow up to 8 based on user preference.
        const MAX_IMAGES = 8;
        imageParts.sort((a, b) => b.priority - a.priority);
        const finalImageParts = imageParts.slice(0, MAX_IMAGES);

        // Build final parts array
        for (const set of finalImageParts) {
            parts.push(...set.part);
        }

        const cameraAngle = (shot.visual_breakdown.framing_composition.camera_angle || 'standard').replace(/_/g, ' ');
        const shotSize = (shot.visual_breakdown.framing_composition.shot_size || 'standard').replace(/_/g, ' ');
        const focalLength = shot.visual_breakdown.camera.lens.focal_length_mm;
        const lensDesc = focalLength <= 24 ? "Wide-angle lens with slight perspective distortion"
            : focalLength >= 85 ? "Telephoto lens with compressed depth"
                : "Standard cinematic prime lens";

        parts.push({
            text: `
      DIRECTORIAL NOTES:
      ${(shot.visual_breakdown.notes || []).map((n: string) => `- ${n}`).join('\n')}

      MANDATORY CINEMATIC SPECS:
      - CAMERA ANGLE: EXTREME ${cameraAngle.toUpperCase()}
      - SHOT SIZE: ${shotSize.toUpperCase()}
      - COMPOSITION: ${shot.visual_breakdown.framing_composition.framing}, ${shot.visual_breakdown.framing_composition.perspective} perspective
      - LENS: ${focalLength}mm (${lensDesc}), Aperture ${shot.visual_breakdown.camera.settings.aperture}
      - DEPTH OF FIELD: ${shot.visual_breakdown.framing_composition.depth} focus
      
      VISUAL CONTEXT:
      - SCENE: "${shot.action_segment}"
      - LIGHTING: ${shot.visual_breakdown.lighting.key}, ${shot.visual_breakdown.lighting.quality}. Style: ${shot.visual_breakdown.lighting.lighting_style || 'standard'}
      - ENVIRONMENT MOOD: ${shot.visual_breakdown.scene.mood}, Palette: ${shot.visual_breakdown.scene.color_palette}
      
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
                            const comicPrompt = "make it comic_klein_style, Comic_lines. keep this image darkness and brightness. Keep this image lighting.";
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

        let base64Data = '';
        let currentMimeType = 'image/png';

        if (!imageRes) {
            // Last ditch fallback for Seedream if resolution failed but it's a URL
            if (requestedModel === 'seedream-4.5' && typeof originalBase64 === 'string' && originalBase64.startsWith('http')) {
                console.log("Resolution failed but passing URL directly to Seedream.");
                base64Data = originalBase64;
            } else {
                console.error(`EDIT SHOT FAILED: Could not resolve original image. Input: ${typeof originalBase64 === 'string' ? originalBase64.substring(0, 50) : 'non-string'}`);
                throw new Error(`Original image source could not be resolved. Source: ${typeof originalBase64 === 'string' ? 'Link/Path' : 'Object'}`);
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
