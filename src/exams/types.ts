// Data model for digitized real IHK exam papers ("AP Prüfungen") — distinct
// from the hand-authored multiple-choice quizzes in src/quizzes/. An exam
// mirrors one real paper: numbered Aufgaben, each with one or more graded
// parts (numbered-choice, exact-number, or free text graded against a
// Musterlösung), carrying the exact point values from the original paper.

// Where an answer gets written when the exam is exported as a filled copy of
// the real source PDF (see src/examPdfExport.ts). Coordinates are in PDF
// points, origin bottom-left of the page (pdf-lib convention), matching the
// *original* exam PDF registered for this exam (see /api/admin/exam-sources).
export interface PdfAnchor {
  page: number; // 0-indexed page in the source PDF
  x: number;
  y: number;
  maxWidth?: number; // wrap the drawn text to this width, in points
  fontSize?: number; // defaults to 9 if omitted
}

// Pure background/explainer material handed out alongside a question (e.g. a
// chmod permissions primer, a syntax-rules appendix) that the user doesn't
// answer — rather than transcribing it into structured content, it's linked
// as "open the original PDF at this page" so nothing is duplicated/paraphrased.
export interface ExternalReference {
  page: number; // 1-indexed, human-facing page number in the source PDF
  label?: string; // e.g. "Anlage: Syntaxregeln" — defaults to a generic label
}

export interface ExamPart {
  id: string; // e.g. "1.a.aa" — stable, used as the answer-map key
  label?: string; // "a)", "aa)" etc., shown next to the prompt
  prompt: string;
  points: number;
  type: 'choice' | 'number' | 'text';
  // 'choice': numbered options, graded instantly against correctIndices (0-indexed, set comparison)
  options?: string[];
  correctIndices?: number[];
  pickCount?: number; // how many options must be selected (default 1)
  // 'number': graded instantly against correctValue (within tolerance)
  correctValue?: number;
  tolerance?: number;
  // 'text': graded via AI against modelAnswer (partial credit), or left pending if AI is unavailable
  modelAnswer?: string;
  referenceImage?: string; // path under /exams/<id>/..., for a diagram this specific part refers to
  externalReference?: ExternalReference; // background material — links to source PDF instead of embedding
  pdfAnchor?: PdfAnchor; // where this part's answer is written on export to the filled source PDF
}

export interface ExamTask {
  number: number; // "1. Aufgabe"
  title: string;
  points: number; // sum of this task's parts
  intro?: string; // shared "Ausgangssituation" / reference prose for this task
  referenceImage?: string; // path under /exams/<id>/..., for diagrams/logos/org charts
  referenceTable?: { headers: string[]; rows: string[][] }; // transcribed data tables
  externalReference?: ExternalReference; // background material — links to source PDF instead of embedding
  parts: ExamPart[];
}

export interface Exam {
  id: string;
  title: string;
  profession: 'SI' | 'WISO';
  period: { year: number; season: 'Sommer' | 'Winter' };
  examPart: 'ap1' | 'ap2'; // reuses src/modes.ts mode ids
  durationMinutes: number;
  totalPoints: number;
  sourceNote: string;
  tasks: ExamTask[];
}
