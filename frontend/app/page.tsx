
"use client";

import dynamic from 'next/dynamic';

const MainApp = dynamic(() => import('@/components/MainApp'), { ssr: false });

export default function Home() {
  return (
    <div className="min-h-screen">
      <MainApp />
    </div>
  );
}
