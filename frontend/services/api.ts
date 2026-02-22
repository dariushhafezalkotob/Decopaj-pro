
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4000';
export const API_URL = `${BACKEND_URL}/api`;

export const login = async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).catch(err => {
        console.error("Login fetch error:", err);
        throw new Error("Cannot connect to server. Ensure backend is running.");
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    localStorage.setItem('token', data.token);
    return data;
};

export const register = async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error('Registration failed');
    return await res.json();
};

export const logout = () => {
    if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('FILM_STUDIO_NAV_V1');
        window.location.href = '/login';
    }
};

const getHeaders = (): Record<string, string> => {
    if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token || ''}`
    };
};

export const getProjects = async () => {
    const res = await fetch(`${API_URL}/projects`, { headers: getHeaders() });
    if (res.status === 401) window.location.href = '/login';
    return await res.json();
};

export const createProject = async (project: any) => {
    const res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(project)
    });
    return await res.json();
};

export const updateProject = async (id: string, project: any) => {
    try {
        const url = `${API_URL}/projects/${id}`;
        console.log(`Syncing project ${id} (${project.name})...`);
        const res = await fetch(url, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(project)
        });

        console.log(`Sync response for ${id}:`, res.status);
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`Update project failed (${res.status}):`, errorText);
            throw new Error(`Update failed: ${res.statusText}`);
        }
        return await res.json();
    } catch (err) {
        console.log("Update project network error:", err);
        throw err;
    }
};

export const deleteProject = async (id: string) => {
    await fetch(`${API_URL}/projects/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
    });
};

// AI Proxies
export const identifyEntitiesProxy = async (script: string, globalCast: any[]) => {
    const res = await fetch(`${API_URL}/ai/identify-entities`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ script, globalCast })
    });
    if (!res.ok) throw new Error("AI Service Failed");
    return await res.json();
};

export const analyzeScriptProxy = async (script: string, assets: any[]) => {
    const res = await fetch(`${API_URL}/ai/analyze-script`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ script, assets })
    });
    if (!res.ok) throw new Error("AI Service Failed");
    const { jobId } = await res.json();
    return await pollJobStatus(jobId);
};

export const analyzeCustomShotProxy = async (description: string, assets: any[]) => {
    const res = await fetch(`${API_URL}/ai/analyze-custom-shot`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ description, assets })
    });
    if (!res.ok) throw new Error("Custom Shot Analysis Failed");
    const { jobId } = await res.json();
    return await pollJobStatus(jobId);
};

// Polling helper for async jobs
const pollJobStatus = async (jobId: string): Promise<any> => {
    const maxAttempts = 100; // 100 * 3s = 300s (5 minutes)
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;
        const res = await fetch(`${API_URL}/ai/job-status/${jobId}`, {
            headers: getHeaders()
        });

        if (!res.ok) {
            throw new Error(`Polling failed: ${res.statusText}`);
        }

        const job = await res.json();
        if (job.status === 'completed') {
            return job.data;
        }
        if (job.status === 'failed') {
            throw new Error(job.error || "Async generation failed.");
        }

        console.log(`Job ${jobId} status: ${job.status}. Attempt ${attempts}...`);
        // Wait 3 seconds before next poll
        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error("Generation timed out. Please try again.");
};

export const generateImageProxy = async (shot: any, size: string, assets: any[], projectName: string, sequenceTitle: string, projectId: string, sequenceId: string, aiModel: string, previousShotUrl?: string) => {
    console.log(`Starting image generation for shot ${shot.shot_id}...`);
    const startTime = Date.now();
    try {
        const res = await fetch(`${API_URL}/ai/generate-image`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ shot, size, assets, projectName, sequenceTitle, projectId, sequenceId, model: aiModel, previousShotUrl })
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => "Unknown error");
            console.error(`Image generation FAILED for ${shot.shot_id}:`, res.status, errorText);
            throw new Error(`Image Gen Failed: ${res.status} ${res.statusText}`);
        }
        const result = await res.json();

        // Check if it's an async job
        if (result.jobId) {
            console.log(`Async job started: ${result.jobId}. Polling...`);
            const data = await pollJobStatus(result.jobId);
            return data.image_url;
        }

        return result.image_url;
    } catch (err: any) {
        const duration = (Date.now() - startTime) / 1000;
        console.error(`Image generation NETWORK ERROR for ${shot.shot_id} after ${duration}s:`, err);
        throw err;
    }
};

export const editShotProxy = async (originalBase64: string, editPrompt: string, shot: any, projectName: string, sequenceTitle: string, projectId: string, sequenceId: string, assets: any[], aiModel: string) => {
    console.log(`Starting shot edit for shot ${shot.shot_id}...`);
    const startTime = Date.now();
    try {
        const res = await fetch(`${API_URL}/ai/edit-shot`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ originalBase64, editPrompt, shot, projectName, sequenceTitle, projectId, sequenceId, assets, model: aiModel })
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            console.error(`Edit shot FAILED for ${shot.shot_id}:`, res.status, errorData);
            throw new Error(errorData.message || "Edit Shot Failed");
        }
        const result = await res.json();

        // Check if it's an async job
        if (result.jobId) {
            console.log(`Async edit job started: ${result.jobId}. Polling...`);
            return await pollJobStatus(result.jobId);
        }

        return result;
    } catch (err: any) {
        const duration = (Date.now() - startTime) / 1000;
        console.error(`Edit shot NETWORK ERROR for ${shot.shot_id} after ${duration}s:`, err);
        throw err;
    }
};
export const checkContinuityProxy = async (shots: any[], assets: any[]) => {
    const res = await fetch(`${API_URL}/ai/check-continuity`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ shots, assets })
    });
    if (!res.ok) throw new Error("Continuity Check Failed");
    return await res.json();
};
