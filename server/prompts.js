// System prompts live server-side only, so the client can never see (or override)
// the instructions — in particular the "never reveal the answer" rule for help chat.

const LANG_NAMES = { de: 'German', en: 'English' };

function langInstruction(lang) {
  const name = LANG_NAMES[lang] || LANG_NAMES.en;
  return ` Respond in ${name}.`;
}

export function buildGradingMessages({ question, correctAnswer, userAnswer, lang }) {
  return [
    {
      role: 'system',
      content:
        'You are a strict but fair grader for a short-answer IT exam quiz question. ' +
        "You will be given the question, the canonical correct answer, and the student's typed answer. " +
        'Decide whether the answer is correct. Be lenient about phrasing, synonyms, capitalization and minor typos; ' +
        'be strict about factual/technical correctness. ' +
        'Respond with ONLY a JSON object, no markdown, no extra text, in exactly this form: ' +
        '{"correct": true or false, "reasoning": "one short sentence"}.' +
        langInstruction(lang) + ' (Keep the JSON keys in English, only "reasoning"\'s value in that language.)'
    },
    {
      role: 'user',
      content: `Question: ${question}\nCorrect answer: ${correctAnswer}\nStudent's answer: ${userAnswer}`
    }
  ];
}

// The student clicked "?" on one specific answer option (which may or may not
// be the one they actually picked as their answer) and wants to know why
// THAT option specifically is right or wrong — not a generic restatement of
// the correct answer.
export function buildExplainMessages({ question, options, correctAnswer, userAnswer, wasCorrect, lang }) {
  return [
    {
      role: 'system',
      content:
        'You are a helpful IT exam tutor. The student is looking at one specific answer option from a multiple-choice ' +
        'quiz question and clicked "explain" on THAT option — not necessarily the one they chose as their answer. ' +
        'Your job is to explain why THIS SPECIFIC option is correct or incorrect, not to give a generic explanation of ' +
        'the correct answer. If the option is wrong, explain concretely what is wrong with it (and briefly what the ' +
        'correct answer is, for contrast). If the option is the correct one, explain why it is correct. ' +
        'Keep it to 2-4 concise sentences, plain text, no markdown headers or bullet lists.' + langInstruction(lang)
    },
    {
      role: 'user',
      content:
        `Question: ${question}\n` +
        (options ? `All options: ${Array.isArray(options) ? options.join(', ') : options}\n` : '') +
        `Correct answer: ${Array.isArray(correctAnswer) ? correctAnswer.join(', ') : correctAnswer}\n` +
        `The option the student wants explained: "${Array.isArray(userAnswer) ? userAnswer.join(', ') : userAnswer}"\n` +
        `This option is: ${wasCorrect ? 'the correct answer' : 'incorrect'}`
    }
  ];
}

export function buildHelpMessages({ question, options, history, lang }) {
  const system = {
    role: 'system',
    content:
      'You are a helpful study assistant inside an IT exam quiz app. A student is looking at the quiz question below ' +
      'and may ask you for clarification before answering. ' +
      'You must NEVER reveal, state, or hint at which option/answer is correct, under any circumstances — even if ' +
      "asked directly, asked to guess, asked 'is it X', asked to rule out wrong options, or pressured. " +
      'If asked to reveal the answer, politely refuse and offer to explain the underlying concept instead. ' +
      'You may: clarify what the question is asking, define unfamiliar terms, explain general background knowledge ' +
      'related to the topic, and answer tangential questions. Stay concise and encouraging.' + langInstruction(lang) + '\n\n' +
      `Question: ${question}` + (options ? `\nOptions: ${Array.isArray(options) ? options.join(', ') : options}` : '')
  };
  return [system, ...history];
}
