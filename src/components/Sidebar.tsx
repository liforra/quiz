import React from 'react';
import { 
  LayoutDashboard, 
  Play, 
  Shield, 
  LogOut, 
  Sun, 
  Moon, 
  Menu, 
  X,
  Award,
  GraduationCap,
  Layers,
  History,
  BarChart2,
  Cpu,
  Cloud,
  Code,
  Database,
  Terminal,
  ChevronRight,
  FileQuestion,
  BookOpen,
  Timer,
  Globe,
  Lock,
  Server,
  Wifi,
  Smartphone,
  Monitor,
  HardDrive,
  Layout,
  Box,
  FileText
} from 'lucide-react';

interface SidebarProps {
  view: string;
  setView: (view: string) => void;
  theme: string;
  setTheme: (theme: void) => void;
  user: any;
  appUser: any;
  categoryStats: any;
  privateQuizzes: any[];
  publicQuizzes: any[];
  onSelectQuiz: (quiz: any) => void;
  onLogout: () => void;
  isOpen: boolean;
  toggleSidebar: () => void;
}

const ICON_MAP: any = {
  Cpu, Cloud, Code, Database, Terminal, Shield, Globe, Lock, 
  Server, Wifi, Smartphone, Monitor, HardDrive, Layout, Box, 
  Layers, FileText, BookOpen, GraduationCap, Timer
};

export default function Sidebar({ 
  view, 
  setView, 
  theme, 
  setTheme, 
  user, 
  appUser, 
  categoryStats,
  privateQuizzes,
  publicQuizzes,
  onSelectQuiz,
  onLogout,
  isOpen,
  toggleSidebar
}: SidebarProps) {
  
  const mainNav = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'simulation', label: 'Prüfungssimulation', icon: Timer, action: () => {
        // Find the full exam quiz if available, otherwise just go to dashboard or handle specifically
        const fullQuiz = publicQuizzes.find(q => q.title.toLowerCase().includes('full') || q.id.includes('full'));
        if (fullQuiz) {
            onSelectQuiz(fullQuiz);
            if (window.innerWidth < 768) toggleSidebar();
        } else {
            setView('dashboard'); // Fallback
        }
    }},
    { id: 'results', label: 'Last Results', icon: Award, condition: view === 'results' },
    { id: 'admin', label: 'Admin Panel', icon: Shield, condition: appUser?.username === 'liforra' },
  ];

  // Combine and sort quizzes
  const allQuizzes = [
    ...privateQuizzes.map(q => ({ ...q, type: 'private' })), 
    ...publicQuizzes.map(q => ({ ...q, type: 'public' }))
  ].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`
          fixed md:sticky top-0 left-0 z-50 h-screen
          bg-white dark:bg-[#18161F] 
          border-r border-zinc-200 dark:border-[#2A2633]
          transition-all duration-300 ease-in-out
          flex flex-col
          ${isOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0 w-64'}
        `}
      >
        {/* Header */}
        <div className="h-16 flex items-center px-6 border-b border-zinc-100 dark:border-[#2A2633]">
          <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <GraduationCap size={20} />
            </div>
            <span className="font-bold text-lg tracking-tight text-zinc-800 dark:text-white">
              FISI Trainer
            </span>
          </div>
          <button 
            onClick={toggleSidebar}
            className="md:hidden ml-auto p-2 text-zinc-400 hover:text-zinc-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          <div>
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] mb-4 px-3 opacity-70">
              Hauptmenü
            </div>
            <div className="space-y-1">
              {mainNav.map((item) => {
                if (item.condition === false) return null;
                const isActive = view === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                        if (item.action) {
                            item.action();
                        } else {
                            setView(item.id);
                        }
                        if (window.innerWidth < 768) toggleSidebar();
                    }}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
                      ${isActive 
                        ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' 
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-[#23202B] hover:text-zinc-900 dark:hover:text-zinc-200'
                      }
                    `}
                  >
                    <Icon size={18} className={isActive ? 'text-purple-600 dark:text-purple-400' : 'text-zinc-400'} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {allQuizzes.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] mb-4 px-3 opacity-70">
                Bibliothek ({allQuizzes.length})
              </div>
              <div className="space-y-1">
                {allQuizzes.map((quiz) => {
                  const QuizIcon = (quiz.icon && ICON_MAP[quiz.icon]) ? ICON_MAP[quiz.icon] : BookOpen;
                  return (
                    <button
                      key={quiz.id}
                      onClick={() => {
                          onSelectQuiz(quiz);
                          if (window.innerWidth < 768) toggleSidebar();
                      }}
                      className="w-full flex items-center group px-3 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-[#23202B] hover:text-zinc-900 dark:hover:text-zinc-200 transition-all"
                    >
                      <QuizIcon size={18} className="text-zinc-400 group-hover:text-purple-500 transition-colors shrink-0" />
                      <div className="ml-3 flex-1 text-left overflow-hidden">
                        <div className="truncate text-zinc-700 dark:text-zinc-300 group-hover:text-purple-700 dark:group-hover:text-purple-300 transition-colors">
                            {quiz.title}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate flex items-center gap-1">
                            {quiz.questions?.length} Fragen 
                            {quiz.type === 'private' && <span className="text-amber-500">• Private</span>}
                        </div>
                      </div>
                      <Play size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-purple-500 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* Footer Actions */}
        <div className="p-4 border-t border-zinc-100 dark:border-[#2A2633] space-y-2 bg-zinc-50/50 dark:bg-[#1C1A24]">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-purple-500/20">
              {appUser?.username?.substring(0, 2).toUpperCase()}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate">
                {appUser?.username}
              </span>
              <span className="text-[10px] text-green-500 font-bold uppercase tracking-wider">Online</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] text-zinc-600 dark:text-zinc-400 hover:border-purple-500 transition-all text-[11px] font-bold"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? 'LIGHT' : 'DARK'}
            </button>
            
            <button
              onClick={onLogout}
              className="flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-[#23202B] border border-red-100 dark:border-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-50 transition-all text-[11px] font-bold"
            >
              <LogOut size={14} />
              LOGOUT
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

