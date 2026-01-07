
"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, register } from '../../services/api';

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            if (isLogin) {
                await login(username, password);
                router.push('/');
            } else {
                await register(username, password);
                alert("Registered! Please login.");
                setIsLogin(true);
            }
        } catch (err) {
            setError("Authentication failed. Check credentials.");
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-black text-white">
            <div className="w-full max-w-md p-8 bg-zinc-900 rounded-2xl border border-zinc-800">
                <h2 className="text-3xl font-bold mb-6 text-center">{isLogin ? 'Production Login' : 'Admin Register'}</h2>

                {error && <div className="bg-red-500/10 text-red-500 p-3 rounded-lg mb-4 text-sm font-bold text-center">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 p-3 rounded-xl focus:border-amber-500 outline-none transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-zinc-950 border border-zinc-800 p-3 rounded-xl focus:border-amber-500 outline-none transition-colors"
                        />
                    </div>
                    <button type="submit" className="w-full bg-amber-500 text-black font-bold py-3 rounded-xl hover:bg-amber-400 transition-colors uppercase tracking-widest text-sm">
                        {isLogin ? 'Sign In' : 'Register Admin'}
                    </button>
                </form>

                <p className="mt-6 text-center text-zinc-600 text-xs cursor-pointer hover:text-white transition-colors" onClick={() => setIsLogin(!isLogin)}>
                    {isLogin ? "Need an admin account? Register" : "Have an account? Login"}
                </p>
            </div>
        </div>
    );
}
