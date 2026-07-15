const normalizeLineBreaks = (value = "") =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const compactText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const getLineMatches = (text, regex) => {
  const matches = [];
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return matches;
};

const makeBlockSlices = (text, matches) =>
  matches.map((match, index) => ({
    match,
    text: text.slice(match.index, matches[index + 1]?.index ?? text.length),
  }));

const getMarkerBlock = (text, marker, endMarkers = []) => {
  const markerMatch = marker.exec(text);
  marker.lastIndex = 0;
  if (!markerMatch) return "";
  const markerEndLine = text.indexOf("\n", markerMatch.index + markerMatch[0].length);
  const start = markerEndLine >= 0 ? markerEndLine + 1 : markerMatch.index + markerMatch[0].length;
  let end = text.length;
  for (const endMarker of endMarkers) {
    endMarker.lastIndex = 0;
    const rest = text.slice(start);
    const endMatch = endMarker.exec(rest);
    if (endMatch) end = Math.min(end, start + endMatch.index);
  }
  return normalizeLineBreaks(text.slice(start, end));
};

const parseLetterBank = (raw, allowedPattern = /^[A-Ha-h]$/) => {
  const lines = normalizeLineBreaks(raw).split("\n").map((line) => line.trim()).filter(Boolean);
  const bank = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(letter|sentence|heading)$/i.test(line)) continue;
    const inline = line.match(/^([A-Oa-o])\s+(.+)$/);
    if (inline && allowedPattern.test(inline[1])) {
      bank.push({ value: inline[1].toLowerCase(), label: compactText(inline[2]) });
      continue;
    }
    if (allowedPattern.test(line) && lines[index + 1]) {
      bank.push({ value: line.toLowerCase(), label: compactText(lines[index + 1]) });
      index += 1;
    }
  }
  return bank;
};

const parseCorrectionPairs = (raw) => {
  const lines = normalizeLineBreaks(raw).split("\n").map((line) => line.trim()).filter(Boolean);
  const answers = new Map();
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!/^\d{1,2}$/.test(lines[index])) continue;
    const value = lines[index + 1].replace(/[.;,]+$/, "").trim();
    if (/^[A-HXabc]$/i.test(value)) {
      answers.set(Number(lines[index]), value);
      index += 1;
    }
  }
  return answers;
};

const parsePersons = (raw) => {
  const text = normalizeLineBreaks(raw);
  const matches = getLineMatches(text, /(?:^|\n)Person\s+([A-D])\s*:\s*([^\n]+)/g);
  return makeBlockSlices(text, matches).map((block) => {
    const letter = block.match[1];
    const title = compactText(block.match[2]);
    const body = normalizeLineBreaks(block.text.slice(block.match[0].length));
    return {
      value: letter,
      title: `Person ${letter}: ${title}`,
      text: body,
    };
  });
};

const parseNumberedPrompts = (raw) => {
  const text = normalizeLineBreaks(raw);
  const matches = getLineMatches(text, /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  return makeBlockSlices(text, matches).map((block) => ({
    number: Number(block.match[1]),
    prompt: compactText(
      block.text
        .slice(block.match[0].length)
        .replace(/\[Select:[^\]]+\]/gi, "")
        .replace(/\[Select heading [^\]]+\]/gi, "")
    ),
  })).filter((item) => item.number && item.prompt);
};

const parseMultipleChoiceQuestions = (raw) =>
  parseNumberedPrompts(raw).map((item) => {
    const options = [];
    const prompt = item.prompt.replace(/\s+([abc])\)\s+/g, "\n$1) ");
    const optionMatches = [...prompt.matchAll(/(?:^|\n)([abc])\)\s*([^\n]+)/gi)];
    optionMatches.forEach((match) => {
      options.push({ value: match[1].toLowerCase(), label: compactText(match[2]) });
    });
    const question = compactText(prompt.split(/\n\s*a\)\s+/i)[0]);
    return {
      number: item.number,
      prompt: question,
      options,
    };
  }).filter((item) => item.prompt && item.options.length === 3);

const parseDocumentSections = (raw) => {
  const text = normalizeLineBreaks(raw);
  const title = compactText(text.split("\n").find((line) => line.trim() && !/^Abschnitt\s+\d+/i.test(line)) || "");
  const matches = getLineMatches(text, /(?:^|\n)Abschnitt\s+(\d+)\s*:\s*/gi);
  const sections = makeBlockSlices(text, matches).map((block) => ({
    number: Number(block.match[1]),
    prompt: compactText(
      `Abschnitt ${block.match[1]}: ${block.text.slice(block.match[0].length)}`
        .replace(/\[Select heading [^\]]+\]/gi, "")
    ),
  })).filter((item) => item.number && item.prompt);
  return { title, sections };
};

const parseInlineGapNumbers = (article) => {
  const numbers = [];
  for (const match of normalizeLineBreaks(article).matchAll(/\[\s*(\d{1,2})\s*\]\s*_{5,}/g)) {
    numbers.push(Number(match[1]));
  }
  return numbers;
};

const createSelectOptions = (values) =>
  values.map((value) => ({
    value,
    label: value.toUpperCase(),
  }));

const buildQuestion = ({ partNumber, partType, position, prompt, options, correct, points = 1, metadata = {} }) => ({
  questionType: partType === "single_choice" ? "multiple_choice" : "goethe_b2_lesen_select",
  prompt,
  options,
  correctAnswer: { value: correct },
  explanation: null,
  position,
  scoring: { points },
  metadata: {
    goetheB2Lesen: true,
    partNumber,
    partType,
    sourceQuestionNumber: position,
    ...metadata,
  },
  sectionType: "read",
});

const parseGoetheB2LesenSection = (partBlock, seriesNumber) => {
  const partNumber = Number(partBlock.match[1]);
  const title = compactText(partBlock.match[2] || `Teil ${partNumber}`);
  const baseEndMarkers = [
    /(?:^|\n)STUDENT_VISIBLE_[A-Z_]+/g,
    /(?:^|\n)IMPLEMENTATION_OVERRIDE_[A-Z_]+/g,
    /(?:^|\n)ANSWER_COMPONENT_SCHEMA/g,
    /(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT/g,
    /(?:^|\n)SOURCE_VALIDATION_WARNING/g,
  ];
  const instruction = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_INSTRUCTION(?:_SOURCE_TEXT)?\b/g, baseEndMarkers);
  const correction = getMarkerBlock(partBlock.text, /(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT\b/g, [/(?:^|\n)TEIL\s+[1-5]\s+-/g]);
  const answers = parseCorrectionPairs(correction);
  const metadata = {
    goetheB2Lesen: {
      seriesNumber,
      partNumber,
      title,
      instruction,
    },
  };

  if (partNumber === 1) {
    const readingContent = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_READING_CONTENT\b/g, baseEndMarkers);
    const questionRaw = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_QUESTIONS\b/g, baseEndMarkers);
    const persons = parsePersons(readingContent);
    const items = parseNumberedPrompts(questionRaw);
    metadata.goetheB2Lesen = {
      ...metadata.goetheB2Lesen,
      partType: "person_matching",
      persons,
      readingContent,
    };
    return {
      sectionType: "read",
      partNumber,
      title: `Teil 1: ${title}`,
      instructions: [instruction, readingContent].filter(Boolean).join("\n\n"),
      durationMinutes: null,
      points: 9,
      scoring: { points: 9 },
      metadata,
      questions: items.map((item) => buildQuestion({
        partNumber,
        partType: "person_matching",
        position: item.number,
        prompt: item.prompt,
        options: createSelectOptions(["A", "B", "C", "D", "X"]),
        correct: answers.get(item.number) || "",
      })),
    };
  }

  if (partNumber === 2) {
    const article = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_ARTICLE_WITH_INLINE_GAPS\b/g, baseEndMarkers);
    const bank = parseLetterBank(getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_SENTENCE_BANK\b/g, baseEndMarkers), /^[A-Ha-h]$/);
    const gapNumbers = parseInlineGapNumbers(article);
    metadata.goetheB2Lesen = {
      ...metadata.goetheB2Lesen,
      partType: "inline_sentence_gap",
      article,
      bank,
      uniqueAnswers: true,
    };
    return {
      sectionType: "read",
      partNumber,
      title: `Teil 2: ${title}`,
      instructions: [instruction, article].filter(Boolean).join("\n\n"),
      durationMinutes: null,
      points: 6,
      scoring: { points: 6 },
      metadata,
      questions: gapNumbers.map((number) => buildQuestion({
        partNumber,
        partType: "inline_sentence_gap",
        position: number,
        prompt: `Luecke ${number}`,
        options: bank,
        correct: answers.get(number)?.toLowerCase() || "",
        metadata: { uniqueAnswers: true },
      })),
    };
  }

  if (partNumber === 3) {
    const readingText = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_READING_TEXT\b/g, baseEndMarkers);
    const questionRaw = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_QUESTIONS\b/g, baseEndMarkers);
    const items = parseMultipleChoiceQuestions(questionRaw);
    metadata.goetheB2Lesen = {
      ...metadata.goetheB2Lesen,
      partType: "single_choice",
      readingText,
    };
    return {
      sectionType: "read",
      partNumber,
      title: `Teil 3: ${title}`,
      instructions: [instruction, readingText].filter(Boolean).join("\n\n"),
      durationMinutes: null,
      points: 6,
      scoring: { points: 6 },
      metadata,
      questions: items.map((item) => buildQuestion({
        partNumber,
        partType: "single_choice",
        position: item.number,
        prompt: item.prompt,
        options: item.options,
        correct: answers.get(item.number)?.toLowerCase() || "",
      })),
    };
  }

  if (partNumber === 4) {
    const headingBank = parseLetterBank(getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_HEADING_BANK\b/g, baseEndMarkers), /^[a-fa-f]$/);
    const opinions = parseNumberedPrompts(getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_OPINIONS\b/g, baseEndMarkers));
    const options = [...headingBank, { value: "X", label: "X" }];
    metadata.goetheB2Lesen = {
      ...metadata.goetheB2Lesen,
      partType: "heading_matching_with_unmatched_opinion",
      headingBank,
      opinions,
      uniqueAnswers: true,
    };
    return {
      sectionType: "read",
      partNumber,
      title: `Teil 4: ${title}`,
      instructions: instruction,
      durationMinutes: null,
      points: 6,
      scoring: { points: 6 },
      metadata,
      questions: opinions.map((item) => {
        const correct = answers.get(item.number);
        return buildQuestion({
          partNumber,
          partType: "heading_matching_with_unmatched_opinion",
          position: item.number,
          prompt: item.prompt,
          options,
          correct: correct === "X" ? "X" : String(correct || "").toLowerCase(),
          points: correct === "X" ? 0 : 1,
          metadata: { uniqueAnswers: true },
        });
      }),
    };
  }

  const documentRaw = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_DOCUMENT_SECTIONS\b/g, baseEndMarkers);
  const document = parseDocumentSections(documentRaw);
  const headingBank = parseLetterBank(getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_HEADING_BANK\b/g, baseEndMarkers), /^[a-ga-g]$/);
  metadata.goetheB2Lesen = {
    ...metadata.goetheB2Lesen,
    partType: "section_heading_matching",
    documentTitle: document.title,
    sections: document.sections,
    headingBank,
    uniqueAnswers: true,
  };
  return {
    sectionType: "read",
    partNumber,
    title: `Teil 5: ${title}`,
    instructions: [instruction, documentRaw].filter(Boolean).join("\n\n"),
    durationMinutes: null,
    points: 3,
    scoring: { points: 3 },
    metadata,
    questions: document.sections.map((item) => buildQuestion({
      partNumber,
      partType: "section_heading_matching",
      position: item.number,
      prompt: item.prompt,
      options: headingBank,
      correct: answers.get(item.number)?.toLowerCase() || "",
      metadata: { uniqueAnswers: true },
    })),
  };
};

const parseGoetheB2LesenSeries = (text, metadata = {}) => {
  const clean = normalizeLineBreaks(text);
  if (!/DOCUMENT_USAGE_CONTRACT/.test(clean) || !/IMPORT SCHEMA REFERENCE/.test(clean)) return [];
  const examMatches = getLineMatches(clean, /(?:^|\n)PR(?:\u00dc|UE)FUNG\s+0?(\d{1,2})\s*[-\u2013\u2014]\s*([^\n]+)/giu);
  return makeBlockSlices(clean, examMatches).slice(0, 20).map((examBlock) => {
    const seriesNumber = Number(examBlock.match[1]);
    const title = compactText(examBlock.match[2] || `Pruefung ${seriesNumber}`);
    const examCode = compactText((examBlock.text.match(/exam_code\s*\n\s*([^\n]+)/i) || [])[1] || `goethe_b2_lesen_${String(seriesNumber).padStart(2, "0")}`);
    const warning = getMarkerBlock(examBlock.text, /(?:^|\n)SOURCE_VALIDATION_WARNING\b/g, [/(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT/g, /(?:^|\n)TEIL\s+[1-5]\s+-/g]);
    const partMatches = getLineMatches(examBlock.text, /(?:^|\n)TEIL\s+([1-5])\s*[-\u2013\u2014]\s*([^\n]+)/giu);
    const sections = makeBlockSlices(examBlock.text, partMatches)
      .map((partBlock) => parseGoetheB2LesenSection(partBlock, seriesNumber))
      .filter((section) => section.questions.length);
    return {
      seriesNumber,
      title,
      examCode,
      sourceLabel: `Goethe B2 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "Goethe-Zertifikat B2 Lesen: fuenf Teile, 65 Minuten, 30 Messpunkte.",
      scoring: {
        totalPoints: 30,
        globalDurationMinutes: 65,
        parts: { 1: 9, 2: 6, 3: 6, 4: 6, 5: 3 },
      },
      metadata: {
        ...metadata,
        goetheB2Lesen: true,
        examCode,
        sourceWarning: warning,
        globalDurationMinutes: 65,
      },
      sections,
    };
  }).filter((series) => series.sections.length === 5);
};

module.exports = {
  parseGoetheB2LesenSeries,
};
