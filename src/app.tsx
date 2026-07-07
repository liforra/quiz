import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import {
  Upload, FileJson, Play, CheckCircle, XCircle, ChevronRight, RotateCcw, Award, AlertCircle,
  Moon, Sun, Pause, Timer, Lock, User, Eye, EyeOff, Save, CheckSquare, Square, Keyboard,
  Globe, Shield, X, Download, Menu, GraduationCap,
  Edit2, Trash2, Cpu, Cloud, Code, Database, Terminal, Server, Wifi, Smartphone, Monitor,
  HardDrive, Layout, Box, Layers, FileText, BookOpen, Zap, HelpCircle, MessageCircle, Loader2, Trophy
} from 'lucide-react';
import { BUILT_IN_MODES } from './modes';
import { DEFAULT_QUIZZES } from './defaultQuizzes';
import { t, resolveQuestionLang, Lang } from './i18n';
import { checkAiStatus, gradeAnswer } from './api';
import HelpChat from './components/HelpChat';
import ExplainPopover from './components/ExplainPopover';
import StatsPanel from './components/StatsPanel';
import Leaderboard from './components/Leaderboard';
import { computeCategoryBreakdown, pickBestCategory } from './stats';

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  onSnapshot,
  increment,
  arrayUnion,
  updateDoc,
  query,
  getDocs,
  deleteDoc
} from 'firebase/firestore';

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = import.meta.env.VITE_APP_ID || 'default-app-id';

const ICON_KEYS = [
  "Cpu", "Cloud", "Code", "Database", "Terminal", "Shield", "Globe", "Lock",
  "Server", "Wifi", "Smartphone", "Monitor", "HardDrive", "Layout", "Box",
  "Layers", "FileText", "BookOpen", "GraduationCap", "Timer"
];

const ICON_MAP: any = {
  Cpu, Cloud, Code, Database, Terminal, Shield, Globe, Lock,
  Server, Wifi, Smartphone, Monitor, HardDrive, Layout, Box,
  Layers, FileText, BookOpen, GraduationCap, Timer
};

// --- UTILS ---
// Gravatar hashing uses SHA-256 (Gravatar's newer API supports this natively,
// so we can use the browser's built-in crypto.subtle instead of an MD5 lib).
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper for multi-select validation
const isCorrectArr = (arr1, arr2) => {
  if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, index) => val === sorted2[index]);
};

// Quiz authors tend to list the correct option(s) first — every correctness
// check in this app compares option *values*, never position, so shuffling
// display order here is safe and doesn't need to touch any grading logic.
function shuffleOptions(question) {
  if (!question?.options) return question;
  const options = [...question.options];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { ...question, options };
}

export default function App() {
  // --- STATE ---
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('auth'); // auth, dashboard, playing, results
  const [user, setUser] = useState(null);
  const [appUser, setAppUser] = useState(null);

  // Scroll to top on view change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // Modes/Categories + UI Language
  const [activeMode, setActiveModeState] = useState<string | null>(() => localStorage.getItem('quiz_active_mode') || null);
  const [uiLang, setUiLangState] = useState<Lang>(() => (localStorage.getItem('quiz_ui_lang') as Lang) || 'de');
  const [customModes, setCustomModes] = useState([]);

  const setActiveMode = (mode: string | null) => {
    setActiveModeState(mode);
    if (mode) localStorage.setItem('quiz_active_mode', mode);
    else localStorage.removeItem('quiz_active_mode');
  };
  const setUiLang = (lang: Lang) => {
    setUiLangState(lang);
    localStorage.setItem('quiz_ui_lang', lang);
  };

  // Library Data
  const [privateQuizzes, setPrivateQuizzes] = useState([]);
  const [publicQuizzes, setPublicQuizzes] = useState([]);
  // Premade/library quizzes filtered by the active mode (untagged quizzes only show under "Alle").
  // Built-in default quizzes (shipped with the app, not stored in Firestore) come first.
  const premadeQuizzes = useMemo(() => [
    ...DEFAULT_QUIZZES.map(q => ({ ...q, type: 'default' })),
    ...privateQuizzes.map(q => ({ ...q, type: 'private' })),
    ...publicQuizzes.map(q => ({ ...q, type: 'public' }))
  ].filter(q => activeMode == null || (q.modes || []).includes(activeMode)), [privateQuizzes, publicQuizzes, activeMode]);

  // Leaderboard Data
  const [leaderboardQuizId, setLeaderboardQuizId] = useState<string | null>(null);
  const openLeaderboard = (quizId: string) => {
    setLeaderboardQuizId(quizId);
    setView('leaderboard');
  };
  const leaderboardQuizTitle = useMemo(() => {
    const all = [...DEFAULT_QUIZZES, ...privateQuizzes, ...publicQuizzes];
    return all.find(q => q.id === leaderboardQuizId)?.title || 'Quiz';
  }, [leaderboardQuizId, privateQuizzes, publicQuizzes]);

  // Custom Quiz Builder — lets the player hand-pick which quizzes to draw
  // from, how many questions, and an optional timer, instead of playing one
  // premade quiz at a time. Unlike premadeQuizzes, the picker ignores the
  // active mode filter — building a mix across AP1/AP2 is the whole point.
  const allQuizzesFlat = useMemo(() => [
    ...DEFAULT_QUIZZES.map(q => ({ ...q, type: 'default' })),
    ...privateQuizzes.map(q => ({ ...q, type: 'private' })),
    ...publicQuizzes.map(q => ({ ...q, type: 'public' }))
  ], [privateQuizzes, publicQuizzes]);
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);
  const [customSelectedQuizIds, setCustomSelectedQuizIds] = useState<string[]>([]);
  const [customQuestionCount, setCustomQuestionCount] = useState(10);
  const [customTimerEnabled, setCustomTimerEnabled] = useState(false);
  const [customTimerScope, setCustomTimerScope] = useState<'question' | 'quiz'>('question');
  const [customTimerSeconds, setCustomTimerSeconds] = useState(30);
  const customPoolSize = useMemo(
    () => allQuizzesFlat.filter(q => customSelectedQuizIds.includes(q.id)).reduce((n, q) => n + (q.questions?.length || 0), 0),
    [allQuizzesFlat, customSelectedQuizIds]
  );
  const toggleCustomQuiz = (quizId: string) => {
    setCustomSelectedQuizIds(prev => prev.includes(quizId) ? prev.filter(id => id !== quizId) : [...prev, quizId]);
  };
  const startCustomQuiz = () => {
    const pool = allQuizzesFlat.filter(q => customSelectedQuizIds.includes(q.id)).flatMap(q => q.questions || []);
    if (pool.length === 0) return;
    const timerConfig = customTimerEnabled
      ? { scope: customTimerScope, seconds: customTimerScope === 'quiz' ? customTimerSeconds * 60 : customTimerSeconds }
      : null;
    generateSmartSession(pool, null, Math.min(customQuestionCount, pool.length), timerConfig);
    setShowCustomBuilder(false);
  };

  // Stats Data
  const [currentQuizId, setCurrentQuizId] = useState(null);
  const [globalStats, setGlobalStats] = useState({}); // Legacy/Global stats
  const [currentQuizStats, setCurrentQuizStats] = useState({}); // Current active quiz stats
  // Effective stats: Quiz stats override global stats (Forking pattern for legacy compatibility)
  const stats = useMemo(() => ({ ...globalStats, ...currentQuizStats }), [globalStats, currentQuizStats]);

  const [attempts, setAttempts] = useState([]); // Per-answer history (for category breakdown + trend chart)
  const categoryBreakdown = useMemo(
    () => computeCategoryBreakdown(stats, [...DEFAULT_QUIZZES, ...privateQuizzes, ...publicQuizzes]),
    [stats, privateQuizzes, publicQuizzes]
  );

  // Quiz Data
  const [activeQuizQuestions, setActiveQuizQuestions] = useState([]); // The full pool
  const [sessionQueue, setSessionQueue] = useState([]); // The smart queue for this run
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Derived (not separate state) so it can never drift out of sync with currentQuestionIndex
  const currentQData = sessionQueue[currentQuestionIndex] ?? null;
  // Language-resolved view of the current question (falls back to original fields when untranslated).
  // Rendering AND the value captured on answer both read from this, so correctness checks stay consistent.
  const displayQ = useMemo(() => shuffleOptions(resolveQuestionLang(currentQData, uiLang)), [currentQData, uiLang]);

  // Upload State
  const [pendingUpload, setPendingUpload] = useState(null);
  const [pendingFileName, setPendingFileName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState(null); // Track quiz being edited
  const [selectedIcon, setSelectedIcon] = useState("BookOpen"); // Default icon
  const [editTitle, setEditTitle] = useState("");
  const [selectedModes, setSelectedModes] = useState<string[]>([]); // Mode ids this quiz is tagged with

  const toggleSelectedMode = (modeId: string) => {
    setSelectedModes(prev => prev.includes(modeId) ? prev.filter(m => m !== modeId) : [...prev, modeId]);
  };

  // Gameplay State
  const [userAnswers, setUserAnswers] = useState({});
  const [sessionScore, setSessionScore] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const processingRef = useRef(false);
  const advancingRef = useRef(false);
  // Lazily constructed so the browser doesn't fetch a sound until it's
  // actually needed, and reused (via .currentTime reset) on replay so
  // rapid-fire answers don't get cut off by a still-playing instance.
  const correctSoundRef = useRef<HTMLAudioElement | null>(null);
  const wrongSoundRef = useRef<HTMLAudioElement | null>(null);
  const playSound = (ref: React.MutableRefObject<HTMLAudioElement | null>, src: string) => {
    if (!ref.current) ref.current = new Audio(src);
    ref.current.currentTime = 0;
    ref.current.play().catch(() => {}); // ignore autoplay-policy rejections
  };
  const timerSoundRef = useRef<HTMLAudioElement | null>(null);
  const playCorrectSound = useCallback(() => playSound(correctSoundRef, '/sounds/correct.mp3'), []);
  const playWrongSound = useCallback(() => playSound(wrongSoundRef, '/sounds/wrong.mp3'), []);
  const playTimerSound = useCallback(() => playSound(timerSoundRef, '/sounds/timer.mp3'), []);

  // Custom Quiz timer state — set once when a custom quiz with a timer is
  // started (see generateSmartSession's timerConfig param), null otherwise.
  const [activeTimer, setActiveTimer] = useState<{ scope: 'question' | 'quiz'; seconds: number } | null>(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(0);
  const [quizTimeLeft, setQuizTimeLeft] = useState(0);
  const [countdownStep, setCountdownStep] = useState(3); // 3, 2, 1, 0 (0 displays as "GO")

  // AI (Groq, via server/index.js — the client never sees the key or the prompts)
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiRateLimited, setAiRateLimited] = useState(false);
  const aiEnabled = aiConfigured && !aiRateLimited;
  const [helpChatQuestion, setHelpChatQuestion] = useState(null);
  const [explainContext, setExplainContext] = useState(null);
  const [gradingAnswer, setGradingAnswer] = useState(false);
  const [textAnswerInput, setTextAnswerInput] = useState('');

  const refreshAiStatus = useCallback(() => {
    checkAiStatus().then(({ enabled, rateLimited }) => {
      setAiConfigured(enabled);
      setAiRateLimited(rateLimited);
    });
  }, []);

  // Check once on load, then keep polling so the app quietly recovers on its
  // own once a Groq rate limit clears (no need to reload).
  useEffect(() => {
    refreshAiStatus();
    const interval = setInterval(refreshAiStatus, 60_000);
    return () => clearInterval(interval);
  }, [refreshAiStatus]);

  // Called wherever an AI call fails — flips the shared rate-limited flag so
  // every AI-dependent bit of UI (grading, explain, help chat) falls back at
  // once, and schedules a status re-check once Groq says we can retry.
  const handleAiError = useCallback((e: any) => {
    if (e?.retryAfterSeconds != null) {
      setAiRateLimited(true);
      setTimeout(refreshAiStatus, (e.retryAfterSeconds + 1) * 1000);
      return true;
    }
    return false;
  }, [refreshAiStatus]);

  // Close any open help/explain panel when the question or view changes, so
  // stale context never lingers onto the next question (or outside gameplay).
  useEffect(() => {
    setHelpChatQuestion(null);
    setExplainContext(null);
    setTextAnswerInput('');
  }, [currentQuestionIndex, view]);

  // Inputs
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Auth Form State
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Text/Multi Inputs
  const [textInputReveal, setTextInputReveal] = useState(false);
  const [multiSelection, setMultiSelection] = useState([]);

  // Settings / Profile State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [gravatarEmailInput, setGravatarEmailInput] = useState('');
  const [gravatarHash, setGravatarHash] = useState('');
  const [hideFromLeaderboardInput, setHideFromLeaderboardInput] = useState(false);

  useEffect(() => {
    const email = appUser?.gravatarEmail?.trim().toLowerCase();
    if (!email) {
      setGravatarHash('');
      return;
    }
    let cancelled = false;
    sha256Hex(email).then(hash => { if (!cancelled) setGravatarHash(hash); });
    return () => { cancelled = true; };
  }, [appUser?.gravatarEmail]);

  const gravatarUrl = gravatarHash ? `https://www.gravatar.com/avatar/${gravatarHash}?d=404&s=80` : null;

  const openSettingsModal = () => {
    setGravatarEmailInput(appUser?.gravatarEmail || '');
    setHideFromLeaderboardInput(!!appUser?.hideFromLeaderboard);
    setShowSettingsModal(true);
  };

  const saveProfileSettings = async () => {
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid), {
        gravatarEmail: gravatarEmailInput.trim(),
        hideFromLeaderboard: hideFromLeaderboardInput
      }, { merge: true });

      // Opting out should also remove any leaderboard entries this user
      // already has (not just block future ones) — otherwise "not included"
      // would only apply going forward, leaving old scores visible to everyone.
      if (hideFromLeaderboardInput) {
        const freshUserDoc = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid));
        const quizIds: string[] = freshUserDoc.data()?.leaderboardQuizIds || [];
        await Promise.all(quizIds.map((quizId) =>
          deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'leaderboards', quizId, 'entries', user.uid))
        ));
      }

      setShowSettingsModal(false);
    } catch (e) {
      setError("Failed to save settings: " + e.message);
    }
  };

  // Admin State
  const [adminUsers, setAdminUsers] = useState([]);
  const [selectedAdminUser, setSelectedAdminUser] = useState(null);
  const [selectedAdminUserData, setSelectedAdminUserData] = useState(null);

  // Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const toggleSidebar = () => setIsSidebarOpen(prev => !prev);


  // --- FIREBASE AUTH INIT ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const username = u.displayName || u.email;
        setAppUser({ username });
        setView('dashboard');

        // Ensure user doc exists for Admin listing (and self-repair)
        try {
          setDoc(doc(db, 'artifacts', appId, 'users', u.uid), {
            username: username,
            lastLogin: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.error("Failed to update user doc", e);
        }
      } else {
        setAppUser(null);
        setView('auth');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- DATA SYNC ---
  useEffect(() => {
    if (!user) return;

    // 0. Sync own user doc (profile prefs like gravatarEmail)
    const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid);
    const unsubUserDoc = onSnapshot(userDocRef, (snap) => {
      const data = snap.data();
      setAppUser(prev => prev ? { ...prev, gravatarEmail: data?.gravatarEmail || '', hideFromLeaderboard: !!data?.hideFromLeaderboard } : prev);
    }, (err) => console.error("User doc sync error", err));

    // 1. Sync User Stats (Questions)
    const statsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'stats');
    const unsubStats = onSnapshot(statsRef, (snapshot) => {
      const newStats = {};
      snapshot.forEach(doc => {
        newStats[doc.id] = doc.data();
      });
      setGlobalStats(newStats);
    }, (err) => console.error("Stats sync error", err));

    // 2. Sync Attempt History (per-answer log, feeds category breakdown + trend chart)
    const attemptsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'attempts');
    const unsubAttempts = onSnapshot(attemptsRef, (snapshot) => {
      setAttempts(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Attempts sync error", err));

    // 3. Sync Private Quizzes
    const privateRef = collection(db, 'artifacts', appId, 'users', user.uid, 'quizzes');
    const unsubPrivate = onSnapshot(privateRef, (snapshot) => {
      setPrivateQuizzes(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Private quiz sync error", err));

    // 4. Sync Public Quizzes
    const publicRef = collection(db, 'artifacts', appId, 'public', 'data', 'quizzes');
    const unsubPublic = onSnapshot(publicRef, (snapshot) => {
      setPublicQuizzes(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Public quiz sync error", err));

    // 5. Sync Custom Modes (private to this user)
    const modesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'modes');
    const unsubModes = onSnapshot(modesRef, (snapshot) => {
      setCustomModes(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Custom modes sync error", err));

    return () => {
      unsubUserDoc();
      unsubStats();
      unsubAttempts();
      unsubPrivate();
      unsubPublic();
      unsubModes();
    };
  }, [user]);

  // --- SYNC CURRENT QUIZ STATS ---
  useEffect(() => {
    if (!user || !currentQuizId) {
      setCurrentQuizStats({});
      return;
    }
    const qStatsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'quiz_stats', currentQuizId, 'stats');
    const unsub = onSnapshot(qStatsRef, (snapshot) => {
      const newStats = {};
      snapshot.forEach(doc => {
        newStats[doc.id] = doc.data();
      });
      setCurrentQuizStats(newStats);
    }, (err) => console.error("Quiz stats sync error", err));
    return () => unsub();
  }, [user, currentQuizId]);

  // --- TIMER LOGIC ---
  useEffect(() => {
    let interval;
    if (view === 'playing' && showFeedback && !isPaused && countdown > 0) {
      interval = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0 && showFeedback && view === 'playing') {
      handleNext();
    }
    return () => clearInterval(interval);
  }, [view, showFeedback, isPaused, countdown]);

  // --- SHARED ACTIONS ---
  const toggleSelection = useCallback((opt) => {
    if (showFeedback) return;
    setMultiSelection(prev =>
      prev.includes(opt) ? prev.filter(p => p !== opt) : [...prev, opt]
    );
  }, [showFeedback]);

  const submitAnswer = useCallback(async (isCorrect, answerValue) => {
    if (showFeedback || processingRef.current) return;
    processingRef.current = true;

    // Update Session State
    const currentQ = sessionQueue[currentQuestionIndex];
    setUserAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: answerValue
    }));

    if (isCorrect) {
      setSessionScore(s => s + 1);
      playCorrectSound();
    } else {
      playWrongSound();
    }

    // Update Firestore Stats
    if (user && appUser) {
      // 1. Update Question Specific Stats
      // If we have a currentQuizId, save to the quiz-specific path.
      // Otherwise, save to the global/legacy path.
      let statRef;
      if (currentQuizId) {
        statRef = doc(db, 'artifacts', appId, 'users', user.uid, 'quiz_stats', currentQuizId, 'stats', currentQ.id);
      } else {
        statRef = doc(db, 'artifacts', appId, 'users', user.uid, 'stats', currentQ.id);
      }

      try {
        // Always update global stats
        const globalStatRef = doc(db, 'artifacts', appId, 'users', user.uid, 'stats', currentQ.id);
        await setDoc(globalStatRef, {
          correct: increment(isCorrect ? 1 : 0),
          wrong: increment(isCorrect ? 0 : 1),
          lastPlayed: new Date().toISOString()
        }, { merge: true });

        // If playing a specific quiz, also update quiz-specific stats
        if (currentQuizId) {
          const quizStatRef = doc(db, 'artifacts', appId, 'users', user.uid, 'quiz_stats', currentQuizId, 'stats', currentQ.id);
          await setDoc(quizStatRef, {
            correct: increment(isCorrect ? 1 : 0),
            wrong: increment(isCorrect ? 0 : 1),
            lastPlayed: new Date().toISOString()
          }, { merge: true });
        }

        // 2. Log this attempt (feeds the category breakdown + trend chart;
        // uncategorized questions land under "Unknown" rather than vanishing)
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'attempts'), {
          questionId: currentQ.id,
          category: currentQ.category || 'Unknown',
          correct: isCorrect,
          quizId: currentQuizId || null,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        console.error("Failed to save stats", e);
      }
    }

    // Trigger Feedback UI
    setFeedbackType(isCorrect ? 'correct' : 'wrong');
    setShowFeedback(true);
    setCountdown(isCorrect ? 2 : 5);
  }, [showFeedback, sessionQueue, currentQuestionIndex, user, appUser, playCorrectSound, playWrongSound]);

  const submitTextAnswer = async (typedAnswer: string) => {
    if (showFeedback || processingRef.current || gradingAnswer || !typedAnswer.trim()) return;
    setGradingAnswer(true);
    try {
      const answerForGrading = Array.isArray(displayQ.answer) ? displayQ.answer.join(', ') : displayQ.answer;
      const result = await gradeAnswer(displayQ.question, answerForGrading, typedAnswer.trim(), uiLang);
      submitAnswer(result.correct, typedAnswer.trim());
    } catch (e) {
      // On rate limit this flips aiEnabled off, so the UI falls back to the
      // classic self-report flow (the typed answer is kept in the input).
      handleAiError(e);
    } finally {
      setGradingAnswer(false);
    }
  };

  // Upserts this user's best result for a quiz into its public leaderboard.
  // Only ever raises the stored score (never lowers it on a worse retry), and
  // is a no-op for quizzes with no stable id (ad-hoc uploads) or opted-out users.
  const submitLeaderboardResult = useCallback(async (quizId: string, correctCount: number, totalCount: number) => {
    if (!user || !appUser || !quizId || totalCount === 0 || appUser.hideFromLeaderboard) return;
    const percentage = Math.round((correctCount / totalCount) * 100);
    try {
      const entryRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboards', quizId, 'entries', user.uid);
      const existing = await getDoc(entryRef);
      const prevBest = existing.exists() ? (existing.data().bestPercentage ?? -1) : -1;
      await setDoc(entryRef, {
        username: appUser.username,
        lastPlayed: new Date().toISOString(),
        ...(percentage >= prevBest ? { bestScore: correctCount, bestTotal: totalCount, bestPercentage: percentage } : {})
      }, { merge: true });
      // Track which quizzes this user has an entry in, on their own (private,
      // owner-readable) doc — lets opt-out purge those entries by direct path
      // instead of a collectionGroup query, which would need a composite index.
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid), {
        leaderboardQuizIds: arrayUnion(quizId)
      }, { merge: true });
    } catch (e) {
      console.error("Failed to update leaderboard", e);
    }
  }, [user, appUser]);

  const handleNext = useCallback(() => {
    // Guards against a second handleNext firing (e.g. key-repeat, or the
    // auto-advance timer and a manual Space press landing in the same tick)
    // before React has re-rendered and swapped in a fresh closure.
    if (advancingRef.current) return;
    advancingRef.current = true;

    if (currentQuestionIndex < sessionQueue.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setShowFeedback(false);
      setTextInputReveal(false);
      setMultiSelection([]);
      setIsPaused(false);
      processingRef.current = false;
    } else {
      if (currentQuizId) {
        submitLeaderboardResult(currentQuizId, sessionScore, sessionQueue.length);
      }
      setView('results');
    }
  }, [currentQuestionIndex, sessionQueue, currentQuizId, sessionScore, submitLeaderboardResult]);

  // Release the handleNext guard only once the question index has actually
  // advanced, so a legitimate next press isn't blocked by a prior one.
  useEffect(() => {
    advancingRef.current = false;
  }, [currentQuestionIndex]);

  // --- CUSTOM QUIZ: 3-2-1-GO COUNTDOWN ---
  // Drives the pre-game overlay for a timed custom quiz. Steps are timed to
  // match the four beeps baked into /sounds/timer.mp3 (one per second, at
  // 0/1/2/3s) — so the beep and the number/GO on screen land together.
  useEffect(() => {
    if (view !== 'countdown') return;
    playTimerSound();
    setCountdownStep(3);
    const timeouts = [
      setTimeout(() => setCountdownStep(2), 1000),
      setTimeout(() => setCountdownStep(1), 2000),
      setTimeout(() => setCountdownStep(0), 3000), // 0 renders as "GO"
      setTimeout(() => {
        setView('playing');
        if (activeTimer?.scope === 'quiz') setQuizTimeLeft(activeTimer.seconds);
      }, 3800),
    ];
    return () => timeouts.forEach(clearTimeout);
  }, [view, activeTimer, playTimerSound]);

  // submitAnswer gets a new identity whenever showFeedback toggles (see its
  // own deps below) — unrelated to the per-question timer. Routing calls
  // through a ref means the timer effect only needs to depend on things that
  // actually mean "this is a new question", not every submitAnswer identity
  // change, so it doesn't restart (and visibly flicker) mid-feedback.
  const submitAnswerRef = useRef(submitAnswer);
  useEffect(() => { submitAnswerRef.current = submitAnswer; }, [submitAnswer]);

  // --- CUSTOM QUIZ: PER-QUESTION TIMER ---
  // One self-contained effect per question: resets and starts its own
  // interval, and force-submits a wrong answer when it reaches zero.
  // (Previously this was two separate effects — one resetting the countdown
  // on question change, one ticking it down — which raced: right after
  // handleNext() advanced the index, the ticking effect could still fire
  // with its stale pre-reset closure value of 0 and immediately force-submit
  // the *new* question too, skipping two questions per single timeout.
  // A lone interval with a local `remaining` counter can't read stale state
  // like that, so it can't race with itself.)
  useEffect(() => {
    if (activeTimer?.scope !== 'question' || view !== 'playing') return;
    let remaining = activeTimer.seconds;
    setQuestionTimeLeft(remaining);
    const interval = setInterval(() => {
      remaining -= 1;
      setQuestionTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        // submitAnswerRef.current no-ops if the question was already answered
        // for real (it guards on showFeedback/processingRef), so a timeout
        // firing right as the user answers can't double-submit.
        submitAnswerRef.current(false, null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [currentQuestionIndex, activeTimer, view]);

  // --- CUSTOM QUIZ: PER-QUIZ (TOTAL) TIMER ---
  // One countdown for the whole session; whatever question is still open
  // when it hits zero is simply left unanswered (the results screen already
  // renders unanswered questions as "Skipped"), and the quiz ends immediately.
  useEffect(() => {
    if (activeTimer?.scope !== 'quiz' || view !== 'playing' || isPaused) return;
    if (quizTimeLeft <= 0) {
      setView('results');
      return;
    }
    const id = setTimeout(() => setQuizTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(id);
  }, [activeTimer, view, isPaused, quizTimeLeft]);

  const downloadQuiz = (quiz) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(quiz, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", (quiz.title || "quiz") + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const downloadStats = () => {
    const exportData = {
      user: appUser?.username,
      exportedAt: new Date().toISOString(),
      categoryStats: categoryBreakdown,
      questionStats: stats
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `quiz_stats_${appUser?.username}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  // --- KEYBOARD LISTENER ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Never hijack keys while the user is typing in an input/textarea
      // (the AI help chat box, the AI-graded text-answer field, etc.) —
      // otherwise 1/2/space/enter get "consumed" by the quiz controls too.
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (view !== 'playing' || !displayQ) return;

      const key = e.key;
      const num = parseInt(key, 10);

      // --- SKIP ON ENTER OR SPACE ---
      if (showFeedback) {
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          handleNext();
        }
        return;
      }

      // --- 1. Flashcard Logic ---
      if (displayQ.type === 'text' || displayQ.type === 'text_input') {
        if (!textInputReveal && (key === 'Enter' || key === ' ')) {
          e.preventDefault();
          setTextInputReveal(true);
        } else if (textInputReveal) {
          if (key === '1') submitAnswer(false, "Self-reported: Wrong");
          if (key === '2') submitAnswer(true, "Self-reported: Correct");
        }
        return;
      }

      // --- 2. Multi-Select Logic ---
      if (displayQ.type === 'multiple' || displayQ.type === 'multiple_response') {
        if (key === 'Enter') {
          e.preventDefault();
          submitAnswer(isCorrectArr(multiSelection, displayQ.answer), multiSelection);
          return;
        }
        // Toggle options 1-9
        if (!isNaN(num) && num > 0 && num <= 9) {
          const index = num - 1;
          if (index < displayQ.options.length) {
            toggleSelection(displayQ.options[index]);
          }
        }
        return;
      }

      // --- 3. Single Choice Logic ---
      if (displayQ.type === 'single' || displayQ.type === 'single_choice') {
        if (!isNaN(num) && num > 0 && num <= 9) {
          const index = num - 1;
          if (index < displayQ.options.length) {
            const option = displayQ.options[index];
            const ans = displayQ.answer;
            const isCorrect = Array.isArray(ans) ? ans.includes(option) : ans === option;
            submitAnswer(isCorrect, option);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, displayQ, showFeedback, textInputReveal, multiSelection, submitAnswer, toggleSelection, handleNext]);


  // --- AUTH HANDLERS ---
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError("Please fill in all fields");
      return;
    }

    // Create a virtual email for the username to satisfy Firebase Auth requirements
    // This keeps the UI simple (Username only) but secure (Firebase backend)
    const virtualEmail = `${username.toLowerCase().replace(/\s+/g, '')}@quiz.local`;

    try {
      if (authMode === 'register') {
        const userCredential = await createUserWithEmailAndPassword(auth, virtualEmail, password);
        await updateProfile(userCredential.user, {
          displayName: username
        });
        // onAuthStateChanged fires as soon as the account is created — typically
        // before the updateProfile call above has resolved — so it falls back to
        // the virtual email as the username (see u.displayName || u.email below).
        // Correct both the in-memory state and the persisted user doc now that
        // displayName is actually set, so this session's username (and anything
        // that reads it this session, e.g. leaderboard entries) is right immediately
        // instead of only after the next sign-in.
        setAppUser(prev => prev ? { ...prev, username } : prev);
        await setDoc(doc(db, 'artifacts', appId, 'users', userCredential.user.uid), {
          username
        }, { merge: true });
        // The onAuthStateChanged listener still handles the view redirect.
      } else {
        await signInWithEmailAndPassword(auth, virtualEmail, password);
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError("Username already taken.");
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError("Invalid username or password.");
      } else {
        setError("Authentication failed: " + err.message);
      }
    }
  };

  // --- QUIZ LOGIC & ALGORITHM ---

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        let quizData = [];

        if (Array.isArray(json)) {
          quizData = json;
        } else if (json.questions && Array.isArray(json.questions)) {
          quizData = json.questions;
        } else {
          throw new Error("Invalid structure");
        }

        if (validateQuizData(quizData)) {
          setPendingUpload(quizData);
          setPendingFileName(file.name.replace('.json', ''));
          setShowSaveModal(true);
        } else {
          setError('Invalid JSON format. Needs "question" and "answer" fields.');
        }
      } catch (err) {
        setError('Error parsing JSON or invalid format.');
      }
    };
    reader.readAsText(file);
  };

  const handleSaveQuiz = async (scope) => {
    const processed = pendingUpload.map((q, idx) => ({
      ...q,
      id: q.id ? `${q.id}` : `q_${Math.random().toString(36).substr(2, 9)}`,
      type: q.type || (Array.isArray(q.answer) ? 'multiple' : 'single')
    }));

    if (scope === 'play') {
      generateSmartSession(processed, null);
      setShowSaveModal(false);
      setPendingUpload(null);
      return;
    }

    const quizData = {
      title: pendingFileName,
      icon: selectedIcon,
      modes: selectedModes,
      questions: processed,
      createdAt: new Date().toISOString(),
      author: appUser.username,
      authorId: user.uid
    };

    try {
      let docRef;
      if (scope === 'private') {
        docRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'quizzes'), quizData);
      } else if (scope === 'public') {
        docRef = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'quizzes'), quizData);
      }
      generateSmartSession(processed, docRef.id);
      setShowSaveModal(false);
      setPendingUpload(null);
      setSelectedIcon("BookOpen");
      setSelectedModes([]);
    } catch (e) {
      setError("Failed to save quiz: " + e.message);
    }
  };

  const handleUpdateQuiz = async (e) => {
    e.preventDefault();
    if (!editingQuiz) return;

    try {
      const quizRef = editingQuiz.type === 'private'
        ? doc(db, 'artifacts', appId, 'users', user.uid, 'quizzes', editingQuiz.id)
        : doc(db, 'artifacts', appId, 'public', 'data', 'quizzes', editingQuiz.id);

      await updateDoc(quizRef, {
        title: editTitle,
        icon: selectedIcon,
        modes: selectedModes
      });

      // Update local state to reflect changes immediately
      if (editingQuiz.type === 'private') {
        setPrivateQuizzes(prev => prev.map(q => q.id === editingQuiz.id ? { ...q, title: editTitle, icon: selectedIcon, modes: selectedModes } : q));
      } else {
        setPublicQuizzes(prev => prev.map(q => q.id === editingQuiz.id ? { ...q, title: editTitle, icon: selectedIcon, modes: selectedModes } : q));
      }

      setEditingQuiz(null);
      setSelectedIcon("BookOpen");
      setEditTitle("");
      setSelectedModes([]);
    } catch (e) {
      setError("Failed to update quiz: " + e.message);
    }
  };

  const handleDeleteQuiz = async (quiz) => {
    if (!window.confirm(`Are you sure you want to delete "${quiz.title}"?`)) return;
    try {
      const quizRef = quiz.type === 'private'
        ? doc(db, 'artifacts', appId, 'users', user.uid, 'quizzes', quiz.id)
        : doc(db, 'artifacts', appId, 'public', 'data', 'quizzes', quiz.id);

      await deleteDoc(quizRef);

      // Update local state
      if (quiz.type === 'private') {
        setPrivateQuizzes(prev => prev.filter(q => q.id !== quiz.id));
      } else {
        setPublicQuizzes(prev => prev.filter(q => q.id !== quiz.id));
      }
    } catch (e) {
      setError("Delete failed: " + e.message);
    }
  };

  const validateQuizData = (data) => {
    return Array.isArray(data) && data.length > 0 && data[0].question && (data[0].answer || data[0].options);
  };

  const saveCustomMode = async (label: string, icon: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'modes'), {
        label,
        icon,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      setError("Failed to create mode: " + e.message);
    }
  };

  const generateSmartSession = (allQuestions, quizId = null, sessionSizeOverride: number | null = null, timerConfig: { scope: 'question' | 'quiz'; seconds: number } | null = null) => {
    setActiveQuizQuestions(allQuestions);
    setCurrentQuizId(quizId);

    // Categorize Questions
    const unknowns = [];
    const review = [];
    const dopamine = [];

    allQuestions.forEach(q => {
      const s = stats[q.id];
      if (!s || (s.correct === 0 && s.wrong === 0)) {
        unknowns.push(q);
      } else {
        const total = s.correct + s.wrong;
        const ratio = s.correct / total;

        // Dopamine: High accuracy (>= 70%)
        // Review: Low accuracy
        if (ratio < 0.7) {
          review.push(q);
        } else {
          dopamine.push(q);
        }
      }
    });

    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

    // Base Queue: Mostly Unknowns and Review items
    let baseQueue = [...shuffle(unknowns), ...shuffle(review)];
    let dopaminePool = shuffle(dopamine);

    // If we have no learning items, just play the dopamine hits
    if (baseQueue.length === 0) {
      baseQueue = dopaminePool;
      dopaminePool = []; // Pool empty as we used it all
    }

    // New Algorithm: Sprinkle Dopamine every 4-6 questions
    let finalQueue = [];
    let sinceLastDopamine = 0;
    let nextDopamineTarget = Math.floor(Math.random() * 3) + 4; // Random: 4, 5, or 6

    baseQueue.forEach(q => {
      finalQueue.push(q);
      sinceLastDopamine++;

      // Sprinkle logic
      if (sinceLastDopamine >= nextDopamineTarget && dopaminePool.length > 0) {
        // Insert Dopamine Hit
        finalQueue.push(dopaminePool.pop()); // Take one from pool

        // Reset counters
        sinceLastDopamine = 0;
        nextDopamineTarget = Math.floor(Math.random() * 3) + 4;
      }
    });

    // FIX: Ensure no dopamine hits are left behind if the base queue was short
    if (dopaminePool.length > 0) {
      finalQueue = [...finalQueue, ...dopaminePool];
    }

    // If final queue is still very small and we have dopamine left, maybe add one at start?
    // But standard flow is respected above.

    // Cap the session length (5-10 questions by default) so a run feels quick
    // to finish, rather than grinding through the whole question pool (up to
    // 100) at once. A caller (the custom quiz builder) can override this with
    // an exact count. Capping after the smart ordering above (not before)
    // keeps the pick weighted toward unknowns/review items instead of a flat
    // random sample.
    const sessionSize = Math.min(finalQueue.length, sessionSizeOverride ?? (Math.floor(Math.random() * 6) + 5));
    finalQueue = finalQueue.slice(0, sessionSize);

    setSessionQueue(finalQueue);
    setSessionScore(0);
    setUserAnswers({});
    setCurrentQuestionIndex(0);
    setError('');
    setActiveTimer(timerConfig);
    // A configured timer needs its 3-2-1-GO countdown to play first; plain
    // sessions (no timer) skip straight to the question view as before.
    setView(timerConfig ? 'countdown' : 'playing');

    // Reset Round State
    setShowFeedback(false);
    setTextInputReveal(false);
    setMultiSelection([]);
    setIsPaused(false);
    processingRef.current = false;
    advancingRef.current = false;
  };

  const handleQuickTest = () => {
    const allQuestions = premadeQuizzes.flatMap(q => q.questions || []);

    if (allQuestions.length === 0) {
      setError("No questions available for a quick test! Upload or find some quizzes first.");
      return;
    }

    generateSmartSession(allQuestions, null);
  };

  const handleQuickQuizSession = (quiz) => {
    const questions = quiz.questions || [];
    if (questions.length === 0) return;
    generateSmartSession(questions, quiz.id);
  };

  // --- ADMIN LOGIC ---
  useEffect(() => {
    if (view === 'admin' && appUser?.username === 'liforra') {
      const fetchUsers = async () => {
        try {
          const q = query(collection(db, 'artifacts', appId, 'users'));
          const snap = await getDocs(q);
          setAdminUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
        } catch (e) {
          console.error("Admin fetch error", e);
        }
      };
      fetchUsers();
    }
  }, [view, appUser]);

  const handleAdminUserSelect = async (u) => {
    setSelectedAdminUser(u);
    setSelectedAdminUserData(null);
    try {
      const statsSnap = await getDocs(collection(db, 'artifacts', appId, 'users', u.uid, 'stats'));
      const s = {};
      statsSnap.forEach(d => s[d.id] = d.data());

      const quizzesSnap = await getDocs(collection(db, 'artifacts', appId, 'users', u.uid, 'quizzes'));
      const q = quizzesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const attemptsSnap = await getDocs(collection(db, 'artifacts', appId, 'users', u.uid, 'attempts'));
      const a = attemptsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setSelectedAdminUserData({ stats: s, quizzes: q, attempts: a });
    } catch (e) {
      console.error("Failed to fetch user details", e);
    }
  };


  // --- RENDER HELPERS ---
  const renderSingleChoice = () => (
    <div className="space-y-3">
      {displayQ.options.map((option, idx) => {
        const isSelected = userAnswers[currentQuestionIndex] === option;
        const ans = displayQ.answer;
        const isCorrect = Array.isArray(ans) ? ans.includes(option) : ans === option;
        const optionKey = `${displayQ.id}::${idx}`;

        let style = "border-zinc-200 dark:border-[#2A2633] hover:bg-zinc-50 dark:hover:bg-[#23202B]";
        if (showFeedback) {
          if (isCorrect) style = "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400";
          else if (isSelected && !isCorrect) style = "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400";
          else style = "opacity-50 border-zinc-200 dark:border-[#2A2633]";
        }

        return (
          <div key={idx} className="relative flex items-center gap-2">
            <button
              disabled={showFeedback}
              onClick={() => submitAnswer(isCorrect, option)}
              className={`flex-1 text-left p-4 rounded-xl border-2 transition-all font-medium flex justify-between items-center group ${style}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-6 h-6 flex items-center justify-center rounded text-xs font-mono border transition-colors ${showFeedback ? 'border-transparent opacity-50' :
                  'bg-zinc-100 dark:bg-[#2A2633] text-zinc-500 dark:text-[#9D99A8] border-zinc-200 dark:border-[#2A2633] group-hover:border-purple-300'
                  }`}>
                  {idx + 1}
                </span>
                <span className="dark:text-[#EBE9F0]">{option}</span>
              </div>
              {showFeedback && isCorrect && <CheckCircle size={20} />}
              {showFeedback && isSelected && !isCorrect && <XCircle size={20} />}
            </button>
            {showFeedback && aiEnabled && (
              <button
                onClick={() => setExplainContext({
                  id: optionKey,
                  question: displayQ.question,
                  options: displayQ.options,
                  correctAnswer: displayQ.answer,
                  userAnswer: option,
                  wasCorrect: isCorrect
                })}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-[#23202B] text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                title={t(uiLang, 'whyRightWrong')}
              >
                <HelpCircle size={14} />
              </button>
            )}
            {explainContext?.id === optionKey && (
              <ExplainPopover context={explainContext} onClose={() => setExplainContext(null)} uiLang={uiLang} onAiError={handleAiError} />
            )}
          </div>
        );
      })}
    </div>
  );

  const renderMultiChoice = () => {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {displayQ.options.map((option, idx) => {
            const isSelected = multiSelection.includes(option);
            const isActuallyCorrect = displayQ.answer.includes(option);

            let style = "border-zinc-200 dark:border-[#2A2633]";
            let icon = isSelected ? <CheckSquare size={24} className="text-purple-600 dark:text-purple-400" /> : <Square size={24} className="text-zinc-300 dark:text-[#4A4555]" />;

            if (showFeedback) {
              if (isActuallyCorrect) {
                style = "border-green-500 bg-green-50 dark:bg-green-900/20";
                icon = <CheckCircle size={24} className="text-green-600 dark:text-green-400" />;
              } else if (isSelected && !isActuallyCorrect) {
                style = "border-red-500 bg-red-50 dark:bg-red-900/20";
                icon = <XCircle size={24} className="text-red-500 dark:text-red-400" />;
              } else {
                style = "opacity-50";
              }
            } else if (isSelected) {
              style = "border-purple-500 bg-purple-50 dark:bg-purple-900/20";
            }

            const optionKey = `${displayQ.id}::${idx}`;

            return (
              <div key={idx} className="relative flex items-center gap-2">
                <button
                  disabled={showFeedback}
                  onClick={() => toggleSelection(option)}
                  className={`flex-1 text-left p-4 rounded-xl border-2 transition-all font-medium flex items-center gap-4 group hover:bg-zinc-50 dark:hover:bg-[#23202B] ${style}`}
                >
                  <div className="flex items-center gap-3 w-full">
                    <span className={`w-6 h-6 flex flex-shrink-0 items-center justify-center rounded text-xs font-mono border transition-colors ${showFeedback ? 'border-transparent opacity-50' :
                      'bg-zinc-100 dark:bg-[#2A2633] text-zinc-500 dark:text-[#9D99A8] border-zinc-200 dark:border-[#2A2633] group-hover:border-purple-300'
                      }`}>
                      {idx + 1}
                    </span>
                    {icon}
                    <span className="flex-1 dark:text-[#EBE9F0]">{option}</span>
                  </div>
                </button>
                {showFeedback && aiEnabled && (
                  <button
                    onClick={() => setExplainContext({
                      id: optionKey,
                      question: displayQ.question,
                      options: displayQ.options,
                      correctAnswer: displayQ.answer,
                      userAnswer: option,
                      wasCorrect: isActuallyCorrect
                    })}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-[#23202B] text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                    title={t(uiLang, 'whyRightWrong')}
                  >
                    <HelpCircle size={14} />
                  </button>
                )}
                {explainContext?.id === optionKey && (
                  <ExplainPopover context={explainContext} onClose={() => setExplainContext(null)} uiLang={uiLang} onAiError={handleAiError} />
                )}
              </div>
            );
          })}
        </div>
        {!showFeedback && (
          <button
            onClick={() => submitAnswer(isCorrectArr(multiSelection, displayQ.answer), multiSelection)}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            <span>Submit Answer</span>
            <span className="text-xs bg-purple-500 px-2 py-0.5 rounded text-purple-100 font-mono">Enter</span>
          </button>
        )}
      </div>
    );
  };

  const renderTextChoice = () => (
    <div className="text-center py-8">
      {aiEnabled ? (
        <div className="space-y-4 max-w-md mx-auto">
          <input
            type="text"
            value={textAnswerInput}
            onChange={(e) => setTextAnswerInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitTextAnswer(textAnswerInput); }}
            disabled={showFeedback || gradingAnswer}
            placeholder={t(uiLang, 'typeYourAnswer')}
            autoFocus
            className="w-full px-4 py-3 text-center text-lg bg-zinc-50 dark:bg-[#23202B] border-2 border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all dark:text-white disabled:opacity-60"
          />
          {!showFeedback && (
            <button
              onClick={() => submitTextAnswer(textAnswerInput)}
              disabled={gradingAnswer || !textAnswerInput.trim()}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
            >
              {gradingAnswer ? <><Loader2 size={16} className="animate-spin" /> {t(uiLang, 'grading')}</> : t(uiLang, 'submitAnswerBtn')}
            </button>
          )}
          {showFeedback && (
            <div className="relative inline-flex items-center gap-2">
              <p className="text-sm text-zinc-500 dark:text-[#9D99A8]">
                {t(uiLang, 'correctAnswerLabel')} <span className="font-bold text-zinc-800 dark:text-white">{Array.isArray(displayQ.answer) ? displayQ.answer.join(", ") : displayQ.answer}</span>
              </p>
              {aiEnabled && (
                <button
                  onClick={() => setExplainContext({
                    id: `${displayQ.id}::text`,
                    question: displayQ.question,
                    options: displayQ.options,
                    correctAnswer: displayQ.answer,
                    userAnswer: userAnswers[currentQuestionIndex],
                    wasCorrect: feedbackType === 'correct'
                  })}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-[#23202B] text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                  title={t(uiLang, 'whyRightWrong')}
                >
                  <HelpCircle size={14} />
                </button>
              )}
              {explainContext?.id === `${displayQ.id}::text` && (
                <ExplainPopover context={explainContext} onClose={() => setExplainContext(null)} uiLang={uiLang} onAiError={handleAiError} />
              )}
            </div>
          )}
        </div>
      ) : !textInputReveal ? (
        <div className="space-y-4">
          <button
            onClick={() => setTextInputReveal(true)}
            className="px-8 py-4 bg-zinc-800 dark:bg-[#EBE9F0] text-white dark:text-[#0F0E13] rounded-2xl font-bold text-xl hover:scale-105 transition-transform shadow-lg"
          >
            Show Answer
          </button>
          <p className="text-xs text-zinc-400 dark:text-[#9D99A8] font-mono">Press [Space] or [Enter] to reveal</p>
        </div>
      ) : (
        <div className="animate-in fade-in zoom-in duration-300 space-y-8">
          <div className="p-6 bg-zinc-100 dark:bg-[#23202B] rounded-xl border border-zinc-200 dark:border-[#2A2633]">
            <p className="text-sm uppercase tracking-wider text-zinc-500 dark:text-[#9D99A8] mb-2">Correct Answer</p>
            <div className="text-2xl font-bold text-zinc-800 dark:text-white">
              {Array.isArray(displayQ.answer) ? displayQ.answer.join(", ") : displayQ.answer}
            </div>
            {displayQ.explanation && (
              <p className="mt-4 text-sm text-zinc-600 dark:text-[#9D99A8] italic">"{displayQ.explanation}"</p>
            )}
          </div>

          {!showFeedback && (
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => submitAnswer(false, "Self-reported: Wrong")}
                className="py-4 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 font-bold flex flex-col items-center justify-center gap-1 group"
              >
                <div className="flex items-center gap-2"><XCircle /> I was Wrong</div>
                <span className="text-xs font-mono opacity-50 group-hover:opacity-100">Press [1]</span>
              </button>
              <button
                onClick={() => submitAnswer(true, "Self-reported: Correct")}
                className="py-4 rounded-xl bg-green-100 hover:bg-green-200 text-green-700 font-bold flex flex-col items-center justify-center gap-1 group"
              >
                <div className="flex items-center gap-2"><CheckCircle /> I got it!</div>
                <span className="text-xs font-mono opacity-50 group-hover:opacity-100">Press [2]</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // --- VIEWS ---
  if (view === 'auth') {
    return (
      <div className={`${theme} min-h-screen flex items-center justify-center p-4 transition-colors font-sans relative overflow-hidden`}>
        {/* Background Layer */}
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-[#0F0E13] dark:via-[#15121A] dark:to-[#0F0E13]">
          <div className="absolute top-[-20%] left-[-20%] w-[70%] h-[70%] rounded-full bg-purple-300/30 dark:bg-purple-900/10 blur-[100px] animate-pulse" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[70%] h-[70%] rounded-full bg-indigo-300/30 dark:bg-indigo-900/10 blur-[100px] animate-pulse delay-1000" />
        </div>

        <div className="max-w-md w-full bg-white/80 dark:bg-[#18161F]/80 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/50 dark:border-[#2A2633] relative z-10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white shadow-lg shadow-purple-200 dark:shadow-none">
              <Lock size={32} />
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Quiz Master Access</h1>
            <p className="text-zinc-500 dark:text-[#9D99A8] mt-2 text-sm">Secure storage enabled via Firebase</p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-1">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-3 text-zinc-400" size={20} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                  placeholder="Enter username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-zinc-400" size={20} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                  placeholder="Enter password"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-zinc-400 hover:text-zinc-600">
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">{error}</p>}

            <button type="submit" className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-200 dark:shadow-none mt-4">
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}
              className="text-purple-600 dark:text-purple-400 text-sm font-semibold hover:underline"
            >
              {authMode === 'login' ? "Need an account? Register" : "Have an account? Login"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={theme}>
      <div className="min-h-screen bg-purple-50 dark:bg-[#0F0E13] text-zinc-800 dark:text-[#EBE9F0] transition-colors duration-300 font-sans flex">

        {/* Sidebar */}
        <Sidebar
          view={view}
          setView={setView}
          theme={theme}
          setTheme={setTheme}
          user={user}
          appUser={appUser}
          defaultQuizzes={DEFAULT_QUIZZES}
          privateQuizzes={privateQuizzes}
          publicQuizzes={publicQuizzes}
          onSelectQuiz={(quiz) => generateSmartSession(quiz.questions, quiz.id)}
          onSelectQuickQuiz={handleQuickQuizSession}
          onEditQuiz={(quiz) => {
            setEditingQuiz(quiz);
            setEditTitle(quiz.title);
            setSelectedIcon(quiz.icon || "BookOpen");
            setSelectedModes(quiz.modes || []);
          }}
          onDeleteQuiz={handleDeleteQuiz}
          onLogout={() => auth.signOut()}
          isOpen={isSidebarOpen}
          toggleSidebar={toggleSidebar}
          gravatarUrl={gravatarUrl}
          onOpenSettings={openSettingsModal}
          uiLang={uiLang}
          setUiLang={setUiLang}
          activeMode={activeMode}
          setActiveMode={setActiveMode}
          builtInModes={BUILT_IN_MODES}
          customModes={customModes}
          onCreateMode={saveCustomMode}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">

          {/* Mobile Header */}
          <div className="md:hidden h-14 flex items-center px-4 border-b border-zinc-200 dark:border-[#2A2633] bg-white dark:bg-[#18161F] sticky top-0 z-30">
            <button onClick={toggleSidebar} className="p-2 -ml-2 text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white">
              <Menu size={20} />
            </button>
            <span className="font-bold text-lg ml-2 dark:text-white">FISI Trainer</span>
          </div>

          {aiConfigured && aiRateLimited && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400 text-xs font-medium text-center">
              {t(uiLang, 'aiRateLimited')}
            </div>
          )}

          {/* --- VIEW: DASHBOARD (UPLOAD & SELECT) --- */}
          {view === 'dashboard' && (
            <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">

              {/* ACTIONS: QUICK TEST + CUSTOM QUIZ */}
              <div className="grid sm:grid-cols-2 gap-4 mb-10">
                <button
                  onClick={handleQuickTest}
                  className="py-6 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-2xl shadow-lg shadow-purple-200 dark:shadow-none flex items-center justify-center gap-4 transition-all group"
                >
                  <div className="p-3 bg-white/20 rounded-xl group-hover:scale-110 transition-transform">
                    <Zap size={32} fill="currentColor" />
                  </div>
                  <div className="text-left">
                    <h2 className="text-2xl font-bold">{t(uiLang, 'quickTest')}</h2>
                    <p className="text-purple-100 opacity-90">{t(uiLang, 'quickTestDesc')}</p>
                  </div>
                </button>

                <button
                  onClick={() => { setCustomSelectedQuizIds([]); setShowCustomBuilder(true); }}
                  className="py-6 px-4 bg-white dark:bg-[#18161F] border-2 border-dashed border-zinc-200 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-400 rounded-2xl flex items-center justify-center gap-4 transition-all group"
                >
                  <div className="p-3 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-xl group-hover:scale-110 transition-transform">
                    <Timer size={32} />
                  </div>
                  <div className="text-left">
                    <h2 className="text-2xl font-bold text-zinc-800 dark:text-white">Custom Quiz</h2>
                    <p className="text-zinc-400 text-sm">Pick quizzes, question count &amp; a timer</p>
                  </div>
                </button>
              </div>

              {/* PREMADE QUIZZES (focus of the dashboard) */}
              <h2 className="text-xl font-bold text-zinc-800 dark:text-white mb-4">{t(uiLang, 'premadeQuizzes')}</h2>
              {premadeQuizzes.length === 0 ? (
                <p className="text-sm text-zinc-400 italic mb-10">{t(uiLang, 'noQuizzesInMode')}</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
                  {premadeQuizzes.map(quiz => {
                    const QuizIcon = (quiz.icon && ICON_MAP[quiz.icon]) ? ICON_MAP[quiz.icon] : BookOpen;
                    return (
                      <div key={quiz.id} className="relative group">
                        <button
                          onClick={() => generateSmartSession(quiz.questions, quiz.id)}
                          className="w-full text-left p-5 bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-md transition-all"
                        >
                          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                            <QuizIcon size={20} />
                          </div>
                          <h3 className="font-bold text-zinc-800 dark:text-white truncate pr-6">{quiz.title}</h3>
                          <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
                            {quiz.questions?.length} {t(uiLang, 'questions')}
                            {quiz.type === 'private' && <span className="text-amber-500">• {t(uiLang, 'private')}</span>}
                          </p>
                        </button>
                        <button
                          onClick={() => openLeaderboard(quiz.id)}
                          title="View leaderboard"
                          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-300 hover:text-purple-600 dark:text-zinc-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                        >
                          <Trophy size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* STATS TEASER — full breakdown + trend chart lives on the Statistics page */}
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-zinc-800 dark:text-white">{t(uiLang, 'performanceStats')}</h2>
                <button onClick={downloadStats} className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline bg-purple-50 dark:bg-purple-900/10 px-3 py-1.5 rounded-lg border border-purple-100 dark:border-purple-800/30 transition-all">
                  <Download size={16} /> {t(uiLang, 'exportData')}
                </button>
              </div>
              {(() => {
                const best = pickBestCategory(categoryBreakdown);
                return (
                  <button
                    onClick={() => setView('stats')}
                    className="w-full mb-10 p-5 bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-400 transition-all flex items-center justify-between group text-left"
                  >
                    <div>
                      {best ? (
                        <>
                          <p className="text-xs uppercase tracking-wider text-zinc-400 font-bold mb-1">{t(uiLang, 'bestCategory')}</p>
                          <p className="font-bold text-zinc-800 dark:text-white">{best.name} — {Math.round(best.correct / (best.correct + best.wrong || 1) * 100)}%</p>
                        </>
                      ) : (
                        <p className="text-sm text-zinc-400">{t(uiLang, 'noStatsYet')}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1 text-sm font-semibold text-purple-600 dark:text-purple-400 group-hover:translate-x-1 transition-transform">
                      {t(uiLang, 'viewFullStats')} <ChevronRight size={16} />
                    </span>
                  </button>
                );
              })()}

              {/* UPLOAD / CREATE (secondary) */}
              <h2 className="text-sm font-bold text-zinc-500 dark:text-zinc-400 mb-2 mt-10">{t(uiLang, 'manageLibrary')}</h2>
              <div
                className="bg-white/60 dark:bg-[#18161F]/60 rounded-xl p-4 border border-dashed border-zinc-200 dark:border-[#2A2633] text-center hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all cursor-pointer group flex items-center justify-center gap-3"
                onClick={() => fileInputRef.current?.click()}
              >
                <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                <Upload className="text-zinc-400 group-hover:text-purple-500 transition-colors" size={18} />
                <p className="text-sm text-zinc-500 dark:text-[#9D99A8]"><span className="font-bold text-zinc-700 dark:text-[#EBE9F0]">{t(uiLang, 'uploadQuiz')}</span> — {t(uiLang, 'uploadDesc')}</p>
              </div>
            </div>
          )}

          {/* --- MODAL: SAVE OPTIONS --- */}
          {showSaveModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-[#18161F] w-full max-w-lg rounded-2xl shadow-2xl p-6 border border-zinc-200 dark:border-[#2A2633]">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold dark:text-white">Upload Options</h2>
                  <button onClick={() => setShowSaveModal(false)}><X className="text-zinc-400 hover:text-zinc-600" /></button>
                </div>

                <div className="bg-zinc-50 dark:bg-[#23202B] p-4 rounded-xl mb-6">
                  <p className="font-mono text-sm text-zinc-600 dark:text-[#9D99A8] truncate"><span className="font-bold">File:</span> {pendingFileName}</p>
                  <p className="font-mono text-sm text-zinc-600 dark:text-[#9D99A8] mb-4"><span className="font-bold">Questions:</span> {pendingUpload?.length}</p>

                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Select Icon</p>
                  <div className="grid grid-cols-5 gap-2 max-h-[120px] overflow-y-auto pr-1">
                    {ICON_KEYS.map(key => {
                      const Icon = ICON_MAP[key];
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedIcon(key)}
                          className={`p-2 rounded-lg flex items-center justify-center transition-colors ${selectedIcon === key ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300 ring-2 ring-purple-500' : 'bg-white dark:bg-[#18161F] text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#2A2633]'}`}
                        >
                          <Icon size={20} />
                        </button>
                      )
                    })}
                  </div>

                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 mt-4">Modes</p>
                  <div className="flex flex-wrap gap-2">
                    {[...BUILT_IN_MODES, ...customModes].map(mode => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => toggleSelectedMode(mode.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedModes.includes(mode.id) ? 'bg-purple-600 text-white' : 'bg-white dark:bg-[#18161F] text-zinc-500 border border-zinc-200 dark:border-[#2A2633] hover:border-purple-500'}`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <button onClick={() => handleSaveQuiz('private')} className="w-full p-4 rounded-xl border border-zinc-200 dark:border-[#2A2633] hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-left flex items-center gap-4 transition-all group">
                    <div className="bg-zinc-100 dark:bg-[#23202B] p-3 rounded-lg text-zinc-500 group-hover:text-purple-500 transition-colors"><Lock size={20} /></div>
                    <div>
                      <h3 className="font-bold text-zinc-800 dark:text-white">Save to Private Library</h3>
                      <p className="text-xs text-zinc-500">Only you can access this quiz.</p>
                    </div>
                  </button>

                  <button onClick={() => handleSaveQuiz('public')} className="w-full p-4 rounded-xl border border-zinc-200 dark:border-[#2A2633] hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-left flex items-center gap-4 transition-all group">
                    <div className="bg-zinc-100 dark:bg-[#23202B] p-3 rounded-lg text-zinc-500 group-hover:text-purple-500 transition-colors"><Globe size={20} /></div>
                    <div>
                      <h3 className="font-bold text-zinc-800 dark:text-white">Publish to Community</h3>
                      <p className="text-xs text-zinc-500">Share with other users.</p>
                    </div>
                  </button>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-zinc-200 dark:border-[#2A2633]"></div>
                    <span className="flex-shrink-0 mx-4 text-zinc-400 text-xs uppercase">Or</span>
                    <div className="flex-grow border-t border-zinc-200 dark:border-[#2A2633]"></div>
                  </div>

                  <button onClick={() => handleSaveQuiz('play')} className="w-full py-3 text-zinc-600 dark:text-[#9D99A8] font-medium hover:bg-zinc-100 dark:hover:bg-[#23202B] rounded-xl transition-colors">
                    Don't Save, Just Play
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --- VIEW: STATISTICS --- */}
          {view === 'stats' && (
            <div className="p-4 md:p-8 max-w-4xl mx-auto w-full">
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{t(uiLang, 'statistics')}</h1>
                <button onClick={() => setView('dashboard')} className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white text-sm font-medium">Exit</button>
              </div>
              <StatsPanel statsMap={stats} attempts={attempts} quizzes={[...DEFAULT_QUIZZES, ...privateQuizzes, ...publicQuizzes]} uiLang={uiLang} />
            </div>
          )}

          {/* --- VIEW: PLAYING --- */}
          {view === 'playing' && displayQ && (
            <div className="min-h-full flex flex-col items-center p-4 py-10">
              <div className="max-w-2xl w-full">
                {/* Header */}
                <div className="flex justify-between items-end mb-4 px-1">
                  <div>
                    <h2 className="text-zinc-500 dark:text-[#9D99A8] text-sm font-semibold uppercase tracking-wider">
                      Question {currentQuestionIndex + 1} of {sessionQueue.length}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${displayQ.type.includes('multiple') ? 'border-purple-200 text-purple-600 bg-purple-50' :
                        displayQ.type.includes('text') ? 'border-blue-200 text-blue-600 bg-blue-50' :
                          'border-zinc-200 text-zinc-600 bg-zinc-50'
                        }`}>
                        {displayQ.type.includes('multiple') ? 'Multi-Select' : displayQ.type.includes('text') ? 'Flashcard' : 'Single Choice'}
                      </span>

                      {displayQ.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-600 bg-purple-50 truncate max-w-[150px]">
                          {displayQ.category}
                        </span>
                      )}

                      {/* Algorithm Tag */}
                      {stats[displayQ.id] && (stats[displayQ.id].correct / (stats[displayQ.id].correct + stats[displayQ.id].wrong) < 0.7) && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-orange-200 text-orange-600 bg-orange-50 flex items-center gap-1">
                          <RotateCcw size={10} /> Review
                        </span>
                      )}
                      {!stats[displayQ.id] && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-green-200 text-green-600 bg-green-50 flex items-center gap-1">
                          New
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {activeTimer?.scope === 'question' && (
                      <span className={`flex items-center gap-1 text-sm font-bold tabular-nums px-2.5 py-1 rounded-lg ${questionTimeLeft <= 5 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-[#23202B]'}`}>
                        <Timer size={14} /> {questionTimeLeft}s
                      </span>
                    )}
                    {activeTimer?.scope === 'quiz' && (
                      <span className={`flex items-center gap-1 text-sm font-bold tabular-nums px-2.5 py-1 rounded-lg ${quizTimeLeft <= 10 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-[#23202B]'}`}>
                        <Timer size={14} /> {Math.floor(quizTimeLeft / 60)}:{String(quizTimeLeft % 60).padStart(2, '0')}
                      </span>
                    )}
                    <button onClick={() => setView('dashboard')} className="text-zinc-400 hover:text-red-500 text-xs font-medium">Exit</button>
                  </div>
                </div>

                <div className="w-full bg-purple-200 dark:bg-[#23202B] h-2 rounded-full mb-6 overflow-hidden">
                  <div className="bg-purple-600 dark:bg-purple-500 h-full transition-all duration-300 ease-out" style={{ width: `${((currentQuestionIndex + 1) / sessionQueue.length) * 100}%` }}></div>
                </div>

                {/* Card */}
                <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-xl p-6 md:p-10 border border-zinc-100 dark:border-[#2A2633] min-h-[400px] flex flex-col relative">
                  <div className="flex items-start justify-between">
                    <h3 className="text-2xl font-bold text-zinc-800 dark:text-white mb-8 leading-snug">{displayQ.question}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="hidden md:flex text-zinc-300 dark:text-zinc-600" title="Keyboard Shortcuts Enabled">
                        <Keyboard size={20} />
                      </div>
                      {aiEnabled && (
                        <button
                          onClick={() => setHelpChatQuestion(displayQ)}
                          className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-[#23202B] text-zinc-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-sm font-bold"
                          title={t(uiLang, 'needHint')}
                        >
                          <HelpCircle size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex-grow z-10">
                    {(displayQ.type === 'single' || displayQ.type === 'single_choice') && renderSingleChoice()}
                    {(displayQ.type === 'multiple' || displayQ.type === 'multiple_response') && renderMultiChoice()}
                    {(displayQ.type === 'text' || displayQ.type === 'text_input') && renderTextChoice()}
                  </div>

                  {/* Feedback Footer */}
                  {showFeedback && (
                    <div className="mt-8 pt-6 border-t border-zinc-100 dark:border-[#2A2633] animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {feedbackType === 'correct' ? (
                            <span className="text-green-600 dark:text-green-400 font-bold flex items-center gap-2"><CheckCircle size={18} /> Correct!</span>
                          ) : (
                            <span className="text-red-600 dark:text-red-400 font-bold flex items-center gap-2"><XCircle size={18} /> Incorrect</span>
                          )}

                          {!isPaused && (
                            <div className="flex items-center gap-2 text-zinc-500 dark:text-[#9D99A8] text-sm ml-4 border-l border-zinc-200 dark:border-[#2A2633] pl-4">
                              <Timer size={16} className="animate-pulse" />
                              <span>Next in {countdown}s</span>
                              <span className="text-xs bg-zinc-100 dark:bg-[#23202B] px-1.5 py-0.5 rounded border border-zinc-300 dark:border-[#2A2633] font-mono">Space</span>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          {!isPaused && currentQuestionIndex < sessionQueue.length - 1 && (
                            <button onClick={() => setIsPaused(true)} className="px-4 py-2 bg-zinc-100 dark:bg-[#23202B] hover:bg-zinc-200 text-zinc-600 dark:text-[#9D99A8] rounded-lg text-sm font-semibold flex items-center gap-2">
                              <Pause size={16} /> Wait
                            </button>
                          )}
                          <button onClick={handleNext} className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 shadow-lg shadow-purple-200 dark:shadow-none">
                            {currentQuestionIndex === sessionQueue.length - 1 ? 'Finish' : 'Next'} <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                      {!isPaused && currentQuestionIndex < sessionQueue.length - 1 && (
                        <div className="h-1 bg-zinc-100 dark:bg-[#23202B] mt-4 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 transition-all duration-1000 ease-linear" style={{ width: `${(countdown / (feedbackType === 'correct' ? 2 : 5)) * 100}%` }}></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {aiEnabled && !helpChatQuestion && (
                <button
                  onClick={() => setHelpChatQuestion(displayQ)}
                  className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-xl shadow-purple-500/20 font-bold text-sm transition-all hover:scale-105"
                >
                  <MessageCircle size={18} /> {t(uiLang, 'help')}
                </button>
              )}
            </div>
          )}

          {/* --- VIEW: RESULTS --- */}
          {view === 'results' && (
            <div className="min-h-screen flex items-start justify-center p-4 py-12">
              <div className="max-w-3xl w-full bg-white dark:bg-[#18161F] rounded-3xl shadow-2xl overflow-hidden border border-zinc-100 dark:border-[#2A2633]">
                <div className="bg-purple-600 dark:bg-purple-700 p-10 text-center text-white relative">
                  <Award className="mx-auto mb-4 opacity-90" size={48} />
                  <h2 className="text-4xl font-bold mb-2">{Math.round((sessionScore / sessionQueue.length) * 100)}%</h2>
                  <p className="text-purple-200 font-medium text-lg">Good job, {appUser?.username}!</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <span className="bg-purple-800/50 px-3 py-1 rounded-full text-xs flex items-center gap-1"><Save size={12} /> Stats Updated</span>
                  </div>
                </div>

                <div className="p-8 bg-purple-50 dark:bg-[#23202B]">
                  <h3 className="text-zinc-800 dark:text-white font-bold text-lg mb-6">Session Review</h3>
                  <div className="space-y-4">
                    {sessionQueue.map((rawQ, index) => {
                      // Resolve through the same language as gameplay used, so the comparison
                      // matches whatever text/options were actually shown and submitted.
                      const q = resolveQuestionLang(rawQ, uiLang);
                      const ans = userAnswers[index];
                      let isCorrect = false;

                      if (q.type.includes('multiple')) {
                        // Array exact match
                        isCorrect = Array.isArray(q.answer) && Array.isArray(ans) &&
                          ans.length === q.answer.length &&
                          ans.every(a => q.answer.includes(a));
                      } else if (q.type.includes('text')) {
                        // Self reported
                        isCorrect = ans && ans.includes('Correct');
                      } else {
                        // Single choice (flexible)
                        isCorrect = Array.isArray(q.answer) ? q.answer.includes(ans) : ans === q.answer;
                      }

                      return (
                        <div key={index} className="bg-white dark:bg-[#18161F] p-5 rounded-xl border border-zinc-200 dark:border-[#2A2633] shadow-sm flex items-center gap-4">
                          <div className={isCorrect ? "text-green-500" : "text-red-500"}>
                            {isCorrect ? <CheckCircle /> : <XCircle />}
                          </div>
                          <div>
                            <p className="font-semibold text-zinc-800 dark:text-[#EBE9F0]">{q.question}</p>
                            <p className="text-xs text-zinc-500 mt-1">
                              {Array.isArray(ans) ? ans.join(", ") : ans || "Skipped"}
                            </p>
                            {q.explanation && !isCorrect && (
                              <p className="text-xs text-zinc-400 mt-2 italic bg-zinc-50 dark:bg-[#23202B] p-2 rounded">Note: {q.explanation}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="p-6 bg-white dark:bg-[#18161F] border-t border-zinc-100 dark:border-[#2A2633] flex flex-wrap justify-center gap-3">
                  <button onClick={() => setView('dashboard')} className="flex items-center gap-2 px-8 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors">
                    <RotateCcw size={18} /> Back to Dashboard
                  </button>
                  {currentQuizId && (
                    <button onClick={() => openLeaderboard(currentQuizId)} className="flex items-center gap-2 px-8 py-3 bg-zinc-100 dark:bg-[#23202B] text-zinc-700 dark:text-white rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-[#2A2633] transition-colors">
                      <Trophy size={18} /> View Leaderboard
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* --- VIEW: LEADERBOARD --- */}
          {view === 'leaderboard' && leaderboardQuizId && (
            <Leaderboard
              db={db}
              appId={appId}
              quizId={leaderboardQuizId}
              quizTitle={leaderboardQuizTitle}
              currentUserId={user.uid}
              hideFromLeaderboard={!!appUser?.hideFromLeaderboard}
              onBack={() => setView('dashboard')}
            />
          )}

          {/* --- VIEW: ADMIN --- */}
          {view === 'admin' && appUser?.username === 'liforra' && (
            <div className="min-h-screen p-8 max-w-6xl mx-auto">
              <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                  <Shield className="text-red-500" /> Admin Dashboard
                </h1>
                <button onClick={() => setView('dashboard')} className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white">Exit</button>
              </div>

              <div className="grid md:grid-cols-3 gap-8">
                {/* User List */}
                <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633] overflow-hidden">
                  <div className="p-4 border-b border-zinc-100 dark:border-[#2A2633] bg-zinc-50 dark:bg-[#23202B]">
                    <h2 className="font-bold text-zinc-700 dark:text-white">Users</h2>
                  </div>
                  <div className="overflow-y-auto max-h-[600px]">
                    {adminUsers.map(u => (
                      <button
                        key={u.uid}
                        onClick={() => handleAdminUserSelect(u)}
                        className={`w-full text-left p-4 border-b border-zinc-100 dark:border-[#2A2633] hover:bg-zinc-50 dark:hover:bg-[#23202B] transition-colors ${selectedAdminUser?.uid === u.uid ? 'bg-purple-50 dark:bg-purple-900/20 border-l-4 border-l-purple-500' : ''}`}
                      >
                        <p className="font-bold text-zinc-800 dark:text-white">{u.username || "Unknown"}</p>
                        <p className="text-xs text-zinc-400 font-mono truncate">{u.uid}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Details */}
                <div className="md:col-span-2 space-y-6">
                  {selectedAdminUser ? (
                    <>
                      <div className="bg-white dark:bg-[#18161F] p-6 rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633]">
                        <h2 className="text-xl font-bold mb-4 dark:text-white">Stats for {selectedAdminUser.username}</h2>
                        {selectedAdminUserData ? (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
                              <p className="text-sm text-green-600 dark:text-green-400 font-bold uppercase">Questions Played</p>
                              <p className="text-3xl font-bold text-zinc-800 dark:text-white">{Object.keys(selectedAdminUserData.stats).length}</p>
                            </div>
                            <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                              <p className="text-sm text-purple-600 dark:text-purple-400 font-bold uppercase">Private Quizzes</p>
                              <p className="text-3xl font-bold text-zinc-800 dark:text-white">{selectedAdminUserData.quizzes.length}</p>
                            </div>
                          </div>
                        ) : <p>Loading data...</p>}
                      </div>

                      {selectedAdminUserData && (
                        <div className="bg-white dark:bg-[#18161F] p-6 rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633]">
                          <h2 className="text-xl font-bold mb-4 dark:text-white">Statistics</h2>
                          <StatsPanel
                            statsMap={selectedAdminUserData.stats}
                            attempts={selectedAdminUserData.attempts}
                            quizzes={[...DEFAULT_QUIZZES, ...selectedAdminUserData.quizzes, ...publicQuizzes]}
                            uiLang={uiLang}
                          />
                        </div>
                      )}

                      {selectedAdminUserData && (
                        <div className="bg-white dark:bg-[#18161F] p-6 rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633]">
                          <h2 className="text-xl font-bold mb-4 dark:text-white">Private Quizzes</h2>
                          <div className="space-y-3">
                            {selectedAdminUserData.quizzes.map(q => (
                              <div key={q.id} className="p-4 border border-zinc-200 dark:border-[#2A2633] rounded-xl">
                                <h3 className="font-bold dark:text-white">{q.title}</h3>
                                <p className="text-xs text-zinc-500">{q.questions.length} questions • {q.createdAt}</p>
                                <button onClick={() => downloadQuiz(q)} className="mt-2 text-xs text-purple-600 hover:underline">Download JSON</button>
                              </div>
                            ))}
                            {selectedAdminUserData.quizzes.length === 0 && <p className="text-zinc-400 italic">No private quizzes.</p>}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-400">
                      Select a user to view details
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- MODAL: EDIT QUIZ --- */}
      {editingQuiz && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#18161F] w-full max-w-md rounded-2xl shadow-2xl p-6 border border-zinc-200 dark:border-[#2A2633]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Edit Quiz</h2>
              <button onClick={() => setEditingQuiz(null)}><X className="text-zinc-400 hover:text-zinc-600" /></button>
            </div>

            <form onSubmit={handleUpdateQuiz} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-1">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                  placeholder="Enter quiz title"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-2">Icon</label>
                <div className="grid grid-cols-5 gap-2 max-h-[120px] overflow-y-auto pr-1">
                  {ICON_KEYS.map(key => {
                    const Icon = ICON_MAP[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedIcon(key)}
                        className={`p-2 rounded-lg flex items-center justify-center transition-colors ${selectedIcon === key ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300 ring-2 ring-purple-500' : 'bg-white dark:bg-[#18161F] text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#2A2633]'}`}
                      >
                        <Icon size={20} />
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-2">Modes</label>
                <div className="flex flex-wrap gap-2">
                  {[...BUILT_IN_MODES, ...customModes].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => toggleSelectedMode(mode.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedModes.includes(mode.id) ? 'bg-purple-600 text-white' : 'bg-white dark:bg-[#18161F] text-zinc-500 border border-zinc-200 dark:border-[#2A2633] hover:border-purple-500'}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditingQuiz(null)} className="flex-1 py-3 text-zinc-600 dark:text-[#9D99A8] font-medium hover:bg-zinc-100 dark:hover:bg-[#23202B] rounded-xl transition-colors">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-200 dark:shadow-none">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: SETTINGS --- */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#18161F] w-full max-w-md rounded-2xl shadow-2xl p-6 border border-zinc-200 dark:border-[#2A2633]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Profile Settings</h2>
              <button onClick={() => setShowSettingsModal(false)}><X className="text-zinc-400 hover:text-zinc-600" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-1">Gravatar Email</label>
                <input
                  type="email"
                  value={gravatarEmailInput}
                  onChange={(e) => setGravatarEmailInput(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                  placeholder="you@example.com"
                />
                <p className="text-xs text-zinc-400 mt-2">Uses your <a href="https://gravatar.com" target="_blank" rel="noreferrer" className="underline hover:text-purple-500">Gravatar</a> picture as your profile avatar. Leave empty to keep the default avatar.</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!hideFromLeaderboardInput}
                  onChange={(e) => setHideFromLeaderboardInput(!e.target.checked)}
                  className="mt-1 h-4 w-4 accent-purple-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-700 dark:text-white">Show me on leaderboards</span>
                  <span className="block text-xs text-zinc-400 mt-0.5">When off, your scores are still saved but never shown on any quiz's leaderboard.</span>
                </span>
              </label>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowSettingsModal(false)} className="flex-1 py-3 text-zinc-600 dark:text-[#9D99A8] font-medium hover:bg-zinc-100 dark:hover:bg-[#23202B] rounded-xl transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={saveProfileSettings} className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-200 dark:shadow-none">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: CUSTOM QUIZ BUILDER --- */}
      {showCustomBuilder && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#18161F] w-full max-w-lg rounded-2xl shadow-2xl p-6 border border-zinc-200 dark:border-[#2A2633] max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold dark:text-white">Custom Quiz</h2>
              <button onClick={() => setShowCustomBuilder(false)}><X className="text-zinc-400 hover:text-zinc-600" /></button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-2">Include quizzes</label>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {allQuizzesFlat.map(quiz => (
                    <label key={quiz.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-[#23202B] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customSelectedQuizIds.includes(quiz.id)}
                        onChange={() => toggleCustomQuiz(quiz.id)}
                        className="h-4 w-4 accent-purple-600"
                      />
                      <span className="text-sm text-zinc-700 dark:text-white truncate flex-1">{quiz.title}</span>
                      <span className="text-xs text-zinc-400">{quiz.questions?.length || 0}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-zinc-400 dark:text-[#9D99A8] mb-1">Number of questions</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(customPoolSize, 1)}
                  value={customQuestionCount}
                  onChange={(e) => setCustomQuestionCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                />
                <p className="text-xs text-zinc-400 mt-1">{customPoolSize} question{customPoolSize === 1 ? '' : 's'} available in the selected quizzes.</p>
              </div>

              <div>
                <label className="flex items-center gap-3 cursor-pointer select-none mb-3">
                  <input
                    type="checkbox"
                    checked={customTimerEnabled}
                    onChange={(e) => setCustomTimerEnabled(e.target.checked)}
                    className="h-4 w-4 accent-purple-600"
                  />
                  <span className="text-sm font-semibold text-zinc-700 dark:text-white">Time limit</span>
                </label>

                {customTimerEnabled && (
                  <div className="pl-1 space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCustomTimerScope('question')}
                        className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${customTimerScope === 'question' ? 'bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-zinc-400'}`}
                      >
                        Per question
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomTimerScope('quiz')}
                        className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${customTimerScope === 'quiz' ? 'bg-purple-600 text-white' : 'bg-zinc-100 dark:bg-[#23202B] text-zinc-500 dark:text-zinc-400'}`}
                      >
                        Per whole quiz
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={customTimerSeconds}
                        onChange={(e) => setCustomTimerSeconds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-24 px-3 py-2 bg-zinc-50 dark:bg-[#23202B] border border-zinc-200 dark:border-[#2A2633] rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all dark:text-white"
                      />
                      <span className="text-sm text-zinc-500 dark:text-[#9D99A8]">
                        {customTimerScope === 'question' ? 'seconds per question' : 'minutes for the whole quiz'}
                      </span>
                    </div>
                    {customTimerScope === 'question' && (
                      <p className="text-xs text-zinc-400">Running out of time on a question auto-submits it as wrong.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCustomBuilder(false)} className="flex-1 py-3 text-zinc-600 dark:text-[#9D99A8] font-medium hover:bg-zinc-100 dark:hover:bg-[#23202B] rounded-xl transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={startCustomQuiz}
                  disabled={customPoolSize === 0}
                  className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-200 dark:shadow-none"
                >
                  Start
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- VIEW: COUNTDOWN (3-2-1-GO before a timed custom quiz) --- */}
      {view === 'countdown' && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center">
          <span className="text-white font-black text-9xl tabular-nums animate-in zoom-in duration-300" key={countdownStep}>
            {countdownStep === 0 ? 'GO' : countdownStep}
          </span>
        </div>
      )}

      <HelpChat question={helpChatQuestion} onClose={() => setHelpChatQuestion(null)} uiLang={uiLang} onAiError={handleAiError} />
    </div>
  );
}
