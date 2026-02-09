
import { ShotPlan, ImageSize, Entity, AnalysisResponse, EntityIdentificationResponse, VisualBreakdown } from "../types";
import { identifyEntitiesProxy, analyzeScriptProxy, analyzeCustomShotProxy, generateImageProxy, editShotProxy } from "./api";

// STAGE 1: Identify additional locations and items, respecting the global cast
export const identifyEntities = async (script: string, globalCast: Entity[]): Promise<EntityIdentificationResponse> => {
    return await identifyEntitiesProxy(script, globalCast);
};

// STAGE 2: Perform full cinematic breakdown using casted assets
export const performFullDecopaj = async (script: string, assets: Entity[]): Promise<AnalysisResponse> => {
    return await analyzeScriptProxy(script, assets);
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
    sequenceId: string
): Promise<string> => {
    return await generateImageProxy(shot, size, assets, projectName, sequenceTitle, projectId, sequenceId);
};

export const editShotImage = async (
    originalBase64: string,
    editPrompt: string,
    shot: ShotPlan,
    projectName: string,
    sequenceTitle: string,
    projectId: string,
    sequenceId: string,
    assets: any[]
): Promise<{ image_url: string, visual_breakdown: VisualBreakdown }> => {
    return await editShotProxy(originalBase64, editPrompt, shot, projectName, sequenceTitle, projectId, sequenceId, assets);
};
