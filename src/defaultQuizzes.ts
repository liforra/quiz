import ap1Netzwerktechnik from './quizzes/ap1-netzwerktechnik.json';
import ap1ItSicherheit from './quizzes/ap1-it-sicherheit.json';
import ap1WirtschaftPm from './quizzes/ap1-wirtschaft-projektmanagement.json';
import ap1HardwareArbeitsplatz from './quizzes/ap1-hardware-arbeitsplatz.json';
import ap1Softwareentwicklung from './quizzes/ap1-softwareentwicklung.json';
import ap2NetzwerkeSubnetting from './quizzes/ap2-netzwerke-subnetting.json';
import ap2ServerdiensteVirtualisierung from './quizzes/ap2-serverdienste-virtualisierung.json';
import ap2ItSicherheit from './quizzes/ap2-it-sicherheit.json';
import ap2SpeicherBackup from './quizzes/ap2-speicher-backup.json';
import ap2Datenbanken from './quizzes/ap2-datenbanken.json';

export interface QuizQuestionTranslation {
  question?: string;
  options?: string[];
  answer?: string | string[];
  explanation?: string;
}

export interface QuizQuestion {
  id: string;
  type: string;
  category: string;
  question: string;
  options?: string[];
  answer: string | string[];
  explanation?: string;
  translations?: Record<string, QuizQuestionTranslation>;
}

export interface DefaultQuiz {
  id: string;
  title: string;
  icon: string;
  modes: string[];
  author: string;
  questions: QuizQuestion[];
}

// Built-in quizzes shipped with the app (mode ids from src/modes.ts tag them
// as AP1/AP2 — the quiz title is just the subject area, per the convention
// that the active mode already scopes it). Question ids are stable strings,
// so per-question stats survive app updates. Not stored in Firestore and
// not editable/deletable from the UI.
export const DEFAULT_QUIZZES: DefaultQuiz[] = [
  {
    id: 'default-ap1-netzwerktechnik',
    title: 'Netzwerktechnik',
    icon: 'Wifi',
    modes: ['ap1'],
    author: 'FISI Trainer',
    questions: ap1Netzwerktechnik.questions,
  },
  {
    id: 'default-ap1-it-sicherheit',
    title: 'IT-Sicherheit & Datenschutz',
    icon: 'Shield',
    modes: ['ap1'],
    author: 'FISI Trainer',
    questions: ap1ItSicherheit.questions,
  },
  {
    id: 'default-ap1-wirtschaft-projektmanagement',
    title: 'Wirtschaft & Projektmanagement',
    icon: 'FileText',
    modes: ['ap1'],
    author: 'FISI Trainer',
    questions: ap1WirtschaftPm.questions,
  },
  {
    id: 'default-ap1-hardware-arbeitsplatz',
    title: 'Hardware & Arbeitsplatz',
    icon: 'Cpu',
    modes: ['ap1'],
    author: 'FISI Trainer',
    questions: ap1HardwareArbeitsplatz.questions,
  },
  {
    id: 'default-ap1-softwareentwicklung',
    title: 'Softwareentwicklung',
    icon: 'Code',
    modes: ['ap1'],
    author: 'FISI Trainer',
    questions: ap1Softwareentwicklung.questions,
  },
  {
    id: 'default-ap2-netzwerke-subnetting',
    title: 'Netzwerke & Subnetting',
    icon: 'Globe',
    modes: ['ap2'],
    author: 'FISI Trainer',
    questions: ap2NetzwerkeSubnetting.questions,
  },
  {
    id: 'default-ap2-serverdienste-virtualisierung',
    title: 'Serverdienste & Virtualisierung',
    icon: 'Server',
    modes: ['ap2'],
    author: 'FISI Trainer',
    questions: ap2ServerdiensteVirtualisierung.questions,
  },
  {
    id: 'default-ap2-it-sicherheit',
    title: 'IT-Sicherheit & Netzwerksicherheit',
    icon: 'Lock',
    modes: ['ap2'],
    author: 'FISI Trainer',
    questions: ap2ItSicherheit.questions,
  },
  {
    id: 'default-ap2-speicher-backup',
    title: 'Speicher & Backup',
    icon: 'HardDrive',
    modes: ['ap2'],
    author: 'FISI Trainer',
    questions: ap2SpeicherBackup.questions,
  },
  {
    id: 'default-ap2-datenbanken',
    title: 'Datenbanken',
    icon: 'Database',
    modes: ['ap2'],
    author: 'FISI Trainer',
    questions: ap2Datenbanken.questions,
  },
];
