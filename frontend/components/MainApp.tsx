
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Project, Sequence, ShotPlan, ImageSize, AppState, Entity } from '../types';
import { Reorder } from 'framer-motion';
import { identifyEntities, performFullDecopaj, analyzeCustomShot, generateShotImage, editShotImage } from '../services/geminiService';
import { getProjects, createProject, updateProject, deleteProject, logout, checkContinuityProxy, BACKEND_URL } from '../services/api';
import { ShotCard } from './ShotCard';

const NAV_STORAGE_KEY = 'FILM_STUDIO_NAV_V1';

interface AssetCardProps {
    entity: Entity;
    isGlobal: boolean;
    onUpdateName: (val: string) => void;
    onUpload: (file: File) => void;
    onDelete?: () => void;
    onPickGlobal?: () => void;
    onPromote?: () => void;
}

const AssetCard: React.FC<AssetCardProps> = ({
    entity,
    isGlobal,
    onUpdateName,
    onUpload,
    onDelete,
    onPickGlobal,
    onPromote
}) => (
    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3 transition-all hover:border-zinc-700 group/asset">
        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest mb-1">
            <div className="flex items-center space-x-2 flex-1 overflow-hidden mr-1">
                {isGlobal ? (
                    <input
                        className="bg-transparent border-b border-white/10 focus:border-amber-500 outline-none flex-1 text-amber-500 py-1"
                        value={entity.name}
                        onChange={(e) => onUpdateName(e.target.value)}
                        placeholder="ENTER NAME..."
                    />
                ) : <span className="text-zinc-400 truncate" title={entity.name}>{entity.name}</span>}
            </div>
            {onDelete && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="text-zinc-600 hover:text-red-500 transition-colors bg-zinc-950/50 p-1.5 rounded-lg border border-white/5 hover:border-red-500/50 flex-shrink-0"
                    title="Delete Asset"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            )}
            <span className="text-zinc-600 whitespace-nowrap ml-2">{entity.refTag}</span>
            {(entity.id.startsWith('global') || entity.id.startsWith('scene-link') || isGlobal) && (
                <div className="absolute -top-1 -right-1 bg-amber-500 text-zinc-950 p-1 rounded-full shadow-lg" title="Global Asset">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                </div>
            )}
        </div>
        <div
            onClick={() => document.getElementById(`upload-${entity.id}`)?.click()}
            className={`relative ${entity.type === 'location' ? 'aspect-video' : 'aspect-square'} bg-black rounded-xl overflow-hidden cursor-pointer border border-zinc-800 hover:border-zinc-600 transition-all flex items-center justify-center group`}
        >
            {entity.imageData ? (
                <img
                    src={entity.imageData?.startsWith('/') ? `${BACKEND_URL}${entity.imageData}` : entity.imageData}
                    className="w-full h-full object-cover"
                    alt={entity.name}
                />
            ) : (
                <div className="flex flex-col items-center justify-center text-zinc-800 group-hover:text-zinc-600 transition-colors">
                    <svg className={`${entity.type === 'location' ? 'w-10 h-10' : 'w-8 h-8'} mb-1`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-[8px] font-black uppercase tracking-tighter">Add Ref</span>
                </div>
            )}
            <input
                id={`upload-${entity.id}`}
                type="file"
                className="hidden"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
        </div>
        {onPickGlobal && (
            <div className="flex flex-col space-y-2">
                <button
                    onClick={(e) => { e.stopPropagation(); onPickGlobal(); }}
                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[8px] font-black uppercase tracking-widest rounded-lg transition-colors border border-zinc-700/50"
                >
                    Pick from Global Library
                </button>
                {onPromote && entity.imageData && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onPromote(); }}
                        className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 text-[8px] font-black uppercase tracking-widest rounded-lg transition-colors border border-amber-500/20"
                    >
                        Save to Master Library
                    </button>
                )}
            </div>
        )}
    </div>
);

const InsertPromptCard: React.FC<{
    value: string;
    onChange: (val: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
    isAnalyzing: boolean;
}> = ({ value, onChange, onConfirm, onCancel, isAnalyzing }) => {
    return (
        <div className="aspect-square bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col items-center justify-center relative group/insert">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-4 self-start">Describe New Plan</h3>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Close up of character A looking at the car..."
                className="flex-1 w-full bg-black/50 border border-zinc-800 rounded-xl p-4 text-[11px] font-bold text-white placeholder:text-zinc-700 focus:border-amber-500 outline-none resize-none mb-4"
                disabled={isAnalyzing}
            />
            <div className="flex w-full space-x-3">
                <button
                    onClick={onCancel}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                    disabled={isAnalyzing}
                >
                    Cancel
                </button>
                <button
                    onClick={onConfirm}
                    disabled={isAnalyzing || !value.trim()}
                    className="flex-1 bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 hover:bg-amber-400 text-zinc-950 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-amber-500/20"
                >
                    {isAnalyzing ? 'Analyzing...' : 'Insert'}
                </button>
            </div>

            {isAnalyzing && (
                <div className="absolute inset-0 bg-zinc-950/80 rounded-3xl z-10 flex flex-col items-center justify-center backdrop-blur-sm animate-in fade-in">
                    <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">Analyzing...</span>
                </div>
            )}
        </div>
    );
};

const MainApp: React.FC = () => {
    const storyboardRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [hasMounted, setHasMounted] = useState(false);
    const [state, setState] = useState<AppState & {
        isCreatingProject: boolean;
        newProjectName: string;
        isCreatingSequence: boolean;
        newSequenceTitle: string;
        isSyncing: boolean;
        hasFileSystemAccess: boolean;
        isIframe: boolean;
        showDriveGuide: boolean;
        showGlobalPicker: boolean;
        pickerTargetId: string | null;
        editingSequenceId: string | null;
    }>({
        projects: [],
        activeProjectId: null,
        activeSequenceId: null,
        currentStep: 'dashboard',
        isIdentifying: false,
        isAnalyzing: false,
        isGeneratingImages: false,
        imageSize: '1K',
        aiModel: 'gemini-high',
        hasApiKey: false,
        error: null,
        isCreatingProject: false,
        newProjectName: '',
        isCreatingSequence: false,
        newSequenceTitle: '',
        isSyncing: false,
        hasFileSystemAccess: false,
        isIframe: false,
        showDriveGuide: false,
        insertionIndex: null,
        insertionPrompt: '',
        showGlobalPicker: false,
        pickerTargetId: null,
        pickerSearch: '',
        pickerCategory: 'all' as 'all' | 'character' | 'location' | 'item',
        editingSequenceId: null
    });

    // Initial Load from Backend
    useEffect(() => {
        const init = async () => {
            try {
                const projects = await getProjects();

                // Restore navigation state
                let initialNav = { activeProjectId: null, activeSequenceId: null, currentStep: 'dashboard' };
                if (typeof window !== 'undefined') {
                    try {
                        const savedNav = localStorage.getItem(NAV_STORAGE_KEY);
                        if (savedNav) initialNav = JSON.parse(savedNav);
                    } catch (e) { }
                }

                setState(prev => ({
                    ...prev,
                    projects: projects.map((p: any) => ({
                        ...p,
                        id: p.id || p._id,
                        globalAssets: (p.globalAssets && p.globalAssets.length > 0) ? p.globalAssets : (p.globalCast || [])
                    })),
                    activeProjectId: initialNav.activeProjectId,
                    activeSequenceId: initialNav.activeSequenceId,
                    currentStep: (initialNav.currentStep as any) || 'dashboard',
                    hasFileSystemAccess: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
                    isIframe: typeof window !== 'undefined' && window.self !== window.top,
                    hasApiKey: true // Backend handles keys
                }));
                setHasMounted(true);
            } catch (e) {
                console.error("Init failed", e);
                setHasMounted(true);
            }
        };
        init();
    }, []);

    // Sync active project to backend on any change
    // Using a ref to track if it's the first render or a mount update to avoid initial overwrite
    const isFirstSync = useRef(true);
    useEffect(() => {
        if (!hasMounted || !state.activeProjectId) return;

        const project = state.projects.find(p => p.id === state.activeProjectId);
        if (!project) return;

        // Skip the very first sync if it's identical to what we just loaded
        if (isFirstSync.current) {
            isFirstSync.current = false;
            // return; // We actually want to allow subsequent saves
        }

        const timer = setTimeout(async () => {
            try {
                await updateProject(state.activeProjectId!, project);
            } catch (err: any) {
                console.error("Auto-sync failed", err);
            }
        }, 1000);

        return () => clearTimeout(timer);
    }, [state.projects, state.activeProjectId, hasMounted]);

    // Save Navigation State
    useEffect(() => {
        if (!hasMounted) return;
        const nav = {
            activeProjectId: state.activeProjectId,
            activeSequenceId: state.activeSequenceId,
            currentStep: state.currentStep
        };
        localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(nav));
    }, [state.activeProjectId, state.activeSequenceId, state.currentStep, hasMounted]);

    const activeProject = state.projects.find(p => p.id === state.activeProjectId);
    const activeSequence = activeProject?.sequences.find(s => s.id === state.activeSequenceId);

    const handleReorderSequences = (newSequences: Sequence[]) => {
        if (!state.activeProjectId) return;
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, sequences: newSequences } : p)
        }));
    };

    const handleRenameSequence = (sequenceId: string, newTitle: string) => {
        if (!state.activeProjectId) return;
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === sequenceId ? { ...s, title: newTitle } : s)
            } : p)
        }));
    };

    const handleStartCreateProject = () => setState(prev => ({ ...prev, isCreatingProject: true, newProjectName: '' }));

    const confirmCreateProject = async () => {
        if (!state.newProjectName.trim()) return;
        try {
            const newProjData = {
                id: `proj-${Date.now()}`,
                name: state.newProjectName,
                globalAssets: [],
                sequences: []
            };
            const created = await createProject(newProjData);
            setState(prev => ({
                ...prev,
                projects: [...prev.projects, { ...created, id: created.id || created._id }],
                activeProjectId: created.id || created._id,
                currentStep: 'casting',
                isCreatingProject: false,
                newProjectName: ''
            }));
        } catch (err: any) {
            setState(prev => ({ ...prev, error: err.message }));
        }
    };

    const handleAddGlobalAsset = (type: 'character' | 'location' | 'item' = 'character') => {
        if (!state.activeProjectId || !activeProject) return;
        const prefix = type === 'character' ? 'char' : type === 'location' ? 'loc' : 'obj';
        const newAsset: Entity = {
            id: `${prefix}-${Date.now()}`,
            refTag: `image ${(activeProject.globalAssets || []).length + 1}`,
            name: '',
            type,
            description: ''
        };
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, globalAssets: [...(p.globalAssets || []), newAsset] } : p)
        }));
    };

    const handleStartCreateSequence = () => setState(prev => ({ ...prev, isCreatingSequence: true, newSequenceTitle: '' }));

    const confirmCreateSequence = () => {
        if (!state.newSequenceTitle.trim() || !state.activeProjectId) return;
        const newSeq: Sequence = {
            id: `seq-${Date.now()}`,
            title: state.newSequenceTitle,
            script: '',
            shots: [],
            assets: [],
            status: 'draft'
        };
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, sequences: [...p.sequences, newSeq] } : p),
            activeSequenceId: newSeq.id,
            currentStep: 'sequence-input',
            isCreatingSequence: false,
            newSequenceTitle: ''
        }));
    };

    const handleStartIdentification = async () => {
        if (!activeSequence?.script || !activeProject) return;
        setState(prev => ({ ...prev, isIdentifying: true, error: null }));

        try {
            const result = await identifyEntities(activeSequence.script, activeProject.globalAssets);
            const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            const existingNames = new Set((activeProject.globalAssets || []).map(c => normalize(c.name)));

            const sceneAssets: Entity[] = [];
            let currentImgCount = (activeProject.globalAssets || []).length;

            result.entities.forEach((ent, idx) => {
                const normalizedName = normalize(ent.name);

                // Check for match in global assets
                const globalMatch = (activeProject.globalAssets || []).find(ga => normalize(ga.name) === normalizedName);

                if (globalMatch) {
                    // LINK: Use the global asset's data directly
                    sceneAssets.push({
                        ...globalMatch,
                        id: `scene-link-${idx}-${Date.now()}` // Unique ID for the link instance in this sequence
                    });
                } else if (!existingNames.has(normalizedName)) {
                    // NEW: Create a new sequence-specific asset
                    currentImgCount++;
                    sceneAssets.push({
                        id: `scene-entity-${idx}-${Date.now()}`,
                        refTag: `image ${currentImgCount}`,
                        name: ent.name,
                        type: ent.type,
                        description: ''
                    });
                    existingNames.add(normalizedName);
                }
            });

            setState(prev => ({
                ...prev,
                isIdentifying: false,
                currentStep: 'sequence-assets',
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? { ...s, assets: sceneAssets } : s)
                } : p)
            }));
        } catch (error: any) {
            setState(prev => ({ ...prev, isIdentifying: false, error: error.message }));
        }
    };

    const handlePickGlobal = (sequenceAssetId: string, globalAsset: Entity) => {
        setState(prev => ({
            ...prev,
            showGlobalPicker: false,
            pickerTargetId: null,
            pickerSearch: '',
            pickerCategory: 'all',
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    assets: s.assets.map(a => a.id === sequenceAssetId ? {
                        ...a,
                        name: globalAsset.name,
                        imageData: globalAsset.imageData,
                        mimeType: globalAsset.mimeType,
                        description: globalAsset.description
                    } : a)
                } : s)
            } : p)
        }));
    };

    const handlePromoteToGlobal = (entity: Entity) => {
        if (!activeProject) return;

        // Check if already exists in global (by name)
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const normName = normalize(entity.name);
        if (activeProject.globalAssets.some(ga => normalize(ga.name) === normName)) {
            alert("An asset with this name already exists in the Master Library.");
            return;
        }

        const newGlobalAsset: Entity = {
            ...entity,
            id: `global-${Date.now()}`,
            refTag: `image ${(activeProject.globalAssets || []).length + 1}`
        };

        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                globalAssets: [...(p.globalAssets || []), newGlobalAsset]
            } : p)
        }));
    };

    const handleRetryShot = async (shotId: string) => {
        if (!activeProject || !activeSequence) return;
        const shotIdx = activeSequence.shots.findIndex(s => s.shot_id === shotId);
        if (shotIdx === -1) return;

        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, loading: true } : sh)
                } : s)
            } : p)
        }));

        const allAssets = [...activeProject.globalAssets, ...activeSequence.assets];
        try {
            const imageUrl = await generateShotImage(
                activeSequence.shots[shotIdx],
                state.imageSize,
                allAssets,
                activeProject.name,
                activeSequence.title,
                activeProject.id,
                activeSequence.id,
                state.aiModel
            );
            setState(prev => ({
                ...prev,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, image_url: imageUrl, loading: false } : sh)
                    } : s)
                } : p)
            }));
        } catch (err: any) {
            setState(prev => ({
                ...prev,
                error: err.message,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, loading: false } : sh)
                    } : s)
                } : p)
            }));
        }
    };

    const handleEditShot = async (shotId: string, editPrompt: string) => {
        if (!activeProject || !activeSequence) return;
        const shotIdx = activeSequence.shots.findIndex(s => s.shot_id === shotId);
        if (shotIdx === -1 || !activeSequence.shots[shotIdx].image_url) return;

        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, editing: true } : sh)
                } : s)
            } : p)
        }));

        const allAssets = [...activeProject.globalAssets, ...activeSequence.assets];

        try {
            const updateData = await editShotImage(
                activeSequence.shots[shotIdx].image_url!,
                editPrompt,
                activeSequence.shots[shotIdx],
                activeProject.name,
                activeSequence.title,
                activeProject.id,
                activeSequence.id,
                allAssets,
                state.aiModel
            );

            setState(prev => ({
                ...prev,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: s.shots.map(sh => sh.shot_id === shotId ? {
                            ...sh,
                            image_url: updateData.image_url,
                            visual_breakdown: updateData.visual_breakdown,
                            editing: false
                        } : sh)
                    } : s)
                } : p)
            }));
        } catch (err: any) {
            setState(prev => ({
                ...prev,
                error: err.message,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, editing: false } : sh)
                    } : s)
                } : p)
            }));
        }
    };

    const handleInsertShot = (index: number) => {
        setState(prev => ({ ...prev, insertionIndex: index, insertionPrompt: '' }));
    };

    const submitInsertion = async () => {
        const { insertionIndex, insertionPrompt } = state;
        if (insertionIndex === null || !insertionPrompt || !activeProject || !activeSequence) return;

        setState(prev => ({ ...prev, isAnalyzing: true }));

        const allAssets = [...activeProject.globalAssets, ...activeSequence.assets];

        try {
            const shotAnalysis = await analyzeCustomShot(insertionPrompt, allAssets);

            // Generate a unique shot_id to avoid collisions
            const uniqueShotId = `custom_${Date.now()}`;
            const newShot: ShotPlan = { ...shotAnalysis, shot_id: uniqueShotId, loading: true };

            setState(prev => ({
                ...prev,
                isAnalyzing: false,
                isGeneratingImages: true,
                insertionIndex: null,
                insertionPrompt: '',
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: [
                            ...s.shots.slice(0, insertionIndex),
                            newShot,
                            ...s.shots.slice(insertionIndex)
                        ]
                    } : s)
                } : p)
            }));

            // Generate the image
            const imageUrl = await generateShotImage(
                newShot,
                state.imageSize,
                allAssets,
                activeProject.name,
                activeSequence.title,
                activeProject.id,
                activeSequence.id,
                state.aiModel
            );

            // Update shot with image
            setState(prev => ({
                ...prev,
                isGeneratingImages: false,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: s.shots.map(sh => sh.shot_id === newShot.shot_id ? { ...sh, image_url: imageUrl, loading: false } : sh)
                    } : s)
                } : p)
            }));

        } catch (err: any) {
            setState(prev => ({ ...prev, isAnalyzing: false, isGeneratingImages: false, error: err.message, insertionIndex: null }));
        }
    };

    const handleDeleteShot = (shotId: string) => {
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    shots: s.shots.filter(sh => sh.shot_id !== shotId)
                } : s)
            } : p)
        }));
    };

    const handleGenerateStoryboard = async () => {
        if (!activeProject || !activeSequence) return;
        setState(prev => ({ ...prev, isAnalyzing: true, error: null }));

        const allAssets = [...activeProject.globalAssets, ...activeSequence.assets];

        try {
            // STEP 1: Full Technical Analysis
            const analysis = await performFullDecopaj(activeSequence.script, allAssets);

            // STEP 2: Automatic Continuity Check
            const continuityRes = await checkContinuityProxy(analysis.shots, allAssets);

            setState(prev => ({
                ...prev,
                currentStep: 'sequence-board',
                isAnalyzing: false,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        shots: analysis.shots,
                        continuityIssues: continuityRes.issues,
                        status: 'analyzed'
                    } : s)
                } : p)
            }));

            // AUTO-START RENDERING: Skip manual confirmation
            setTimeout(() => {
                handleStartRendering(analysis.shots, allAssets);
            }, 500);

        } catch (error: any) {
            setState(prev => ({ ...prev, isAnalyzing: false, error: error.message }));
        }
    };

    const handleStartRendering = async (passedShots?: any[], passedAssets?: any[]) => {
        if (!activeProject || !activeSequence) return;
        setState(prev => ({ ...prev, isGeneratingImages: true }));

        const allAssets = passedAssets || [...activeProject.globalAssets, ...activeSequence.assets];
        const shots = passedShots || [...activeSequence.shots];

        for (let i = 0; i < shots.length; i++) {
            if (shots[i].image_url) continue; // Skip already rendered shots

            try {
                setState(prev => ({
                    ...prev,
                    projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                        ...p,
                        sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                            ...s,
                            shots: s.shots.map((sh, idx) => idx === i ? { ...sh, loading: true } : sh)
                        } : s)
                    } : p)
                }));

                const previousShotUrl = i > 0 ? shots[i - 1].image_url : undefined;

                const imageUrl = await generateShotImage(
                    shots[i],
                    state.imageSize,
                    allAssets,
                    activeProject.name,
                    activeSequence.title,
                    activeProject.id,
                    activeSequence.id,
                    state.aiModel,
                    previousShotUrl
                );

                setState(prev => ({
                    ...prev,
                    projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                        ...p,
                        sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                            ...s,
                            shots: s.shots.map((sh, idx) => idx === i ? { ...sh, image_url: imageUrl, loading: false } : sh)
                        } : s)
                    } : p)
                }));
            } catch (err) {
                console.error(`Render failed for shot ${i}`, err);
                setState(prev => ({
                    ...prev,
                    projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                        ...p,
                        sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                            ...s,
                            shots: s.shots.map((sh, idx) => idx === i ? { ...sh, loading: false } : sh)
                        } : s)
                    } : p)
                }));
            }
        }

        setState(prev => ({
            ...prev,
            isGeneratingImages: false,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? { ...s, status: 'storyboarded' } : s)
            } : p)
        }));
    };

    const handleAssetUpload = (id: string, file: File, isGlobal: boolean) => {
        const MAX_SIZE = 20 * 1024 * 1024; // 20MB
        if (file.size > MAX_SIZE) {
            setState(prev => ({ ...prev, error: `Image too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please use images under 20MB.` }));
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            const imageData = reader.result as string;
            const mimeType = file.type;
            setState(prev => ({
                ...prev,
                projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                    ...p,
                    globalAssets: isGlobal ? p.globalAssets.map(c => c.id === id ? { ...c, imageData, mimeType } : c) : p.globalAssets,
                    sequences: !isGlobal ? p.sequences.map(s => s.id === prev.activeSequenceId ? {
                        ...s,
                        assets: s.assets.map(a => a.id === id ? { ...a, imageData, mimeType } : a)
                    } : s) : p.sequences
                } : p)
            }));
        };
        reader.readAsDataURL(file);
    };

    const handleDeleteProject = async (id: string) => {
        if (!confirm("Delete this project? This cannot be undone.")) return;
        try {
            await deleteProject(id);
            setState(prev => ({
                ...prev,
                projects: prev.projects.filter(p => p.id !== id),
                activeProjectId: prev.activeProjectId === id ? null : prev.activeProjectId,
                currentStep: prev.activeProjectId === id ? 'dashboard' : prev.currentStep
            }));
        } catch (err: any) {
            setState(prev => ({ ...prev, error: err.message }));
        }
    };

    const handleApplyContinuityFix = (shotId: string, issueId: string) => {
        if (!activeProject || !activeSequence) return;
        const issue = activeSequence.continuityIssues?.find(i => i.id === issueId);
        if (!issue || !issue.fixData) return;

        const { field, value, charName } = issue.fixData;

        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    shots: s.shots.map(sh => {
                        if (sh.shot_id !== shotId) return sh;

                        const updatedVB = { ...sh.visual_breakdown };
                        if (field === 'scene.time') {
                            updatedVB.scene.time = value;
                        } else if (field === 'characters.appearance.description' && charName) {
                            updatedVB.characters = updatedVB.characters.map(c =>
                                c.name === charName ? { ...c, appearance: { ...c.appearance, description: value } } : c
                            );
                        }
                        return { ...sh, visual_breakdown: updatedVB };
                    }),
                    continuityIssues: s.continuityIssues?.map(i => i.id === issueId ? { ...i, resolved: true } : i)
                } : s)
            } : p)
        }));
    };

    const handleResolveIssue = (issueId: string) => {
        if (!activeProject || !activeSequence) return;
        setState(prev => ({
            ...prev,
            projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
                ...p,
                sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
                    ...s,
                    continuityIssues: s.continuityIssues?.map(i => i.id === issueId ? { ...i, resolved: true } : i)
                } : s)
            } : p)
        }));
    };

    const handleLogout = () => {
        if (confirm("Are you sure you want to log out?")) {
            logout();
        }
    };

    if (!hasMounted) return null;

    return (
        <div className="min-h-screen pb-24 text-zinc-200">
            <nav className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800 px-6 h-16 flex items-center justify-between print:hidden">
                <div className="flex items-center space-x-4 cursor-pointer" onClick={() => setState(p => ({ ...p, currentStep: 'dashboard', activeProjectId: null, activeSequenceId: null }))}>
                    <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center text-zinc-950 font-black shadow-lg shadow-amber-500/20">F</div>
                    <h1 className="font-bold uppercase tracking-tighter text-sm">Frameline Studio</h1>
                    {activeProject && <span className="text-zinc-700">/</span>}
                    {activeProject && <span className="text-xs font-bold text-amber-500">{activeProject.name}</span>}
                </div>
                <div className="flex items-center space-x-4">
                    <div
                        onClick={() => setState(p => ({ ...p, showDriveGuide: !p.showDriveGuide }))}
                        className="group relative flex items-center space-x-2 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800 shadow-inner cursor-help transition-colors hover:border-zinc-600"
                    >
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)] ${state.isIframe ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                            {state.isIframe ? 'RESTRICTED DRIVE' : 'DRIVE LINK READY'}
                        </span>
                    </div>
                    <div className="flex items-center bg-zinc-900 px-3 py-1 rounded-full border border-zinc-800 space-x-3">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest border-r border-zinc-800 pr-3">Engine</span>
                        <div className="flex space-x-1">
                            <button
                                onClick={() => setState(p => ({ ...p, aiModel: 'gemini-high' }))}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${state.aiModel === 'gemini-high' ? 'bg-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                            >
                                High-End
                            </button>
                            <button
                                onClick={() => setState(p => ({ ...p, aiModel: 'seedream-4.5' }))}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${state.aiModel === 'seedream-4.5' ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                            >
                                Production
                            </button>
                            <button
                                onClick={() => setState(p => ({ ...p, aiModel: 'flux-comic' }))}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${state.aiModel === 'flux-comic' ? 'bg-purple-500 text-zinc-950 shadow-lg shadow-purple-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                            >
                                Comic
                            </button>
                        </div>
                    </div>
                    <div className="text-[10px] px-4 py-1.5 rounded-full border border-emerald-500/50 text-emerald-400 bg-emerald-500/5 uppercase font-black tracking-widest">
                        API Ready
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                        title="Logout"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-6 mt-12 print:mt-0 print:px-0">
                {state.currentStep === 'dashboard' && (
                    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-between items-end">
                            <div>
                                <h2 className="text-4xl font-bold mb-2">Workspace Dashboard</h2>
                                <p className="text-zinc-500">Break down scripts and manage cinematic assets across your projects.</p>
                            </div>
                            <div className="flex items-center space-x-4">
                                {!state.isCreatingProject ? (
                                    <button
                                        onClick={handleStartCreateProject}
                                        className="bg-amber-500 text-zinc-950 px-6 py-3 rounded-xl font-bold hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/20"
                                    >
                                        + New Project
                                    </button>
                                ) : (
                                    <div className="flex items-center space-x-2 bg-zinc-900 p-2 rounded-xl border border-zinc-800 animate-in slide-in-from-right-2">
                                        <input
                                            autoFocus
                                            className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm outline-none focus:border-amber-500 transition-colors w-64"
                                            placeholder="Project Name..."
                                            value={state.newProjectName}
                                            onChange={(e) => setState(p => ({ ...p, newProjectName: e.target.value }))}
                                            onKeyDown={(e) => e.key === 'Enter' && confirmCreateProject()}
                                        />
                                        <button onClick={confirmCreateProject} className="bg-amber-500 text-zinc-950 px-4 py-2 rounded-lg font-bold text-sm">Create</button>
                                        <button onClick={() => setState(p => ({ ...p, isCreatingProject: false }))} className="text-zinc-500 px-2 py-2 font-bold text-xs uppercase">Cancel</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {state.projects.length === 0 && !state.isCreatingProject && (
                                <div className="col-span-full py-24 border-2 border-dashed border-zinc-800 rounded-3xl flex flex-col items-center justify-center text-zinc-700">
                                    <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                                    <p className="font-bold uppercase tracking-widest text-xs">No active projects found</p>
                                </div>
                            )}
                            {state.projects.map(p => (
                                <div
                                    key={p.id}
                                    onClick={() => setState(prev => ({ ...prev, activeProjectId: p.id, currentStep: 'project-home' }))}
                                    className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl cursor-pointer hover:border-amber-500/50 hover:bg-zinc-800/40 transition-all group relative overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-amber-500/10 transition-colors"></div>
                                    <h3 className="text-2xl font-bold group-hover:text-amber-500 transition-colors relative z-10">{p.name}</h3>
                                    <div className="mt-6 flex items-center space-x-4 text-zinc-500 text-[10px] font-black uppercase tracking-widest relative z-10">
                                        <span>{p.sequences.length} Sequences</span>
                                        <span className="w-1 h-1 bg-zinc-800 rounded-full"></span>
                                        <span>{(p.globalAssets || []).length} Assets</span>
                                    </div>
                                    <div className="absolute bottom-4 right-8 flex items-center space-x-4 opacity-0 group-hover:opacity-100 transition-all">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }}
                                            className="text-zinc-700 hover:text-red-500 transition-all text-[8px] font-black uppercase tracking-widest"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {state.currentStep === 'casting' && (
                    <div className="max-w-6xl mx-auto space-y-16 animate-in fade-in">
                        <div className="text-center">
                            <h2 className="text-4xl font-black uppercase tracking-tighter mb-4">Master Project Library</h2>
                            <p className="text-zinc-500 max-w-2xl mx-auto text-sm">Define recurring characters, locations, and props to maintain visual consistency across all sequences.</p>
                        </div>

                        {/* CHARACTERS SECTION */}
                        <div className="space-y-6">
                            <div className="flex items-center space-x-4">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-amber-500">Global Cast</h3>
                                <div className="h-px bg-zinc-800 flex-1"></div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                                {(activeProject?.globalAssets || []).filter(a => a.type === 'character').map(c => (
                                    <AssetCard
                                        key={c.id}
                                        entity={c}
                                        isGlobal={true}
                                        onUpdateName={(val) => setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).map(char => char.id === c.id ? { ...char, name: val } : char) } : proj) }))}
                                        onUpload={(file) => handleAssetUpload(c.id, file, true)}
                                        onDelete={() => {
                                            if (confirm(`Are you sure you want to delete actor "${c.name || 'this unnamed asset'}"? This may affect sequences that use this asset.`)) {
                                                setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).filter(a => a.id !== c.id) } : proj) }));
                                            }
                                        }}
                                    />
                                ))}
                                <button onClick={() => handleAddGlobalAsset('character')} className="aspect-square border-2 border-dashed border-zinc-900 rounded-2xl flex flex-col items-center justify-center text-zinc-800 hover:border-amber-500/50 hover:text-amber-500/70 transition-all group bg-zinc-950/30">
                                    <svg className="w-8 h-8 mb-2 opacity-30 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                    <span className="text-[9px] font-black uppercase tracking-widest">Add Actor</span>
                                </button>
                            </div>
                        </div>

                        {/* LOCATIONS SECTION */}
                        <div className="space-y-6">
                            <div className="flex items-center space-x-4">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">Global Locations</h3>
                                <div className="h-px bg-zinc-800 flex-1"></div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {(activeProject?.globalAssets || []).filter(a => a.type === 'location').map(l => (
                                    <AssetCard
                                        key={l.id}
                                        entity={l}
                                        isGlobal={true}
                                        onUpdateName={(val) => setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).map(loc => loc.id === l.id ? { ...loc, name: val } : loc) } : proj) }))}
                                        onUpload={(file) => handleAssetUpload(l.id, file, true)}
                                        onDelete={() => {
                                            if (confirm(`Are you sure you want to delete location "${l.name || 'this unnamed location'}"? This may affect sequences that use this location.`)) {
                                                setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).filter(a => a.id !== l.id) } : proj) }));
                                            }
                                        }}
                                    />
                                ))}
                                <button onClick={() => handleAddGlobalAsset('location')} className="aspect-video border-2 border-dashed border-zinc-900 rounded-2xl flex flex-col items-center justify-center text-zinc-800 hover:border-emerald-500/50 hover:text-emerald-500/70 transition-all group bg-zinc-950/30">
                                    <svg className="w-8 h-8 mb-2 opacity-30 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                    <span className="text-[9px] font-black uppercase tracking-widest">Register Scene/Location</span>
                                </button>
                            </div>
                        </div>

                        {/* OBJECTS SECTION */}
                        <div className="space-y-6">
                            <div className="flex items-center space-x-4">
                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-500">Key Props & Objects</h3>
                                <div className="h-px bg-zinc-800 flex-1"></div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                                {(activeProject?.globalAssets || []).filter(a => a.type === 'item').map(i => (
                                    <AssetCard
                                        key={i.id}
                                        entity={i}
                                        isGlobal={true}
                                        onUpdateName={(val) => setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).map(item => item.id === i.id ? { ...item, name: val } : item) } : proj) }))}
                                        onUpload={(file) => handleAssetUpload(i.id, file, true)}
                                        onDelete={() => {
                                            if (confirm(`Are you sure you want to delete prop "${i.name || 'this unnamed prop'}"? This may affect sequences that use this prop.`)) {
                                                setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalAssets: (proj.globalAssets || []).filter(a => a.id !== i.id) } : proj) }));
                                            }
                                        }}
                                    />
                                ))}
                                <button onClick={() => handleAddGlobalAsset('item')} className="aspect-square border-2 border-dashed border-zinc-900 rounded-2xl flex flex-col items-center justify-center text-zinc-800 hover:border-blue-500/50 hover:text-blue-500/70 transition-all group bg-zinc-950/30">
                                    <svg className="w-8 h-8 mb-2 opacity-30 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                    <span className="text-[9px] font-black uppercase tracking-widest">Add Key Prop</span>
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-center pt-8">
                            <button
                                onClick={() => setState(p => ({ ...p, currentStep: 'project-home' }))}
                                className="bg-white text-zinc-950 px-12 py-4 rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-zinc-200 transition-all shadow-2xl"
                            >
                                Enter Production Home
                            </button>
                        </div>
                    </div>
                )}

                {state.currentStep === 'project-home' && (
                    <div className="space-y-10 animate-in fade-in">
                        <div className="flex justify-between items-end border-b border-zinc-800 pb-10">
                            <div>
                                <h2 className="text-4xl font-black uppercase tracking-tighter mb-2">{activeProject?.name}</h2>
                                <div className="flex items-center space-x-6 text-zinc-500 text-xs font-bold uppercase tracking-widest">
                                    <span>Production Base</span>
                                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                                    <span>{activeProject?.sequences.length} Active Sequences</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-4">
                                <button
                                    onClick={() => setState(p => ({ ...p, currentStep: 'casting' }))}
                                    className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all"
                                >
                                    Project Cast
                                </button>
                                {!state.isCreatingSequence ? (
                                    <button
                                        onClick={handleStartCreateSequence}
                                        className="bg-amber-500 text-zinc-950 px-6 py-3 rounded-xl font-bold hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/20"
                                    >
                                        + New Sequence
                                    </button>
                                ) : (
                                    <div className="flex items-center space-x-2 bg-zinc-900 p-2 rounded-xl border border-zinc-800 animate-in slide-in-from-right-2">
                                        <input
                                            autoFocus
                                            className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm outline-none focus:border-amber-500 transition-colors w-64"
                                            placeholder="Sequence Title..."
                                            value={state.newSequenceTitle}
                                            onChange={(e) => setState(p => ({ ...p, newSequenceTitle: e.target.value }))}
                                            onKeyDown={(e) => e.key === 'Enter' && confirmCreateSequence()}
                                        />
                                        <button onClick={confirmCreateSequence} className="bg-amber-500 text-zinc-950 px-4 py-2 rounded-lg font-bold text-sm">Create</button>
                                        <button onClick={() => setState(p => ({ ...p, isCreatingSequence: false }))} className="text-zinc-500 px-2 py-2 font-bold text-xs uppercase">Cancel</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <Reorder.Group
                            axis="y"
                            values={activeProject?.sequences || []}
                            onReorder={handleReorderSequences}
                            className="grid grid-cols-1 gap-6"
                        >
                            {activeProject?.sequences.length === 0 && !state.isCreatingSequence && (
                                <div className="py-32 bg-zinc-950 border-2 border-dashed border-zinc-900 rounded-3xl flex flex-col items-center justify-center text-zinc-800">
                                    <p className="font-black uppercase tracking-[0.3em] text-[10px]">Ready for breakdown</p>
                                </div>
                            )}
                            {activeProject?.sequences.map(s => (
                                <Reorder.Item
                                    key={s.id}
                                    value={s}
                                    className="group bg-zinc-900/50 border border-zinc-800 px-8 py-8 rounded-3xl flex justify-between items-center cursor-pointer hover:bg-zinc-900 hover:border-amber-500/30 transition-all"
                                    onClick={() => !state.editingSequenceId && setState(p => ({ ...p, activeSequenceId: s.id, currentStep: s.shots.length ? 'sequence-board' : 'sequence-input' }))}
                                >
                                    <div className="flex-1 mr-4">
                                        {state.editingSequenceId === s.id ? (
                                            <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    autoFocus
                                                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-lg font-bold outline-none focus:border-amber-500 transition-colors flex-1"
                                                    value={s.title}
                                                    onChange={(e) => handleRenameSequence(s.id, e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') setState(p => ({ ...p, editingSequenceId: null }));
                                                        if (e.key === 'Escape') setState(p => ({ ...p, editingSequenceId: null }));
                                                    }}
                                                    onBlur={() => setState(p => ({ ...p, editingSequenceId: null }))}
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex items-center group/title">
                                                <h4 className="font-bold text-xl group-hover:text-amber-500 transition-colors">{s.title}</h4>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setState(p => ({ ...p, editingSequenceId: s.id })); }}
                                                    className="ml-3 p-1 text-zinc-600 hover:text-amber-500 opacity-0 group-hover/title:opacity-100 transition-opacity"
                                                    title="Rename Sequence"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                </button>
                                            </div>
                                        )}
                                        <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest mt-1">
                                            {s.shots.length ? 'Analysis Complete' : 'Script Stage'}
                                        </p>
                                    </div>
                                    <div className="flex items-center space-x-6">
                                        <span className="text-xs font-black uppercase tracking-widest text-zinc-600">{s.shots.length ? `${s.shots.length} Technical Shots` : 'Draft'}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this sequence?")) setState(prev => ({ ...prev, projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, sequences: p.sequences.filter(seq => seq.id !== s.id) } : p) })); }}
                                            className="w-10 h-10 bg-zinc-950 rounded-full flex items-center justify-center text-zinc-700 hover:text-red-500 transition-all"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2.001 0 0116.138 21H7.862a2 2.001 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                        <div className="w-10 h-10 bg-zinc-950/50 cursor-grab active:cursor-grabbing rounded-full flex items-center justify-center text-zinc-700 hover:text-amber-500 transition-all" title="Drag to reorder">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" /></svg>
                                        </div>
                                    </div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    </div>
                )}

                {state.currentStep === 'sequence-input' && (
                    <div className="max-w-3xl mx-auto space-y-8 animate-in slide-in-from-right-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-3xl font-black uppercase tracking-tighter">{activeSequence?.title}</h2>
                            <button onClick={() => setState(p => ({ ...p, currentStep: 'project-home' }))} className="text-zinc-600 hover:text-zinc-300 text-[10px] font-black uppercase tracking-widest transition-colors">Abort</button>
                        </div>
                        <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl">
                            <textarea
                                value={activeSequence?.script}
                                onChange={(e) => setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, sequences: proj.sequences.map(s => s.id === p.activeSequenceId ? { ...s, script: e.target.value } : s) } : proj) }))}
                                className="w-full h-96 bg-zinc-950 border border-zinc-800 rounded-2xl p-6 text-sm mono focus:border-amber-500 outline-none resize-none leading-relaxed text-zinc-400"
                                placeholder="Paste script here..."
                            />
                            <div className="flex space-x-4 mt-8">
                                <button onClick={() => setState(p => ({ ...p, currentStep: 'project-home' }))} className="px-8 py-4 bg-zinc-800 text-zinc-400 font-bold rounded-2xl hover:bg-zinc-700 transition-all">Back</button>
                                <button
                                    onClick={handleStartIdentification}
                                    disabled={state.isIdentifying || !activeSequence?.script.trim()}
                                    className={`flex-1 px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center space-x-3 transition-all ${state.isIdentifying || !activeSequence?.script.trim() ? 'bg-zinc-800 text-zinc-600' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-xl shadow-amber-500/20'}`}
                                >
                                    {state.isIdentifying && <div className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>}
                                    <span>{state.isIdentifying ? 'Scanning...' : 'Analyze Sequence Assets'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {state.currentStep === 'sequence-assets' && (
                    <div className="space-y-12 animate-in fade-in">
                        <div className="border-b border-zinc-800 pb-8">
                            <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">Sequence Scouting</h2>
                            <p className="text-zinc-500">Provide visual references for specific locations and props in this scene.</p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                            {activeSequence?.assets.map(a => (
                                <AssetCard
                                    key={a.id}
                                    entity={a}
                                    isGlobal={false}
                                    onUpdateName={() => { }}
                                    onUpload={(file) => handleAssetUpload(a.id, file, false)}
                                    onDelete={() => setState(prev => ({ ...prev, projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? { ...s, assets: s.assets.filter(asset => asset.id !== a.id) } : s) } : p) }))}
                                    onPickGlobal={() => setState(prev => ({ ...prev, showGlobalPicker: true, pickerTargetId: a.id }))}
                                    onPromote={() => handlePromoteToGlobal(a)}
                                />
                            ))}
                        </div>

                        {/* GLOBAL PICKER MODAL */}
                        {state.showGlobalPicker && (
                            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in">
                                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setState(p => ({ ...p, showGlobalPicker: false, pickerSearch: '', pickerCategory: 'all' }))}></div>
                                <div className="relative bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                                    <div className="p-6 border-b border-zinc-800">
                                        <div className="flex justify-between items-center mb-6">
                                            <h3 className="text-xl font-bold">Select Global Asset</h3>
                                            <button onClick={() => setState(p => ({ ...p, showGlobalPicker: false, pickerSearch: '', pickerCategory: 'all' }))} className="text-zinc-500 hover:text-white transition-colors">
                                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            {/* Search Bar */}
                                            <div className="relative">
                                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                <input
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-amber-500 transition-all"
                                                    placeholder="Search assets by name..."
                                                    value={state.pickerSearch}
                                                    onChange={(e) => setState(p => ({ ...p, pickerSearch: e.target.value }))}
                                                />
                                            </div>

                                            {/* Category Tabs */}
                                            <div className="flex p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
                                                {[
                                                    { id: 'all', label: 'All Assets' },
                                                    { id: 'character', label: 'Characters' },
                                                    { id: 'location', label: 'Locations' },
                                                    { id: 'item', label: 'Props/Items' }
                                                ].map(cat => (
                                                    <button
                                                        key={cat.id}
                                                        onClick={() => setState(p => ({ ...p, pickerCategory: cat.id as any }))}
                                                        className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${state.pickerCategory === cat.id ? 'bg-amber-500 text-zinc-950 shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    >
                                                        {cat.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4 custom-scrollbar bg-zinc-900/50">
                                        {(() => {
                                            const filtered = (activeProject?.globalAssets || []).filter(ga => {
                                                const matchesSearch = !state.pickerSearch || ga.name.toLowerCase().includes(state.pickerSearch.toLowerCase());
                                                const matchesCategory = state.pickerCategory === 'all' || ga.type === state.pickerCategory;
                                                return matchesSearch && matchesCategory;
                                            });

                                            if (filtered.length === 0) {
                                                return (
                                                    <p className="col-span-full text-center py-12 text-zinc-600 font-bold uppercase tracking-widest text-xs">
                                                        {activeProject?.globalAssets.length === 0 ? "No global assets defined yet." : "No assets match your search."}
                                                    </p>
                                                );
                                            }

                                            return filtered.map(ga => (
                                                <div
                                                    key={ga.id}
                                                    onClick={() => state.pickerTargetId && handlePickGlobal(state.pickerTargetId, ga)}
                                                    className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl cursor-pointer hover:border-amber-500 transition-all flex items-center space-x-4 group"
                                                >
                                                    <div className="w-16 h-16 bg-zinc-900 rounded-lg overflow-hidden flex-shrink-0 border border-zinc-800">
                                                        {ga.imageData ? (
                                                            <img src={ga.imageData.startsWith('/') ? `${BACKEND_URL}${ga.imageData}` : ga.imageData} className="w-full h-full object-cover" alt="" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-zinc-800 uppercase font-black text-[8px]">{ga.type}</div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 overflow-hidden">
                                                        <h4 className="font-bold text-sm truncate group-hover:text-amber-500">{ga.name || 'Unnamed Asset'}</h4>
                                                        <div className="flex items-center space-x-2 mt-1">
                                                            <span className={`text-[8px] font-black uppercase tracking-widest ${ga.type === 'character' ? 'text-amber-500' : ga.type === 'location' ? 'text-emerald-500' : 'text-blue-500'}`}>{ga.type}</span>
                                                            <span className="text-[8px] font-black uppercase tracking-widest text-zinc-700">{ga.refTag}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="flex space-x-6 pt-8">
                            <button onClick={() => setState(p => ({ ...p, currentStep: 'sequence-input' }))} className="px-10 py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl hover:bg-zinc-700 transition-all">Adjust Script</button>
                            <button
                                onClick={handleGenerateStoryboard}
                                disabled={state.isAnalyzing}
                                className={`flex-1 px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center space-x-4 transition-all ${state.isAnalyzing ? 'bg-zinc-800 text-zinc-600' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-xl shadow-amber-500/20'}`}
                            >
                                {state.isAnalyzing && <div className="w-5 h-5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>}
                                <span>{state.isAnalyzing ? 'Decopaj in progress...' : 'Finalize Shot Board'}</span>
                            </button>
                        </div>
                    </div>
                )}

                {state.currentStep === 'sequence-board' && (activeProject && activeSequence) && (
                    <div className="space-y-12 animate-in fade-in" ref={storyboardRef}>
                        <div className="flex justify-between items-end border-b border-zinc-800 pb-8 print:border-zinc-300 print:mb-12">
                            <div>
                                <h2 className="text-3xl font-black uppercase tracking-tighter mb-2 print:text-5xl print:text-zinc-900">{activeSequence.title}</h2>
                                <div className="flex items-center space-x-4 text-[10px] font-black uppercase tracking-widest text-zinc-600 print:text-sm print:text-zinc-500">
                                    <span>Production Storyboard</span>
                                    <span className="w-1 h-1 bg-zinc-800 rounded-full print:bg-zinc-300"></span>
                                    <span>{activeSequence.shots.length} Technical Shots</span>
                                </div>
                            </div>
                            <div className="flex items-center space-x-4 print:hidden">
                                {activeSequence.status === 'analyzed' && (
                                    <button
                                        onClick={() => handleStartRendering()}
                                        disabled={state.isGeneratingImages}
                                        className="bg-emerald-500 text-zinc-950 px-8 py-3 rounded-xl font-black uppercase tracking-widest hover:bg-emerald-400 transition-all text-xs shadow-xl shadow-emerald-500/20 flex items-center space-x-3"
                                    >
                                        {state.isGeneratingImages ? (
                                            <div className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>
                                        ) : (
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                                        )}
                                        <span>{state.isGeneratingImages ? 'Rendering...' : 'Confirm & Start Rendering'}</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setState(p => ({ ...p, currentStep: 'project-home', activeSequenceId: null }))}
                                    className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all text-xs"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={() => typeof window !== 'undefined' && window.print()}
                                    className="bg-white text-zinc-950 px-6 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all text-xs flex items-center space-x-2 shadow-lg shadow-white/5"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    <span>Export PDF</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-32 print:grid-cols-1 print:gap-12 print:pb-0">
                            {/* Continuity Review Panel - Removed for automation */}

                            {/* Insert Prompt at index 0 */}
                            {state.insertionIndex === 0 && (
                                <InsertPromptCard
                                    value={state.insertionPrompt}
                                    onChange={(val: string) => setState(p => ({ ...p, insertionPrompt: val }))}
                                    onConfirm={submitInsertion}
                                    onCancel={() => setState(p => ({ ...p, insertionIndex: null }))}
                                    isAnalyzing={state.isAnalyzing}
                                />
                            )}

                            {activeSequence.shots.map((shot, idx) => (
                                <React.Fragment key={shot.shot_id}>
                                    <div className="relative group/card">
                                        <ShotCard
                                            shot={shot}
                                            issues={activeSequence.continuityIssues?.filter(i => i.shotId === shot.shot_id)}
                                            onApplyFix={(issueId) => handleApplyContinuityFix(shot.shot_id, issueId)}
                                            onRetry={() => handleRetryShot(shot.shot_id)}
                                            onEdit={(prompt: string) => handleEditShot(shot.shot_id, prompt)}
                                            onDelete={() => handleDeleteShot(shot.shot_id)}
                                        />

                                        {/* Hover "+" button for NEXT slot */}
                                        <div className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity hidden lg:block">
                                            <button
                                                onClick={() => handleInsertShot(idx + 1)}
                                                className="bg-amber-500 text-black p-1.5 rounded-full shadow-xl hover:scale-110 transition-transform"
                                                title={`Insert after shot ${idx + 1}`}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Insert Prompt Card when active */}
                                    {state.insertionIndex === idx + 1 && (
                                        <InsertPromptCard
                                            value={state.insertionPrompt}
                                            onChange={(val: string) => setState(p => ({ ...p, insertionPrompt: val }))}
                                            onConfirm={submitInsertion}
                                            onCancel={() => setState(p => ({ ...p, insertionIndex: null }))}
                                            isAnalyzing={state.isAnalyzing}
                                        />
                                    )}
                                </React.Fragment>
                            ))}

                            {/* Sequence Script Card */}
                            <div className="aspect-square rounded-3xl border border-zinc-800 bg-zinc-900/30 p-8 flex flex-col relative overflow-hidden group">
                                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50"></div>
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-[10px] font-black uppercase tracking-widest text-amber-500">Original Script</h3>
                                    <svg className="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                    <p className="text-[11px] font-bold text-zinc-400 leading-relaxed whitespace-pre-wrap italic">
                                        "{activeSequence.script}"
                                    </p>
                                </div>
                                <div className="mt-6 pt-6 border-t border-zinc-800/50">
                                    <div className="flex items-center space-x-2 opacity-30 group-hover:opacity-100 transition-opacity">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">End of Scene</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {state.error && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-800 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center space-x-6 animate-in slide-in-from-bottom-6 z-[9999] print:hidden max-w-md">
                    <div className="bg-amber-500/20 p-2 rounded-full text-amber-500">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div className="flex-1">
                        <h4 className="text-[10px] font-black uppercase tracking-widest opacity-50">System Info</h4>
                        <p className="text-[11px] font-bold leading-tight mt-0.5">{state.error}</p>
                    </div>
                    <button onClick={() => setState(p => ({ ...p, error: null }))} className="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-3 py-1.5 transition-colors text-[10px] font-black uppercase">
                        OK
                    </button>
                </div>
            )}
        </div>
    );
};

export default MainApp;
