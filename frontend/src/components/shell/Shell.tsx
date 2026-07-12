"use client";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface-alt">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-5 md:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
