
export interface CharacterShotDetail {
    name: string;
    reference_image: string;
    position: string;
    appearance: {
        description: string;
        expression: string;
        details?: string;
    };
    actions: string;
    lighting_effect: string;
}

export interface VisualBreakdown {
    scene: {
        environment: { location_type: string; description: string };
        time: string;
        mood: string;
        color_palette: string;
    };
    characters: CharacterShotDetail[];
    objects: Array<{
        name: string;
        reference_image?: string;
        details: string;
        action?: string;
    }>;
    framing_composition: {
        shot_type: string;
        framing: string;
        perspective: string;
    };
    camera: {
        lens: { focal_length_mm: number; type: string };
        settings: { aperture: string; focus: string };
    };
    lighting: {
        key: string;
        quality: string;
        color_contrast: string;
    };
}

export interface ShotPlan {
    shot_id: string;
    plan_type: string;
    camera_specs: string;
    action_segment: string;
    visual_breakdown: VisualBreakdown;
    relevant_entities: string[];
    image_url?: string;
    loading?: boolean;
    editing?: boolean;
}

export interface Entity {
    id: string;
    refTag: string;
    name: string;
    type: 'character' | 'location' | 'item';
    description: string;
    imageData?: string;
    mimeType?: string;
}

export interface Sequence {
    id: string;
    title: string;
    script: string;
    shots: ShotPlan[];
    assets: Entity[]; // Sequence-specific (locations/items)
    status: 'draft' | 'analyzed' | 'storyboarded';
}

export interface Project {
    id: string;
    name: string;
    globalAssets: Entity[];
    sequences: Sequence[];
}

export interface AnalysisResponse {
    shots: ShotPlan[];
}

export interface EntityIdentificationResponse {
    entities: { name: string; type: 'character' | 'location' | 'item' }[];
}

export type ImageSize = "1K" | "2K" | "4K";

export interface AppState {
    projects: Project[];
    activeProjectId: string | null;
    activeSequenceId: string | null;
    currentStep: 'dashboard' | 'casting' | 'project-home' | 'sequence-input' | 'sequence-assets' | 'sequence-board';
    isIdentifying: boolean;
    isAnalyzing: boolean;
    isGeneratingImages: boolean;
    imageSize: ImageSize;
    hasApiKey: boolean;
    error: string | null;
    insertionIndex: number | null;
    insertionPrompt: string;
}
