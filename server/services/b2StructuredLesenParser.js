const eclB2ReadingBanks = require("../data/eclB2ReadingBanks.json");
const osdB2MissingLetterAnswers = require("../data/osdB2ReadingMissingLetterAnswers.json");

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

const stripKnownLayoutArtifacts = (value = "") =>
  normalizeLineBreaks(value)
    .replace(/^\s*OSD\s+[–-]\s+Österreichisches Sprachdiplom Deutsch\s+Modul LESEN B2\s*$/gim, "")
    .replace(/^\s*ÖSD\s+[–-]\s+Österreichisches Sprachdiplom Deutsch\s+Modul LESEN B2\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getMatches = (text, regex) => {
  const matches = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return matches;
};

const makeSlices = (text, matches) =>
  matches.map((match, index) => ({
    match,
    text: text.slice(match.index, matches[index + 1]?.index ?? text.length),
  }));

const getMarkerBlock = (text, marker, endMarkers = []) => {
  marker.lastIndex = 0;
  const match = marker.exec(text);
  marker.lastIndex = 0;
  if (!match) return "";
  const lineEnd = text.indexOf("\n", match.index + match[0].length);
  const start = lineEnd >= 0 ? lineEnd + 1 : match.index + match[0].length;
  let end = text.length;
  const remainder = text.slice(start);
  endMarkers.forEach((endMarker) => {
    endMarker.lastIndex = 0;
    const endMatch = endMarker.exec(remainder);
    endMarker.lastIndex = 0;
    if (endMatch) end = Math.min(end, start + endMatch.index);
  });
  return stripKnownLayoutArtifacts(text.slice(start, end));
};

const splitFirstParagraph = (value = "") => {
  const text = normalizeLineBreaks(value);
  const boundary = text.indexOf("\n\n");
  if (boundary < 0) return { instruction: text, body: "" };
  return {
    instruction: text.slice(0, boundary).trim(),
    body: text.slice(boundary + 2).trim(),
  };
};

const makeOptions = (values) => values.map((value) => ({ value, label: value.toUpperCase() }));

const buildQuestion = ({
  provider,
  seriesNumber,
  partNumber,
  partType,
  position,
  prompt,
  options = [],
  correct = "",
  points = null,
  metadata = {},
  correctMetadata = {},
}) => ({
  questionType: options.length
    ? partType === "single_choice" || partType === "three_way_choice" ? "multiple_choice" : "structured_b2_lesen_select"
    : "structured_b2_lesen_blank",
  prompt: String(prompt || "").trim(),
  options,
  correctAnswer: {
    value: correct,
    ...correctMetadata,
  },
  explanation: correctMetadata.modelAnswer || null,
  position,
  scoring: points !== null && points !== "" && Number.isFinite(Number(points)) ? { points: Number(points) } : {},
  metadata: {
    structuredB2Lesen: true,
    provider,
    seriesNumber,
    partNumber,
    partType,
    sourceQuestionNumber: position,
    ...metadata,
  },
  sectionType: "read",
});

const buildSection = ({ provider, seriesNumber, partNumber, title, instruction, partType, points, metadata, questions }) => ({
  sectionType: "read",
  partNumber,
  title,
  instructions: instruction,
  durationMinutes: null,
  points,
  scoring: points !== null && points !== "" && Number.isFinite(Number(points)) ? { points: Number(points) } : {},
  metadata: {
    structuredB2Lesen: {
      provider,
      seriesNumber,
      partNumber,
      partType,
      instruction,
      ...metadata,
    },
  },
  questions,
});

const parseLetterTableRows = (raw, allowedLetters) => {
  const allowed = new Set(allowedLetters.map((letter) => letter.toUpperCase()));
  const items = [];
  normalizeLineBreaks(raw).split(/\n\s*\n/).forEach((paragraph) => {
    const line = paragraph.replace(/\n/g, " ").trim();
    if (!line) return;
    const labels = [...line.matchAll(/(?:^|\s)([A-Z])\s+(?=\S)/g)]
      .filter((match) => allowed.has(match[1]))
      .slice(0, 2);
    if (!labels.length) return;
    if (labels.length === 1) {
      items.push({ value: labels[0][1], label: compactText(line.slice(labels[0].index + labels[0][0].length)) });
      return;
    }
    const first = labels[0];
    const second = labels[1];
    const firstStart = first.index + first[0].length;
    const secondStart = second.index + second[0].length;
    const firstBase = line.slice(firstStart, second.index).trim();
    const tail = line.slice(secondStart);
    const chunks = tail.split(/[ \t]{3,}/).map((chunk) => compactText(chunk)).filter(Boolean);
    const secondBase = chunks.shift() || "";
    const firstContinuation = chunks.shift() || "";
    const secondContinuation = chunks.join(" ");
    items.push({ value: first[1], label: compactText([firstBase, firstContinuation].filter(Boolean).join(" ")) });
    items.push({ value: second[1], label: compactText([secondBase, secondContinuation].filter(Boolean).join(" ")) });
  });
  return items.filter((item) => item.label);
};

const parseBracketAnswerMap = (raw) => {
  const lines = normalizeLineBreaks(raw).split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const numbers = [...lines[index].matchAll(/\[(\d{1,2})\]/g)].map((match) => Number(match[1]));
    if (!numbers.length) continue;
    const values = lines[index + 1].split(/\s+/).filter((value) => /^[A-M]$/i.test(value));
    if (values.length >= numbers.length) {
      return new Map(numbers.map((number, valueIndex) => [number, values[valueIndex].toUpperCase()]));
    }
  }
  return new Map();
};

const parseArrowCorrections = (raw) => {
  const answers = new Map();
  const text = normalizeLineBreaks(raw);
  const matches = getMatches(text, /(?:^|\n)\s*(\d{1,2})\.\s+/g);
  makeSlices(text, matches).forEach((block) => {
    const number = Number(block.match[1]);
    const arrow = block.text.match(/→\s*([\s\S]*?)(?=\n\s*\d{1,2}\.\s+|$)/);
    if (arrow) answers.set(number, compactText(arrow[1]));
  });
  return answers;
};

const splitEclPartOne = (studentContent) => {
  const answerSheetIndex = studentContent.search(/(?:^|\n)Antwortbogen\s+Teil\s+1\s*:/i);
  const beforeSheet = answerSheetIndex >= 0 ? studentContent.slice(0, answerSheetIndex) : studentContent;
  const finalGap = beforeSheet.lastIndexOf("[10]");
  const bankMatch = beforeSheet.slice(Math.max(0, finalGap)).match(/\n\n[A-M]\s+/);
  const bankStart = bankMatch ? Math.max(0, finalGap) + bankMatch.index : -1;
  const leading = bankStart >= 0 ? beforeSheet.slice(0, bankStart) : beforeSheet;
  const bankRaw = bankStart >= 0 ? beforeSheet.slice(bankStart).trim() : "";
  const { instruction, body: article } = splitFirstParagraph(leading);
  return { instruction, article, bankRaw };
};

const parseEclPartTwoQuestions = (studentContent) => {
  const firstQuestion = studentContent.search(/(?:^|\n)Frage\s+1\s*:/i);
  const leading = firstQuestion >= 0 ? studentContent.slice(0, firstQuestion) : studentContent;
  const { instruction, body: article } = splitFirstParagraph(leading);
  const questionText = firstQuestion >= 0 ? studentContent.slice(firstQuestion) : "";
  const matches = getMatches(questionText, /(?:^|\n)Frage\s+(\d{1,2})\s*:\s*/gi);
  const questions = makeSlices(questionText, matches).map((block) => ({
    number: Number(block.match[1]),
    prompt: compactText(block.text.slice(block.match[0].length).replace(/(?:^|\n)Antwort\s*:\s*_*[\s\S]*$/i, "")),
  }));
  return { instruction, article, questions };
};

const parseEclSeries = (text, metadata) => {
  const matches = getMatches(text, /(?:^|\n)SUJET\s+(\d{2})\s+-\s+([^\n]+)/gi);
  return makeSlices(text, matches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = compactText(seriesBlock.match[2]);
    const partMatches = getMatches(seriesBlock.text, /(?:^|\n)TEIL\s+([12])\s+-\s+([^\n]+)/gi);
    const sections = makeSlices(seriesBlock.text, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const partTitle = compactText(partBlock.match[2]);
      const studentContent = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_CONTENT\b/g, [/(?:^|\n)ANSWER_COMPONENT_SCHEMA\b/g]);
      const correction = getMarkerBlock(partBlock.text, /(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT\b/g, [/(?:^|\n)TEIL\s+[12]\s+-/g, /(?:^|\n)SUJET\s+\d{2}\s+-/g]);
      if (partNumber === 1) {
        const { instruction, article, bankRaw } = splitEclPartOne(studentContent);
        const bank = eclB2ReadingBanks[String(seriesNumber)] || parseLetterTableRows(bankRaw, "ABCDEFGHIJKLM".split(""));
        const answers = parseBracketAnswerMap(correction);
        const questions = [...article.matchAll(/\[(\d{1,2})\]\s*_{3,}/g)].map((match) => {
          const number = Number(match[1]);
          return buildQuestion({
            provider: "ecl",
            seriesNumber,
            partNumber,
            partType: "inline_letter_gap",
            position: number,
            prompt: `Lücke ${number}`,
            options: bank,
            correct: answers.get(number) || "",
            points: 1.25,
            metadata: { uniqueAnswers: true },
          });
        });
        const example = studentContent.match(/Beispiel\s*\[0\]\s*:\s*→\s*Antwort\s*:\s*([A-M])/i);
        return buildSection({
          provider: "ecl",
          seriesNumber,
          partNumber,
          title: `Teil 1: ${partTitle}`,
          instruction,
          partType: "inline_letter_gap",
          points: 12.5,
          metadata: {
            article,
            bank,
            uniqueAnswers: true,
            example: { number: 0, value: example?.[1]?.toUpperCase() || "I", locked: true },
          },
          questions,
        });
      }

      const parsed = parseEclPartTwoQuestions(studentContent);
      const answers = parseArrowCorrections(correction);
      const questions = parsed.questions.map((item) => {
        const modelAnswer = answers.get(item.number) || "";
        const requiresAllConcepts = /(?:min\.?\s*2|\(2\))/i.test(item.prompt);
        const requiredConcepts = requiresAllConcepts
          ? modelAnswer.split(/\s+(?:und|sowie)\s+|\s*[,;]\s*/i).map(compactText).filter(Boolean)
          : [];
        return buildQuestion({
          provider: "ecl",
          seriesNumber,
          partNumber,
          partType: "short_answer",
          position: item.number,
          prompt: item.prompt,
          correct: modelAnswer,
          points: 1.25,
          metadata: {
            answerNormalization: "strict-german-terminal-punctuation",
            manualReviewOnMismatch: true,
            requiresAllConcepts,
            requiredConcepts,
          },
          correctMetadata: {
            modelAnswer,
            acceptedAnswers: modelAnswer ? [modelAnswer] : [],
            requiredConcepts,
            manualReviewOnMismatch: true,
          },
        });
      });
      return buildSection({
        provider: "ecl",
        seriesNumber,
        partNumber,
        title: `Teil 2: ${partTitle}`,
        instruction: parsed.instruction,
        partType: "short_answer",
        points: 12.5,
        metadata: { article: parsed.article, manualReviewOnMismatch: true },
        questions,
      });
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `ECL B2 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ECL B2 Leseverstehen: zwei Teile, 45 Minuten, 25 Punkte.",
      scoring: { totalPoints: 25, globalDurationMinutes: 45, parts: { 1: 12.5, 2: 12.5 } },
      metadata: {
        ...metadata,
        globalDurationMinutes: 45,
        structuredB2Lesen: true,
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseColonAnswerMap = (raw) => {
  const answers = new Map();
  for (const match of normalizeLineBreaks(raw).matchAll(/(?:^|[|\n])\s*(\d{1,2})\s*:\s*([A-Z])\b/g)) {
    answers.set(Number(match[1]), match[2].toUpperCase());
  }
  return answers;
};

const splitTelcInstruction = (leading, partNumber) => {
  const text = normalizeLineBreaks(leading);
  const patterns = {
    1: /Nicht im Text\s*\(N\)\s*\?/i,
    2: /Eine Anzeige passt nicht\s*\./i,
    3: /Drei Sätze passen nicht\s*\./i,
  };
  const match = text.match(patterns[partNumber]);
  if (!match) return splitFirstParagraph(text);
  const end = match.index + match[0].length;
  return { instruction: text.slice(0, end).trim(), body: text.slice(end).trim() };
};

const parseTelcPartOne = (studentContent) => {
  const questionMatches = getMatches(studentContent, /(?:^|\n)\s*(\d{1,2})\.\s+/g)
    .filter((match) => Number(match[1]) >= 1 && Number(match[1]) <= 10);
  const firstQuestion = questionMatches[0]?.index ?? studentContent.length;
  const leading = splitTelcInstruction(studentContent.slice(0, firstQuestion), 1);
  const questions = makeSlices(studentContent.slice(firstQuestion), getMatches(studentContent.slice(firstQuestion), /(?:^|\n)\s*(\d{1,2})\.\s+/g))
    .map((block) => ({
      number: Number(block.match[1]),
      prompt: compactText(block.text.slice(block.match[0].length).replace(/\s*■\s*Richtig[\s\S]*$/i, "")),
    }))
    .filter((item) => item.number >= 1 && item.number <= 10);
  return { instruction: leading.instruction, article: leading.body, questions };
};

const parseTelcPartTwo = (studentContent) => {
  const statementStart = studentContent.search(/(?:^|\n)\s*11\.\s+/);
  const leading = statementStart >= 0 ? studentContent.slice(0, statementStart) : studentContent;
  const split = splitTelcInstruction(leading, 2);
  const ads = makeSlices(split.body, getMatches(split.body, /(?:^|\n)Anzeige\s+([A-F])\s*:\s*/gi)).map((block) => ({
    value: block.match[1].toUpperCase(),
    label: compactText(block.text.slice(block.match[0].length)),
  }));
  const questionText = statementStart >= 0 ? studentContent.slice(statementStart) : "";
  const questions = makeSlices(questionText, getMatches(questionText, /(?:^|\n)\s*(1[1-5])\.\s+/g)).map((block) => ({
    number: Number(block.match[1]),
    prompt: compactText(block.text.slice(block.match[0].length).replace(/\s*Anzeige\s*:\s*_*\s*$/i, "")),
  }));
  return { instruction: split.instruction, advertisements: ads, questions };
};

const parseInlineLetterBank = (raw, letters) => {
  const pattern = new RegExp(`(?:^|\\s)([${letters}])\\s+([\\s\\S]*?)(?=\\s+[${letters}]\\s+|$)`, "g");
  return [...raw.matchAll(pattern)].map((match) => ({
    value: match[1].toUpperCase(),
    label: compactText(match[2]),
  }));
};

const parseTelcPartThree = (studentContent) => {
  const split = splitTelcInstruction(studentContent, 3);
  const finalGap = Math.max(split.body.lastIndexOf("___20___"), split.body.lastIndexOf("__20__"));
  const bankStart = split.body.indexOf(" A ", Math.max(0, finalGap));
  const article = bankStart >= 0 ? split.body.slice(0, bankStart).trim() : split.body;
  const bankRaw = bankStart >= 0 ? split.body.slice(bankStart + 1).trim() : "";
  return {
    instruction: split.instruction,
    article,
    bank: parseInlineLetterBank(bankRaw, "A-H"),
    gaps: [...article.matchAll(/_{2,}\s*(1[6-9]|20)\s*_{2,}/g)].map((match) => Number(match[1])),
  };
};

const parseTelcSeries = (text, metadata) => {
  const matches = getMatches(text, /(?:^|\n)(?:ÜBUNGSHEFT|UEBUNGSHEFT)\s+(\d{2})\s+-\s+([^\n]+)/gi);
  return makeSlices(text, matches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = compactText(seriesBlock.match[2]);
    const partMatches = getMatches(seriesBlock.text, /(?:^|\n)TEIL\s+([123])\s+-\s+([^\n]+)/gi);
    const sections = makeSlices(seriesBlock.text, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const partTitle = compactText(partBlock.match[2]);
      const studentContent = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_CONTENT\b/g, [/(?:^|\n)ANSWER_COMPONENT_SCHEMA\b/g]);
      const correction = getMarkerBlock(partBlock.text, /(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT\b/g, [/(?:^|\n)TEIL\s+[123]\s+-/g, /(?:^|\n)(?:ÜBUNGSHEFT|UEBUNGSHEFT)\s+\d{2}\s+-/g]);
      const answers = parseColonAnswerMap(correction);
      if (partNumber === 1) {
        const parsed = parseTelcPartOne(studentContent);
        const options = [
          { value: "R", label: "Richtig" },
          { value: "F", label: "Falsch" },
          { value: "N", label: "Nicht im Text" },
        ];
        const questions = parsed.questions.map((item) => buildQuestion({
          provider: "telc", seriesNumber, partNumber, partType: "three_way_choice", position: item.number,
          prompt: item.prompt, options, correct: answers.get(item.number) || "",
          metadata: { sourceKeyReviewRequired: true },
        }));
        return buildSection({
          provider: "telc", seriesNumber, partNumber, title: `Teil 1: ${partTitle}`,
          instruction: parsed.instruction, partType: "three_way_choice", points: null,
          metadata: { article: parsed.article, sourceKeyReviewRequired: true }, questions,
        });
      }
      if (partNumber === 2) {
        const parsed = parseTelcPartTwo(studentContent);
        const questions = parsed.questions.map((item) => buildQuestion({
          provider: "telc", seriesNumber, partNumber, partType: "advertisement_matching", position: item.number,
          prompt: item.prompt, options: parsed.advertisements, correct: answers.get(item.number) || "",
          metadata: { uniqueAnswers: true, sourceKeyReviewRequired: true },
        }));
        return buildSection({
          provider: "telc", seriesNumber, partNumber, title: `Teil 2: ${partTitle}`,
          instruction: parsed.instruction, partType: "advertisement_matching", points: null,
          metadata: { advertisements: parsed.advertisements, uniqueAnswers: true, sourceKeyReviewRequired: true }, questions,
        });
      }
      const parsed = parseTelcPartThree(studentContent);
      const questions = parsed.gaps.map((number) => buildQuestion({
        provider: "telc", seriesNumber, partNumber, partType: "inline_sentence_gap", position: number,
        prompt: `Lücke ${number}`, options: parsed.bank, correct: answers.get(number) || "",
        metadata: { uniqueAnswers: true, sourceKeyReviewRequired: true },
      }));
      return buildSection({
        provider: "telc", seriesNumber, partNumber, title: `Teil 3: ${partTitle}`,
        instruction: parsed.instruction, partType: "inline_sentence_gap", points: null,
        metadata: { article: parsed.article, bank: parsed.bank, uniqueAnswers: true, sourceKeyReviewRequired: true }, questions,
      });
    });
    return {
      seriesNumber,
      title,
      sourceLabel: `TELC B2 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "TELC Deutsch B2 Lesen: drei Teile in einer Sitzung.",
      scoring: { globalDurationMinutes: 65 },
      metadata: {
        ...metadata,
        globalDurationMinutes: 65,
        structuredB2Lesen: true,
        sourceKeyReviewRequired: true,
        sourceWarnings: [
          "The restructured TELC source marks its printed answer keys for admin review; the imported keys are preserved unchanged.",
        ],
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseOsdChoiceQuestions = (studentContent) => {
  const questionStart = studentContent.search(/(?:^|\n)\s*1\.\s+/);
  const leading = questionStart >= 0 ? studentContent.slice(0, questionStart) : studentContent;
  const instructionMatch = leading.match(/Wählen Sie für jede Frage die richtige Antwort \(A, B oder C\)\s*:/i);
  const instruction = instructionMatch?.[0] || "Wählen Sie für jede Frage die richtige Antwort (A, B oder C):";
  const article = stripKnownLayoutArtifacts(
    leading
      .replace(/^\s*Punkte\)\s*/i, "")
      .replace(instruction, "")
  );
  const questionText = questionStart >= 0 ? studentContent.slice(questionStart) : "";
  const blocks = makeSlices(questionText, getMatches(questionText, /(?:^|\n)\s*([1-5])\.\s+/g));
  const questions = blocks.map((block) => {
    const raw = stripKnownLayoutArtifacts(block.text.slice(block.match[0].length));
    const options = [...raw.matchAll(/(?:^|\n)\s*([ABC])\)\s*([\s\S]*?)(?=\n\s*[ABC]\)|$)/g)].map((match) => ({
      value: match[1],
      label: compactText(match[2]),
    }));
    const prompt = compactText(raw.slice(0, raw.search(/(?:^|\n)\s*A\)\s*/)));
    return { number: Number(block.match[1]), prompt, options };
  });
  return { instruction, article, questions };
};

const findOsdCorrectChoice = (correction, question) => {
  const lineMatch = normalizeLineBreaks(correction).match(new RegExp(`(?:^|\\n)\\s*${question.number}\\s+([\\s\\S]*?)(?=\\n\\s*${question.number + 1}\\s+|$)`));
  const line = compactText(lineMatch?.[1] || "");
  for (const option of question.options) {
    const significant = compactText(option.label).slice(0, 22);
    if (significant.length >= 8 && line.includes(significant)) return option.value;
  }
  const letter = line.match(/(?:^|\s)([ABC])(?=\s|[A-ZÄÖÜ])/);
  return letter?.[1] || "";
};

const parseOsdHeadingPart = (studentContent) => {
  const firstParagraph = studentContent.search(/(?:^|\n)Absatz\s+1\b/i);
  const leading = firstParagraph >= 0 ? studentContent.slice(0, firstParagraph) : studentContent;
  const split = splitFirstParagraph(leading);
  const headingSource = split.body || leading.slice(split.instruction.length);
  const headings = makeSlices(headingSource, getMatches(headingSource, /(?:^|\n)([A-F])\)\s*/g)).map((block) => ({
    value: block.match[1],
    label: compactText(block.text.slice(block.match[0].length)),
  }));
  const paragraphText = firstParagraph >= 0 ? studentContent.slice(firstParagraph) : "";
  const paragraphs = makeSlices(paragraphText, getMatches(paragraphText, /(?:^|\n)Absatz\s+([1-5])\b/gi)).map((block) => ({
    number: Number(block.match[1]),
    prompt: stripKnownLayoutArtifacts(block.text.slice(block.match[0].length).replace(/(?:^|\n)Überschrift\s*:\s*_*\s*$/i, "")),
  }));
  return { instruction: split.instruction, headings, paragraphs };
};

const parseOsdHeadingAnswers = (correction, headings) => {
  const answers = new Map();
  for (const match of normalizeLineBreaks(correction).matchAll(/(?:^|\n)\s*([1-5])\s+([A-F])\s+/g)) {
    answers.set(Number(match[1]), match[2]);
  }
  if (answers.size === 5) return answers;
  for (const number of [1, 2, 3, 4, 5]) {
    const lineMatch = normalizeLineBreaks(correction).match(new RegExp(`(?:^|\\n)\\s*${number}\\s+([\\s\\S]*?)(?=\\n\\s*${number + 1}\\s+|$)`));
    const line = compactText(lineMatch?.[1] || "");
    const heading = headings.find((item) => line.includes(compactText(item.label).slice(0, 20)));
    if (heading) answers.set(number, heading.value);
  }
  return answers;
};

const parseNumberedWords = (raw, pattern) => {
  const map = new Map();
  for (const match of normalizeLineBreaks(raw).matchAll(pattern)) {
    map.set(Number(match[1]), String(match[2] || "").replace(/[.,;:]+$/, ""));
  }
  return map;
};

const splitOsdGapContent = (studentContent, partNumber) => {
  const text = normalizeLineBreaks(studentContent);
  const pattern = partNumber === 3
    ? /Ergänzen Sie die fehlenden Buchstaben\. Die Lücken sind durch Wort___ markiert\./i
    : /Ergänzen Sie die fehlenden Wörter\. Die Lücken sind nummeriert \(__1__\) bis \(__10__\)\. Schreiben Sie Ihre Antworten auf den Antwortbogen\./i;
  const match = text.match(pattern);
  if (!match) return splitFirstParagraph(text);
  const end = match.index + match[0].length;
  return {
    instruction: text.slice(0, end).trim(),
    body: text.slice(end).trim(),
  };
};

const parseOsdSeries = (text, metadata) => {
  const matches = getMatches(text, /(?:^|\n)(?:PRÜFUNG|PRUEFUNG)\s+(\d{2})\s+-\s+([^\n]+)/gi);
  return makeSlices(text, matches).map((seriesBlock) => {
    const seriesNumber = Number(seriesBlock.match[1]);
    const title = compactText(seriesBlock.match[2]);
    const partMatches = getMatches(seriesBlock.text, /(?:^|\n)AUFGABE\s+([1-4])\s+-\s+([^\n]+)/gi);
    const sections = makeSlices(seriesBlock.text, partMatches).map((partBlock) => {
      const partNumber = Number(partBlock.match[1]);
      const partTitle = compactText(partBlock.match[2]).replace(/\s*\(\d+\s*$/, "");
      const studentContent = getMarkerBlock(partBlock.text, /(?:^|\n)STUDENT_VISIBLE_CONTENT\b/g, [/(?:^|\n)ANSWER_COMPONENT_SCHEMA\b/g]);
      const correction = getMarkerBlock(partBlock.text, /(?:^|\n)CORRECTION_VISIBLE_AFTER_SUBMIT\b/g, [/(?:^|\n)AUFGABE\s+[1-4]\s+-/g, /(?:^|\n)(?:PRÜFUNG|PRUEFUNG)\s+\d{2}\s+-/g]);
      if (partNumber === 1) {
        const parsed = parseOsdChoiceQuestions(studentContent);
        const questions = parsed.questions.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "single_choice", position: item.number,
          prompt: item.prompt, options: item.options, correct: findOsdCorrectChoice(correction, item), points: 1,
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Aufgabe 1: ${partTitle}`,
          instruction: parsed.instruction, partType: "single_choice", points: 5,
          metadata: { article: parsed.article }, questions,
        });
      }
      if (partNumber === 2) {
        const parsed = parseOsdHeadingPart(studentContent);
        const answers = parseOsdHeadingAnswers(correction, parsed.headings);
        const questions = parsed.paragraphs.map((item) => buildQuestion({
          provider: "osd", seriesNumber, partNumber, partType: "heading_matching", position: item.number,
          prompt: item.prompt, options: parsed.headings, correct: answers.get(item.number) || "", points: 1,
          metadata: { uniqueAnswers: true },
        }));
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Aufgabe 2: ${partTitle}`,
          instruction: parsed.instruction, partType: "heading_matching", points: 5,
          metadata: { headings: parsed.headings, uniqueAnswers: true }, questions,
        });
      }
      if (partNumber === 3) {
        const parsed = splitOsdGapContent(studentContent, 3);
        const article = stripKnownLayoutArtifacts(parsed.body);
        const sourceAnswers = osdB2MissingLetterAnswers[String(seriesNumber)] || {};
        const fallbackAnswers = parseNumberedWords(correction, /(?:^|\s)(\d{1,2})\.\s+([\p{L}ßÄÖÜäöü-]+)/gu);
        const answers = new Map(
          Object.keys(sourceAnswers).length
            ? Object.entries(sourceAnswers).map(([number, word]) => [Number(number), word])
            : fallbackAnswers
        );
        const gaps = [...article.matchAll(/([\p{L}ßÄÖÜäöü-]+)_{3,}/gu)];
        const questions = gaps.map((match, index) => {
          const number = index + 1;
          const prefix = match[1];
          const expectedWord = answers.get(number) || "";
          const prefixMatches = expectedWord.toLocaleLowerCase("de-DE").startsWith(prefix.toLocaleLowerCase("de-DE"));
          const suffix = prefixMatches
            ? expectedWord.slice(prefix.length)
            : "";
          return buildQuestion({
            provider: "osd", seriesNumber, partNumber, partType: "missing_letters", position: number,
            prompt: `${prefix}___`, correct: suffix || expectedWord, points: 0.25,
            metadata: {
              visiblePrefix: prefix,
              expectedWord,
              answerNormalization: "strict-german",
              auditCompletedWord: true,
              sourcePrefixMismatch: !prefixMatches,
              manualReviewOnMismatch: !prefixMatches,
            },
            correctMetadata: {
              expectedWord,
              visiblePrefix: prefix,
              expectedSuffix: suffix,
              sourcePrefixMismatch: !prefixMatches,
              manualReviewOnMismatch: !prefixMatches,
            },
          });
        });
        return buildSection({
          provider: "osd", seriesNumber, partNumber, title: `Aufgabe 3: ${partTitle}`,
          instruction: parsed.instruction, partType: "missing_letters", points: 5,
          metadata: { article }, questions,
        });
      }
      const parsed = splitOsdGapContent(studentContent, 4);
      const article = stripKnownLayoutArtifacts(parsed.body);
      const answers = parseNumberedWords(correction, /\((\d{1,2})\)\s+([\p{L}ßÄÖÜäöü-]+)/gu);
      const gaps = [...article.matchAll(/\(__?(\d{1,2})__?\)/g)].map((match) => Number(match[1]));
      const questions = gaps.map((number) => buildQuestion({
        provider: "osd", seriesNumber, partNumber, partType: "missing_word", position: number,
        prompt: `Lücke ${number}`, correct: answers.get(number) || "", points: 0.5,
        metadata: { answerNormalization: "strict-german" },
      }));
      return buildSection({
        provider: "osd", seriesNumber, partNumber, title: `Aufgabe 4: ${partTitle}`,
        instruction: parsed.instruction, partType: "missing_word", points: 5,
        metadata: { article }, questions,
      });
    });
    const sourceWarnings = [];
    const missingLettersSection = sections.find((section) => section.partNumber === 3);
    if (missingLettersSection && missingLettersSection.questions.length !== 20) {
      sourceWarnings.push(
        `Pruefung ${String(seriesNumber).padStart(2, "0")} Aufgabe 3 contains ${missingLettersSection.questions.length} visible gaps although the source correction lists 20 answers.`
      );
    }
    const prefixMismatches = (missingLettersSection?.questions || [])
      .filter((question) => question.metadata?.sourcePrefixMismatch)
      .map((question) => question.position);
    if (prefixMismatches.length) {
      sourceWarnings.push(
        `Pruefung ${String(seriesNumber).padStart(2, "0")} Aufgabe 3 has source prefix/key mismatches at items ${prefixMismatches.join(", ")}; these answers require manual review.`
      );
    }
    if (missingLettersSection && sourceWarnings.length) {
      missingLettersSection.metadata.structuredB2Lesen.sourceWarnings = sourceWarnings;
    }
    return {
      seriesNumber,
      title,
      sourceLabel: `ÖSD B2 Lesen ${String(seriesNumber).padStart(2, "0")}`,
      instructions: "ÖSD Zertifikat B2 Lesen: vier Aufgaben, 90 Minuten, 20 Punkte.",
      scoring: { totalPoints: 20, globalDurationMinutes: 90, parts: { 1: 5, 2: 5, 3: 5, 4: 5 } },
      metadata: {
        ...metadata,
        globalDurationMinutes: 90,
        structuredB2Lesen: true,
        sourceWarnings,
        replacePublishedScope: true,
      },
      sections,
    };
  });
};

const parseB2StructuredLesenSeries = (text, metadata = {}) => {
  const provider = String(metadata.provider || "").toLowerCase();
  if (provider === "ecl") return parseEclSeries(text, metadata);
  if (provider === "telc") return parseTelcSeries(text, metadata);
  if (provider === "osd") return parseOsdSeries(text, metadata);
  return [];
};

module.exports = {
  parseB2StructuredLesenSeries,
};
