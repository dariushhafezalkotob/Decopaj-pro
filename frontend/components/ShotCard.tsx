
import React, { useState } from 'react';
import { ShotPlan } from '../types';
import { BACKEND_URL } from '../services/api';

interface ShotCardProps {
    shot: ShotPlan;
    onRetry: () => void;
    onEdit: (prompt: string) => void;
    onDelete?: () => void;
}

export const ShotCard: React.FC<ShotCardProps> = ({ shot, onRetry, onEdit, onDelete }) => {
    const [showMeta, setShowMeta] = useState(false);
    const [showJson, setShowJson] = useState(false);
    const [isEditingMode, setIsEditingMode] = useState(false);
    const [editPrompt, setEditPrompt] = useState('');
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);

    // Keyboard support for Esc
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsLightboxOpen(false);
        };
        if (isLightboxOpen) window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLightboxOpen]);

    const handleEditSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editPrompt.trim()) return;
        onEdit(editPrompt);
        setIsEditingMode(false);
        setEditPrompt('');
    };

    const vb = shot.visual_breakdown;

    return (
        <div className="print-break-inside-avoid bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-2xl transition-all hover:border-zinc-700 print:bg-white print:border-zinc-300 print:shadow-none print:rounded-none print:border-b-2 print:pb-12 print:mb-8">
            <div className="aspect-video bg-black relative group print:bg-zinc-100 print:border print:border-zinc-300">
                {(shot.loading || shot.editing) ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/80 backdrop-blur-sm z-20 animate-in fade-in">
                        <div className="w-12 h-12 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mb-4"></div>
                        <p className="text-zinc-300 text-[10px] font-black uppercase tracking-[0.2em] animate-pulse">
                            {shot.editing ? 'RE-BUILDING METADATA...' : 'PROCESSING SPEC...'}
                        </p>
                    </div>
                ) : shot.image_url ? (
                    <img
                        src={shot.image_url.startsWith('/') ? `${BACKEND_URL}${shot.image_url}` : shot.image_url}
                        alt={shot.plan_type}
                        onClick={() => setIsLightboxOpen(true)}
                        className="w-full h-full object-cover cursor-zoom-in hover:scale-105 transition-transform duration-500"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center print:hidden">
                        <button
                            onClick={onRetry}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold transition-colors border border-zinc-700"
                        >
                            Regenerate
                        </button>
                    </div>
                )}

                <div className="absolute top-4 left-4 bg-zinc-950/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-black text-amber-500 uppercase tracking-widest print:bg-zinc-900 print:text-white print:border-zinc-800">
                    #{shot.shot_id}
                </div>

                <div className="absolute top-4 right-4 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
                    <button
                        onClick={() => setShowJson(!showJson)}
                        title="View Raw JSON"
                        className={`bg-zinc-950/80 backdrop-blur-md w-8 h-8 rounded-full border flex items-center justify-center text-white transition-all ${showJson ? 'border-amber-500 text-amber-500' : 'border-white/10'}`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                    </button>
                    <button
                        onClick={() => setShowMeta(!showMeta)}
                        title="View Metadata"
                        className={`bg-zinc-950/80 backdrop-blur-md w-8 h-8 rounded-full border flex items-center justify-center text-white transition-all ${showMeta ? 'border-amber-500 text-amber-500' : 'border-white/10'}`}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); if (confirm('Are you sure you want to delete this shot?')) onDelete(); }}
                            title="Delete Shot"
                            className="bg-zinc-950/80 backdrop-blur-md w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-zinc-500 hover:text-red-500 hover:border-red-500/50 transition-all"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    )}
                </div>
            </div>

            <div className="p-5 flex-1 flex flex-col print:p-0 print:pt-6">
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                        <h3 className="text-lg font-bold text-white print:text-zinc-900 print:text-3xl">{shot.plan_type}</h3>
                        <div className="flex items-center space-x-2">
                            {shot.image_url && !shot.loading && !shot.editing && (
                                <>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const fileName = `shot_${shot.shot_id}.png`;
                                                const fullUrl = shot.image_url?.startsWith('/') ? `${BACKEND_URL}${shot.image_url}` : shot.image_url;
                                                const res = await fetch(fullUrl!);
                                                const blob = await res.blob();
                                                const url = window.URL.createObjectURL(blob);
                                                const link = document.createElement('a');
                                                link.href = url;
                                                link.download = fileName;
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                                window.URL.revokeObjectURL(url);
                                            } catch (err) {
                                                console.error("Download failed", err);
                                            }
                                        }}
                                        className="p-1.5 text-zinc-500 hover:text-amber-500 hover:bg-amber-500/10 rounded-full transition-all print:hidden"
                                        title="Download Image"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    </button>
                                    <button
                                        onClick={onRetry}
                                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-all print:hidden"
                                        title="Regenerate with same data"
                                    >
                                        Regenerate
                                    </button>
                                    <button
                                        onClick={() => setIsEditingMode(!isEditingMode)}
                                        className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border transition-all print:hidden ${isEditingMode ? 'border-amber-500 text-amber-500 bg-amber-500/10' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}`}
                                    >
                                        {isEditingMode ? 'Cancel' : 'Modify'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                    <p className="text-amber-500/90 text-[10px] mono uppercase tracking-wider font-bold print:text-zinc-600 print:text-sm">
                        {shot.camera_specs}
                    </p>
                </div>

                {isEditingMode && (
                    <form onSubmit={handleEditSubmit} className="mb-6 animate-in slide-in-from-top-2 duration-300 print:hidden">
                        <div className="relative">
                            <textarea
                                autoFocus
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="Modify lighting, add fog, change expression..."
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-[11px] text-zinc-300 focus:border-amber-500 outline-none resize-none min-h-[60px]"
                            />
                            <button
                                type="submit"
                                disabled={!editPrompt.trim()}
                                className="absolute bottom-2 right-2 bg-amber-500 text-zinc-950 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all shadow-lg shadow-amber-500/20"
                            >
                                Modify
                            </button>
                        </div>
                        <p className="text-[8px] text-zinc-600 mt-1 uppercase font-bold tracking-widest">AI Colorist Instruction</p>
                    </form>
                )}

                <div className="space-y-4">
                    <div>
                        <span className="text-[9px] uppercase font-black text-zinc-600 block mb-1 tracking-widest print:text-zinc-500 print:text-[10px]">Script Segment</span>
                        <p className="text-sm text-zinc-300 italic leading-relaxed print:text-zinc-900 print:not-italic print:text-lg">
                            "{shot.action_segment}"
                        </p>
                    </div>

                    <div className={`${showMeta ? 'block' : 'hidden'} print:block pt-4 border-t border-zinc-800 print:border-zinc-200`}>
                        <span className="text-[9px] uppercase font-black text-zinc-600 block mb-2 tracking-widest print:text-zinc-500 print:text-[10px]">Technical Data</span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] mono mb-4 print:text-sm">
                            <div className="flex justify-between border-b border-zinc-800/50 pb-1 print:border-zinc-100">
                                <span className="text-zinc-500">Lens</span>
                                <span className="text-zinc-300 font-bold print:text-zinc-950">
                                    {vb?.camera?.lens?.focal_length_mm || '---'}mm
                                </span>
                            </div>
                            <div className="flex justify-between border-b border-zinc-800/50 pb-1 print:border-zinc-100">
                                <span className="text-zinc-500">Aperture</span>
                                <span className="text-zinc-300 font-bold print:text-zinc-950">
                                    {vb?.camera?.settings?.aperture || '---'}
                                </span>
                            </div>
                            <div className="flex justify-between border-b border-zinc-800/50 pb-1 print:border-zinc-100">
                                <span className="text-zinc-500">Mood</span>
                                <span className="text-zinc-300 font-bold print:text-zinc-950 truncate max-w-[80px] print:max-w-none">
                                    {vb?.scene?.mood || '---'}
                                </span>
                            </div>
                            <div className="flex justify-between border-b border-zinc-800/50 pb-1 print:border-zinc-100">
                                <span className="text-zinc-500">Lighting</span>
                                <span className="text-zinc-300 font-bold print:text-zinc-950 truncate max-w-[80px] print:max-w-none">
                                    {vb?.lighting?.key || '---'}
                                </span>
                            </div>
                        </div>

                        <span className="text-[9px] uppercase font-black text-zinc-600 block mb-2 tracking-widest print:text-zinc-500 print:text-[10px]">Character Mapping</span>
                        <div className="space-y-2">
                            {vb?.characters?.map((char, i) => (
                                <div key={i} className="text-[10px] bg-zinc-950/50 p-2 rounded-lg border border-zinc-800/50 print:bg-zinc-50 print:border-zinc-200 print:text-sm">
                                    <div className="flex justify-between mb-1">
                                        <span className="font-bold text-amber-500 uppercase print:text-zinc-950">{char.name}</span>
                                        <span className="text-zinc-400 italic bg-white/5 px-1 rounded print:bg-zinc-200 print:text-zinc-600">{char.reference_image}</span>
                                    </div>
                                    <p className="text-zinc-400 leading-tight print:text-zinc-700">
                                        <span className="text-zinc-600 font-bold">Action:</span> {char.actions}
                                    </p>
                                    <p className="text-[9px] text-zinc-500 mt-1 italic print:text-xs">
                                        {char.lighting_effect}
                                    </p>
                                </div>
                            )) || <p className="text-[10px] text-zinc-600 italic">No characters detected</p>}
                        </div>
                    </div>

                    <div className={`${showJson ? 'block' : 'hidden'} print:hidden pt-4 border-t border-zinc-800`}>
                        <span className="text-[9px] uppercase font-black text-zinc-600 block mb-2 tracking-widest">Decopaj JSON</span>
                        <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 overflow-x-auto">
                            <pre className="text-[9px] text-amber-500/80 mono leading-tight">
                                {JSON.stringify(vb, null, 2)}
                            </pre>
                        </div>
                    </div>

                    <div className="print:hidden">
                        <div className="flex flex-wrap gap-1 mt-2">
                            {shot.relevant_entities?.map((ent, i) => (
                                <span key={i} className="text-[8px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded uppercase font-bold tracking-tighter">
                                    {ent}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Lightbox Widget */}
            {isLightboxOpen && shot.image_url && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-md animate-in fade-in duration-300 print:hidden"
                    onClick={() => setIsLightboxOpen(false)}
                >
                    <div className="relative max-w-[95vw] max-h-[90vh] flex flex-col items-center">
                        <button
                            className="absolute -top-12 right-0 text-white/50 hover:text-white transition-colors p-2 group"
                            onClick={(e) => { e.stopPropagation(); setIsLightboxOpen(false); }}
                        >
                            <svg className="w-8 h-8 group-active:scale-95 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <img
                            src={shot.image_url.startsWith('/') ? `${BACKEND_URL}${shot.image_url}` : shot.image_url}
                            alt={shot.plan_type}
                            className="w-full h-full object-contain shadow-2xl rounded-lg animate-in zoom-in-95 duration-300"
                            onClick={(e) => e.stopPropagation()}
                        />

                        <div className="absolute -bottom-12 left-0 right-0 flex justify-between items-center px-2">
                            <span className="text-white/40 text-[10px] uppercase font-black tracking-widest">#{shot.shot_id} — {shot.plan_type}</span>
                            <span className="text-white/40 text-[10px] uppercase font-black tracking-widest">Press ESC to close</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
