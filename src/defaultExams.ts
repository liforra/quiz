import wiso2024Winter from './exams/wiso-2024-winter.json';
import wiso2023Winter from './exams/wiso-2023-winter.json';
import si2024WinterTeil1 from './exams/si-2024-winter-teil1.json';
import si2024SommerTeil1 from './exams/si-2024-sommer-teil1.json';
import si2024SommerTeil2 from './exams/si-2024-sommer-teil2.json';
import si2023WinterTeil1 from './exams/si-2023-winter-teil1.json';
import si2023WinterTeil2 from './exams/si-2023-winter-teil2.json';
import si2024WinterTeil2 from './exams/si-2024-winter-teil2.json';
import wiso2023Sommer from './exams/wiso-2023-sommer.json';
import si2023SommerTeil1 from './exams/si-2023-sommer-teil1.json';
import si2023SommerTeil2 from './exams/si-2023-sommer-teil2.json';
import si2022WinterTeil1 from './exams/si-2022-winter-teil1.json';
import si2022WinterTeil2 from './exams/si-2022-winter-teil2.json';
import wiso2022Winter from './exams/wiso-2022-winter.json';
import { Exam } from './exams/types';

export * from './exams/types';

// Digitized real IHK exam papers ("AP Prüfungen"), shipped with the app just
// like src/defaultQuizzes.ts — not stored in Firestore, not editable from the
// UI. Each one has been transcribed and cross-checked by hand against both
// the original exam PDF and its Musterlösung (see src/exams/*.json).
export const DEFAULT_EXAMS: Exam[] = [
  wiso2024Winter as Exam,
  wiso2023Winter as Exam,
  si2024WinterTeil1 as Exam,
  si2024SommerTeil1 as Exam,
  si2024SommerTeil2 as Exam,
  si2023WinterTeil1 as Exam,
  si2023WinterTeil2 as Exam,
  si2024WinterTeil2 as Exam,
  wiso2023Sommer as Exam,
  si2023SommerTeil1 as Exam,
  si2023SommerTeil2 as Exam,
  si2022WinterTeil1 as Exam,
  si2022WinterTeil2 as Exam,
  wiso2022Winter as Exam,
];
