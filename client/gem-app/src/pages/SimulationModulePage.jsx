/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock3,
  FileText,
  Flag,
  Gauge,
  Headphones,
  History,
  Home,
  Lock,
  Mic,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  SkipForward,
  Square,
  TimerReset,
  Trophy,
  Volume2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import API from "../services/api";
import styles from "./SimulationModulePage.module.css";
import logo from "../assets/images/logo.png";
import speakingImage from "../assets/images/active_people.png";
import BackButton from "../components/BackButton";
import { getTranslations } from "../context/LanguageContext";
import { getSeriesById, getSeriesModuleContent } from "../data/testSeries";
import { getProgressKey, upsertSimulationHistoryEntry } from "../utils/simulationHistory";
import { canOpenSeries, getAuthUser, isVisitorSeriesAttempt } from "../utils/access";
import { useTestProtection } from "../utils/testProtection";
import NotFoundPage from "./NotFoundPage";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const PASS_SCORE = 70;

const readingPassage = {
  title: "La bibliothèque universitaire devient plus flexible",
  intro:
    "Le texte suivant présente une nouvelle organisation de la bibliothèque d'une université allemande. Lisez-le attentivement puis répondez aux questions.",
  paragraphs: [
    {
      id: "A",
      heading: "Un accès plus long",
      text:
        "À partir du mois de mai, la bibliothèque centrale de l'Université de Leipzig ouvrira ses portes jusqu'à 22 h du lundi au jeudi. Cette décision répond à une demande fréquente des étudiants qui travaillent en journée ou qui préparent des examens intensifs.",
    },
    {
      id: "B",
      heading: "Des espaces adaptés",
      text:
        "Le premier étage sera réservé au travail silencieux, tandis que le rez-de-chaussée accueillera les groupes. Des salles pourront être réservées en ligne pour deux heures, avec une priorité donnée aux projets de semestre.",
    },
    {
      id: "C",
      heading: "Un programme de soutien",
      text:
        "La bibliothèque proposera aussi des ateliers courts sur la recherche documentaire, la citation des sources et l'utilisation des bases de données allemandes. Les inscriptions se feront via la plateforme Bibliothek Plus.",
    },
    {
      id: "D",
      heading: "Quelques limites",
      text:
        "Le service de prêt ne sera pas disponible après 19 h. Les étudiants pourront cependant rendre les livres dans une boîte automatique située près de l'entrée principale.",
    },
  ],
};

const readingTasks = [
  {
    id: "read-1",
    level: "A1",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Quel est le changement principal annoncé dans le texte ?",
    options: [
      { value: "a", label: "La bibliothèque ferme pendant les examens." },
      { value: "b", label: "La bibliothèque reste ouverte plus tard certains jours." },
      { value: "c", label: "La bibliothèque devient payante." },
    ],
    correct: "b",
    hint: "Repérez les horaires dans le paragraphe A.",
    explanation: "Le paragraphe A annonce une ouverture jusqu'à 22 h du lundi au jeudi.",
  },
  {
    id: "read-2",
    level: "A1",
    type: "trueFalse",
    typeLabel: "Vrai / Faux",
    question: "Le rez-de-chaussée est réservé au travail silencieux.",
    correct: "false",
    hint: "Comparez les deux espaces décrits dans le paragraphe B.",
    explanation: "Le travail silencieux se fait au premier étage. Le rez-de-chaussée accueille les groupes.",
  },
  {
    id: "read-3",
    level: "A2",
    type: "blank",
    typeLabel: "Texte à trou",
    question: "Complétez : les inscriptions aux ateliers se feront via la plateforme ____.",
    correct: "Bibliothek Plus",
    alternatives: ["bibliothek plus"],
    hint: "La réponse se trouve à la fin du paragraphe C.",
    explanation: "La plateforme citée est Bibliothek Plus.",
  },
  {
    id: "read-4",
    level: "A2",
    type: "match",
    typeLabel: "Associer les titres",
    question: "Associez chaque paragraphe à son idée principale.",
    paragraphs: ["A", "B", "C"],
    headings: ["Des espaces adaptés", "Un accès plus long", "Un programme de soutien"],
    correct: {
      A: "Un accès plus long",
      B: "Des espaces adaptés",
      C: "Un programme de soutien",
    },
    hint: "Cherchez d'abord le mot clé de chaque paragraphe.",
    explanation: "Chaque paragraphe annonce une fonction précise : horaires, espaces, puis ateliers.",
  },
  {
    id: "read-5",
    level: "B1",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Pourquoi l'université modifie-t-elle les horaires ?",
    options: [
      { value: "a", label: "Pour répondre aux besoins des étudiants." },
      { value: "b", label: "Pour réduire les coûts du personnel." },
      { value: "c", label: "Pour remplacer les cours du soir." },
    ],
    correct: "a",
    hint: "La justification apparaît dans la deuxième phrase du paragraphe A.",
    explanation: "Le texte parle d'une demande fréquente des étudiants.",
  },
  {
    id: "read-6",
    level: "B1",
    type: "trueFalse",
    typeLabel: "Vrai / Faux",
    question: "Les salles de groupe peuvent être réservées en ligne.",
    correct: "true",
    hint: "Relisez le paragraphe B.",
    explanation: "Le texte précise que les salles pourront être réservées en ligne pour deux heures.",
  },
  {
    id: "read-7",
    level: "B2",
    type: "blank",
    typeLabel: "Texte à trou",
    question: "Après 19 h, les étudiants peuvent rendre les livres dans une boîte ____.",
    correct: "automatique",
    alternatives: ["automatique"],
    hint: "La limite et l'alternative sont décrites dans le paragraphe D.",
    explanation: "La boîte de retour est automatique et située près de l'entrée principale.",
  },
  {
    id: "read-8",
    level: "B2",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Quelle nuance est importante concernant le prêt de livres ?",
    options: [
      { value: "a", label: "Le prêt continue toute la nuit." },
      { value: "b", label: "Le prêt est fermé après 19 h, mais les retours restent possibles." },
      { value: "c", label: "Les retours sont interdits après 19 h." },
    ],
    correct: "b",
    hint: "Le paragraphe D oppose une limite et une possibilité.",
    explanation: "Le prêt ferme après 19 h, mais les retours sont possibles dans la boîte automatique.",
  },
  {
    id: "read-9",
    level: "C1",
    type: "match",
    typeLabel: "Associer les titres",
    question: "Quel titre correspond le mieux aux paragraphes B, C et D ?",
    paragraphs: ["B", "C", "D"],
    headings: ["Organisation des lieux", "Services pédagogiques", "Restrictions pratiques"],
    correct: {
      B: "Organisation des lieux",
      C: "Services pédagogiques",
      D: "Restrictions pratiques",
    },
    hint: "Résumez chaque paragraphe en deux mots avant de choisir.",
    explanation: "B organise les espaces, C présente les ateliers, D précise les limites de service.",
  },
  {
    id: "read-10",
    level: "C2",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Quel ton général caractérise l'annonce ?",
    options: [
      { value: "a", label: "Informatif avec quelques conditions pratiques." },
      { value: "b", label: "Critique et ironique." },
      { value: "c", label: "Publicitaire sans détails concrets." },
    ],
    correct: "a",
    hint: "Observez la structure : annonce, modalités, limites.",
    explanation: "L'annonce donne des informations concrètes et mentionne les limites du service.",
  },
];

const listeningTasks = [
  {
    id: "listen-1",
    level: "A1",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Où se déroule l'annonce ?",
    options: [
      { value: "a", label: "Dans une gare." },
      { value: "b", label: "Dans une bibliothèque." },
      { value: "c", label: "Dans un restaurant." },
    ],
    correct: "a",
    hint: "Écoutez les mots liés au transport.",
    explanation: "Le document parle d'un train, d'un quai et de voyageurs.",
  },
  {
    id: "listen-2",
    level: "A1",
    type: "blank",
    typeLabel: "Mot manquant",
    question: "Le train à destination de Berlin partira du quai ____.",
    correct: "7",
    alternatives: ["sept"],
    hint: "Le numéro est répété après le changement.",
    explanation: "L'annonce indique que le train partira du quai 7.",
  },
  {
    id: "listen-3",
    level: "A2",
    type: "trueFalse",
    typeLabel: "Vrai / Faux",
    question: "Le train part avec quinze minutes de retard.",
    correct: "true",
    hint: "Concentrez-vous sur l'expression de durée.",
    explanation: "L'annonce mentionne un retard d'environ quinze minutes.",
  },
  {
    id: "listen-4",
    level: "A2",
    type: "order",
    typeLabel: "Mettre en ordre",
    question: "Remettez les événements dans l'ordre entendu.",
    events: [
      { value: "change", label: "Changement de quai" },
      { value: "delay", label: "Annonce du retard" },
      { value: "coffee", label: "Conseil aux voyageurs" },
    ],
    correct: ["change", "delay", "coffee"],
    hint: "Notez les connecteurs comme d'abord, ensuite, enfin.",
    explanation: "L'annonce commence par le changement de quai, précise le retard, puis conseille d'attendre près du café.",
  },
  {
    id: "listen-5",
    level: "B1",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Pourquoi les voyageurs doivent-ils rester attentifs ?",
    options: [
      { value: "a", label: "Le quai pourrait encore changer." },
      { value: "b", label: "Les billets ne sont plus valables." },
      { value: "c", label: "Le train est supprimé." },
    ],
    correct: "a",
    hint: "Écoutez la dernière recommandation.",
    explanation: "L'annonce demande de surveiller les écrans au cas où le quai changerait encore.",
  },
  {
    id: "listen-6",
    level: "B1",
    type: "blank",
    typeLabel: "Mot manquant",
    question: "Les passagers peuvent attendre près du ____ au niveau inférieur.",
    correct: "café",
    alternatives: ["cafe"],
    hint: "Le lieu est donné après le conseil pratique.",
    explanation: "Le café au niveau inférieur est cité comme lieu d'attente.",
  },
  {
    id: "listen-7",
    level: "B2",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Quelle information n'est pas donnée dans l'annonce ?",
    options: [
      { value: "a", label: "Le nouveau quai." },
      { value: "b", label: "La cause exacte du retard." },
      { value: "c", label: "La destination du train." },
    ],
    correct: "b",
    hint: "Distinguez les faits annoncés des raisons absentes.",
    explanation: "L'annonce donne le quai et la destination, mais pas la cause exacte du retard.",
  },
  {
    id: "listen-8",
    level: "B2",
    type: "trueFalse",
    typeLabel: "Vrai / Faux",
    question: "Les voyageurs doivent se présenter immédiatement à un guichet.",
    correct: "false",
    hint: "Le conseil concerne surtout l'attente et les écrans.",
    explanation: "Aucun passage ne demande d'aller au guichet.",
  },
  {
    id: "listen-9",
    level: "C1",
    type: "order",
    typeLabel: "Mettre en ordre",
    question: "Classez ces informations selon leur importance dans l'annonce.",
    events: [
      { value: "platform", label: "Nouveau quai" },
      { value: "delay", label: "Retard prévu" },
      { value: "screens", label: "Surveiller les écrans" },
    ],
    correct: ["platform", "delay", "screens"],
    hint: "L'information principale est celle qui permet de ne pas manquer le train.",
    explanation: "Le nouveau quai est prioritaire, puis le retard, puis la recommandation de suivi.",
  },
  {
    id: "listen-10",
    level: "C2",
    type: "multiple",
    typeLabel: "Choix multiple",
    question: "Quel registre décrit le mieux l'annonce ?",
    options: [
      { value: "a", label: "Formel, bref et fonctionnel." },
      { value: "b", label: "Familier et humoristique." },
      { value: "c", label: "Narratif et personnel." },
    ],
    correct: "a",
    hint: "Les annonces publiques utilisent souvent des formules directes.",
    explanation: "Le document transmet des informations pratiques dans un registre formel.",
  },
];

const writingTasks = [
  {
    id: "write-1",
    level: "A1",
    typeLabel: "Email court",
    title: "Demander une information",
    register: "formel",
    minWords: 45,
    targetWords: 70,
    maxWords: 100,
    prompt:
      "Écrivez un email à une école de langue à Berlin. Demandez les horaires du cours A2, le prix et la date d'inscription.",
    criteria: ["salutation", "trois questions claires", "formule de politesse"],
  },
  {
    id: "write-2",
    level: "A1",
    typeLabel: "Message personnel",
    title: "Inviter un ami",
    register: "informel",
    minWords: 45,
    targetWords: 70,
    maxWords: 100,
    prompt:
      "Écrivez à un ami allemand pour l'inviter à visiter votre ville ce week-end. Proposez deux activités.",
    criteria: ["ton naturel", "date ou moment", "deux activités"],
  },
  {
    id: "write-3",
    level: "A2",
    typeLabel: "Email pratique",
    title: "Changer un rendez-vous",
    register: "formel",
    minWords: 60,
    targetWords: 90,
    maxWords: 130,
    prompt:
      "Vous ne pouvez pas venir à un rendez-vous administratif. Écrivez un email pour vous excuser et proposer deux nouveaux créneaux.",
    criteria: ["excuse", "raison simple", "deux propositions"],
  },
  {
    id: "write-4",
    level: "B1",
    typeLabel: "Opinion courte",
    title: "Apprendre en ligne",
    register: "neutre",
    minWords: 90,
    targetWords: 130,
    maxWords: 170,
    prompt:
      "Donnez votre opinion sur les cours de langue en ligne. Présentez un avantage, un inconvénient et votre préférence personnelle.",
    criteria: ["opinion claire", "connecteurs", "exemple personnel"],
  },
  {
    id: "write-5",
    level: "B1",
    typeLabel: "Email de réclamation",
    title: "Problème de logement",
    register: "formel",
    minWords: 100,
    targetWords: 140,
    maxWords: 190,
    prompt:
      "Vous avez réservé une chambre mais le chauffage ne fonctionne pas. Écrivez à la résidence pour décrire le problème et demander une solution.",
    criteria: ["description précise", "demande claire", "registre poli"],
  },
  {
    id: "write-6",
    level: "B2",
    typeLabel: "Essai structuré",
    title: "Transports publics",
    register: "neutre",
    minWords: 140,
    targetWords: 190,
    maxWords: 250,
    prompt:
      "Les transports publics devraient-ils être gratuits pour les étudiants ? Développez votre point de vue avec deux arguments et une limite.",
    criteria: ["introduction", "arguments contrastés", "conclusion"],
  },
  {
    id: "write-7",
    level: "B2",
    typeLabel: "Article d'opinion",
    title: "Travail et études",
    register: "neutre",
    minWords: 150,
    targetWords: 210,
    maxWords: 270,
    prompt:
      "Faut-il travailler pendant ses études ? Présentez les bénéfices, les risques et une recommandation pour les étudiants internationaux.",
    criteria: ["nuance", "exemples", "recommandation"],
  },
  {
    id: "write-8",
    level: "C1",
    typeLabel: "Argumentation",
    title: "Intelligence artificielle",
    register: "formel",
    minWords: 180,
    targetWords: 240,
    maxWords: 320,
    prompt:
      "Discutez l'utilisation de l'intelligence artificielle dans l'apprentissage des langues. Analysez l'autonomie, la correction et les limites éthiques.",
    criteria: ["problématique", "arguments complexes", "vocabulaire précis"],
  },
  {
    id: "write-9",
    level: "C1",
    typeLabel: "Synthèse",
    title: "Vie universitaire",
    register: "formel",
    minWords: 180,
    targetWords: 250,
    maxWords: 330,
    prompt:
      "Rédigez une synthèse sur l'équilibre entre réussite académique et santé mentale chez les étudiants. Proposez deux mesures concrètes.",
    criteria: ["synthèse", "structure claire", "mesures concrètes"],
  },
  {
    id: "write-10",
    level: "C2",
    typeLabel: "Essai avancé",
    title: "Mobilité internationale",
    register: "formel",
    minWords: 220,
    targetWords: 300,
    maxWords: 380,
    prompt:
      "Analysez dans quelle mesure la mobilité internationale transforme l'identité professionnelle des jeunes diplômés. Appuyez votre réflexion sur des exemples.",
    criteria: ["thèse nuancée", "abstraction maîtrisée", "exemples pertinents"],
  },
];

const speakingTasks = [
  {
    id: "speak-1",
    level: "A1",
    typeLabel: "Décrire une image",
    title: "Scène quotidienne",
    prepSeconds: 30,
    responseSeconds: 45,
    visual: true,
    prompt:
      "Décrivez l'image : qui voyez-vous, où sont les personnes et que font-elles ?",
    checklist: ["lieu", "personnes", "actions"],
  },
  {
    id: "speak-2",
    level: "A1",
    typeLabel: "Question personnelle",
    title: "Se présenter",
    prepSeconds: 25,
    responseSeconds: 45,
    prompt:
      "Présentez-vous en allemand : nom, pays, activité actuelle et raison d'apprendre l'allemand.",
    checklist: ["identité", "activité", "objectif"],
  },
  {
    id: "speak-3",
    level: "A2",
    typeLabel: "Role-play",
    title: "À l'accueil",
    prepSeconds: 30,
    responseSeconds: 60,
    prompt:
      "Vous arrivez dans une école de langue. Demandez où se trouve votre salle, à quelle heure commence le cours et où acheter le livre.",
    checklist: ["salutation", "trois demandes", "remerciement"],
  },
  {
    id: "speak-4",
    level: "B1",
    typeLabel: "Opinion courte",
    title: "Étudier le soir",
    prepSeconds: 30,
    responseSeconds: 75,
    prompt:
      "Répondez à la question : préférez-vous étudier le matin ou le soir ? Donnez deux raisons.",
    checklist: ["opinion", "deux raisons", "connecteurs"],
  },
  {
    id: "speak-5",
    level: "B1",
    typeLabel: "Décrire une expérience",
    title: "Un voyage",
    prepSeconds: 30,
    responseSeconds: 90,
    prompt:
      "Racontez un voyage important : où êtes-vous allé, avec qui, et qu'avez-vous appris ?",
    checklist: ["temps passé", "ordre chronologique", "bilan"],
  },
  {
    id: "speak-6",
    level: "B2",
    typeLabel: "Comparer",
    title: "Ville ou campagne",
    prepSeconds: 25,
    responseSeconds: 100,
    prompt:
      "Comparez la vie en ville et à la campagne pour un étudiant international. Terminez par votre préférence.",
    checklist: ["comparaison", "exemple", "préférence"],
  },
  {
    id: "speak-7",
    level: "B2",
    typeLabel: "Role-play avancé",
    title: "Trouver un compromis",
    prepSeconds: 25,
    responseSeconds: 110,
    prompt:
      "Votre colocataire veut organiser une fête pendant votre période d'examens. Expliquez le problème et proposez un compromis.",
    checklist: ["problème", "ton poli", "solution"],
  },
  {
    id: "speak-8",
    level: "C1",
    typeLabel: "Sujet abstrait",
    title: "Apprendre toute la vie",
    prepSeconds: 20,
    responseSeconds: 120,
    prompt:
      "Expliquez pourquoi la formation continue devient importante dans la vie professionnelle moderne. Donnez un exemple concret.",
    checklist: ["argument abstrait", "exemple", "conclusion"],
  },
  {
    id: "speak-9",
    level: "C1",
    typeLabel: "Réagir",
    title: "Télétravail",
    prepSeconds: 20,
    responseSeconds: 120,
    prompt:
      "Réagissez à cette affirmation : le télétravail rend les équipes moins créatives. Nuancez votre réponse.",
    checklist: ["prise de position", "nuance", "contre-exemple"],
  },
  {
    id: "speak-10",
    level: "C2",
    typeLabel: "Argumentation orale",
    title: "Identité et langue",
    prepSeconds: 15,
    responseSeconds: 140,
    prompt:
      "Dans quelle mesure une nouvelle langue change-t-elle la manière de penser et d'agir ? Développez une réponse structurée.",
    checklist: ["thèse", "abstraction", "structure"],
  },
];

const MODULES = {
  read: {
    id: "read",
    title: "Compréhension Écrite",
    eyebrow: "Lecture active",
    examPart: "Lesen",
    accent: "#c62828",
    soft: "#fff1f1",
    Icon: BookOpen,
    simulationSeconds: 60 * 60,
    tasks: readingTasks,
    passage: readingPassage,
    focus: ["Repérage d'informations", "Vrai/Faux", "Titres à associer", "Vocabulaire en contexte"],
    advancement: [
      "Textes plus longs",
      "Vocabulaire moins transparent",
      "Questions d'inférence",
      "Temps de lecture réduit",
    ],
  },
  listen: {
    id: "listen",
    title: "Compréhension Orale",
    eyebrow: "Écoute active",
    examPart: "Horen",
    accent: "#2563eb",
    soft: "#eff6ff",
    Icon: Headphones,
    simulationSeconds: 60 * 60,
    tasks: listeningTasks,
    audio: {
      title: "Annonce en gare",
      speaker: "Allemand standard, débit modéré",
      duration: 105,
      maxReplays: 5,
      trainingReplays: 5,
      transcript:
        "Guten Morgen, liebe Fahrgäste. Der Intercity nach Berlin fährt heute nicht von Gleis drei, sondern von Gleis sieben ab. Wegen einer technischen Kontrolle hat der Zug ungefähr fünfzehn Minuten Verspätung. Bitte achten Sie weiterhin auf die Anzeigen in der Bahnhofshalle. Wenn Sie warten möchten, finden Sie ein Café auf der unteren Ebene. Wir danken Ihnen für Ihr Verständnis.",
      rate: 0.92,
    },
    focus: ["Prise de notes", "Informations chiffrées", "Ordre des événements", "Accents et débit"],
    advancement: [
      "Débit plus rapide",
      "Accents régionaux",
      "Clips plus longs",
      "Moins de répétitions",
    ],
  },
  write: {
    id: "write",
    title: "Expression Écrite",
    eyebrow: "Production structurée",
    examPart: "Schreiben",
    accent: "#7c3aed",
    soft: "#f5f3ff",
    Icon: PencilLine,
    simulationSeconds: 60 * 60,
    tasks: writingTasks,
    focus: ["Plan clair", "Registre adapté", "Connecteurs", "Correction grammaticale"],
    advancement: [
      "Sujets plus abstraits",
      "Limites de mots plus hautes",
      "Registre formel",
      "Argumentation nuancée",
    ],
  },
  speak: {
    id: "speak",
    title: "Expression Orale",
    eyebrow: "Prise de parole",
    examPart: "Sprechen",
    accent: "#059669",
    soft: "#ecfdf5",
    Icon: Mic,
    simulationSeconds: 60 * 60,
    tasks: speakingTasks,
    focus: ["Prononciation", "Fluidité", "Interaction", "Organisation des idées"],
    advancement: [
      "Réponses plus longues",
      "Temps de préparation réduit",
      "Sujets plus abstraits",
      "Relances plus spontanées",
    ],
  },
};

const TRUE_FALSE_OPTIONS = [
  { value: "true", label: "Vrai" },
  { value: "false", label: "Faux" },
];

const AUDIO_REPLAY_LIMIT = 5;
const SPEECH_WORDS_PER_MINUTE = 132;

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const formatExamTime = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
};

const formatClock = (date = new Date()) =>
  date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const countWords = (text) => {
  const words = String(text ?? "").trim().match(/\S+/g);
  return words ? words.length : 0;
};

const getEstimatedAudioDuration = (audio) => {
  const wordCount = countWords(audio?.transcript);
  const punctuationPauses = (String(audio?.transcript ?? "").match(/[.,;:!?]/g) ?? []).length * 0.45;
  const rate = Math.max(0.6, Number(audio?.rate) || 1);
  const spokenSeconds = (wordCount / (SPEECH_WORDS_PER_MINUTE * rate)) * 60;
  return Math.max(18, Math.ceil(spokenSeconds + punctuationPauses + 6));
};

const getTaskDuration = (module, task) => {
  if (!task) return 60;

  if (module.id === "listen") {
    const audioDuration = getEstimatedAudioDuration(module.audio);
    const answerBuffer = task.type === "order" ? 75 : task.type === "blank" ? 50 : 45;
    return audioDuration + answerBuffer;
  }

  if (module.id === "write") {
    return Math.max(180, Math.min(900, Math.round((task.targetWords ?? 120) * 2.2 + 90)));
  }

  if (module.id === "speak") {
    return (task.prepSeconds ?? 30) + (task.responseSeconds ?? 60);
  }

  const levelExtra = { A1: 0, A2: 10, B1: 20, B2: 35, C1: 50, C2: 65 }[task.level] ?? 20;
  const typeBase = {
    trueFalse: 45,
    multiple: 60,
    blank: 75,
    match: 120,
    order: 110,
  }[task.type] ?? 75;
  return typeBase + levelExtra;
};

const getStoredProgress = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

const isQuestionAnswered = (task, answer) => {
  if (!task) return false;

  if (task.type === "match") {
    return task.paragraphs.every((paragraphId) => Boolean(answer?.[paragraphId]));
  }

  if (task.type === "order") {
    return Array.isArray(answer) && answer.length === task.correct.length && answer.every(Boolean);
  }

  if (task.type === "blank") {
    return String(answer ?? "").trim().length > 0;
  }

  return Boolean(answer);
};

const isAnswerCorrect = (task, answer) => {
  if (!isQuestionAnswered(task, answer)) return false;

  if (task.type === "blank") {
    const normalized = normalizeText(answer);
    const accepted = [task.correct, ...(task.alternatives ?? [])].map(normalizeText);
    return accepted.includes(normalized);
  }

  if (task.type === "match") {
    return task.paragraphs.every((paragraphId) => answer?.[paragraphId] === task.correct[paragraphId]);
  }

  if (task.type === "order") {
    return task.correct.every((value, index) => answer?.[index] === value);
  }

  return answer === task.correct;
};

const evaluateWriting = (task, text) => {
  const words = countWords(text);
  if (!words) return 0;

  const targetRatio = Math.min(1, words / task.minWords);
  const connectorBonus = /(weil|deshalb|außerdem|jedoch|trotzdem|zum beispiel|daher|einerseits|andererseits)/i.test(text)
    ? 12
    : 0;
  const structureBonus = /(\n|erstens|zweitens|abschließend|zusammenfassend)/i.test(text) ? 10 : 0;
  const registerBonus =
    task.register === "formel" && /(Sehr geehrte|Mit freundlichen Grüßen|bitte|würde)/i.test(text) ? 10 : 0;
  const lengthPenalty = words > task.maxWords ? Math.min(20, words - task.maxWords) : 0;

  return Math.max(0, Math.min(100, Math.round(targetRatio * 68 + connectorBonus + structureBonus + registerBonus - lengthPenalty)));
};

const evaluateSpeaking = (task, answer) => {
  if (!answer?.duration) return 0;
  const target = Math.max(30, task.responseSeconds * 0.65);
  const durationScore = Math.min(70, Math.round((answer.duration / target) * 70));
  const retryBonus = answer.attempts <= 2 ? 15 : 8;
  const playbackBonus = answer.audioDataUrl || answer.audioUrl || answer.simulated ? 15 : 0;
  return Math.max(0, Math.min(100, durationScore + retryBonus + playbackBonus));
};

const getWritingSuggestions = (task, text) => {
  const words = countWords(text);
  const suggestions = [];

  if (words < task.minWords) {
    suggestions.push(`Ajoutez environ ${task.minWords - words} mots pour atteindre le minimum attendu.`);
  }

  if (!/(weil|deshalb|außerdem|jedoch|trotzdem|zum beispiel|daher|einerseits|andererseits)/i.test(text)) {
    suggestions.push("Ajoutez au moins un connecteur logique allemand pour rendre le texte plus fluide.");
  }

  if (task.register === "formel" && !/(Sehr geehrte|Mit freundlichen Grüßen|bitte|würde)/i.test(text)) {
    suggestions.push("Renforcez le registre formel avec une salutation et une formule finale adaptées.");
  }

  if ((text.match(/\bich\b/gi) ?? []).length > 6) {
    suggestions.push("Variez les structures pour éviter de commencer trop souvent par « ich ».");
  }

  return suggestions.length ? suggestions : ["Structure claire. Relisez maintenant les verbes conjugués et les déclinaisons."];
};

const calculateModuleScore = (module, answers) => {
  if (module.id === "write") {
    const total = module.tasks.reduce((sum, task, index) => sum + evaluateWriting(task, answers[index]), 0);
    return Math.round(total / module.tasks.length);
  }

  if (module.id === "speak") {
    const total = module.tasks.reduce((sum, task, index) => sum + evaluateSpeaking(task, answers[index]), 0);
    return Math.round(total / module.tasks.length);
  }

  const correct = module.tasks.filter((task, index) => isAnswerCorrect(task, answers[index])).length;
  return Math.round((correct / module.tasks.length) * 100);
};

const getTaskAnswered = (module, task, answer) => {
  if (module.id === "write") return countWords(answer) > 0;
  if (module.id === "speak") return Boolean(answer?.duration);
  return isQuestionAnswered(task, answer);
};

const getNextLevel = (level) => {
  const index = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, index + 1)] ?? level;
};

const buildSeriesTask = (moduleId, task, index, content, series) => {
  const override = content?.taskOverrides?.[index] ?? {};
  const base = {
    ...task,
    ...override,
    id: `${series.examId}-${series.id}-${moduleId}-${task.id}`,
    hint: override.hint ?? `Use the ${series.code} context: ${content.theme}.`,
    explanation:
      override.explanation ??
      `This answer is linked to ${series.examName} ${series.code}, whose theme is ${content.theme}.`,
  };

  if (moduleId === "write") {
    return {
      ...base,
      title: override.title ?? `${series.code}: ${task.title}`,
      prompt:
        override.prompt ??
        `${task.prompt}\n\nSeries context: ${series.theme}. Connect your answer to ${series.setting}.`,
      criteria: override.criteria ?? [...(task.criteria ?? []), series.code],
    };
  }

  if (moduleId === "speak") {
    return {
      ...base,
      title: override.title ?? `${series.code}: ${task.title}`,
      prompt:
        override.prompt ??
        `${task.prompt} Include one detail from ${series.theme} and one example from ${series.setting}.`,
      checklist: override.checklist ?? [...(task.checklist ?? []), series.code],
    };
  }

  if (task.type === "multiple") {
    return {
      ...base,
      question:
        override.question ??
        `In ${series.code}, what is the main topic for this ${content.shortLabel.toLowerCase()} task?`,
      options:
        override.options ??
        [
          { value: "a", label: content.theme },
          { value: "b", label: "a holiday recipe" },
          { value: "c", label: "a sports ranking" },
        ],
      correct: override.correct ?? "a",
    };
  }

  if (task.type === "trueFalse") {
    return {
      ...base,
      question:
        override.question ??
        `${series.code} belongs to ${series.examName} and uses the theme ${content.theme}.`,
      correct: override.correct ?? "true",
    };
  }

  if (task.type === "blank") {
    return {
      ...base,
      question:
        override.question ??
        `Complete the sentence: This exercise set is called ____.`,
      correct: override.correct ?? series.code,
      alternatives: override.alternatives ?? [series.id, series.code.toLowerCase()],
    };
  }

  if (task.type === "match") {
    const paragraphs = task.paragraphs ?? ["A", "B", "C"];
    const headings = [
      `${series.code} context`,
      `Topic: ${content.theme}`,
      `Exam: ${series.examName}`,
      `Level: ${series.level}`,
    ].slice(0, paragraphs.length);
    return {
      ...base,
      question:
        override.question ??
        `Match each item to the correct ${series.code} series heading.`,
      paragraphs,
      headings: override.headings ?? headings,
      correct:
        override.correct ??
        Object.fromEntries(paragraphs.map((paragraph, paragraphIndex) => [paragraph, headings[paragraphIndex]])),
    };
  }

  if (task.type === "order") {
    const events =
      override.events ??
      [
        { value: "topic", label: `Identify ${content.theme}` },
        { value: "details", label: "Note dates and key details" },
        { value: "answer", label: "Choose the answer for the task" },
      ];
    return {
      ...base,
      question:
        override.question ??
        `Put the ${series.code} listening steps in the best order.`,
      events,
      correct: override.correct ?? events.map((event) => event.value),
    };
  }

  return base;
};

const buildSeriesModule = (baseModule, content, series) => {
  if (!content || !series) return baseModule;

  return {
    ...baseModule,
    eyebrow: `${series.code} / ${baseModule.eyebrow}`,
    examPart: `${series.examName} ${series.code} - ${baseModule.examPart}`,
    tasks: baseModule.tasks.map((task, index) => buildSeriesTask(baseModule.id, task, index, content, series)),
    passage: content.passage ?? baseModule.passage,
    audio: content.audio ?? baseModule.audio,
    focus: content.focus ?? baseModule.focus,
    advancement: content.advancement ?? baseModule.advancement,
    seriesContext: {
      examId: series.examId,
      examName: series.examName,
      seriesId: series.id,
      seriesCode: series.code,
      seriesTitle: series.title,
      theme: series.theme,
    },
  };
};

function FeedbackBox({ task, answer }) {
  if (!isQuestionAnswered(task, answer)) return null;

  const correct = isAnswerCorrect(task, answer);

  return (
    <div className={`${styles.feedbackBox} ${correct ? styles.feedbackCorrect : styles.feedbackWrong}`}>
      {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
      <div>
        <strong>{correct ? "Correct" : "À revoir"}</strong>
        <p>{task.explanation}</p>
      </div>
    </div>
  );
}

export default function SimulationModulePage({ moduleIdOverride }) {
  useTestProtection();
  const t = getTranslations("fr");
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const routeModuleId = moduleIdOverride ?? params.moduleId ?? "read";
  const baseModule = MODULES[routeModuleId] ?? MODULES.read;
  const selectedSeries = useMemo(
    () => getSeriesById(params.examId, params.seriesId),
    [params.examId, params.seriesId]
  );
  const selectedSeriesContent = useMemo(
    () => getSeriesModuleContent(params.examId, params.seriesId, baseModule.id),
    [baseModule.id, params.examId, params.seriesId]
  );
  const auth = useMemo(() => getAuthUser(), []);
  const loggedIn = Boolean(auth?.id);
  const visitorSeriesAttempt = isVisitorSeriesAttempt(selectedSeries);
  const visitorAccessAllowed = Boolean(location.state?.visitorFreeAccess);
  const blockedSeriesAccess = Boolean(selectedSeries && !canOpenSeries(selectedSeries));
  const blockedVisitorRefresh = visitorSeriesAttempt && !visitorAccessAllowed;
  const shouldPersistProgress = Boolean(auth?.id) && !blockedSeriesAccess && !blockedVisitorRefresh;
  const module = useMemo(
    () => buildSeriesModule(baseModule, selectedSeriesContent, selectedSeries),
    [baseModule, selectedSeriesContent, selectedSeries]
  );
  const ModuleIcon = module.Icon;
  const moduleTitle = t.modules[module.id] ?? module.title;
  const totalTasks = module.tasks.length;
  const progressScopeId = selectedSeries
    ? `${selectedSeries.examId}-${selectedSeries.id}-${module.id}`
    : module.id;
  const progressKey = getProgressKey(progressScopeId);
  const firstTaskDuration = getTaskDuration(module, module.tasks[0]);
  const seriesRoute = selectedSeries
    ? `/simulations/${selectedSeries.examId}/${selectedSeries.id}`
    : "/simulations";
  const currentRoute = selectedSeries
    ? `/simulation/${selectedSeries.examId}/${selectedSeries.id}/${module.id}`
    : `/simulation/${module.id}`;
  const examHeading = selectedSeries
    ? `${selectedSeries.examName} ${selectedSeries.code}`
    : "Goethe-Zertifikat B2";

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [skipped, setSkipped] = useState({});
  const [flagged, setFlagged] = useState({});
  const [notes, setNotes] = useState({});
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(firstTaskDuration);
  const [simulationMode, setSimulationMode] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [resultStatus, setResultStatus] = useState("");
  const [writingVersions, setWritingVersions] = useState([]);
  const [audioTimestamp, setAudioTimestamp] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioSessionActive, setAudioSessionActive] = useState(false);
  const [replaysUsed, setReplaysUsed] = useState(0);
  const [prepRemaining, setPrepRemaining] = useState(speakingTasks[0].prepSeconds);
  const [prepActive, setPrepActive] = useState(false);
  const [speakingPhase, setSpeakingPhase] = useState("prep");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordError, setRecordError] = useState("");
  const [restoredKey, setRestoredKey] = useState("");

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioSessionRef = useRef(false);
  const audioStartedAtRef = useRef(0);
  const audioStartOffsetRef = useRef(0);
  const audioTimestampRef = useRef(0);
  const recordingIntervalRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const recordingTaskIndexRef = useRef(0);
  const fallbackRecordingRef = useRef(false);

  const currentTask = module.tasks[Math.min(currentIndex, totalTasks - 1)];
  const currentAnswer = answers[currentIndex];
  const currentTaskDuration = getTaskDuration(module, currentTask);
  const currentAudioDuration = module.id === "listen" ? getEstimatedAudioDuration(module.audio) : 0;
  const answeredCount = module.tasks.filter((task, index) => getTaskAnswered(module, task, answers[index])).length;
  const progressPercent = ((Math.min(currentIndex + 1, totalTasks) / totalTasks) * 100).toFixed(1);
  const score = calculateModuleScore(module, answers);
  const currentAnswered = getTaskAnswered(module, currentTask, currentAnswer);
  const currentSkipped = Boolean(skipped[currentIndex]);
  const nextDisabled = !completed && !currentAnswered;
  const level = currentTask?.level ?? "A1";
  const audioAtSessionEnd = module.id === "listen" && audioTimestamp >= currentAudioDuration;
  const audioReplayBlocked = module.id === "listen" && replaysUsed >= AUDIO_REPLAY_LIMIT && (!audioSessionActive || audioAtSessionEnd);

  useEffect(() => {
    if (!shouldPersistProgress) {
      setCurrentIndex(0);
      setAnswers({});
      setSkipped({});
      setFlagged({});
      setNotes({});
      setElapsedSeconds(0);
      setTimerSeconds(firstTaskDuration);
      setSimulationMode(false);
      setCompleted(false);
      setWritingVersions([]);
      setSaveStatus("Mode visiteur : la progression n'est pas sauvegardée.");
      setRestoredKey(progressKey);
      return;
    }

    const stored = getStoredProgress(progressKey);
    const restoredIndex = Math.min(Math.max(0, Number(stored?.currentIndex) || 0), totalTasks - 1);

    setCurrentIndex(restoredIndex);
    setAnswers(stored?.answers ?? {});
    setSkipped(stored?.skipped ?? {});
    setFlagged(stored?.flagged ?? {});
    setNotes(stored?.notes ?? {});
    setElapsedSeconds(Number(stored?.elapsedSeconds) || 0);
    const restoredTask = module.tasks[restoredIndex] ?? module.tasks[0];
    setTimerSeconds(Number(stored?.timerSeconds) || getTaskDuration(module, restoredTask));
    setSimulationMode(Boolean(stored?.simulationMode));
    setCompleted(Boolean(stored?.completed));
    setWritingVersions(stored?.writingVersions ?? []);
    const restoredAudioTimestamp = Number(stored?.audioTimestamp) || 0;
    setAudioTimestamp(restoredAudioTimestamp);
    audioTimestampRef.current = restoredAudioTimestamp;
    setReplaysUsed(Number(stored?.replaysUsed) || 0);
    setSpeakingPhase(stored?.speakingPhase ?? "prep");
    setPrepRemaining(Number(stored?.prepRemaining) || restoredTask?.prepSeconds || speakingTasks[0].prepSeconds);
    setAudioPlaying(false);
    setAudioSessionActive(false);
    setResultStatus("");
    setSaveStatus(stored?.savedAt ? `Dernière sauvegarde ${formatClock(new Date(stored.savedAt))}` : "Sauvegarde locale prête");
    setRestoredKey(progressKey);
  }, [firstTaskDuration, module, progressKey, shouldPersistProgress, totalTasks]);

  useEffect(() => {
    if (completed) return undefined;
    const interval = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [completed]);

  const saveResultToBackend = useCallback(
    async (finalScore) => {
      if (!auth?.id) {
        setResultStatus("Résultat gardé en local. Connectez-vous pour l'ajouter au dashboard.");
        return;
      }

      try {
        await API.post(
          "/simulations",
          {
            examName: `${examHeading} - ${moduleTitle} - ${simulationMode ? "Simulation" : "Entraînement"}`,
            scorePct: finalScore,
            levelCurrent: level,
            levelTarget: getNextLevel(level),
            aiCorrections: {
              module: module.id,
              mode: simulationMode ? "simulation" : "training",
              recommendations: module.focus.map((item) => `Renforcer : ${item}`),
            },
          },
          { headers: { "x-user-id": String(auth.id) } }
        );
        setResultStatus("Résultat enregistré dans le dashboard.");
      } catch {
        setResultStatus("Résultat gardé en local. Le backend n'est pas joignable pour le moment.");
      }
    },
    [auth?.id, examHeading, level, module.focus, module.id, moduleTitle, simulationMode]
  );

  const finishModule = useCallback(() => {
    setCompleted(true);
    setAudioPlaying(false);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    void saveResultToBackend(score);
  }, [saveResultToBackend, score]);

  const buildProgressSnapshot = useCallback(
    () => ({
      moduleId: progressScopeId,
      moduleTitle: selectedSeries
        ? `${selectedSeries.examName} ${selectedSeries.code} - ${moduleTitle}`
        : `Goethe B2 - ${moduleTitle}`,
      moduleType: module.examPart,
      route: currentRoute,
      currentIndex,
      totalTasks,
      answeredCount,
      progressPercent: Number(progressPercent),
      answers,
      skipped,
      flagged,
      notes,
      elapsedSeconds,
      timerSeconds,
      taskDuration: currentTaskDuration,
      simulationMode,
      completed,
      audioTimestamp,
      replaysUsed,
      prepRemaining,
      speakingPhase,
      writingVersions,
      lastAccessedAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
    }),
    [
      answers,
      answeredCount,
      audioTimestamp,
      completed,
      currentIndex,
      currentTaskDuration,
      currentRoute,
      elapsedSeconds,
      flagged,
      module.examPart,
      moduleTitle,
      notes,
      prepRemaining,
      progressPercent,
      progressScopeId,
      replaysUsed,
      selectedSeries,
      simulationMode,
      skipped,
      speakingPhase,
      timerSeconds,
      totalTasks,
      writingVersions,
    ]
  );

  const persistProgress = useCallback(
    (message) => {
      if (!shouldPersistProgress) {
        setSaveStatus("Mode visiteur : la progression n'est pas sauvegardée.");
        return;
      }

      try {
        const snapshot = buildProgressSnapshot();
        localStorage.setItem(progressKey, JSON.stringify(snapshot));
        if (
          snapshot.simulationMode ||
          snapshot.completed ||
          snapshot.currentIndex > 0 ||
          snapshot.answeredCount > 0 ||
          Object.values(snapshot.notes ?? {}).some((note) => String(note ?? "").trim())
        ) {
          upsertSimulationHistoryEntry(snapshot);
        }
        setSaveStatus(message ?? `Sauvegardé à ${formatClock()}`);
      } catch {
        setSaveStatus("Sauvegarde locale impossible : espace navigateur insuffisant.");
      }
    },
    [buildProgressSnapshot, progressKey, shouldPersistProgress]
  );

  useEffect(() => {
    if (!shouldPersistProgress) return;
    if (restoredKey !== progressKey) return;
    persistProgress(`Auto-sauvegardé à ${formatClock()}`);
  }, [persistProgress, progressKey, restoredKey, shouldPersistProgress]);

  useEffect(() => {
    if (module.id !== "write" || completed || !shouldPersistProgress) return undefined;

    const interval = window.setInterval(() => {
      const text = String(answers[currentIndex] ?? "");
      if (text.trim().length < 12) return;

      setWritingVersions((versions) => {
        if (versions[0]?.text === text && versions[0]?.taskIndex === currentIndex) return versions;
        return [
          {
            id: `${Date.now()}-${currentIndex}`,
            taskIndex: currentIndex,
            taskTitle: currentTask.title,
            words: countWords(text),
            text,
            createdAt: new Date().toISOString(),
          },
          ...versions,
        ].slice(0, 8);
      });
    }, 6000);

    return () => window.clearInterval(interval);
  }, [answers, completed, currentIndex, currentTask.title, module.id, shouldPersistProgress]);

  useEffect(() => {
    audioTimestampRef.current = audioTimestamp;
  }, [audioTimestamp]);

  useEffect(() => {
    if (module.id !== "listen" || !audioPlaying) return undefined;

    const interval = window.setInterval(() => {
      const elapsed = audioStartOffsetRef.current + (Date.now() - audioStartedAtRef.current) / 1000;
      const nextValue = Math.min(currentAudioDuration, Math.round(elapsed));
      audioTimestampRef.current = nextValue;
      setAudioTimestamp(nextValue);

      if (nextValue >= currentAudioDuration) {
        setAudioPlaying(false);
        audioSessionRef.current = false;
        setAudioSessionActive(false);
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [audioPlaying, currentAudioDuration, module.id]);

  useEffect(() => {
    if (module.id !== "speak") return;
    setPrepRemaining(currentTask.prepSeconds);
    setSpeakingPhase("prep");
    setPrepActive(simulationMode && !completed);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setRecordError("");
  }, [completed, currentIndex, currentTask.prepSeconds, module.id, simulationMode]);

  useEffect(
    () => () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recordingIntervalRef.current) {
        window.clearInterval(recordingIntervalRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  const setAnswerForCurrent = useCallback(
    (value) => {
      setAnswers((previous) => ({ ...previous, [currentIndex]: value }));
      setSkipped((previous) => {
        if (!previous[currentIndex]) return previous;
        const next = { ...previous };
        delete next[currentIndex];
        return next;
      });
    },
    [currentIndex]
  );

  const startSimulation = useCallback(() => {
    setCurrentIndex(0);
    setAnswers({});
    setSkipped({});
    setFlagged({});
    setNotes({});
    setElapsedSeconds(0);
    setTimerSeconds(firstTaskDuration);
    setSimulationMode(true);
    setCompleted(false);
    setWritingVersions([]);
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioStartOffsetRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    setReplaysUsed(0);
    setAudioPlaying(false);
    setSpeakingPhase("prep");
    setPrepRemaining(module.tasks[0]?.prepSeconds ?? speakingTasks[0].prepSeconds);
    setPrepActive(module.id === "speak");
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setResultStatus("");
    setSaveStatus("Simulation démarrée : navigation verrouillée.");
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [firstTaskDuration, module.id, module.tasks]);

  const restartTraining = useCallback(() => {
    setCurrentIndex(0);
    setAnswers({});
    setSkipped({});
    setFlagged({});
    setNotes({});
    setElapsedSeconds(0);
    setTimerSeconds(firstTaskDuration);
    setSimulationMode(false);
    setCompleted(false);
    setWritingVersions([]);
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioStartOffsetRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    setReplaysUsed(0);
    setAudioPlaying(false);
    setSpeakingPhase("prep");
    setPrepRemaining(module.tasks[0]?.prepSeconds ?? speakingTasks[0].prepSeconds);
    setPrepActive(false);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setResultStatus("");
    setSaveStatus("Nouvel entraînement prêt.");
  }, [firstTaskDuration, module.tasks]);

  const toggleFlag = useCallback(() => {
    setFlagged((previous) => ({ ...previous, [currentIndex]: !previous[currentIndex] }));
  }, [currentIndex]);

  const goToNext = useCallback(() => {
    if (currentIndex >= totalTasks - 1) {
      finishModule();
      return;
    }
    const nextIndex = Math.min(totalTasks - 1, currentIndex + 1);
    setCurrentIndex(nextIndex);
    setTimerSeconds(getTaskDuration(module, module.tasks[nextIndex]));
    setSpeakingPhase("prep");
    setPrepRemaining(module.tasks[nextIndex]?.prepSeconds ?? speakingTasks[0].prepSeconds);
    setPrepActive(module.id === "speak" && simulationMode);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
  }, [currentIndex, finishModule, module, simulationMode, totalTasks]);

  const goToPrevious = useCallback(() => {
    const previousIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(previousIndex);
    setTimerSeconds(getTaskDuration(module, module.tasks[previousIndex]));
  }, [currentIndex, module]);

  const skipCurrent = useCallback(() => {
    setSkipped((previous) => ({ ...previous, [currentIndex]: true }));
    goToNext();
  }, [currentIndex, goToNext]);

  const goToQuestion = useCallback(
    (index) => {
      if (simulationMode) return;
      setCurrentIndex(index);
      setTimerSeconds(getTaskDuration(module, module.tasks[index]));
    },
    [module, simulationMode]
  );

  const playListeningAudio = useCallback(() => {
    if (module.id !== "listen") return;

    const replayLimit = AUDIO_REPLAY_LIMIT;
    const startingFresh = audioTimestamp <= 0 || audioTimestamp >= currentAudioDuration || !audioSessionActive;

    if (startingFresh) {
      if (replaysUsed >= replayLimit) {
        setSaveStatus("Limite de 5 ecoutes atteinte pour ce module.");
        return;
      }

      setReplaysUsed((value) => value + 1);
      setAudioTimestamp(0);
      audioTimestampRef.current = 0;
      audioStartOffsetRef.current = 0;
      audioSessionRef.current = true;
      setAudioSessionActive(true);

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(module.audio.transcript);
        utterance.lang = "de-DE";
        utterance.rate = module.audio.rate;
        utterance.onend = () => {
          setAudioTimestamp(currentAudioDuration);
          audioTimestampRef.current = currentAudioDuration;
          setAudioPlaying(false);
          audioSessionRef.current = false;
          setAudioSessionActive(false);
        };
        window.speechSynthesis.speak(utterance);
      }
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }

    audioStartOffsetRef.current = startingFresh ? 0 : audioTimestampRef.current;
    audioStartedAtRef.current = Date.now();
    setAudioPlaying(true);
  }, [audioSessionActive, audioTimestamp, currentAudioDuration, module, replaysUsed]);

  const pauseListeningAudio = useCallback(() => {
    setAudioPlaying(false);
    audioStartOffsetRef.current = audioTimestampRef.current;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.pause();
    }
  }, []);

  const resetListeningAudio = useCallback(() => {
    setAudioPlaying(false);
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioStartOffsetRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const saveWritingVersion = useCallback(() => {
    if (module.id !== "write") return;
    const text = String(answers[currentIndex] ?? "");
    if (!text.trim()) {
      setSaveStatus("Le brouillon est vide.");
      return;
    }

    setWritingVersions((versions) => [
      {
        id: `${Date.now()}-${currentIndex}`,
        taskIndex: currentIndex,
        taskTitle: currentTask.title,
        words: countWords(text),
        text,
        createdAt: new Date().toISOString(),
      },
      ...versions,
    ].slice(0, 8));
    persistProgress(`Brouillon sauvegardé à ${formatClock()}`);
  }, [answers, currentIndex, currentTask.title, module.id, persistProgress]);

  const beginPrep = useCallback(() => {
    setSpeakingPhase("prep");
    setPrepRemaining(currentTask.prepSeconds);
    setPrepActive(true);
  }, [currentTask.prepSeconds]);

  const finishRecording = useCallback((blob, simulated = false) => {
    const duration = recordingSecondsRef.current;
    const taskIndex = recordingTaskIndexRef.current;

    const commitRecording = (audioDataUrl = "", audioUrl = "") => {
      setAnswers((previous) => {
        const previousAnswer = previous[taskIndex] ?? {};
        return {
          ...previous,
          [taskIndex]: {
            ...previousAnswer,
            duration,
            audioDataUrl,
            audioUrl,
            simulated,
            pending: false,
            recordedAt: new Date().toISOString(),
          },
        };
      });
    };

    if (!blob) {
      commitRecording("", "");
      return;
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const reader = new window.FileReader();
    reader.onloadend = () => commitRecording(String(reader.result ?? ""), objectUrl);
    reader.onerror = () => commitRecording("", objectUrl);
    reader.readAsDataURL(blob);
  }, []);

  const startRecording = useCallback(async () => {
    if (module.id !== "speak" || isRecording) return;

    const previousAnswer = answers[currentIndex] ?? {};
    const startingDuration = Number(previousAnswer.duration ?? recordingSecondsRef.current ?? 0);
    setRecordError("");
    setRecordingSeconds(startingDuration);
    recordingSecondsRef.current = startingDuration;
    recordingTaskIndexRef.current = currentIndex;
    fallbackRecordingRef.current = false;

    setAnswers((previous) => {
      const currentPreviousAnswer = previous[currentIndex] ?? {};
      return {
        ...previous,
        [currentIndex]: {
          ...currentPreviousAnswer,
          attempts: Number(currentPreviousAnswer.attempts ?? 0) + 1,
          pending: true,
        },
      };
    });

    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingSeconds((value) => {
        const nextValue = value + 1;
        recordingSecondsRef.current = nextValue;
        return nextValue;
      });
    }, 1000);

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      fallbackRecordingRef.current = true;
      setRecordError("Micro non disponible : le minuteur d'entraînement est utilisé à la place.");
      setIsRecording(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new window.MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new window.Blob(audioChunksRef.current, { type: "audio/webm" });
        finishRecording(blob);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      fallbackRecordingRef.current = true;
      setRecordError("Autorisation micro refusée : le minuteur d'entraînement est utilisé.");
      setIsRecording(true);
    }
  }, [answers, currentIndex, finishRecording, isRecording, module.id]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    setIsRecording(false);
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (fallbackRecordingRef.current) {
      finishRecording(null, true);
      fallbackRecordingRef.current = false;
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, [finishRecording, isRecording]);

  const advanceAfterTimer = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }

    persistProgress(`Auto-sauvegarde a ${formatClock()}`);

    if (currentIndex >= totalTasks - 1) {
      finishModule();
      return;
    }

    const nextIndex = Math.min(totalTasks - 1, currentIndex + 1);
    setCurrentIndex(nextIndex);
    setTimerSeconds(getTaskDuration(module, module.tasks[nextIndex]));
    setSpeakingPhase("prep");
    setPrepRemaining(module.tasks[nextIndex]?.prepSeconds ?? speakingTasks[0].prepSeconds);
    setPrepActive(module.id === "speak" && simulationMode);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
  }, [currentIndex, finishModule, isRecording, module, persistProgress, simulationMode, stopRecording, totalTasks]);

  useEffect(() => {
    if (!simulationMode || completed) return undefined;

    if (timerSeconds <= 0) {
      if (module.id !== "speak") {
        advanceAfterTimer();
      }
      return undefined;
    }

    const interval = window.setInterval(() => {
      setTimerSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [advanceAfterTimer, completed, module.id, simulationMode, timerSeconds]);

  useEffect(() => {
    if (module.id !== "speak" || !simulationMode || !prepActive || completed) return undefined;

    if (prepRemaining <= 0) {
      if (speakingPhase === "prep") {
        setSpeakingPhase("response");
        setPrepRemaining(currentTask.responseSeconds);
        return undefined;
      }

      advanceAfterTimer();
      return undefined;
    }

    const interval = window.setInterval(() => {
      setPrepRemaining((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    advanceAfterTimer,
    completed,
    currentTask.responseSeconds,
    module.id,
    prepActive,
    prepRemaining,
    simulationMode,
    speakingPhase,
  ]);

  const rerecord = useCallback(() => {
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setAnswers((previous) => {
      const previousAnswer = previous[currentIndex] ?? {};
      return {
        ...previous,
        [currentIndex]: {
          attempts: previousAnswer.attempts ?? 0,
          duration: 0,
        },
      };
    });
    void startRecording();
  }, [currentIndex, startRecording]);

  const renderQuestionControl = (task, answer) => {
    if (task.type === "multiple" || task.type === "trueFalse") {
      const options = task.type === "trueFalse" ? TRUE_FALSE_OPTIONS : task.options;

      return (
        <div className={styles.optionList}>
          {options.map((option) => {
            const showCorrectness = !simulationMode && answer;
            const isSelected = answer === option.value;
            const isCorrect = task.correct === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                className={[
                  styles.optionButton,
                  isSelected ? styles.optionSelected : "",
                  showCorrectness && isCorrect ? styles.optionCorrect : "",
                  showCorrectness && isSelected && !isCorrect ? styles.optionWrong : "",
                ].join(" ")}
                onClick={() => setAnswerForCurrent(option.value)}
              >
                <span>{option.label}</span>
                {showCorrectness && isCorrect ? <CheckCircle2 size={18} /> : null}
              </button>
            );
          })}
        </div>
      );
    }

    if (task.type === "blank") {
      return (
        <label className={styles.fieldLabel}>
          Réponse
          <input
            className={styles.textInput}
            value={answer ?? ""}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
            placeholder="Tapez le mot ou l'expression"
          />
        </label>
      );
    }

    if (task.type === "match") {
      const answerObject = answer ?? {};
      return (
        <div className={styles.matchGrid}>
          {task.paragraphs.map((paragraphId) => (
            <label key={paragraphId} className={styles.matchRow}>
              <span>Paragraphe {paragraphId}</span>
              <select
                value={answerObject[paragraphId] ?? ""}
                onChange={(event) => setAnswerForCurrent({ ...answerObject, [paragraphId]: event.target.value })}
              >
                <option value="">Choisir un titre</option>
                {task.headings.map((heading) => (
                  <option key={heading} value={heading}>
                    {heading}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }

    if (task.type === "order") {
      const orderedAnswer = Array.isArray(answer) ? answer : [];
      return (
        <div className={styles.orderGrid}>
          {task.correct.map((_, index) => (
            <label key={index} className={styles.matchRow}>
              <span>Position {index + 1}</span>
              <select
                value={orderedAnswer[index] ?? ""}
                onChange={(event) => {
                  const nextAnswer = [...orderedAnswer];
                  nextAnswer[index] = event.target.value;
                  setAnswerForCurrent(nextAnswer);
                }}
              >
                <option value="">Choisir un événement</option>
                {task.events.map((event) => (
                  <option key={event.value} value={event.value}>
                    {event.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }

    return null;
  };

  const renderReading = () => (
    <div className={styles.readingLayout}>
      <section className={styles.passagePane}>
        <div className={styles.sectionLabel}>
          <BookOpen size={18} />
          Texte niveau {level}
        </div>
        <h2>{module.passage.title}</h2>
        <p className={styles.introText}>{module.passage.intro}</p>
        <div className={styles.paragraphList}>
          {module.passage.paragraphs.map((paragraph) => (
            <article key={paragraph.id} className={styles.readingParagraph}>
              <span>{paragraph.id}</span>
              <p>{paragraph.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.questionPane}>
        <div className={styles.questionTopline}>
          <span>{currentTask.typeLabel}</span>
          <span>{level}</span>
        </div>
        <h2>{currentTask.question}</h2>
        {renderQuestionControl(currentTask, currentAnswer)}
        {!simulationMode ? (
          <>
            {!currentAnswered ? <p className={styles.hintLine}><WandSparkles size={16} /> {currentTask.hint}</p> : null}
            <FeedbackBox task={currentTask} answer={currentAnswer} />
          </>
        ) : null}
      </section>
    </div>
  );

  const renderListening = () => {
    const replayLimit = AUDIO_REPLAY_LIMIT;
    const replaysLeft = Math.max(0, replayLimit - replaysUsed);
    const audioProgressPercent = currentAudioDuration
      ? Math.min(100, (audioTimestamp / currentAudioDuration) * 100)
      : 0;

    return (
      <div className={styles.listeningLayout}>
        <section className={styles.audioPanel}>
          <div className={styles.audioHeader}>
            <div>
              <div className={styles.sectionLabel}>
                <Headphones size={18} />
                {module.audio.title}
              </div>
              <h2>{module.audio.speaker}</h2>
            </div>
            <div className={styles.replayBadge} data-blocked={audioReplayBlocked ? "true" : "false"}>
              <Volume2 size={16} />
              {replaysLeft} écoute{replaysLeft > 1 ? "s" : ""} restante{replaysLeft > 1 ? "s" : ""}
            </div>
          </div>

          <div className={styles.playerControls}>
            <button
              type="button"
              className={styles.audioPlayButton}
              data-playing={audioPlaying ? "true" : "false"}
              data-blocked={audioReplayBlocked ? "true" : "false"}
              style={{ "--audio-progress": `${audioProgressPercent}%` }}
              onClick={audioPlaying ? pauseListeningAudio : playListeningAudio}
              disabled={!audioPlaying && audioReplayBlocked}
              aria-label={audioPlaying ? "Pause" : "Lecture"}
            >
              {audioPlaying ? <Pause size={34} /> : <Play size={34} />}
            </button>
            <div className={styles.audioTimeline}>
              <div className={styles.timelineMeta}>
                <span>{formatTime(audioTimestamp)}</span>
                <span>{formatTime(currentAudioDuration)}</span>
              </div>
              <div className={styles.timelineTrack}>
                <span style={{ width: `${audioProgressPercent}%` }} />
              </div>
            </div>
            <button type="button" className={styles.iconButton} onClick={resetListeningAudio} disabled={audioReplayBlocked} aria-label="Revenir au début">
              <RotateCcw size={20} />
              Reecouter
            </button>
          </div>

          <div className={styles.lockedNote}>
            <Lock size={18} />
            Transcript hidden for test protection.
          </div>
        </section>

        <section className={styles.questionPane}>
          <div className={styles.questionTopline}>
            <span>{currentTask.typeLabel}</span>
            <span>{level}</span>
          </div>
          <h2>{currentTask.question}</h2>
          {renderQuestionControl(currentTask, currentAnswer)}
          {!simulationMode ? (
            <>
              {!currentAnswered ? <p className={styles.hintLine}><WandSparkles size={16} /> {currentTask.hint}</p> : null}
              <FeedbackBox task={currentTask} answer={currentAnswer} />
            </>
          ) : null}
        </section>
      </div>
    );
  };

  const renderWriting = () => {
    const text = String(currentAnswer ?? "");
    const words = countWords(text);
    const suggestions = getWritingSuggestions(currentTask, text);

    return (
      <div className={styles.writingLayout}>
        <section className={styles.promptPanel}>
          <div className={styles.questionTopline}>
            <span>{currentTask.typeLabel}</span>
            <span>{level}</span>
          </div>
          <h2>{currentTask.title}</h2>
          <p>{currentTask.prompt}</p>
          <div className={styles.promptMeta}>
            <span><FileText size={16} /> {currentTask.minWords}-{currentTask.maxWords} mots</span>
            <span><ShieldCheck size={16} /> Registre {currentTask.register}</span>
          </div>
        </section>

        <section className={styles.editorPanel}>
          <div className={styles.editorToolbar}>
            <span>{words} mot{words > 1 ? "s" : ""}</span>
            <span>Objectif {currentTask.targetWords}</span>
            <button type="button" onClick={saveWritingVersion}>
              <Save size={16} />
              Sauver le brouillon
            </button>
          </div>
          <textarea
            value={text}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
            placeholder="Rédigez votre réponse en allemand..."
            className={styles.editor}
          />
        </section>

        <div className={styles.writingSupportGrid}>
          {!simulationMode ? (
            <section className={styles.supportPanel}>
              <div className={styles.sectionLabel}>
                <WandSparkles size={18} />
                Suggestions
              </div>
              <ul>
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.supportPanel}>
            <div className={styles.sectionLabel}>
              <History size={18} />
              Historique
            </div>
            {writingVersions.length ? (
              <div className={styles.versionList}>
                {writingVersions.slice(0, 5).map((version) => (
                  <button
                    type="button"
                    key={version.id}
                    onClick={() => {
                      setCurrentIndex(version.taskIndex);
                      setAnswers((previous) => ({ ...previous, [version.taskIndex]: version.text }));
                    }}
                  >
                    <span>{version.taskTitle}</span>
                    <small>{formatClock(new Date(version.createdAt))} · {version.words} mots</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.mutedText}>Les versions apparaissent après quelques secondes d'écriture.</p>
            )}
          </section>
        </div>
      </div>
    );
  };

  const renderSpeaking = () => {
    const answer = currentAnswer ?? {};
    const playbackSrc = answer.audioDataUrl || answer.audioUrl;

    return (
      <div className={styles.speakingLayout}>
        <section className={styles.promptPanel}>
          <div className={styles.questionTopline}>
            <span>{currentTask.typeLabel}</span>
            <span>{level}</span>
          </div>
          <h2>{currentTask.title}</h2>
          <p>{currentTask.prompt}</p>
          {currentTask.visual ? (
            <img className={styles.speakingImage} src={speakingImage} alt="Personnes actives dans un contexte quotidien" />
          ) : null}
          <div className={styles.promptMeta}>
            <span><Clock3 size={16} /> Préparation {currentTask.prepSeconds}s</span>
            <span><Mic size={16} /> Réponse cible {currentTask.responseSeconds}s</span>
          </div>
        </section>

        <section className={styles.recorderPanel}>
          <div className={styles.timerGrid}>
            <div className={styles.timerBlock}>
              <Clock3 size={20} />
              <strong>{formatTime(prepRemaining)}</strong>
              <span>{speakingPhase === "prep" ? "Temps de preparation restant" : "Temps restant"}</span>
            </div>
            <div className={styles.timerBlock}>
              <Mic size={20} />
              <strong>{formatTime(recordingSeconds || answer.duration || 0)}</strong>
              <span>Temps de parole</span>
            </div>
          </div>

          <div className={styles.micStage} data-recording={isRecording ? "true" : "false"}>
            <div className={styles.waveform} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <button
              type="button"
              className={isRecording ? styles.stopButton : styles.recordButton}
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={isRecording ? "Arreter l'enregistrement" : "Commencer l'enregistrement"}
            >
              {isRecording ? <Square size={34} /> : <Mic size={38} />}
            </button>
            <div className={styles.waveform} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className={styles.recordActions}>
            <button type="button" className={styles.secondaryButton} onClick={beginPrep} disabled={prepActive || simulationMode}>
              <TimerReset size={16} />
              Relancer preparation
            </button>
            <button type="button" className={styles.secondaryButton} onClick={rerecord} disabled={isRecording}>
              <RotateCcw size={16} />
              Re-record
            </button>
          </div>

          {recordError ? <p className={styles.warningText}><AlertCircle size={16} /> {recordError}</p> : null}

          {playbackSrc ? (
            <audio className={styles.playback} src={playbackSrc} controls />
          ) : answer.simulated ? (
            <p className={styles.mutedText}>Réponse minutée enregistrée sans fichier audio.</p>
          ) : (
            <p className={styles.mutedText}>Votre lecture apparaîtra ici après l'enregistrement.</p>
          )}
        </section>

        {!simulationMode ? (
          <section className={styles.supportPanel}>
            <div className={styles.sectionLabel}>
              <ClipboardCheck size={18} />
              Grille de réponse
            </div>
            <ul>
              {currentTask.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  };

  const renderModuleContent = () => {
    if (completed) {
      const unlocked = score >= PASS_SCORE;
      return (
        <section className={styles.resultPanel}>
          <Trophy size={44} />
          <p className={styles.sectionLabel}>{t.modulePage.result}</p>
          <h2>{score}%</h2>
          <p>
            {unlocked
              ? `Bravo, le prochain niveau conseillé est ${getNextLevel(level)}.`
              : `Continuez sur ${level} avant d'augmenter la difficulté.`}
          </p>
          <div className={styles.resultStats}>
            <span><CheckCircle2 size={16} /> {answeredCount}/{totalTasks} tâches traitées</span>
            <span><Flag size={16} /> {Object.values(flagged).filter(Boolean).length} signalée(s)</span>
            <span><Clock3 size={16} /> {formatTime(elapsedSeconds)} de travail</span>
          </div>
          {resultStatus ? <p className={styles.statusLine}>{resultStatus}</p> : null}
          <div className={styles.resultActions}>
            <button type="button" className={styles.secondaryButton} onClick={restartTraining}>
              <RotateCcw size={16} />
              Recommencer
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => navigate(seriesRoute)}>
              {t.modulePage.chooseModule}
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      );
    }

    if (module.id === "read") return renderReading();
    if (module.id === "listen") return renderListening();
    if (module.id === "write") return renderWriting();
    return renderSpeaking();
  };

  if (blockedSeriesAccess || blockedVisitorRefresh) {
    return (
      <NotFoundPage
        title="404 error"
        message="This test session is not available. Open a free series from the series listing to start a visitor test."
      />
    );
  }

  return (
    <div className={`${styles.page} notranslate`} translate="no" style={{ "--module-accent": module.accent, "--module-soft": module.soft }}>
      <nav className={styles.nav}>
        <button type="button" className={styles.logoButton} onClick={() => navigate(loggedIn ? "/dashboard" : "/")} aria-label="Retour">
          <img src={logo} alt="Deutsch Lernen" />
        </button>
        <div className={styles.navActions}>
          {loggedIn ? (
            <button type="button" onClick={() => navigate("/dashboard")}>
              <Home size={16} />
              {t.common.home}
            </button>
          ) : null}
          <button type="button" onClick={() => navigate(seriesRoute)}>
            <ClipboardCheck size={16} />
            {t.common.modules}
          </button>
        </div>
      </nav>

      <main className={styles.shell}>
        <BackButton fallback={seriesRoute} />
        <header className={styles.moduleHeader}>
          <div className={styles.examHeaderTop}>
            <div className={styles.titleBlock}>
              <h1>Simulation: {examHeading}</h1>
              <p>
                <ModuleIcon size={18} />
                Module: {moduleTitle} ({module.examPart})
              </p>
            </div>
            <div
              className={[
                styles.examTimer,
                simulationMode && timerSeconds <= 15 ? styles.timerUrgent : "",
              ].join(" ")}
              aria-label="Temps restant"
            >
              <Clock3 size={22} />
              {formatExamTime(simulationMode ? timerSeconds : currentTaskDuration)}
            </div>
          </div>

          <div className={styles.headerMeta}>
            <span className={styles.moduleBadge}>
              <Gauge size={16} />
              Niveau {level}
            </span>
            <span className={styles.moduleBadge}>
              <ModuleIcon size={16} />
              {module.eyebrow}
            </span>
            <span className={styles.moduleBadge}>
              <Clock3 size={16} />
              {simulationMode ? "Mode examen" : t.modulePage.freeTraining}
            </span>
            {simulationMode ? (
              <span className={styles.moduleBadge}>
                <Lock size={16} />
                {t.modulePage.locked}
              </span>
            ) : null}
            <button type="button" className={styles.simulationButton} onClick={startSimulation}>
              <TimerReset size={16} />
              {t.modulePage.startSimulation}
            </button>
          </div>

          <div className={styles.progressWrap} aria-label={`Question ${currentIndex + 1} sur ${totalTasks}`}>
            <div className={styles.progressText}>
              <span>{currentIndex + 1}/{totalTasks} {t.modulePage.questions}</span>
              <span>{answeredCount} {t.modulePage.answersSaved}</span>
            </div>
            <div className={styles.progressTrack}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        </header>

        <div className={styles.workArea}>
          <section className={styles.mainContent}>{renderModuleContent()}</section>

          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <h2>Tests</h2>
              <p>{simulationMode ? t.modulePage.navigationLocked : t.modulePage.navigationFree}</p>
            </div>

            <div className={styles.questionNav}>
              {module.tasks.map((task, index) => {
                const answered = getTaskAnswered(module, task, answers[index]);
                const isSkipped = Boolean(skipped[index]);
                const isFlagged = Boolean(flagged[index]);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className={[
                      styles.questionButton,
                      index === currentIndex ? styles.questionCurrent : "",
                      answered ? styles.questionAnswered : "",
                      isSkipped ? styles.questionSkipped : "",
                    ].join(" ")}
                    onClick={() => goToQuestion(index)}
                    disabled={simulationMode && index !== currentIndex}
                    aria-current={index === currentIndex ? "step" : undefined}
                    aria-label={`Question ${index + 1}`}
                  >
                    <span>{index + 1}</span>
                    {answered ? <CheckCircle2 size={14} /> : isSkipped ? <SkipForward size={14} /> : <Circle size={14} />}
                    {isFlagged ? <Flag size={12} className={styles.flagMini} /> : null}
                  </button>
                );
              })}
            </div>

            <div className={styles.legend}>
              <span><i className={styles.legendAnswered} /> {t.modulePage.answered}</span>
              <span><i className={styles.legendCurrent} /> En cours</span>
              <span><i className={styles.legendFlagged} /> {t.modulePage.flagged}</span>
            </div>

            <div className={styles.notesBox}>
              <label htmlFor={`notes-${module.id}-${currentIndex}`}>
                <PencilLine size={16} />
                Notes
              </label>
              <textarea
                id={`notes-${module.id}-${currentIndex}`}
                value={notes[currentIndex] ?? ""}
                onChange={(event) =>
                  setNotes((previous) => ({ ...previous, [currentIndex]: event.target.value }))
                }
                placeholder="Vos notes rapides..."
                rows={4}
              />
            </div>

            <div className={styles.adaptiveBox}>
              <div className={styles.sectionLabel}>
                <Gauge size={18} />
                {t.modulePage.progression}
              </div>
              <p>{t.modulePage.passText}</p>
              <ul>
                {module.advancement.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <p className={styles.saveStatus}>{saveStatus}</p>
          </aside>
        </div>

        {!completed ? (
          <section className={styles.actionPanel}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={goToPrevious}
              disabled={currentIndex === 0 || simulationMode || isRecording}
            >
              <ChevronLeft size={16} />
              Retour
            </button>
            <button type="button" className={styles.secondaryButton} onClick={toggleFlag}>
              <Flag size={16} />
              {flagged[currentIndex] ? t.modulePage.removeFlag : t.modulePage.flagQuestion}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={skipCurrent} disabled={isRecording}>
              <SkipForward size={16} />
              {t.common.skip}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => persistProgress(`Sauvegardé à ${formatClock()}`)}>
              <Save size={16} />
              {t.modulePage.saveProgress}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={goToNext}
              disabled={(nextDisabled && !currentSkipped) || isRecording}
            >
              {currentIndex >= totalTasks - 1 ? t.common.submit : t.common.next}
              <Send size={16} />
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
