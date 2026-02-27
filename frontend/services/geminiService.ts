
import { ShotPlan, ImageSize, Entity, AnalysisResponse, EntityIdentificationResponse, VisualBreakdown, AIModel } from "../types";
import { identifyEntitiesProxy, analyzeScriptProxy, analyzeCustomShotProxy, generateImageProxy, editShotProxy, analyzeNextShotProxy } from "./api";

// STAGE 1: Identify additional locations and items, respecting the global cast
export const identifyEntities = async (script: string, globalCast: Entity[]): Promise<EntityIdentificationResponse> => {
    return await identifyEntitiesProxy(script, globalCast);
};

// STAGE 2: Perform full cinematic breakdown using casted assets
export const performFullDecopaj = async (script: string, assets: Entity[], onProgress?: (progress: string) => void): Promise<AnalysisResponse & { scene_context: any, shot_plan: any[] }> => {
    return await analyzeScriptProxy(script, assets, onProgress);
};

export const analyzeNextShot = async (
    sceneContext: any,
    plannedShot: any,
    previousShotJSON: any,
    assets: Entity[],
    masterShotUrl?: string,
    previousShotUrl?: string
): Promise<ShotPlan> => {
    return await analyzeNextShotProxy(sceneContext, plannedShot, previousShotJSON, assets, masterShotUrl, previousShotUrl);
};

export const analyzeCustomShot = async (description: string, assets: Entity[]): Promise<ShotPlan> => {
    return await analyzeCustomShotProxy(description, assets);
};

export const generateShotImage = async (
    shot: ShotPlan,
    size: ImageSize,
    assets: Entity[],
    projectName: string,
    sequenceTitle: string,
    projectId: string,
    sequenceId: string,
    aiModel: AIModel,
    masterShotUrl?: string,
    previousShotUrl?: string
): Promise<string> => {
    return await generateImageProxy(shot, size, assets, projectName, sequenceTitle, projectId, sequenceId, aiModel, masterShotUrl, previousShotUrl);
};

export const editShotImage = async (
    originalBase64: string,
    editPrompt: string,
    shot: ShotPlan,
    projectName: string,
    sequenceTitle: string,
    projectId: string,
    sequenceId: string,
    assets: any[],
    aiModel: AIModel
): Promise<{ image_url: string, visual_breakdown: VisualBreakdown }> => {
    return await editShotProxy(originalBase64, editPrompt, shot, projectName, sequenceTitle, projectId, sequenceId, assets, aiModel);
};
