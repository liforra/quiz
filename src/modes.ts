export interface QuizMode {
  id: string;
  label: string;
  icon: string;
}

// Built-in modes/categories. Extending this later (e.g. "Random IT Knowledge",
// "Drug Knowledge") is a one-line addition to this array.
export const BUILT_IN_MODES: QuizMode[] = [
  { id: 'ap1', label: 'AP1', icon: 'GraduationCap' },
  { id: 'ap2', label: 'AP2', icon: 'GraduationCap' },
];
