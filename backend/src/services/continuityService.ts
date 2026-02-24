
import { ShotPlan, Entity, ContinuityIssue } from './types';

export const checkSequenceContinuity = (shots: ShotPlan[], assets: Entity[]): ContinuityIssue[] => {
    const issues: ContinuityIssue[] = [];

    if (shots.length < 2) return issues;

    // 1. Time of Day Consistency
    const baseTime = shots[0].visual_breakdown.scene.time;
    shots.forEach((shot, idx) => {
        if (shot.visual_breakdown.scene.time !== baseTime) {
            issues.push({
                id: `time-mismatch-${idx}`,
                shotId: shot.shot_id,
                category: 'time',
                severity: 'warning',
                message: `Time of day mismatch. Expected "${baseTime}", found "${shot.visual_breakdown.scene.time}".`,
                evidence: `Shot 1 is ${baseTime}, but this shot is ${shot.visual_breakdown.scene.time}`,
                suggestedFix: `Update scene time to ${baseTime} for consistency.`,
                fixData: { type: 'update-field', field: 'scene.time', value: baseTime },
                resolved: false
            });
        }
    });

    // 2. Location Consistency
    const baseLocation = shots[0].visual_breakdown.scene.environment.description;
    shots.forEach((shot, idx) => {
        if (shot.visual_breakdown.scene.environment.description !== baseLocation) {
            issues.push({
                id: `loc-mismatch-${idx}`,
                shotId: shot.shot_id,
                category: 'location',
                severity: 'info',
                message: `Location variation detected within sequence.`,
                evidence: `Primary location: "${baseLocation.substring(0, 30)}...". Current: "${shot.visual_breakdown.scene.environment.description.substring(0, 30)}..."`,
                resolved: false
            });
        }
    });

    // 3. Character Outfit Consistency
    const characterOutfits: Map<string, string> = new Map();
    shots.forEach((shot) => {
        shot.visual_breakdown.characters.forEach((char: any) => {
            const lastOutfit = characterOutfits.get(char.name);
            if (lastOutfit && lastOutfit !== char.appearance.description) {
                issues.push({
                    id: `outfit-mismatch-${shot.shot_id}-${char.name}`,
                    shotId: shot.shot_id,
                    category: 'outfit',
                    severity: 'error',
                    message: `Outfit mismatch for ${char.name}.`,
                    evidence: `Previously: "${lastOutfit}". Now: "${char.appearance.description}"`,
                    suggestedFix: `Standardize outfit description to match previous appearance.`,
                    fixData: { type: 'update-field', field: 'characters.appearance.description', value: lastOutfit, charName: char.name },
                    resolved: false
                });
            }
            characterOutfits.set(char.name, char.appearance.description);
        });
    });

    // 3b. Character Position / Blocking Consistency
    const characterPositions: Map<string, string> = new Map();
    const characterBlockingIds: Map<string, string> = new Map();
    shots.forEach((shot) => {
        shot.visual_breakdown.characters.forEach((char: any) => {
            const currentBlockingId = (char.blocking_id || '').trim();
            const lastBlockingId = characterBlockingIds.get(char.name);
            if (lastBlockingId && currentBlockingId && lastBlockingId !== currentBlockingId) {
                issues.push({
                    id: `blocking-id-mismatch-${shot.shot_id}-${char.name}`,
                    shotId: shot.shot_id,
                    category: 'other',
                    severity: 'error',
                    message: `Blocking ID mismatch for ${char.name}.`,
                    evidence: `Previously: "${lastBlockingId}". Now: "${currentBlockingId}"`,
                    suggestedFix: `Keep ${char.name} blocking_id as "${lastBlockingId}" for continuity.`,
                    fixData: { type: 'update-field', field: 'characters.blocking_id', value: lastBlockingId, charName: char.name },
                    resolved: false
                });
            }

            if (lastBlockingId && !currentBlockingId) {
                issues.push({
                    id: `blocking-id-missing-${shot.shot_id}-${char.name}`,
                    shotId: shot.shot_id,
                    category: 'other',
                    severity: 'warning',
                    message: `Missing blocking_id for ${char.name}.`,
                    evidence: `Previous shots used blocking_id "${lastBlockingId}" but this shot has none.`,
                    suggestedFix: `Set blocking_id to "${lastBlockingId}".`,
                    fixData: { type: 'update-field', field: 'characters.blocking_id', value: lastBlockingId, charName: char.name },
                    resolved: false
                });
            }

            const currentPosition = (char.position || '').trim();
            if (!currentPosition) return;

            const lastPosition = characterPositions.get(char.name);
            if (lastPosition && lastPosition !== currentPosition) {
                const actionText = `${char.actions || ''} ${char.appearance?.description || ''}`.toLowerCase();
                const movementKeywords = ['moves to', 'switches seat', 'gets out', 'walks to', 'changes position', 'slides over', 'stands up'];
                const explicitMovement = movementKeywords.some(kw => actionText.includes(kw));

                if (!explicitMovement) {
                    issues.push({
                        id: `position-mismatch-${shot.shot_id}-${char.name}`,
                        shotId: shot.shot_id,
                        category: 'other',
                        severity: 'error',
                        message: `Position mismatch for ${char.name}.`,
                        evidence: `Previously: "${lastPosition}". Now: "${currentPosition}"`,
                        suggestedFix: `Keep ${char.name} at "${lastPosition}" unless script/action explicitly states movement.`,
                        fixData: { type: 'update-field', field: 'characters.position', value: lastPosition, charName: char.name },
                        resolved: false
                    });
                }
            }

            if (currentBlockingId) {
                characterBlockingIds.set(char.name, currentBlockingId);
            }
            characterPositions.set(char.name, currentPosition);
        });
    });

    // 4. Camera Direction (180 Axis Proxy)
    // If consecutive shots are both "Profile Right" or "Profile Left", it might be an axis jump depending on characters.
    // Simplifying for V1: Flag if perspective changes drastically without intermediate shots
    for (let i = 1; i < shots.length; i++) {
        const prev = shots[i - 1].visual_breakdown.framing_composition?.perspective;
        const curr = shots[i].visual_breakdown.framing_composition?.perspective;
        if (prev && curr && prev.includes('Side') && curr.includes('Side') && prev !== curr) {
            issues.push({
                id: `axis-warning-${shots[i].shot_id}`,
                shotId: shots[i].shot_id,
                category: 'camera',
                severity: 'warning',
                message: `Potential axis crossing. Perspective shifted from ${prev} to ${curr}.`,
                evidence: `Consecutive side-angle shifts can be disorienting.`,
                resolved: false
            });
        }
    }

    // 5. Prop Persistence (Stateful Continuity)
    const characterProps: Map<string, Set<string>> = new Map();
    const propKeywords = ['helmet', 'glasses', 'hat', 'mask', 'backpack', 'bag', 'jacket'];

    shots.forEach((shot, idx) => {
        shot.visual_breakdown.characters.forEach((char: any) => {
            const currentProps = new Set<string>();
            const desc = (char.appearance?.description || '' + ' ' + (char.actions || '')).toLowerCase();

            // Collect props in this shot
            propKeywords.forEach(kw => {
                if (desc.includes(kw) && !desc.includes(`no ${kw}`) && !desc.includes(`without ${kw}`)) {
                    currentProps.add(kw);
                }
            });

            // Also check objects list for this character
            const vb = shot.visual_breakdown as any;
            vb.objects?.forEach((obj: any) => {
                const objName = obj.name.toLowerCase();
                propKeywords.forEach(kw => {
                    if (objName.includes(kw)) currentProps.add(kw);
                });
            });

            const lastProps = characterProps.get(char.name);
            if (lastProps) {
                lastProps.forEach(prop => {
                    // Prop was present before, is it missing now?
                    if (!currentProps.has(prop)) {
                        // Check if there's a reason it's missing (removal action)
                        const removalKeywords = ['remove', 'take off', 'drop', 'lose', 'leaves', 'helmet off'];
                        const isRemoved = removalKeywords.some(kw => desc.includes(kw));

                        if (!isRemoved) {
                            issues.push({
                                id: `prop-lost-${shot.shot_id}-${char.name}-${prop}`,
                                shotId: shot.shot_id,
                                category: 'outfit',
                                severity: 'warning',
                                message: `${char.name} is missing ${prop}.`,
                                evidence: `${prop.charAt(0).toUpperCase() + prop.slice(1)} was seen in previous shots but is missing here without a removal action.`,
                                suggestedFix: `Add "${prop}" to ${char.name}'s appearance description.`,
                                fixData: {
                                    type: 'update-field',
                                    field: 'characters.appearance.description',
                                    value: `${char.appearance.description}, wearing ${prop}`,
                                    charName: char.name
                                },
                                resolved: false
                            });
                        }
                    }
                });
            }
            // Update tracking
            characterProps.set(char.name, currentProps);
        });
    });

    return issues;
}
