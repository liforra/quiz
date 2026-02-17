import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Upload, FileJson, Play, CheckCircle, XCircle, ChevronRight, RotateCcw, Award, AlertCircle, Moon, Sun, Pause, Timer, Lock, User, Eye, EyeOff, Save, CheckSquare, Square, Keyboard, Globe, Shield, X, BarChart2, TrendingUp, TrendingDown, Download } from 'lucide-react';

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
  updateDoc,
  query,
  getDocs
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

// --- UTILS ---
// Helper for multi-select validation
const isCorrectArr = (arr1, arr2) => {
  if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, index) => val === sorted2[index]);
};

const SAMPLE_QUIZ = [
  {
    id: "q1",
    type: "single",
    category: "Biology",
    question: "What is the powerhouse of the cell?",
    options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi Apparatus"],
    answer: "Mitochondria"
  },
  {
    id: "q2",
    type: "multiple",
    category: "Computer Science",
    question: "Select the colors in the RGB model (Select all that apply)",
    options: ["Red", "Cyan", "Green", "Yellow", "Blue"],
    answer: ["Red", "Green", "Blue"]
  },
  {
    id: "q3",
    type: "text",
    category: "Web Development",
    question: "What does DOM stand for?",
    answer: "Document Object Model"
  },
  {
    id: "q4",
    type: "single",
    category: "Web Development",
    question: "Which hook handles side effects?",
    options: ["useState", "useEffect", "useMemo"],
    answer: "useEffect"
  }
];

export default function App() {
  // --- STATE ---
  const [theme, setTheme] = useState('dark');
  const [view, setView] = useState('auth'); // auth, dashboard, playing, results
  const [user, setUser] = useState(null);
  const [appUser, setAppUser] = useState(null);

  // Library Data
  const [privateQuizzes, setPrivateQuizzes] = useState([]);
  const [publicQuizzes, setPublicQuizzes] = useState([]);

  // Stats Data
  const [currentQuizId, setCurrentQuizId] = useState(null);
  const [globalStats, setGlobalStats] = useState({}); // Legacy/Global stats
  const [currentQuizStats, setCurrentQuizStats] = useState({}); // Current active quiz stats
  // Effective stats: Quiz stats override global stats (Forking pattern for legacy compatibility)
  const stats = useMemo(() => ({ ...globalStats, ...currentQuizStats }), [globalStats, currentQuizStats]);

  const [categoryStats, setCategoryStats] = useState({}); // Category stats

  // Quiz Data
  const [activeQuizQuestions, setActiveQuizQuestions] = useState([]); // The full pool
  const [sessionQueue, setSessionQueue] = useState([]); // The smart queue for this run
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQData, setCurrentQData] = useState(null);

  // Upload State
  const [pendingUpload, setPendingUpload] = useState(null);
  const [pendingFileName, setPendingFileName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  // Gameplay State
  const [userAnswers, setUserAnswers] = useState({});
  const [sessionScore, setSessionScore] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

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

  // Admin State
  const [adminUsers, setAdminUsers] = useState([]);
  const [selectedAdminUser, setSelectedAdminUser] = useState(null);
  const [selectedAdminUserData, setSelectedAdminUserData] = useState(null);

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

    // 1. Sync User Stats (Questions)
    const statsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'stats');
    const unsubStats = onSnapshot(statsRef, (snapshot) => {
      const newStats = {};
      snapshot.forEach(doc => {
        newStats[doc.id] = doc.data();
      });
      setGlobalStats(newStats);
    }, (err) => console.error("Stats sync error", err));

    // 2. Sync Category Stats
    const catStatsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'category_stats');
    const unsubCatStats = onSnapshot(catStatsRef, (snapshot) => {
      const newCatStats = {};
      snapshot.forEach(doc => {
        newCatStats[doc.id] = doc.data();
      });
      setCategoryStats(newCatStats);
    }, (err) => console.error("Category stats sync error", err));

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

    return () => {
      unsubStats();
      unsubCatStats();
      unsubPrivate();
      unsubPublic();
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
    if (showFeedback) return;

    // Update Session State
    const currentQ = sessionQueue[currentQuestionIndex];
    setUserAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: answerValue
    }));

    if (isCorrect) setSessionScore(s => s + 1);

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
        await setDoc(statRef, {
          correct: increment(isCorrect ? 1 : 0),
          wrong: increment(isCorrect ? 0 : 1),
          lastPlayed: new Date().toISOString()
        }, { merge: true });

        // 2. Update Category Stats (If category exists)
        if (currentQ.category) {
          // Use safe slugification instead of btoa
          const catId = currentQ.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'misc';
          const catRef = doc(db, 'artifacts', appId, 'users', user.uid, 'category_stats', catId);
          await setDoc(catRef, {
            name: currentQ.category,
            correct: increment(isCorrect ? 1 : 0),
            wrong: increment(isCorrect ? 0 : 1),
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        }
      } catch (e) {
        console.error("Failed to save stats", e);
      }
    }

    // Trigger Feedback UI
    setFeedbackType(isCorrect ? 'correct' : 'wrong');
    setShowFeedback(true);
    setCountdown(isCorrect ? 2 : 5);
  }, [showFeedback, sessionQueue, currentQuestionIndex, user, appUser]);

  const handleNext = useCallback(() => {
    if (currentQuestionIndex < sessionQueue.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setCurrentQData(sessionQueue[currentQuestionIndex + 1]);
      setShowFeedback(false);
      setTextInputReveal(false);
      setMultiSelection([]);
      setIsPaused(false);
    } else {
      setView('results');
    }
  }, [currentQuestionIndex, sessionQueue]);

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
      categoryStats: categoryStats,
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
      if (view !== 'playing' || !currentQData) return;

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
      if (currentQData.type === 'text' || currentQData.type === 'text_input') {
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
      if (currentQData.type === 'multiple' || currentQData.type === 'multiple_response') {
        if (key === 'Enter') {
          e.preventDefault();
          submitAnswer(isCorrectArr(multiSelection, currentQData.answer), multiSelection);
          return;
        }
        // Toggle options 1-9
        if (!isNaN(num) && num > 0 && num <= 9) {
          const index = num - 1;
          if (index < currentQData.options.length) {
            toggleSelection(currentQData.options[index]);
          }
        }
        return;
      }

      // --- 3. Single Choice Logic ---
      if (currentQData.type === 'single' || currentQData.type === 'single_choice') {
        if (!isNaN(num) && num > 0 && num <= 9) {
          const index = num - 1;
          if (index < currentQData.options.length) {
            const option = currentQData.options[index];
            const ans = currentQData.answer;
            const isCorrect = Array.isArray(ans) ? ans.includes(option) : ans === option;
            submitAnswer(isCorrect, option);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, currentQData, showFeedback, textInputReveal, multiSelection, submitAnswer, toggleSelection, handleNext]);


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
        // The onAuthStateChanged listener will handle the redirect and state updates
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
      questions: processed,
      createdAt: new Date().toISOString(),
      author: appUser.username
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
    } catch (e) {
      setError("Failed to save quiz: " + e.message);
    }
  };

  const validateQuizData = (data) => {
    return Array.isArray(data) && data.length > 0 && data[0].question && (data[0].answer || data[0].options);
  };

  const generateSmartSession = (allQuestions, quizId = null) => {
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

    setSessionQueue(finalQueue);
    setSessionScore(0);
    setUserAnswers({});
    setCurrentQuestionIndex(0);
    setCurrentQData(finalQueue[0]);
    setView('playing');
    setError('');

    // Reset Round State
    setShowFeedback(false);
    setTextInputReveal(false);
    setMultiSelection([]);
    setIsPaused(false);
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
          
          setSelectedAdminUserData({ stats: s, quizzes: q });
      } catch (e) {
          console.error("Failed to fetch user details", e);
      }
  };

  // --- COMPONENT: STATS DASHBOARD ---
  const StatsOverview = () => {
    const cats = Object.values(categoryStats);
    if (cats.length === 0) return null;

    const sorted = [...cats].sort((a, b) => {
      const rateA = a.correct / (a.correct + a.wrong);
      const rateB = b.correct / (b.correct + b.wrong);
      return rateB - rateA;
    });

    const top = sorted.slice(0, 3).filter(c => (c.correct + c.wrong) > 0);
    const bottom = sorted.reverse().slice(0, 3).filter(c => (c.correct / (c.correct + c.wrong)) < 0.8);

    return (
      <div className="grid md:grid-cols-2 gap-6 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-white dark:bg-[#18161F] p-6 rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633]">
          <h3 className="flex items-center gap-2 font-bold text-zinc-800 dark:text-white mb-4">
            <TrendingUp className="text-green-500" size={20} /> Top Strengths
          </h3>
          <div className="space-y-3">
            {top.length === 0 ? <p className="text-sm text-zinc-400">Play more to see stats!</p> : top.map(c => (
              <div key={c.name} className="flex justify-between items-center">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 truncate w-2/3" title={c.name}>{c.name}</span>
                <span className="text-xs font-bold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-full">
                  {Math.round((c.correct / (c.correct + c.wrong)) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-[#18161F] p-6 rounded-2xl shadow-sm border border-zinc-100 dark:border-[#2A2633]">
          <h3 className="flex items-center gap-2 font-bold text-zinc-800 dark:text-white mb-4">
            <TrendingDown className="text-orange-500" size={20} /> Focus Areas
          </h3>
          <div className="space-y-3">
            {bottom.length === 0 ? <p className="text-sm text-zinc-400">No weak spots found yet!</p> : bottom.map(c => (
              <div key={c.name} className="flex justify-between items-center">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 truncate w-2/3" title={c.name}>{c.name}</span>
                <span className="text-xs font-bold text-orange-600 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded-full">
                  {Math.round((c.correct / (c.correct + c.wrong)) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // --- RENDER HELPERS ---
  const renderSingleChoice = () => (
    <div className="space-y-3">
      {currentQData.options.map((option, idx) => {
        const isSelected = userAnswers[currentQuestionIndex] === option;
        const ans = currentQData.answer;
        const isCorrect = Array.isArray(ans) ? ans.includes(option) : ans === option;

        let style = "border-zinc-200 dark:border-[#2A2633] hover:bg-zinc-50 dark:hover:bg-[#23202B]";
        if (showFeedback) {
          if (isCorrect) style = "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400";
          else if (isSelected && !isCorrect) style = "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400";
          else style = "opacity-50 border-zinc-200 dark:border-[#2A2633]";
        }

        return (
          <button
            key={idx}
            disabled={showFeedback}
            onClick={() => submitAnswer(isCorrect, option)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all font-medium flex justify-between items-center group relative ${style}`}
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
        );
      })}
    </div>
  );

  const renderMultiChoice = () => {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {currentQData.options.map((option, idx) => {
            const isSelected = multiSelection.includes(option);
            const isActuallyCorrect = currentQData.answer.includes(option);

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

            return (
              <button
                key={idx}
                disabled={showFeedback}
                onClick={() => toggleSelection(option)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all font-medium flex items-center gap-4 group hover:bg-zinc-50 dark:hover:bg-[#23202B] ${style}`}
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
            );
          })}
        </div>
        {!showFeedback && (
          <button
            onClick={() => submitAnswer(isCorrectArr(multiSelection, currentQData.answer), multiSelection)}
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
      {!textInputReveal ? (
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
              {Array.isArray(currentQData.answer) ? currentQData.answer.join(", ") : currentQData.answer}
            </div>
            {currentQData.explanation && (
              <p className="mt-4 text-sm text-zinc-600 dark:text-[#9D99A8] italic">"{currentQData.explanation}"</p>
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
      <div className="min-h-screen bg-purple-50 dark:bg-[#0F0E13] text-zinc-800 dark:text-[#EBE9F0] transition-colors duration-300 font-sans">

        {/* --- VIEW: DASHBOARD (UPLOAD & SELECT) --- */}
        {view === 'dashboard' && (
          <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Welcome, {appUser?.username}</h1>
                <p className="text-zinc-500 dark:text-[#9D99A8]">Manage your quizzes and track progress.</p>
              </div>
              <div className="flex gap-2">
                {appUser?.username === 'liforra' && (
                  <button onClick={() => setView('admin')} className="p-3 bg-red-100 dark:bg-red-900/20 rounded-xl shadow-sm hover:scale-105 transition-all text-red-600 dark:text-red-400" title="Admin Dashboard"><Shield size={20} /></button>
                )}
                <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="p-3 bg-white dark:bg-[#18161F] rounded-xl shadow-sm hover:scale-105 transition-all text-zinc-600 dark:text-[#9D99A8]"><Sun size={20} /></button>
                <button onClick={() => setView('auth')} className="p-3 bg-white dark:bg-[#18161F] rounded-xl shadow-sm hover:scale-105 transition-all text-red-500"><User size={20} /></button>
              </div>
            </div>

            {/* STATS OVERVIEW */}
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-zinc-800 dark:text-white">Performance Stats</h2>
              <button onClick={downloadStats} className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:underline bg-purple-50 dark:bg-purple-900/10 px-3 py-1.5 rounded-lg border border-purple-100 dark:border-purple-800/30 transition-all">
                <Download size={16} /> Export Data
              </button>
            </div>
            <StatsOverview />

            {/* Upload Area */}
            <div
              className="bg-white dark:bg-[#18161F] rounded-2xl shadow-sm p-8 border-2 border-dashed border-zinc-300 dark:border-[#2A2633] text-center hover:border-purple-500 dark:hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all cursor-pointer group mb-8"
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <Upload className="mx-auto text-zinc-400 group-hover:text-purple-500 mb-4 transition-colors" size={40} />
              <p className="font-bold text-lg text-zinc-700 dark:text-[#EBE9F0]">Create New Quiz</p>
              <p className="text-zinc-400 dark:text-[#9D99A8]">Upload a JSON file to start</p>
            </div>

            {/* Quiz Lists */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Private Quizzes */}
              <div>
                <h2 className="flex items-center gap-2 font-bold text-zinc-400 uppercase tracking-wider mb-4 text-sm">
                  <Lock size={14} /> My Private Library
                </h2>
                <div className="space-y-3">
                  {privateQuizzes.length === 0 && <p className="text-zinc-400 italic text-sm">No saved quizzes yet.</p>}
                  {privateQuizzes.map(q => (
                    <div key={q.id} className="bg-white dark:bg-[#18161F] p-4 rounded-xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-500 transition-all flex justify-between items-center group">
                      <div>
                        <h3 className="font-bold text-zinc-800 dark:text-white">{q.title}</h3>
                        <p className="text-xs text-zinc-400 dark:text-[#9D99A8]">{q.questions.length} Questions</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => downloadQuiz(q)} className="bg-zinc-100 dark:bg-[#23202B] text-zinc-500 hover:text-purple-600 dark:hover:text-purple-400 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Download JSON">
                          <Download size={16} />
                        </button>
                        <button onClick={() => generateSmartSession(q.questions, q.id)} className="bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                          <Play size={16} fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Public Quizzes */}
              <div>
                <h2 className="flex items-center gap-2 font-bold text-zinc-400 uppercase tracking-wider mb-4 text-sm">
                  <Globe size={14} /> Community Quizzes
                </h2>
                <div className="space-y-3">
                  {publicQuizzes.length === 0 && <p className="text-zinc-400 italic text-sm">No public quizzes available.</p>}
                  {publicQuizzes.map(q => (
                    <div key={q.id} className="bg-white dark:bg-[#18161F] p-4 rounded-xl shadow-sm border border-zinc-100 dark:border-[#2A2633] hover:border-purple-500 dark:hover:border-purple-500 transition-all flex justify-between items-center group">
                      <div>
                        <h3 className="font-bold text-zinc-800 dark:text-white">{q.title}</h3>
                        <p className="text-xs text-zinc-400 dark:text-[#9D99A8]">By {q.author} • {q.questions.length} Questions</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => downloadQuiz(q)} className="bg-zinc-100 dark:bg-[#23202B] text-zinc-500 hover:text-purple-600 dark:hover:text-purple-400 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Download JSON">
                          <Download size={16} />
                        </button>
                        <button onClick={() => generateSmartSession(q.questions, q.id)} className="bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-300 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                          <Play size={16} fill="currentColor" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sample Loader */}
            <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-[#2A2633] text-center">
              <button onClick={() => { setPendingUpload(SAMPLE_QUIZ); setPendingFileName("Sample Quiz"); setShowSaveModal(true); }} className="text-sm text-zinc-500 hover:text-purple-500 transition-colors">
                Try Sample Quiz
              </button>
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
                <p className="font-mono text-sm text-zinc-600 dark:text-[#9D99A8]"><span className="font-bold">Questions:</span> {pendingUpload?.length}</p>
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

        {/* --- VIEW: PLAYING --- */}
        {view === 'playing' && currentQData && (
          <div className="min-h-screen flex flex-col items-center justify-center p-4">
            <div className="max-w-2xl w-full">
              {/* Header */}
              <div className="flex justify-between items-end mb-4 px-1">
                <div>
                  <h2 className="text-zinc-500 dark:text-[#9D99A8] text-sm font-semibold uppercase tracking-wider">
                    Question {currentQuestionIndex + 1} of {sessionQueue.length}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${currentQData.type.includes('multiple') ? 'border-purple-200 text-purple-600 bg-purple-50' :
                        currentQData.type.includes('text') ? 'border-blue-200 text-blue-600 bg-blue-50' :
                          'border-zinc-200 text-zinc-600 bg-zinc-50'
                      }`}>
                      {currentQData.type.includes('multiple') ? 'Multi-Select' : currentQData.type.includes('text') ? 'Flashcard' : 'Single Choice'}
                    </span>

                    {currentQData.category && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-600 bg-purple-50 truncate max-w-[150px]">
                        {currentQData.category}
                      </span>
                    )}

                    {/* Algorithm Tag */}
                    {stats[currentQData.id] && (stats[currentQData.id].correct / (stats[currentQData.id].correct + stats[currentQData.id].wrong) < 0.7) && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-orange-200 text-orange-600 bg-orange-50 flex items-center gap-1">
                        <RotateCcw size={10} /> Review
                      </span>
                    )}
                    {!stats[currentQData.id] && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-green-200 text-green-600 bg-green-50 flex items-center gap-1">
                        New
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setView('dashboard')} className="text-zinc-400 hover:text-red-500 text-xs font-medium">Exit</button>
              </div>

              <div className="w-full bg-purple-200 dark:bg-[#23202B] h-2 rounded-full mb-6 overflow-hidden">
                <div className="bg-purple-600 dark:bg-purple-500 h-full transition-all duration-300 ease-out" style={{ width: `${((currentQuestionIndex + 1) / sessionQueue.length) * 100}%` }}></div>
              </div>

              {/* Card */}
              <div className="bg-white dark:bg-[#18161F] rounded-2xl shadow-xl p-6 md:p-10 border border-zinc-100 dark:border-[#2A2633] min-h-[400px] flex flex-col relative overflow-hidden">
                <div className="flex items-start justify-between">
                  <h3 className="text-2xl font-bold text-zinc-800 dark:text-white mb-8 leading-snug">{currentQData.question}</h3>
                  <div className="hidden md:flex text-zinc-300 dark:text-zinc-600" title="Keyboard Shortcuts Enabled">
                    <Keyboard size={20} />
                  </div>
                </div>

                <div className="flex-grow z-10">
                  {(currentQData.type === 'single' || currentQData.type === 'single_choice') && renderSingleChoice()}
                  {(currentQData.type === 'multiple' || currentQData.type === 'multiple_response') && renderMultiChoice()}
                  {(currentQData.type === 'text' || currentQData.type === 'text_input') && renderTextChoice()}
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
          </div>
        )}

        {/* --- VIEW: RESULTS --- */}
        {view === 'results' && (
          <div className="min-h-screen flex items-center justify-center p-4 py-12">
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
                  {sessionQueue.map((q, index) => {
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

              <div className="p-6 bg-white dark:bg-[#18161F] border-t border-zinc-100 dark:border-[#2A2633] flex justify-center">
                <button onClick={() => setView('dashboard')} className="flex items-center gap-2 px-8 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors">
                  <RotateCcw size={18} /> Back to Dashboard
                </button>
              </div>
            </div>
          </div>
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
  );
}
