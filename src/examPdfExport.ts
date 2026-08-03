// Exports a completed exam attempt as a filled copy of the *real* source
// PDF: every answer is drawn directly onto the original exam page at its
// registered pdfAnchor coordinates (see src/exams/types.ts), so the result
// looks like the actual paper filled out by hand — not a generated summary.
//
// The source PDF itself is never bundled/redistributed: it's fetched from
// /exam-sources/<examId>.pdf, which server/index.js serves from a symlink
// into the private, gitignored Prüfungen/ archive (see AdminExamSources).
// If no source PDF is registered, or a part has no pdfAnchor yet (not all
// exams have been retrofitted with coordinates), those answers are listed
// on an appended "not shown on the original" summary page instead of being
// silently dropped — so export never loses information, it just degrades
// to a transcript for whatever isn't wired up to the real paper yet.
//
// A compact scoring summary is always appended as a final page.

import { PDFDocument, PDFPageDrawTextOptions, StandardFonts, rgb, degrees, PDFFont, PDFPage } from 'pdf-lib';
import { Exam, ExamPart } from './defaultExams';
import { ExamAnswers } from './components/ExamTaking';
import { ExamGrading } from './components/ExamResults';

// ExamPart.pdfAnchor.x/y are always authored in "visual" space — points as a
// human reads the page (origin bottom-left of the page *as displayed*,
// matching what you'd measure off a normal portrait render), regardless of
// whatever /Rotate value the underlying PDF page actually carries. Some of
// these source PDFs were scanned in landscape with a 90/270 rotation flag;
// this converts a visual-space point + rotation into pdf-lib's raw content
// coordinates (and the matching text `rotate` angle) at draw time, so exam
// JSON files never need to know or care about a given PDF's rotation.
function visualToRaw(page: PDFPage, visX: number, visY: number): { x: number; y: number; rotate: PDFPageDrawTextOptions['rotate'] } {
  const { width: rawW, height: rawH } = page.getSize();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  switch (angle) {
    case 90: return { x: rawW - visY, y: visX, rotate: degrees(90) };
    case 180: return { x: rawW - visX, y: rawH - visY, rotate: degrees(180) };
    case 270: return { x: visY, y: rawH - visX, rotate: degrees(270) };
    default: return { x: visX, y: visY, rotate: degrees(0) };
  }
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ANSWER_COLOR = rgb(0.1, 0.25, 0.75); // blue — visually distinct from the printed original

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function answerText(part: ExamPart, answers: ExamAnswers, skippedLabel: string): string {
  const raw = answers[part.id];
  if (part.type === 'choice') {
    return (((raw as number[]) || []).map(i => part.options?.[i]).filter(Boolean).join('; ')) || skippedLabel;
  }
  return (((raw as string) || '').trim()) || skippedLabel;
}

async function loadSourcePdf(examId: string): Promise<PDFDocument | null> {
  try {
    const res = await fetch(`/exam-sources/${encodeURIComponent(examId)}.pdf`);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return await PDFDocument.load(bytes);
  } catch {
    return null;
  }
}

export async function exportExamToPdf(exam: Exam, answers: ExamAnswers, grading: ExamGrading, skippedLabel: string, pointsLabel: string): Promise<Blob> {
  const sourceDoc = await loadSourcePdf(exam.id);
  const doc = sourceDoc ?? (await PDFDocument.create());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const allParts = exam.tasks.flatMap(t => t.parts);
  const unanchoredParts = sourceDoc
    ? allParts.filter(p => !p.pdfAnchor)
    : allParts; // no source PDF at all — everything falls back to the summary

  // Draw every anchored answer directly onto its page of the real source PDF.
  if (sourceDoc) {
    for (const part of allParts) {
      if (!part.pdfAnchor) continue;
      const { page: pageIndex, x, y, maxWidth, fontSize } = part.pdfAnchor;
      const page = doc.getPages()[pageIndex];
      if (!page) continue;
      const size = fontSize ?? 9;
      const text = answerText(part, answers, skippedLabel);
      const lines = maxWidth ? wrapText(font, text, size, maxWidth) : [text];
      lines.forEach((line, i) => {
        const { x: rx, y: ry, rotate } = visualToRaw(page, x, y - i * (size + 2));
        page.drawText(line, { x: rx, y: ry, size, font, color: ANSWER_COLOR, rotate });
      });
    }
  }

  // --- Appended pages: fallback transcript for unanchored parts, then a
  // scoring summary — both always present regardless of source-PDF status.
  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.bold ? boldFont : font;
    const color = opts.color ?? rgb(0.1, 0.1, 0.12);
    const lines = wrapText(f, text, size, CONTENT_WIDTH);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(line, { x: MARGIN, y, size, font: f, color });
      y -= size + 4;
    }
    y -= opts.gap ?? 2;
  };

  const drawRule = () => {
    ensureSpace(10);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.82) });
    y -= 10;
  };

  drawText(exam.title, { size: 16, bold: true, gap: 4 });
  drawText(`${exam.profession} · ${exam.examPart.toUpperCase()} · ${exam.period.season} ${exam.period.year}`, { size: 10, color: rgb(0.4, 0.4, 0.45), gap: 10 });

  const graded = allParts.filter(p => grading[p.id]?.status === 'graded');
  const fullyGraded = graded.length === allParts.length;
  const totalMax = exam.totalPoints ?? allParts.reduce((n, p) => n + p.points, 0);
  const totalScore = graded.reduce((n, p) => n + (grading[p.id]?.score || 0), 0);

  if (fullyGraded) {
    const pct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
    drawText(`${pointsLabel}: ${totalScore.toFixed(1)} / ${totalMax.toFixed(2)} (${pct}%)`, { size: 13, bold: true, color: rgb(0.45, 0.2, 0.75), gap: 12 });
  } else {
    drawText(`${pointsLabel}: ${totalScore.toFixed(1)} / ${totalMax.toFixed(2)} (${graded.length}/${allParts.length} graded)`, { size: 11, color: rgb(0.6, 0.45, 0.1), gap: 12 });
  }
  drawRule();

  if (unanchoredParts.length > 0) {
    drawText(
      sourceDoc
        ? 'The following answers are not yet mapped onto the original PDF and are listed here instead:'
        : 'No original PDF is linked for this exam — all answers are listed here instead:',
      { size: 10, color: rgb(0.5, 0.5, 0.55), gap: 8 }
    );
    for (const task of exam.tasks) {
      const taskUnanchored = task.parts.filter(p => unanchoredParts.includes(p));
      if (taskUnanchored.length === 0) continue;
      ensureSpace(24);
      drawText(task.title, { size: 12, bold: true, gap: 4 });
      for (const part of taskUnanchored) {
        const label = part.label ? `${part.label} ` : '';
        drawText(`${label}${part.prompt}`, { size: 9, bold: true, gap: 1 });
        drawText(answerText(part, answers, skippedLabel), { size: 9, color: rgb(0.25, 0.25, 0.3), gap: 1 });
        const g = grading[part.id];
        drawText(
          g?.status === 'graded'
            ? `${pointsLabel}: ${g.score.toFixed(1)} / ${g.maxScore.toFixed(2)}${g.reasoning ? ' — ' + g.reasoning : ''}`
            : `${pointsLabel}: — / ${part.points.toFixed(2)} (not graded)`,
          { size: 8, color: rgb(0.45, 0.2, 0.75), gap: 6 }
        );
      }
    }
    drawRule();
  }

  const bytes = await doc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
