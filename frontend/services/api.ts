
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export const BACKEND_URL = 'http://127.0.0.1:4000';
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
        console.log(`Updating project at ${url}`);
        console.log(`Payload size: ${JSON.stringify(project).length} chars`);
        const res = await fetch(url, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(project)
        });
        console.log(res);
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
    return await res.json();
};

export const generateImageProxy = async (shot: any, size: string, assets: any[], projectName: string, sequenceTitle: string) => {
    const res = await fetch(`${API_URL}/ai/generate-image`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ shot, size, assets, projectName, sequenceTitle })
    });
    if (!res.ok) throw new Error("Image Gen Failed");
    const data = await res.json();
    return data.image_url;
};

export const editShotProxy = async (originalBase64: string, editPrompt: string, shot: any, projectName: string, sequenceTitle: string) => {
    const res = await fetch(`${API_URL}/ai/edit-shot`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ originalBase64, editPrompt, shot, projectName, sequenceTitle })
    });
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Edit Shot Failed");
    }
    return await res.json();
};
