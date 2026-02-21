
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
        environment: { location_type: string; description: string; reference_image?: string };
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
    isLocked?: boolean;
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
    continuityIssues?: ContinuityIssue[];
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
export type AIModel = "gemini-high" | "seedream-4.5" | "flux-comic";

export interface AppState {
    projects: Project[];
    activeProjectId: string | null;
    activeSequenceId: string | null;
    currentStep: 'dashboard' | 'casting' | 'project-home' | 'sequence-input' | 'sequence-assets' | 'sequence-board';
    isIdentifying: boolean;
    isAnalyzing: boolean;
    isGeneratingImages: boolean;
    imageSize: ImageSize;
    aiModel: AIModel;
    hasApiKey: boolean;
    error: string | null;
    insertionIndex: number | null;
    insertionPrompt: string;
    showGlobalPicker: boolean;
    pickerTargetId: string | null;
    pickerSearch: string;
    pickerCategory: 'all' | 'character' | 'location' | 'item';
    editingSequenceId: string | null;
}

export interface ContinuityIssue {
    id: string;
    shotId?: string;
    category: 'outfit' | 'time' | 'location' | 'camera' | 'lighting' | 'other';
    severity: 'error' | 'warning' | 'info';
    message: string;
    evidence: string;
    suggestedFix?: string;
    fixData?: {
        type: 'update-field';
        field: string;
        value: any;
        charName?: string; // For outfit fixes
    };
    resolved: boolean;
}
