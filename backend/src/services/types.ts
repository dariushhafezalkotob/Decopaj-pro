export interface CharacterShotDetail {
    name: string;
    appearance: {
        description: string;
        expression: string;
    };
    actions: string;
    position?: string;
}

export interface VisualBreakdown {
    scene: {
        time: string;
        environment: {
            location_type: string;
            description: string;
        };
    };
    camera: {
        settings: {
            aperture: string;
        };
    };
    lighting: {
        key: string;
    };
    characters: CharacterShotDetail[];
    objects?: Array<{
        name: string;
        details: string;
        action?: string;
        reference_image?: string;
    }>;
    framing_composition?: {
        perspective: string;
    };
}

export interface ShotPlan {
    shot_id: string;
    visual_breakdown: VisualBreakdown;
}

export interface Entity {
    id: string;
    name: string;
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
        charName?: string;
    };
    resolved: boolean;
}
