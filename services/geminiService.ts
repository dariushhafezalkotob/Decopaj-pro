
import { GoogleGenAI, Type } from "@google/genai";
import { ShotPlan, ImageSize, Entity, AnalysisResponse, EntityIdentificationResponse, VisualBreakdown } from "../types";

// STAGE 1: Identify additional locations and items, respecting the global cast
export const identifyEntities = async (script: string, globalCast: Entity[]): Promise<EntityIdentificationResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const castNames = globalCast.map(c => c.name).join(", ");
  
  const prompt = `Identify all unique characters, locations, and important items in this film script.
  IMPORTANT: The following characters are already cast: [${castNames}]. 
  - DO NOT list these specific characters in your response if they are already in the cast list above.
  - ONLY identify NEW characters, LOCATIONS, and key PROPS/ITEMS.
  - Ensure names match the script exactly.
  
  Return as JSON.
  
  Script:
  "${script}"`;

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

  return JSON.parse(response.text || '{"entities": []}') as EntityIdentificationResponse;
};

// STAGE 2: Perform full cinematic breakdown using casted assets
export const performFullDecopaj = async (script: string, assets: Entity[]): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const assetMapText = assets.map(a => `- ${a.name} (${a.type}): USE REF TAG "${a.refTag}"`).join('\n');

  const prompt = `Role: Professional Film Director & Cinematographer.
Task: Technical 'Decopaj' (shot breakdown) of the provided script.

MANDATORY PRODUCTION ASSETS (Mapping table):
${assetMapText}

INSTRUCTIONS:
1. Break the scene into logical Shots/Plans.
2. For each shot, list the characters present in that frame.
3. CRITICAL: For every character, you MUST populate the "reference_image" field with the exact "image X" ref tag from the mapping table above.
4. Provide detailed physical positioning and lighting effects specifically for those characters.
5. Technical camera specs should be professional (e.g., 35mm lens, f/2.8, shallow depth of field).

Script to process:
"${script}"`;

  try {
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
                          environment: { type: Type.OBJECT, properties: { location_type: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["location_type", "description"] },
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

    return JSON.parse(response.text || '{"shots": []}') as AnalysisResponse;
  } catch (error) {
    console.error("Full Decopaj Error:", error);
    throw error;
  }
};

export const generateShotImage = async (
  shot: ShotPlan, 
  size: ImageSize, 
  assets: Entity[]
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const parts: any[] = [];

  const locationAsset = assets.find(a => a.type === 'location' && shot.relevant_entities.includes(a.name));
  if (locationAsset?.imageData) {
    parts.push({ inlineData: { data: locationAsset.imageData.split(',')[1], mimeType: locationAsset.mimeType || 'image/png' } });
    parts.push({ text: `ENVIRONMENT REFERENCE [${locationAsset.refTag}]: ${locationAsset.name}. ${locationAsset.description}` });
  }

  shot.visual_breakdown.characters.forEach(charShot => {
    const asset = assets.find(a => a.refTag === charShot.reference_image) || assets.find(a => a.name === charShot.name);
    if (asset?.imageData) {
      parts.push({ inlineData: { data: asset.imageData.split(',')[1], mimeType: asset.mimeType || 'image/png' } });
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
  });

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
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { 
        imageConfig: { aspectRatio: "16:9" }
      }
    });

    if (!response.candidates?.[0]?.content?.parts) throw new Error("No parts in response.");

    const part = response.candidates[0].content.parts.find(p => p.inlineData);
    if (part?.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    
    throw new Error("Image generation failed.");
  } catch (error) {
    console.error("Image Gen Error:", error);
    throw error;
  }
};

export const editShotImage = async (
  originalBase64: string,
  editPrompt: string,
  shot: ShotPlan
): Promise<{ image_url: string, visual_breakdown: VisualBreakdown }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const mimeType = 'image/png';
  const base64Data = originalBase64.includes(',') ? originalBase64.split(',')[1] : originalBase64;

  // STEP 1: Generate the new visual
  const genPromptText = `
    You are a professional film colorist and VFX supervisor.
    TASK: Modify the attached cinematic film still according to the instruction below.
    
    ORIGINAL CONTEXT: ${shot.plan_type} - ${shot.action_segment}
    EDIT INSTRUCTION: ${editPrompt}
    
    MAINTAIN: Keep the character identities, composition, and lens properties unless explicitly told to change them.
    RESULT: Output a single cinematic frame. NO TEXT, LOGOS, OR CAPTIONS.
  `;

  let newImageUrl = "";

  try {
    const imgResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: genPromptText }
        ]
      },
      config: { imageConfig: { aspectRatio: "16:9" } }
    });

    const part = imgResponse.candidates?.[0]?.content?.parts.find(p => p.inlineData);
    if (part?.inlineData) {
      newImageUrl = `data:image/png;base64,${part.inlineData.data}`;
    } else {
      throw new Error("Visual update failed.");
    }

    // STEP 2: Update the Metadata JSON to match the new visual
    const metaPrompt = `
      You are a professional Director of Photography. 
      I have just edited a film shot with this instruction: "${editPrompt}".
      
      Here is the ORIGINAL technical JSON for that shot:
      ${JSON.stringify(shot.visual_breakdown)}
      
      TASK: Update the JSON to reflect the changes from the edit instruction.
      - If the instruction was "Make it moonlight", update lighting.key and color_palette.
      - If the instruction was "Zoom in more", update framing_composition.shot_type and focal_length_mm.
      - If the instruction was "Make him angry", update characters[].appearance.expression.
      
      MANDATORY: Return the FULL and COMPLETE updated JSON object following the structure provided.
    `;

    const metaResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: metaPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scene: { type: Type.OBJECT, properties: { environment: { type: Type.OBJECT, properties: { location_type: { type: Type.STRING }, description: { type: Type.STRING } } }, time: { type: Type.STRING }, mood: { type: Type.STRING }, color_palette: { type: Type.STRING } }, required: ["environment", "time", "mood", "color_palette"] },
            characters: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, reference_image: { type: Type.STRING }, position: { type: Type.STRING }, appearance: { type: Type.OBJECT, properties: { description: { type: Type.STRING }, expression: { type: Type.STRING } } }, actions: { type: Type.STRING }, lighting_effect: { type: Type.STRING } }, required: ["name", "reference_image", "position", "appearance", "actions", "lighting_effect"] } },
            objects: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, details: { type: Type.STRING } } } },
            framing_composition: { type: Type.OBJECT, properties: { shot_type: { type: Type.STRING }, framing: { type: Type.STRING }, perspective: { type: Type.STRING } }, required: ["shot_type", "framing", "perspective"] },
            camera: { type: Type.OBJECT, properties: { lens: { type: Type.OBJECT, properties: { focal_length_mm: { type: Type.NUMBER }, type: { type: Type.STRING } }, required: ["focal_length_mm", "type"] }, settings: { type: Type.OBJECT, properties: { aperture: { type: Type.STRING }, focus: { type: Type.STRING } }, required: ["aperture", "focus"] } }, required: ["lens", "settings"] },
            lighting: { type: Type.OBJECT, properties: { key: { type: Type.STRING }, quality: { type: Type.STRING }, color_contrast: { type: Type.STRING } }, required: ["key", "quality", "color_contrast"] }
          },
          required: ["scene", "characters", "camera", "lighting", "framing_composition"]
        }
      }
    });

    const updatedMetadata = JSON.parse(metaResponse.text || '{}') as VisualBreakdown;

    // Defensive merge: If for some reason the response is missing parts, fallback to original shot data
    const mergedMetadata: VisualBreakdown = {
      ...shot.visual_breakdown,
      ...updatedMetadata,
      scene: { ...shot.visual_breakdown.scene, ...(updatedMetadata.scene || {}) },
      camera: { ...shot.visual_breakdown.camera, ...(updatedMetadata.camera || {}) },
      lighting: { ...shot.visual_breakdown.lighting, ...(updatedMetadata.lighting || {}) },
      framing_composition: { ...shot.visual_breakdown.framing_composition, ...(updatedMetadata.framing_composition || {}) }
    };

    return {
      image_url: newImageUrl,
      visual_breakdown: mergedMetadata
    };

  } catch (error) {
    console.error("Shot Update Error:", error);
    throw error;
  }
};
