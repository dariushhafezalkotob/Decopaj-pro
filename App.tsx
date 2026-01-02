
import React, { useState, useEffect, useRef } from 'react';
import { Project, Sequence, ShotPlan, ImageSize, AppState, Entity } from './types';
import { identifyEntities, performFullDecopaj, generateShotImage, editShotImage } from './services/geminiService';
import { ShotCard } from './components/ShotCard';

const STORAGE_KEY = 'FILM_STUDIO_DATA_V1';
const NAV_STORAGE_KEY = 'FILM_STUDIO_NAV_V1';

// Fix: Defining props interface for AssetCard to resolve TypeScript JSX attribute errors
interface AssetCardProps {
  entity: Entity;
  isGlobal: boolean;
  onUpdateName: (val: string) => void;
  onUpload: (file: File) => void;
}

// Fix: Using React.FC with the defined interface to properly handle component props including 'key'
const AssetCard: React.FC<AssetCardProps> = ({ 
  entity, 
  isGlobal, 
  onUpdateName, 
  onUpload 
}) => (
  <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3 transition-all hover:border-zinc-700">
    <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest mb-1">
      {isGlobal ? (
        <input 
          className="bg-transparent border-b border-white/10 focus:border-amber-500 outline-none flex-1 text-amber-500 py-1"
          value={entity.name}
          onChange={(e) => onUpdateName(e.target.value)}
          placeholder="ENTER NAME..."
        />
      ) : <span className="text-zinc-400 truncate max-w-[120px]" title={entity.name}>{entity.name}</span>}
      <span className="text-zinc-600 ml-2 whitespace-nowrap">{entity.refTag}</span>
    </div>
    <div 
      onClick={() => document.getElementById(`upload-${entity.id}`)?.click()}
      className="relative aspect-square bg-black rounded-xl overflow-hidden cursor-pointer border border-zinc-800 hover:border-zinc-600 transition-all flex items-center justify-center group"
    >
      {entity.imageData ? (
        <img src={entity.imageData} className="w-full h-full object-cover" alt={entity.name} />
      ) : (
        <div className="flex flex-col items-center justify-center text-zinc-800 group-hover:text-zinc-600 transition-colors">
          <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
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
  </div>
);

const App: React.FC = () => {
  const storyboardRef = useRef<HTMLDivElement>(null);
  
  // Hydrate projects from localStorage
  const getInitialProjects = (): Project[] => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to load projects", e);
      return [];
    }
  };

  // Hydrate navigation from localStorage
  const getInitialNav = () => {
    try {
      const saved = localStorage.getItem(NAV_STORAGE_KEY);
      return saved ? JSON.parse(saved) : { 
        activeProjectId: null, 
        activeSequenceId: null, 
        currentStep: 'dashboard' 
      };
    } catch (e) {
      return { activeProjectId: null, activeSequenceId: null, currentStep: 'dashboard' };
    }
  };

  const initialNav = getInitialNav();

  const [state, setState] = useState<AppState & { 
    isCreatingProject: boolean; 
    newProjectName: string;
    isCreatingSequence: boolean;
    newSequenceTitle: string;
  }>({
    projects: getInitialProjects(),
    activeProjectId: initialNav.activeProjectId,
    activeSequenceId: initialNav.activeSequenceId,
    currentStep: initialNav.currentStep as any,
    isIdentifying: false,
    isAnalyzing: false,
    isGeneratingImages: false,
    imageSize: '1K',
    hasApiKey: false,
    error: null,
    isCreatingProject: false,
    newProjectName: '',
    isCreatingSequence: false,
    newSequenceTitle: ''
  });

  // Auto-save projects
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        setState(prev => ({ ...prev, error: "Storage Full: Try removing some images or clearing older projects." }));
      }
    }
  }, [state.projects]);

  // Auto-save navigation
  useEffect(() => {
    const nav = {
      activeProjectId: state.activeProjectId,
      activeSequenceId: state.activeSequenceId,
      currentStep: state.currentStep
    };
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(nav));
  }, [state.activeProjectId, state.activeSequenceId, state.currentStep]);

  useEffect(() => {
    const checkKey = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const hasKey = await aistudio.hasSelectedApiKey();
        setState(prev => ({ ...prev, hasApiKey: hasKey }));
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      await aistudio.openSelectKey();
      setState(prev => ({ ...prev, hasApiKey: true }));
    }
  };

  const handleClearAllData = () => {
    if (confirm("Are you sure you want to delete all projects and data? This cannot be undone.")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(NAV_STORAGE_KEY);
      window.location.reload();
    }
  };

  const handleStartCreateProject = () => setState(prev => ({ ...prev, isCreatingProject: true, newProjectName: '' }));

  const confirmCreateProject = () => {
    if (!state.newProjectName.trim()) return;
    const newProject: Project = {
      id: `proj-${Date.now()}`,
      name: state.newProjectName,
      globalCast: [],
      sequences: []
    };
    setState(prev => ({
      ...prev,
      projects: [...prev.projects, newProject],
      activeProjectId: newProject.id,
      currentStep: 'casting',
      isCreatingProject: false,
      newProjectName: ''
    }));
  };

  const activeProject = state.projects.find(p => p.id === state.activeProjectId);
  const activeSequence = activeProject?.sequences.find(s => s.id === state.activeSequenceId);

  const handleAddGlobalCharacter = () => {
    if (!state.activeProjectId || !activeProject) return;
    const newChar: Entity = {
      id: `char-${Date.now()}`,
      refTag: `image ${activeProject.globalCast.length + 1}`,
      name: '',
      type: 'character',
      description: ''
    };
    setState(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, globalCast: [...p.globalCast, newChar] } : p)
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
      const result = await identifyEntities(activeSequence.script, activeProject.globalCast);
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const existingNames = new Set(activeProject.globalCast.map(c => normalize(c.name)));
      
      const sceneAssets: Entity[] = [];
      let currentImgCount = activeProject.globalCast.length;

      result.entities.forEach((ent, idx) => {
        const normalizedName = normalize(ent.name);
        if (!existingNames.has(normalizedName)) {
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

  const retryShot = async (shotId: string) => {
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

    const allAssets = [...activeProject.globalCast, ...activeSequence.assets];
    try {
      const imageUrl = await generateShotImage(activeSequence.shots[shotIdx], state.imageSize, allAssets);
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

    try {
      const newImageUrl = await editShotImage(
        activeSequence.shots[shotIdx].image_url!,
        editPrompt,
        activeSequence.shots[shotIdx]
      );
      
      setState(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
          ...p,
          sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? {
            ...s,
            shots: s.shots.map(sh => sh.shot_id === shotId ? { ...sh, image_url: newImageUrl, editing: false } : sh)
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

  const handleGenerateStoryboard = async () => {
    if (!activeProject || !activeSequence) return;
    setState(prev => ({ ...prev, isAnalyzing: true }));

    const allAssets = [...activeProject.globalCast, ...activeSequence.assets];

    try {
      const analysis = await performFullDecopaj(activeSequence.script, allAssets);
      
      setState(prev => ({ 
        ...prev, 
        currentStep: 'sequence-board',
        isAnalyzing: false,
        isGeneratingImages: true,
        projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
          ...p,
          sequences: p.sequences.map(s => s.id === prev.activeSequenceId ? { ...s, shots: analysis.shots.map(sh => ({ ...sh, loading: true })) } : s)
        } : p)
      }));

      for (let i = 0; i < analysis.shots.length; i++) {
        try {
          const imageUrl = await generateShotImage(analysis.shots[i], state.imageSize, allAssets);
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
      setState(prev => ({ ...prev, isGeneratingImages: false }));
    } catch (error: any) {
      setState(prev => ({ ...prev, isAnalyzing: false, error: error.message }));
    }
  };

  const handleAssetUpload = (id: string, file: File, isGlobal: boolean) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const imageData = reader.result as string;
      const mimeType = file.type;
      setState(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === prev.activeProjectId ? {
          ...p,
          globalCast: isGlobal ? p.globalCast.map(c => c.id === id ? { ...c, imageData, mimeType } : c) : p.globalCast,
          sequences: !isGlobal ? p.sequences.map(s => s.id === prev.activeSequenceId ? {
            ...s,
            assets: s.assets.map(a => a.id === id ? { ...a, imageData, mimeType } : a)
          } : s) : p.sequences
        } : p)
      }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="min-h-screen pb-24 text-zinc-200">
      <nav className="sticky top-0 z-50 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-4 cursor-pointer" onClick={() => setState(p => ({ ...p, currentStep: 'dashboard', activeProjectId: null, activeSequenceId: null }))}>
          <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center text-zinc-950 font-black shadow-lg shadow-amber-500/20">F</div>
          <h1 className="font-bold uppercase tracking-tighter text-sm">Frameline Studio</h1>
          {activeProject && <span className="text-zinc-700">/</span>}
          {activeProject && <span className="text-xs font-bold text-amber-500">{activeProject.name}</span>}
        </div>
        <div className="flex items-center space-x-4">
          <button 
            onClick={handleOpenKeySelector} 
            className={`text-[10px] px-4 py-1.5 rounded-full border uppercase font-black tracking-widest transition-colors ${state.hasApiKey ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/5' : 'border-amber-500/50 text-amber-400 bg-amber-500/5'}`}
          >
            {state.hasApiKey ? 'API Ready' : 'API KEY Required'}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 mt-12">
        {state.currentStep === 'dashboard' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-4xl font-bold mb-2">My Projects</h2>
                <p className="text-zinc-500">Persistent workspace. Everything is saved automatically.</p>
              </div>
              <div className="flex items-center space-x-4">
                <button 
                  onClick={handleClearAllData}
                  className="text-[10px] font-black uppercase tracking-widest text-zinc-700 hover:text-red-500 transition-colors"
                >
                  Reset Workspace
                </button>
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
                  <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
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
                    <span>{p.globalCast.length} Cast</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); if(confirm("Delete this project?")) setState(prev => ({ ...prev, projects: prev.projects.filter(proj => proj.id !== p.id) })); }}
                    className="absolute bottom-4 right-8 opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-red-500 transition-all text-[8px] font-black uppercase"
                  >
                    Delete Project
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {state.currentStep === 'casting' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in">
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-2">Global Project Casting</h2>
              <p className="text-zinc-500">Define key character visuals that will persist across every sequence in this project.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {activeProject?.globalCast.map(c => (
                <AssetCard 
                  key={c.id} 
                  entity={c} 
                  isGlobal={true} 
                  onUpdateName={(val) => setState(p => ({ ...p, projects: p.projects.map(proj => proj.id === p.activeProjectId ? { ...proj, globalCast: proj.globalCast.map(char => char.id === c.id ? { ...char, name: val } : char) } : proj) }))}
                  onUpload={(file) => handleAssetUpload(c.id, file, true)}
                />
              ))}
              <button onClick={handleAddGlobalCharacter} className="aspect-square border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center text-zinc-700 hover:border-amber-500 hover:text-amber-500 transition-all group">
                <svg className="w-8 h-8 mb-2 opacity-50 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                <span className="text-[10px] font-black uppercase tracking-widest">Add Actor</span>
              </button>
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
                      placeholder="Sequence Title (e.g. INT. LAB - NIGHT)"
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
            
            <div className="grid grid-cols-1 gap-6">
              {activeProject?.sequences.length === 0 && !state.isCreatingSequence && (
                <div className="py-32 bg-zinc-950 border-2 border-dashed border-zinc-900 rounded-3xl flex flex-col items-center justify-center text-zinc-800">
                  <p className="font-black uppercase tracking-[0.3em] text-[10px]">Ready for breakdown</p>
                </div>
              )}
              {activeProject?.sequences.map(s => (
                <div 
                  key={s.id} 
                  onClick={() => setState(p => ({ ...p, activeSequenceId: s.id, currentStep: s.shots.length ? 'sequence-board' : 'sequence-input' }))} 
                  className="group bg-zinc-900/50 border border-zinc-800 px-8 py-8 rounded-3xl flex justify-between items-center cursor-pointer hover:bg-zinc-900 hover:border-amber-500/30 transition-all"
                >
                  <div>
                    <h4 className="font-bold text-xl group-hover:text-amber-500 transition-colors">{s.title}</h4>
                    <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest mt-1">
                      {s.shots.length ? 'Analysis Complete' : 'Script Stage'}
                    </p>
                  </div>
                  <div className="flex items-center space-x-6">
                    <span className="text-xs font-black uppercase tracking-widest text-zinc-600">{s.shots.length ? `${s.shots.length} Technical Shots` : 'Draft'}</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); if(confirm("Delete this sequence?")) setState(prev => ({ ...prev, projects: prev.projects.map(p => p.id === prev.activeProjectId ? { ...p, sequences: p.sequences.filter(seq => seq.id !== s.id) } : p) })); }}
                      className="w-10 h-10 bg-zinc-950 rounded-full flex items-center justify-center text-zinc-700 hover:text-red-500 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                    <div className="w-10 h-10 bg-zinc-950 rounded-full flex items-center justify-center text-zinc-700 group-hover:text-amber-500 group-hover:bg-amber-500/10 transition-all">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
                placeholder="INT. STUDIO - DAY&#10;&#10;The light catches the lens as the camera tracks forward..."
              />
              <div className="flex space-x-4 mt-8">
                <button onClick={() => setState(p => ({ ...p, currentStep: 'project-home' }))} className="px-8 py-4 bg-zinc-800 text-zinc-400 font-bold rounded-2xl hover:bg-zinc-700 transition-all">Back to Project</button>
                <button 
                  onClick={handleStartIdentification} 
                  disabled={state.isIdentifying || !activeSequence?.script.trim()} 
                  className={`flex-1 px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center space-x-3 transition-all ${state.isIdentifying || !activeSequence?.script.trim() ? 'bg-zinc-800 text-zinc-600' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-xl shadow-amber-500/20'}`}
                >
                  {state.isIdentifying && <div className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>}
                  <span>{state.isIdentifying ? 'Analyzing Narrative...' : 'Analyze Scene Assets'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {state.currentStep === 'sequence-assets' && (
          <div className="space-y-12 animate-in fade-in">
            <div className="border-b border-zinc-800 pb-8">
              <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">Sequence Scouting</h2>
              <p className="text-zinc-500">Provide visual references for unique locations and props found in this specific sequence.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
              {activeSequence?.assets.map(a => (
                <AssetCard 
                  key={a.id} 
                  entity={a} 
                  isGlobal={false} 
                  onUpdateName={() => {}} 
                  onUpload={(file) => handleAssetUpload(a.id, file, false)}
                />
              ))}
            </div>
            <div className="flex space-x-6 pt-8">
               <button onClick={() => setState(p => ({ ...p, currentStep: 'sequence-input' }))} className="px-10 py-4 bg-zinc-800 text-zinc-300 font-bold rounded-2xl hover:bg-zinc-700 transition-all">Adjust Script</button>
               <button 
                 onClick={handleGenerateStoryboard} 
                 disabled={state.isAnalyzing} 
                 className={`flex-1 px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-sm flex items-center justify-center space-x-4 transition-all ${state.isAnalyzing ? 'bg-zinc-800 text-zinc-600' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-xl shadow-amber-500/20'}`}
               >
                 {state.isAnalyzing && <div className="w-5 h-5 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin"></div>}
                 <span>{state.isAnalyzing ? 'Executing Full Decopaj...' : 'Finalize Technical Board'}</span>
               </button>
            </div>
          </div>
        )}

        {state.currentStep === 'sequence-board' && (activeProject && activeSequence) && (
          <div className="space-y-12 animate-in fade-in" ref={storyboardRef}>
            <div className="flex justify-between items-end border-b border-zinc-800 pb-8 print:hidden">
              <div>
                <h2 className="text-3xl font-black uppercase tracking-tighter mb-2">{activeSequence.title}</h2>
                <div className="flex items-center space-x-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                  <span>Production Storyboard</span>
                  <span className="w-1 h-1 bg-zinc-800 rounded-full"></span>
                  <span>{activeSequence.shots.length} Technical Shots</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <button 
                  onClick={() => setState(p => ({ ...p, currentStep: 'project-home', activeSequenceId: null }))} 
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-6 py-3 rounded-xl font-bold hover:bg-zinc-800 transition-all text-xs"
                >
                  Close Board
                </button>
                <button 
                  onClick={() => window.print()} 
                  className="bg-white text-zinc-950 px-6 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all text-xs flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                  <span>Export PDF</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-32">
              {activeSequence.shots.map(shot => (
                <ShotCard 
                  key={shot.shot_id} 
                  shot={shot} 
                  onRetry={() => retryShot(shot.shot_id)} 
                  onEdit={(prompt) => handleEditShot(shot.shot_id, prompt)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {state.error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500/90 backdrop-blur-md text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center space-x-4 animate-in slide-in-from-bottom-4 z-[9999]">
          <span className="text-xs font-bold uppercase tracking-widest">{state.error}</span>
          <button onClick={() => setState(p => ({ ...p, error: null }))} className="bg-white/20 hover:bg-white/30 rounded-full p-1 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
