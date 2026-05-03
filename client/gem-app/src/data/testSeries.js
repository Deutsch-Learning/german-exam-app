import { examSimulations } from "./siteContent";

export const simulationModules = [
  {
    id: "listen",
    label: "Compr\u00e9hension Orale",
    shortLabel: "Oral comprehension",
    description: "Audio tasks, details, order of information, and focused note-taking.",
  },
  {
    id: "read",
    label: "Compr\u00e9hension \u00c9crite",
    shortLabel: "Written comprehension",
    description: "Academic texts, inference, matching, and vocabulary in context.",
  },
  {
    id: "speak",
    label: "Expression Orale",
    shortLabel: "Oral expression",
    description: "Timed prompts, personal argumentation, image description, and role-play.",
  },
  {
    id: "write",
    label: "Expression \u00c9crite",
    shortLabel: "Written expression",
    description: "Formal emails, essays, synthesis, and structured written answers.",
  },
];

const examSeriesSeeds = {
  testdaf: {
    series: [
      {
        id: "series-101",
        code: "Series 101",
        title: "University Orientation",
        level: "B1-B2",
        duration: "4 modules",
        theme: "university orientation week",
        setting: "a German campus preparing international students for their first semester",
        readingTopic: "orientation schedules and campus services",
        listeningTopic: "an announcement from the international office",
        writingTopic: "asking the international office for missing registration documents",
        speakingTopic: "explaining how you prepare for a first semester abroad",
      },
      {
        id: "series-102",
        code: "Series 102",
        title: "Academic Research",
        level: "B2-C1",
        duration: "4 modules",
        theme: "student research projects",
        setting: "a university department organizing research presentations",
        readingTopic: "library databases and research deadlines",
        listeningTopic: "a seminar coordinator describing project rules",
        writingTopic: "arguing for more research support for international students",
        speakingTopic: "presenting a research topic and defending your method",
      },
      {
        id: "series-103",
        code: "Series 103",
        title: "Campus Life",
        level: "B2",
        duration: "4 modules",
        theme: "student life and housing",
        setting: "student housing, study groups, and campus appointments",
        readingTopic: "housing rules and shared study spaces",
        listeningTopic: "a student-service update about room bookings",
        writingTopic: "requesting a housing change because of exam preparation",
        speakingTopic: "comparing private housing and student residences",
      },
    ],
  },
  dsh: {
    series: [
      {
        id: "series-101",
        code: "Series 101",
        title: "Lecture Hall Entry",
        level: "B2",
        duration: "4 modules",
        theme: "DSH entrance preparation",
        setting: "a university language center preparing candidates for admission",
        readingTopic: "lecture notes and admission language requirements",
        listeningTopic: "a lecturer explaining an entrance-test timetable",
        writingTopic: "summarizing why academic German matters for admission",
        speakingTopic: "describing your study goal and language plan",
      },
      {
        id: "series-102",
        code: "Series 102",
        title: "Academic Debate",
        level: "B2-C1",
        duration: "4 modules",
        theme: "academic debate and argumentation",
        setting: "a DSH preparation course focused on university discussion",
        readingTopic: "arguments about digital lectures",
        listeningTopic: "a classroom debate about hybrid study formats",
        writingTopic: "taking a position on online lectures at university",
        speakingTopic: "reacting to an examiner's opinion about digital learning",
      },
      {
        id: "series-103",
        code: "Series 103",
        title: "Exam Conditions",
        level: "C1",
        duration: "4 modules",
        theme: "strict exam conditions",
        setting: "a DSH exam center explaining rules and expectations",
        readingTopic: "exam regulations and permitted materials",
        listeningTopic: "an examiner announcing procedure changes",
        writingTopic: "describing how exam rules influence fair assessment",
        speakingTopic: "explaining how you handle pressure during oral exams",
      },
    ],
  },
  goethe: {
    series: [
      {
        id: "series-101",
        code: "Series 101",
        title: "Everyday Communication",
        level: "B1-B2",
        duration: "4 modules",
        theme: "everyday communication",
        setting: "daily appointments, services, and formal requests in German",
        readingTopic: "public-service notices and appointment rules",
        listeningTopic: "a service desk explaining an appointment change",
        writingTopic: "writing a formal request to move an appointment",
        speakingTopic: "describing a daily problem and proposing a solution",
      },
      {
        id: "series-102",
        code: "Series 102",
        title: "Work And Training",
        level: "B2",
        duration: "4 modules",
        theme: "professional training",
        setting: "workplace language, internships, and training opportunities",
        readingTopic: "training-program descriptions and requirements",
        listeningTopic: "an HR update about an internship program",
        writingTopic: "applying for a professional development course",
        speakingTopic: "presenting your work experience and learning goals",
      },
      {
        id: "series-103",
        code: "Series 103",
        title: "Culture And Society",
        level: "B2-C1",
        duration: "4 modules",
        theme: "culture and society",
        setting: "public discussion about culture, media, and community life",
        readingTopic: "an article about local cultural participation",
        listeningTopic: "a radio segment about community events",
        writingTopic: "arguing whether cultural events should be free for students",
        speakingTopic: "discussing how culture helps language learning",
      },
    ],
  },
  telc: {
    series: [
      {
        id: "series-101",
        code: "Series 101",
        title: "Integration Basics",
        level: "B1-B2",
        duration: "4 modules",
        theme: "integration and administration",
        setting: "appointments, documents, and everyday public services",
        readingTopic: "administrative letters and deadline notices",
        listeningTopic: "a citizen-office message about documents",
        writingTopic: "asking for clarification about a document deadline",
        speakingTopic: "explaining an administrative problem politely",
      },
      {
        id: "series-102",
        code: "Series 102",
        title: "Workplace German",
        level: "B2",
        duration: "4 modules",
        theme: "workplace communication",
        setting: "team meetings, customer messages, and internal procedures",
        readingTopic: "workplace guidelines and shift information",
        listeningTopic: "a team lead explaining new procedures",
        writingTopic: "informing a supervisor about a schedule conflict",
        speakingTopic: "negotiating a practical solution with a colleague",
      },
      {
        id: "series-103",
        code: "Series 103",
        title: "Public Services",
        level: "B2-C1",
        duration: "4 modules",
        theme: "public services and community support",
        setting: "community offices, health services, and local information",
        readingTopic: "public information about health and community courses",
        listeningTopic: "a local-office announcement about new services",
        writingTopic: "giving feedback on access to public services",
        speakingTopic: "describing how public services support newcomers",
      },
    ],
  },
};

const makeReadingPassage = (series) => ({
  title: `${series.code}: ${series.readingTopic}`,
  intro: `Read the text about ${series.setting}, then answer the questions for ${series.theme}.`,
  paragraphs: [
    {
      id: "A",
      text: `The first notice describes ${series.readingTopic}. Candidates must identify dates, responsible offices, and the reason for the update.`,
    },
    {
      id: "B",
      text: `A second section explains how students should react when information is missing. It links the topic to ${series.setting}.`,
    },
    {
      id: "C",
      text: `The text then compares two options and asks readers to understand advantages, limits, and implied recommendations.`,
    },
    {
      id: "D",
      text: `The final paragraph gives practical restrictions. These details are important for the selected ${series.code} exercise set.`,
    },
  ],
});

const makeAudio = (examName, series) => ({
  title: `${series.code}: ${series.listeningTopic}`,
  speaker: `${examName} audio task, clear standard German`,
  duration: 110,
  maxReplays: 5,
  trainingReplays: 5,
  transcript: `Guten Tag. In dieser Aufgabe hoeren Sie Informationen ueber ${series.listeningTopic}. Achten Sie besonders auf Termine, Reihenfolge und Begruendungen. Die Situation spielt in ${series.setting}. Notieren Sie die wichtigste Aenderung und den naechsten Schritt fuer die Kandidaten.`,
  rate: 0.9,
});

const makeTaskOverrides = (examName, series, moduleId) => {
  if (moduleId === "read") {
    return [
      {
        question: `What is the central topic of ${series.code}?`,
        options: [
          { value: "a", label: series.readingTopic },
          { value: "b", label: "a restaurant menu" },
          { value: "c", label: "a train cancellation" },
        ],
        correct: "a",
        hint: `Look for the repeated topic in ${series.code}.`,
        explanation: `${series.code} focuses on ${series.readingTopic}.`,
      },
      {
        question: `The text is connected to ${series.setting}.`,
        correct: "true",
        hint: "Check the introduction and paragraph B.",
        explanation: `The text explicitly places the task in ${series.setting}.`,
      },
    ];
  }

  if (moduleId === "listen") {
    return [
      {
        question: `What should candidates listen for in ${series.code}?`,
        options: [
          { value: "a", label: "dates, order, and reasons" },
          { value: "b", label: "sport results only" },
          { value: "c", label: "weather forecasts only" },
        ],
        correct: "a",
        hint: "The audio names the important listening targets.",
        explanation: "The transcript asks candidates to follow dates, order, and reasons.",
      },
      {
        question: `The audio topic is ${series.listeningTopic}.`,
        correct: "true",
        hint: "Listen to the opening sentence.",
        explanation: `${series.code} uses a listening task about ${series.listeningTopic}.`,
      },
    ];
  }

  if (moduleId === "write") {
    return [
      {
        title: `${series.code}: ${series.writingTopic}`,
        prompt: `Write a formal German text for the ${examName} task. Topic: ${series.writingTopic}. Include the situation, two concrete details, and a polite closing.`,
        criteria: ["situation", "two concrete details", "polite closing"],
      },
      {
        title: `${series.code}: argument`,
        prompt: `Give your opinion on ${series.theme}. Present one advantage, one problem, and your recommendation for candidates.`,
        criteria: ["opinion", "advantage and problem", "recommendation"],
      },
    ];
  }

  return [
    {
      title: `${series.code}: ${series.speakingTopic}`,
      prompt: `Speak about ${series.speakingTopic}. Give one personal example and one clear recommendation.`,
      checklist: ["topic", "example", "recommendation"],
    },
    {
      title: `${series.code}: examiner follow-up`,
      prompt: `React to this examiner question: How does ${series.theme} affect your preparation?`,
      checklist: ["reaction", "reason", "clear structure"],
    },
  ];
};

const buildSeries = (exam) => {
  const examMeta = examSimulations.find((item) => item.id === exam.id);
  return exam.series.map((series, index) => ({
    ...series,
    isFree: series.isFree ?? index === 0,
    examId: exam.id,
    examName: examMeta?.name ?? exam.id,
    accent: examMeta?.accent ?? "#c10016",
    modules: Object.fromEntries(
      simulationModules.map((module) => [
        module.id,
        {
          ...module,
          theme: series.theme,
          focus: [series.theme, module.shortLabel, series.level, series.code],
          advancement: [
            `${series.code} dedicated ${module.shortLabel.toLowerCase()} tasks`,
            `Topic: ${series.theme}`,
            `Level target: ${series.level}`,
            "Review feedback before moving to the next series",
          ],
          passage: module.id === "read" ? makeReadingPassage(series) : undefined,
          audio: module.id === "listen" ? makeAudio(examMeta?.name ?? exam.id, series) : undefined,
          taskOverrides: makeTaskOverrides(examMeta?.name ?? exam.id, series, module.id),
        },
      ])
    ),
  }));
};

export const testSeriesByExam = Object.fromEntries(
  Object.entries(examSeriesSeeds).map(([examId, exam]) => [examId, buildSeries({ id: examId, ...exam })])
);

export const getExamSimulation = (examId) =>
  examSimulations.find((exam) => exam.id === examId) ?? null;

export const getSeriesForExam = (examId) => testSeriesByExam[examId] ?? [];

export const getSeriesById = (examId, seriesId) =>
  getSeriesForExam(examId).find((series) => series.id === seriesId) ?? null;

export const getSeriesModuleContent = (examId, seriesId, moduleId) =>
  getSeriesById(examId, seriesId)?.modules?.[moduleId] ?? null;
