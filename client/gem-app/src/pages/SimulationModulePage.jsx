/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PanelRightOpen,
  PencilLine,
  Play,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  SkipForward,
  Square,
  Timer,
  TimerReset,
  Trophy,
  Volume2,
  WandSparkles,
  X,
  XCircle,
} from "lucide-react";
import API from "../services/api";
import { clearDashboardCache } from "../services/dashboard";
import styles from "./SimulationModulePage.module.css";
import logo from "../assets/images/logo.png";
import speakingImage from "../assets/images/active_people.png";
import { fetchImportedSeriesModule } from "../services/importedExams";
import { getProgressKey, upsertSimulationHistoryEntry } from "../utils/simulationHistory";
import { canOpenSeries, getAuthUser, isVisitorSeriesAttempt } from "../utils/access";
import { useTestProtection } from "../utils/testProtection";
import { useSimulationLanguage } from "../utils/simulationLanguage";
import SmoothedAudioPlayer from "../components/SmoothedAudioPlayer";
import {
  createRecordingBlob,
  getMicrophoneConstraints,
  getPreferredRecorderOptions,
} from "../utils/audio";
import { createListeningSpeechFallback } from "../utils/listeningSpeechFallback";
import NotFoundPage from "./NotFoundPage";
import ComingSoonPage from "./ComingSoonPage";
import { getModuleCountLabel, isTopicModule } from "../utils/moduleLabels";
import { hasRichTextMarkup, richTextToPlainText, sanitizeRichTextHtml } from "../utils/richText";
import { stripQuestionMaterial } from "../utils/examText";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const PASS_SCORE = 70;
const MOBILE_AUDIO_UNSUPPORTED_MESSAGE =
  "Fuer diese Hoeren-Aufgabe ist noch keine freigegebene Audiodatei verfuegbar. Bitte versuchen Sie es spaeter erneut.";
const PART_TRANSITION_SECONDS = 10;

const ImportedLoadingDots = ({ label = "Importierte Aufgaben werden geladen" }) => (
  <span className={styles.importedLoadingDots} role="status" aria-label={label}>
    <span />
    <span />
    <span />
  </span>
);

const cleanTeilTitle = (value = "") =>
  String(value || "").replace(/^Teil\s+\d+\s*[-:]\s*/i, "").trim();

const TeilTransitionScreen = ({
  nextTeilTitle = "",
  nextTeilNumber,
  durationSeconds = PART_TRANSITION_SECONDS,
  onComplete,
}) => {
  const [remaining, setRemaining] = useState(durationSeconds);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    completedRef.current = false;
    setRemaining(durationSeconds);
    const startTime = Date.now();

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const nextRemaining = Math.max(0, durationSeconds - elapsed);
      setRemaining((value) => (value === nextRemaining ? value : nextRemaining));
      if (nextRemaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        window.clearInterval(interval);
        window.setTimeout(() => onCompleteRef.current?.(), 180);
      }
    };

    const interval = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(interval);
  }, [durationSeconds]);

  const progress = durationSeconds > 0 ? ((durationSeconds - remaining) / durationSeconds) * 360 : 360;
  const title = cleanTeilTitle(nextTeilTitle);

  return (
    <section className={styles.teilTransitionOverlay} aria-live="polite" aria-label="Der nächste Teil beginnt gleich">
      <div className={styles.teilTransitionPanel}>
        <div className={styles.teilTransitionIcon}>
          <Timer size={34} />
        </div>
        <p className={styles.sectionLabel}>Teilwechsel</p>
        <h2>Der nächste Teil beginnt gleich</h2>
        <p className={styles.teilTransitionNext}>
          Teil {nextTeilNumber || ""}
          {title ? `: ${title}` : ""}
        </p>
        <p className={styles.teilTransitionText}>Der nächste Teil beginnt in</p>
        <div
          className={styles.teilTransitionRing}
          style={{ "--transition-progress": `${progress}deg` }}
          aria-label={`${remaining} Sekunden`}
        >
          <span>{remaining}</span>
        </div>
        <p className={styles.teilTransitionSeconds}>Sekunden</p>
        <p className={styles.teilTransitionHint}>Bereite dich auf die nächste Aufgabe vor.</p>
      </div>
    </section>
  );
};

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

const germanReadingPassage = {
  title: "Die Universitaetsbibliothek wird flexibler",
  intro:
    "Der folgende Text beschreibt eine neue Organisation der Bibliothek einer deutschen Universitaet. Lesen Sie ihn aufmerksam und beantworten Sie danach die Fragen.",
  paragraphs: [
    {
      id: "A",
      heading: "Laengere Oeffnungszeiten",
      text:
        "Ab Mai bleibt die Zentralbibliothek der Universitaet Leipzig von Montag bis Donnerstag bis 22 Uhr geoeffnet. Die Entscheidung reagiert auf eine haeufige Bitte von Studierenden, die tagsueber arbeiten oder sich intensiv auf Pruefungen vorbereiten.",
    },
    {
      id: "B",
      heading: "Angepasste Arbeitsbereiche",
      text:
        "Der erste Stock ist fuer ruhiges Arbeiten reserviert, waehrend das Erdgeschoss Gruppen aufnimmt. Arbeitsraeume koennen online fuer zwei Stunden gebucht werden; Semesterprojekte haben dabei Vorrang.",
    },
    {
      id: "C",
      heading: "Ein Unterstuetzungsprogramm",
      text:
        "Die Bibliothek bietet auch kurze Workshops zur Literaturrecherche, zum Zitieren von Quellen und zur Nutzung deutscher Datenbanken an. Die Anmeldung erfolgt ueber die Plattform Bibliothek Plus.",
    },
    {
      id: "D",
      heading: "Einige Einschraenkungen",
      text:
        "Die Ausleihe ist nach 19 Uhr nicht mehr verfuegbar. Studierende koennen Buecher jedoch in eine automatische Rueckgabebox in der Naehe des Haupteingangs legen.",
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

const WRITING_MIN_WORDS = 80;

const getWritingMinimumWords = (task) =>
  Math.max(WRITING_MIN_WORDS, Number(task?.minWords) || WRITING_MIN_WORDS);

const withMinimumWritingWords = (tasks) =>
  tasks.map((task) => ({
    ...task,
    minWords: getWritingMinimumWords(task),
    targetWords: Math.max(Number(task.targetWords) || WRITING_MIN_WORDS, WRITING_MIN_WORDS),
    maxWords: null,
  }));

const CORRECTION_CRITERION_LABELS = {
  instructions: "Consignes",
  taskCompletion: "Tache",
  coherence: "Coherence",
  grammar: "Grammaire",
  spelling: "Orthographe",
  vocabulary: "Vocabulaire",
  register: "Registre",
};
const INVALID_WRITING_STATUSES = new Set(["empty", "too_short", "meaningless", "off_topic"]);
const WRITING_VALIDATION_LABELS = {
  valid: "Reponse valide",
  empty: "Reponse vide",
  too_short: "Trop courte",
  meaningless: "Texte incomprehensible",
  off_topic: "Hors sujet",
  unavailable: "Indisponible",
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
};

const getConfiguredWritingMaxScore = (task, totalTasks) => {
  const explicit = firstPositiveNumber(
    task?.maxScore,
    task?.taskMaxScore,
    task?.points,
    task?.partPoints,
    task?.scoring?.points
  );
  if (explicit) return Math.round(explicit * 100) / 100;
  return Math.round((100 / Math.max(1, totalTasks)) * 100) / 100;
};

const uniqueTextValues = (values) => {
  const seen = new Set();
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const formatCorrectionScore = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
};

const normalizeWritingValidationStatus = (value) => {
  const status = String(value ?? "valid").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return WRITING_VALIDATION_LABELS[status] ? status : "valid";
};

const getWritingValidationLabel = (value) => {
  const status = normalizeWritingValidationStatus(value);
  return WRITING_VALIDATION_LABELS[status] || WRITING_VALIDATION_LABELS.valid;
};

const isInvalidWritingStatus = (value) => INVALID_WRITING_STATUSES.has(normalizeWritingValidationStatus(value));

const buildWritingCorrectionTasks = (module, answers, examParts, context) => {
  if (module.id !== "write") return [];
  return module.tasks.map((task, index) => {
    const part = examParts.find((item) => item.taskIndexes.includes(index));
    const maxScore = getConfiguredWritingMaxScore(task, module.tasks.length);
    const instructions = uniqueTextValues([
      part?.sourceText || part?.instructions,
      task.partInstructions,
      task.prompt || task.question,
    ]).join("\n\n");

    return {
      taskId: task.sourceQuestionId || task.id,
      title: task.title || task.question || `Tache ${index + 1}`,
      instructions,
      subtitles: uniqueTextValues([part?.displayTitle, part?.title, task.typeLabel, task.partTitle]),
      examType: context.examHeading,
      moduleType: context.moduleTitle,
      durationMinutes: firstPositiveNumber(task.durationMinutes, task.partDurationMinutes, part?.durationMinutes),
      maxScore,
      taskWeight: maxScore,
      level: task.level || context.level,
      minWords: getWritingMinimumWords(task),
      targetWords: Number(task.targetWords) || null,
      register: task.register || "",
      criteria: task.criteria || [],
      candidateResponse: String(answers[index] ?? ""),
      responseWordCount: countWords(answers[index]),
    };
  });
};

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

const germanWritingPrompts = {
  "write-1": "Schreiben Sie eine E-Mail an eine Sprachschule in Berlin. Fragen Sie nach den Uhrzeiten des A2-Kurses, dem Preis und dem Anmeldedatum.",
  "write-2": "Schreiben Sie einem deutschen Freund und laden Sie ihn ein, Ihre Stadt am Wochenende zu besuchen. Schlagen Sie zwei Aktivitaeten vor.",
  "write-3": "Sie koennen zu einem Behoerdentermin nicht kommen. Schreiben Sie eine E-Mail, entschuldigen Sie sich und schlagen Sie zwei neue Termine vor.",
  "write-4": "Aeussern Sie Ihre Meinung zu Online-Sprachkursen. Nennen Sie einen Vorteil, einen Nachteil und Ihre persoenliche Praeferenz.",
  "write-5": "Sie haben ein Zimmer reserviert, aber die Heizung funktioniert nicht. Schreiben Sie an das Wohnheim, beschreiben Sie das Problem und bitten Sie um eine Loesung.",
  "write-6": "Sollten oeffentliche Verkehrsmittel fuer Studierende kostenlos sein? Entwickeln Sie Ihren Standpunkt mit zwei Argumenten und einer Einschraenkung.",
  "write-7": "Sollte man waehrend des Studiums arbeiten? Stellen Sie Vorteile, Risiken und eine Empfehlung fuer internationale Studierende dar.",
  "write-8": "Diskutieren Sie den Einsatz kuenstlicher Intelligenz beim Sprachenlernen. Analysieren Sie Autonomie, Korrektur und ethische Grenzen.",
  "write-9": "Verfassen Sie eine Synthese ueber das Gleichgewicht zwischen akademischem Erfolg und psychischer Gesundheit bei Studierenden. Schlagen Sie zwei konkrete Massnahmen vor.",
  "write-10": "Analysieren Sie, inwiefern internationale Mobilitaet die berufliche Identitaet junger Absolventinnen und Absolventen veraendert. Stuetzen Sie Ihre Antwort auf Beispiele.",
};

const germanSpeakingPrompts = {
  "speak-1": "Beschreiben Sie das Bild: Wen sehen Sie, wo sind die Personen und was machen sie?",
  "speak-2": "Stellen Sie sich auf Deutsch vor: Name, Land, aktuelle Taetigkeit und Grund, Deutsch zu lernen.",
  "speak-3": "Sie kommen in einer Sprachschule an. Fragen Sie, wo Ihr Raum ist, wann der Kurs beginnt und wo Sie das Buch kaufen koennen.",
  "speak-4": "Antworten Sie auf die Frage: Lernen Sie lieber morgens oder abends? Nennen Sie zwei Gruende.",
  "speak-5": "Erzaehlen Sie von einer wichtigen Reise: Wohin sind Sie gefahren, mit wem, und was haben Sie gelernt?",
  "speak-6": "Vergleichen Sie das Leben in der Stadt und auf dem Land fuer internationale Studierende. Beenden Sie Ihre Antwort mit Ihrer Praeferenz.",
  "speak-7": "Ihre Mitbewohnerin oder Ihr Mitbewohner moechte waehrend Ihrer Pruefungszeit eine Feier organisieren. Erklaeren Sie das Problem und schlagen Sie einen Kompromiss vor.",
  "speak-8": "Erklaeren Sie, warum Weiterbildung im modernen Berufsleben wichtig wird. Geben Sie ein konkretes Beispiel.",
  "speak-9": "Reagieren Sie auf diese Aussage: Homeoffice macht Teams weniger kreativ. Nuancieren Sie Ihre Antwort.",
  "speak-10": "Inwiefern veraendert eine neue Sprache die Art zu denken und zu handeln? Entwickeln Sie eine strukturierte Antwort.",
};

const GERMAN_TASK_COPY = {
  "read-1": {
    typeLabel: "Mehrfachauswahl",
    question: "Welche wichtigste Aenderung wird im Text angekuendigt?",
    options: [
      { value: "a", label: "Die Bibliothek schliesst waehrend der Pruefungen." },
      { value: "b", label: "Die Bibliothek bleibt an einigen Tagen laenger geoeffnet." },
      { value: "c", label: "Die Bibliothek wird kostenpflichtig." },
    ],
    hint: "Achten Sie auf die Oeffnungszeiten in Absatz A.",
    explanation: "Absatz A kuendigt Oeffnungszeiten bis 22 Uhr von Montag bis Donnerstag an.",
  },
  "read-2": {
    typeLabel: "Richtig / Falsch",
    question: "Das Erdgeschoss ist fuer ruhiges Arbeiten reserviert.",
    hint: "Vergleichen Sie die beiden Bereiche in Absatz B.",
    explanation: "Ruhiges Arbeiten findet im ersten Stock statt. Das Erdgeschoss ist fuer Gruppen vorgesehen.",
  },
  "read-3": {
    typeLabel: "Lueckentext",
    question: "Ergaenzen Sie: Die Anmeldung zu den Workshops erfolgt ueber die Plattform ____.",
    hint: "Die Antwort steht am Ende von Absatz C.",
    explanation: "Die genannte Plattform heisst Bibliothek Plus.",
  },
  "read-4": {
    typeLabel: "Titel zuordnen",
    question: "Ordnen Sie jedem Absatz seine Hauptidee zu.",
    headings: ["Angepasste Arbeitsbereiche", "Laengerer Zugang", "Ein Unterstuetzungsprogramm"],
    correct: {
      A: "Laengerer Zugang",
      B: "Angepasste Arbeitsbereiche",
      C: "Ein Unterstuetzungsprogramm",
    },
    hint: "Suchen Sie zuerst das Schluesselwort jedes Absatzes.",
    explanation: "Die Abschnitte behandeln nacheinander Oeffnungszeiten, Arbeitsbereiche und Workshops.",
  },
  "read-5": {
    typeLabel: "Mehrfachauswahl",
    question: "Warum aendert die Universitaet die Oeffnungszeiten?",
    options: [
      { value: "a", label: "Um auf die Beduerfnisse der Studierenden zu reagieren." },
      { value: "b", label: "Um Personalkosten zu senken." },
      { value: "c", label: "Um Abendkurse zu ersetzen." },
    ],
    hint: "Die Begruendung steht im zweiten Satz von Absatz A.",
    explanation: "Der Text nennt eine haeufige Bitte von Studierenden als Grund.",
  },
  "read-6": {
    typeLabel: "Richtig / Falsch",
    question: "Gruppenraeume koennen online reserviert werden.",
    hint: "Lesen Sie Absatz B noch einmal.",
    explanation: "Der Text sagt, dass Raeume online fuer zwei Stunden gebucht werden koennen.",
  },
  "read-7": {
    typeLabel: "Lueckentext",
    question: "Nach 19 Uhr koennen Studierende Buecher in eine ____ Rueckgabebox legen.",
    correct: "automatische",
    alternatives: ["automatische", "automatisch"],
    hint: "Die Einschraenkung und die Alternative stehen in Absatz D.",
    explanation: "Die Rueckgabebox ist automatisch und befindet sich nahe am Haupteingang.",
  },
  "read-8": {
    typeLabel: "Mehrfachauswahl",
    question: "Welche wichtige Einschraenkung gibt es bei der Ausleihe?",
    options: [
      { value: "a", label: "Die Ausleihe laeuft die ganze Nacht weiter." },
      { value: "b", label: "Die Ausleihe ist nach 19 Uhr geschlossen, Rueckgaben bleiben aber moeglich." },
      { value: "c", label: "Rueckgaben sind nach 19 Uhr verboten." },
    ],
    hint: "Absatz D stellt eine Grenze und eine Moeglichkeit gegenueber.",
    explanation: "Die Ausleihe schliesst nach 19 Uhr, aber Rueckgaben ueber die Box bleiben moeglich.",
  },
  "read-9": {
    typeLabel: "Titel zuordnen",
    question: "Welcher Titel passt am besten zu den Absaetzen B, C und D?",
    headings: ["Organisation der Raeume", "Paedagogische Angebote", "Praktische Einschraenkungen"],
    correct: {
      B: "Organisation der Raeume",
      C: "Paedagogische Angebote",
      D: "Praktische Einschraenkungen",
    },
    hint: "Fassen Sie jeden Absatz zuerst in zwei Woertern zusammen.",
    explanation: "B beschreibt die Raeume, C die Workshops und D die Grenzen des Services.",
  },
  "read-10": {
    typeLabel: "Mehrfachauswahl",
    question: "Welcher Ton kennzeichnet die Ankuendigung insgesamt?",
    options: [
      { value: "a", label: "Informativ mit einigen praktischen Bedingungen." },
      { value: "b", label: "Kritisch und ironisch." },
      { value: "c", label: "Werblich ohne konkrete Details." },
    ],
    hint: "Beachten Sie die Struktur: Ankuendigung, Regeln, Grenzen.",
    explanation: "Die Ankuendigung gibt konkrete Informationen und nennt praktische Einschraenkungen.",
  },
  "listen-1": {
    typeLabel: "Mehrfachauswahl",
    question: "Wo findet die Ansage statt?",
    options: [
      { value: "a", label: "In einem Bahnhof." },
      { value: "b", label: "In einer Bibliothek." },
      { value: "c", label: "In einem Restaurant." },
    ],
    hint: "Hoeren Sie auf Wörter zum Verkehr.",
    explanation: "Die Ansage spricht von einem Zug, einem Gleis und Reisenden.",
  },
  "listen-2": {
    typeLabel: "Fehlendes Wort",
    question: "Der Zug nach Berlin faehrt von Gleis ____ ab.",
    correct: "7",
    alternatives: ["sieben"],
    hint: "Die Zahl wird nach dem Gleiswechsel genannt.",
    explanation: "Die Ansage nennt Gleis 7.",
  },
  "listen-3": {
    typeLabel: "Richtig / Falsch",
    question: "Der Zug hat ungefaehr fuenfzehn Minuten Verspaetung.",
    hint: "Achten Sie auf die Zeitangabe.",
    explanation: "Die Ansage nennt eine Verspaetung von ungefaehr fuenfzehn Minuten.",
  },
  "listen-4": {
    typeLabel: "In die richtige Reihenfolge bringen",
    question: "Bringen Sie die Ereignisse in die gehoerte Reihenfolge.",
    events: [
      { value: "change", label: "Gleiswechsel" },
      { value: "delay", label: "Ansage der Verspaetung" },
      { value: "coffee", label: "Hinweis fuer Reisende" },
    ],
    hint: "Achten Sie auf Signalwörter wie zuerst, danach und schliesslich.",
    explanation: "Zuerst kommt der Gleiswechsel, dann die Verspaetung, danach der Hinweis zum Warten.",
  },
  "listen-5": {
    typeLabel: "Mehrfachauswahl",
    question: "Warum sollen die Reisenden aufmerksam bleiben?",
    options: [
      { value: "a", label: "Das Gleis koennte sich erneut aendern." },
      { value: "b", label: "Die Fahrkarten sind nicht mehr gueltig." },
      { value: "c", label: "Der Zug faellt aus." },
    ],
    hint: "Hoeren Sie die letzte Empfehlung.",
    explanation: "Die Ansage bittet die Reisenden, die Anzeigen weiter zu beobachten.",
  },
  "listen-6": {
    typeLabel: "Fehlendes Wort",
    question: "Die Reisenden koennen auf der unteren Ebene in der Naehe des ____ warten.",
    correct: "Cafes",
    alternatives: ["cafe", "cafes", "café", "cafés"],
    hint: "Der Ort wird nach dem praktischen Hinweis genannt.",
    explanation: "Das Cafe auf der unteren Ebene wird als Warteort genannt.",
  },
  "listen-7": {
    typeLabel: "Mehrfachauswahl",
    question: "Welche Information wird in der Ansage nicht genannt?",
    options: [
      { value: "a", label: "Das neue Gleis." },
      { value: "b", label: "Die genaue Ursache der Verspaetung." },
      { value: "c", label: "Das Ziel des Zuges." },
    ],
    hint: "Unterscheiden Sie genannte Fakten von fehlenden Gruenden.",
    explanation: "Die Ansage nennt Gleis und Ziel, aber nicht die genaue Ursache der Verspaetung.",
  },
  "listen-8": {
    typeLabel: "Richtig / Falsch",
    question: "Die Reisenden sollen sofort zu einem Schalter gehen.",
    hint: "Der Hinweis betrifft vor allem das Warten und die Anzeigen.",
    explanation: "In der Ansage wird kein Gang zum Schalter verlangt.",
  },
  "listen-9": {
    typeLabel: "In die richtige Reihenfolge bringen",
    question: "Ordnen Sie diese Informationen nach ihrer Bedeutung in der Ansage.",
    events: [
      { value: "platform", label: "Neues Gleis" },
      { value: "delay", label: "Voraussichtliche Verspaetung" },
      { value: "screens", label: "Anzeigen beobachten" },
    ],
    hint: "Die wichtigste Information hilft, den Zug nicht zu verpassen.",
    explanation: "Das neue Gleis ist am wichtigsten, danach folgen Verspaetung und Beobachtung der Anzeigen.",
  },
  "listen-10": {
    typeLabel: "Mehrfachauswahl",
    question: "Welches Register beschreibt die Ansage am besten?",
    options: [
      { value: "a", label: "Formal, kurz und funktional." },
      { value: "b", label: "Umgangssprachlich und humorvoll." },
      { value: "c", label: "Erzaehlend und persoenlich." },
    ],
    hint: "Oeffentliche Ansagen nutzen oft direkte Formulierungen.",
    explanation: "Die Ansage vermittelt praktische Informationen in einem formalen Register.",
  },
  "write-1": { typeLabel: "Kurze E-Mail", title: "Eine Information erfragen", register: "formell", prompt: germanWritingPrompts["write-1"], criteria: ["Anrede", "drei klare Fragen", "Grussformel"] },
  "write-2": { typeLabel: "Persoenliche Nachricht", title: "Einen Freund einladen", register: "informell", prompt: germanWritingPrompts["write-2"], criteria: ["natuerlicher Ton", "Datum oder Zeitpunkt", "zwei Aktivitaeten"] },
  "write-3": { typeLabel: "Praktische E-Mail", title: "Einen Termin verschieben", register: "formell", prompt: germanWritingPrompts["write-3"], criteria: ["Entschuldigung", "einfacher Grund", "zwei Vorschlaege"] },
  "write-4": { typeLabel: "Kurze Stellungnahme", title: "Online lernen", register: "neutral", prompt: germanWritingPrompts["write-4"], criteria: ["klare Meinung", "Konnektoren", "persoenliches Beispiel"] },
  "write-5": { typeLabel: "Beschwerde-E-Mail", title: "Wohnungsproblem", register: "formell", prompt: germanWritingPrompts["write-5"], criteria: ["praezise Beschreibung", "klare Bitte", "hoefliches Register"] },
  "write-6": { typeLabel: "Strukturierter Aufsatz", title: "Oeffentliche Verkehrsmittel", register: "neutral", prompt: germanWritingPrompts["write-6"], criteria: ["Einleitung", "ausgewogene Argumente", "Schluss"] },
  "write-7": { typeLabel: "Meinungsartikel", title: "Arbeit und Studium", register: "neutral", prompt: germanWritingPrompts["write-7"], criteria: ["Nuance", "Beispiele", "Empfehlung"] },
  "write-8": { typeLabel: "Argumentation", title: "Kuenstliche Intelligenz", register: "formell", prompt: germanWritingPrompts["write-8"], criteria: ["Problemstellung", "komplexe Argumente", "praeziser Wortschatz"] },
  "write-9": { typeLabel: "Synthese", title: "Universitaetsleben", register: "formell", prompt: germanWritingPrompts["write-9"], criteria: ["Synthese", "klare Struktur", "konkrete Massnahmen"] },
  "write-10": { typeLabel: "Fortgeschrittener Aufsatz", title: "Internationale Mobilitaet", register: "formell", prompt: germanWritingPrompts["write-10"], criteria: ["nuancierte These", "sichere Abstraktion", "passende Beispiele"] },
  "speak-1": { typeLabel: "Bild beschreiben", title: "Alltagsszene", prompt: germanSpeakingPrompts["speak-1"], checklist: ["Ort", "Personen", "Handlungen"] },
  "speak-2": { typeLabel: "Persoenliche Frage", title: "Sich vorstellen", prompt: germanSpeakingPrompts["speak-2"], checklist: ["Identitaet", "Taetigkeit", "Ziel"] },
  "speak-3": { typeLabel: "Rollenspiel", title: "Am Empfang", prompt: germanSpeakingPrompts["speak-3"], checklist: ["Begruessung", "drei Bitten", "Dank"] },
  "speak-4": { typeLabel: "Kurze Meinung", title: "Abends lernen", prompt: germanSpeakingPrompts["speak-4"], checklist: ["Meinung", "zwei Gruende", "Konnektoren"] },
  "speak-5": { typeLabel: "Erfahrung beschreiben", title: "Eine Reise", prompt: germanSpeakingPrompts["speak-5"], checklist: ["Vergangenheit", "chronologische Ordnung", "Fazit"] },
  "speak-6": { typeLabel: "Vergleichen", title: "Stadt oder Land", prompt: germanSpeakingPrompts["speak-6"], checklist: ["Vergleich", "Beispiel", "Praeferenz"] },
  "speak-7": { typeLabel: "Fortgeschrittenes Rollenspiel", title: "Einen Kompromiss finden", prompt: germanSpeakingPrompts["speak-7"], checklist: ["Problem", "hoeflicher Ton", "Loesung"] },
  "speak-8": { typeLabel: "Abstraktes Thema", title: "Lebenslanges Lernen", prompt: germanSpeakingPrompts["speak-8"], checklist: ["abstraktes Argument", "Beispiel", "Schluss"] },
  "speak-9": { typeLabel: "Reagieren", title: "Homeoffice", prompt: germanSpeakingPrompts["speak-9"], checklist: ["Position", "Nuance", "Gegenbeispiel"] },
  "speak-10": { typeLabel: "Muendliche Argumentation", title: "Identitaet und Sprache", prompt: germanSpeakingPrompts["speak-10"], checklist: ["These", "Abstraktion", "Struktur"] },
};

const withGermanTaskCopy = (tasks) =>
  tasks.map((task) => {
    const copy = GERMAN_TASK_COPY[task.id] ?? {};
    return {
      ...task,
      ...copy,
      options: copy.options ?? task.options,
      headings: copy.headings ?? task.headings,
      events: copy.events ?? task.events,
      criteria: copy.criteria ?? task.criteria,
      checklist: copy.checklist ?? task.checklist,
      alternatives: copy.alternatives ?? task.alternatives,
    };
  });

const withGermanPrompts = (tasks, promptMap) =>
  tasks.map((task) => ({
    ...task,
    prompt: promptMap[task.id] ?? task.prompt,
  }));

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
    passage: germanReadingPassage ?? readingPassage,
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
    tasks: withMinimumWritingWords(withGermanPrompts(writingTasks, germanWritingPrompts)),
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
    tasks: withGermanPrompts(speakingTasks, germanSpeakingPrompts),
    focus: ["Prononciation", "Fluidité", "Interaction", "Organisation des idées"],
    advancement: [
      "Réponses plus longues",
      "Temps de préparation réduit",
      "Sujets plus abstraits",
      "Relances plus spontanées",
    ],
  },
  sprach: {
    id: "sprach",
    title: "Sprachbausteine",
    eyebrow: "Sprachbausteine",
    examPart: "Sprachbausteine",
    accent: "#b91c1c",
    soft: "#fff1f1",
    Icon: BookOpen,
    simulationSeconds: 30 * 60,
    tasks: [],
    passage: { title: "Sprachbausteine", intro: "", paragraphs: [] },
    focus: ["Lueckentext", "Grammatik", "Wortschatz", "Antwortkasten"],
    advancement: ["Offizielle TELC-Struktur", "Zwei Teile", "20 Luecken", "Antwortbank"],
  },
};

const GERMAN_MODULE_OVERRIDES = {
  read: {
    title: "Lesen",
    eyebrow: "Aktives Lesen",
    tasks: withGermanTaskCopy(readingTasks),
    focus: ["Informationen finden", "Richtig/Falsch", "Titel zuordnen", "Wortschatz im Kontext"],
    advancement: ["Laengere Texte", "Weniger transparenter Wortschatz", "Inferenzfragen", "Kuerzere Lesezeit"],
  },
  listen: {
    title: "Hoerverstehen",
    eyebrow: "Aktives Hoeren",
    tasks: withGermanTaskCopy(listeningTasks),
    audio: {
      ...MODULES.listen.audio,
      title: "Ansage im Bahnhof",
      speaker: "Standarddeutsch, moderates Tempo",
    },
    focus: ["Notizen machen", "Zahlenangaben", "Reihenfolge der Ereignisse", "Akzente und Tempo"],
    advancement: ["Schnelleres Tempo", "Regionale Akzente", "Laengere Audioaufnahmen", "Weniger Wiederholungen"],
  },
  write: {
    title: "Schreiben",
    eyebrow: "Strukturierte Produktion",
    tasks: withMinimumWritingWords(withGermanTaskCopy(writingTasks)),
    focus: ["Klarer Plan", "Passendes Register", "Konnektoren", "Grammatische Korrektheit"],
    advancement: ["Abstraktere Themen", "Hoehere Wortgrenzen", "Formelles Register", "Nuancierte Argumentation"],
  },
  speak: {
    title: "Sprechen",
    eyebrow: "Sprechen",
    tasks: withGermanTaskCopy(speakingTasks),
    focus: ["Aussprache", "Fluessigkeit", "Interaktion", "Gedanken ordnen"],
    advancement: ["Laengere Antworten", "Kuerzere Vorbereitungszeit", "Abstraktere Themen", "Spontanere Nachfragen"],
  },
  sprach: {
    title: "Sprachbausteine",
    eyebrow: "Sprachbausteine",
    focus: ["Lueckentext", "Grammatik", "Wortschatz", "Antwortkasten"],
    advancement: ["Offizielle TELC-Struktur", "Zwei Teile", "20 Luecken", "Antwortbank"],
  },
};

Object.entries(GERMAN_MODULE_OVERRIDES).forEach(([moduleId, override]) => {
  MODULES[moduleId] = { ...MODULES[moduleId], ...override };
});

const TRUE_FALSE_OPTIONS = [
  { value: "true", label: "Richtig" },
  { value: "false", label: "Falsch" },
];

const GERMAN_CHOICE_LABELS = {
  "read-1": {
    a: "Die Bibliothek schliesst waehrend der Pruefungen.",
    b: "Die Bibliothek bleibt an einigen Tagen laenger geoeffnet.",
    c: "Die Bibliothek wird kostenpflichtig.",
  },
  "read-5": {
    a: "Um auf die Beduerfnisse der Studierenden zu reagieren.",
    b: "Um Personalkosten zu senken.",
    c: "Um Abendkurse zu ersetzen.",
  },
  "read-8": {
    a: "Die Ausleihe laeuft die ganze Nacht weiter.",
    b: "Die Ausleihe ist nach 19 Uhr geschlossen, aber Rueckgaben bleiben moeglich.",
    c: "Rueckgaben sind nach 19 Uhr verboten.",
  },
  "read-10": {
    a: "Informativ mit einigen praktischen Bedingungen.",
    b: "Kritisch und ironisch.",
    c: "Werblich ohne konkrete Details.",
  },
  "listen-1": {
    a: "In einem Bahnhof.",
    b: "In einer Bibliothek.",
    c: "In einem Restaurant.",
  },
  "listen-4": {
    change: "Gleiswechsel",
    delay: "Ansage der Verspaetung",
    coffee: "Hinweis fuer Reisende",
  },
  "listen-5": {
    a: "Das Gleis koennte sich erneut aendern.",
    b: "Die Fahrkarten sind nicht mehr gueltig.",
    c: "Der Zug faellt aus.",
  },
  "listen-7": {
    a: "Das neue Gleis.",
    b: "Die genaue Ursache der Verspaetung.",
    c: "Das Ziel des Zuges.",
  },
  "listen-9": {
    platform: "Neues Gleis",
    delay: "Voraussichtliche Verspaetung",
    screens: "Anzeigen beobachten",
  },
  "listen-10": {
    a: "Formal, kurz und funktional.",
    b: "Umgangssprachlich und humorvoll.",
    c: "Erzaehlend und persoenlich.",
  },
};

const GERMAN_HEADING_LABELS = {
  "read-4": ["Angepasste Arbeitsbereiche", "Laengerer Zugang", "Ein Unterstuetzungsprogramm"],
  "read-9": ["Organisation der Raeume", "Paedagogische Angebote", "Praktische Einschraenkungen"],
};

const toPlainDisplayText = (value, fallback = "") => {
  if (value == null || value === "") return fallback;
  const raw = String(value);
  const text = hasRichTextMarkup(raw) ? richTextToPlainText(raw) : raw;
  return text.replace(/\s+/g, " ").trim() || fallback;
};

const getProtectedChoiceLabel = (task, option, index = 0) =>
  toPlainDisplayText(
    GERMAN_CHOICE_LABELS[task?.id]?.[option?.value] ??
      GERMAN_HEADING_LABELS[task?.id]?.[index] ??
      option?.label ??
      option,
    `Option ${index + 1}`
  );

const AUDIO_REPLAY_LIMIT = 5;
const AUDIO_WORDS_PER_MINUTE = 132;

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
  date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

const extractTime = (value) => String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? formatClock();

const toGermanStatus = (value) => {
  const text = String(value ?? "");
  if (!text) return "";

  if (text.includes("Mode visiteur")) return "Besuchermodus: Der Fortschritt wird nicht gespeichert.";
  if (text.includes("Dern")) return `Letzte Speicherung ${extractTime(text)}`;
  if (text.includes("Auto-sauveg")) return `Automatisch gespeichert um ${extractTime(text)}`;
  if (text.includes("Sauvegarde locale impossible")) return "Lokale Speicherung nicht moeglich: Der Browserspeicher ist voll.";
  if (text.includes("Sauvegarde locale pr")) return "Lokale Speicherung bereit.";
  if (text.includes("Sauvegard")) return `Gespeichert um ${extractTime(text)}`;
  if (text.includes("Sauvegarde locale pr")) return "Lokale Speicherung bereit.";
  if (text.includes("Sauvegarde locale impossible")) return "Lokale Speicherung nicht moeglich: Der Browserspeicher ist voll.";
  if (text.includes("Simulation d")) return "Simulation gestartet: Die Navigation ist gesperrt.";
  if (text.includes("Limite de 5")) return "Die Grenze von 5 Hoerdurchgaengen ist fuer dieses Modul erreicht.";
  if (text.includes("Production audio has not been generated")) return "Das Produktionsaudio wurde noch nicht generiert. Bitte einen Administrator, die Hoeren-Audio-Datei zu erzeugen.";
  if (text.includes("Production audio cannot be played")) return "Die Produktionsaudio-Datei kann auf diesem Geraet gerade nicht abgespielt werden.";
  if (text.includes("Production audio is not available")) return "Das Produktionsaudio ist im Moment nicht verfuegbar.";
  if (text.includes("Audio playback is not supported")) return "Die Audiowiedergabe wird von diesem Browser auf diesem Geraet nicht unterstuetzt. Bitte versuchen Sie Chrome, aktualisieren Sie den Browser oder nutzen Sie ein anderes Geraet. Wenn eine Audiodatei fuer diesen Test vorhanden ist, wird sie stattdessen abgespielt.";
  if (text.includes("synth")) return "Die Produktionsaudio-Datei ist in diesem Browser nicht verfuegbar.";
  if (text.includes("lecture audio")) return "Die Audiowiedergabe ist auf diesem Geraet fehlgeschlagen. Pruefen Sie die Lautstaerke.";
  if (text.includes("brouillon est vide")) return "Der Entwurf ist leer.";
  if (text.includes("Brouillon")) return `Entwurf gespeichert um ${extractTime(text)}`;
  if (text.includes("Micro non disponible")) return "Mikrofon nicht verfuegbar: Stattdessen wird der Trainingstimer verwendet.";
  if (text.includes("Autorisation micro")) return "Mikrofonberechtigung verweigert: Der Trainingstimer wird verwendet.";
  if (text.includes("Connectez-vous")) return "Ergebnis lokal gespeichert. Melden Sie sich an, um es dem Dashboard hinzuzufuegen.";
  if (text.includes("dashboard")) return "Ergebnis im Dashboard gespeichert.";
  if (text.includes("backend")) return "Ergebnis lokal gespeichert. Das Backend ist im Moment nicht erreichbar.";

  return text;
};

const countWords = (text) => {
  const words = String(text ?? "").trim().match(/\S+/g);
  return words ? words.length : 0;
};

const formatWritingRequirementGerman = (task) =>
  `Mindestens ${getWritingMinimumWords(task)} Wörter, keine Obergrenze`;

const formatWritingRequirementFrench = (task) =>
  `Minimum ${getWritingMinimumWords(task)} mots, sans limite maximale`;

const getEstimatedAudioDuration = (audio) => {
  const wordCount = countWords(audio?.transcript);
  const punctuationPauses = (String(audio?.transcript ?? "").match(/[.,;:!?]/g) ?? []).length * 0.45;
  const rate = Math.max(0.6, Number(audio?.rate) || 1);
  const spokenSeconds = (wordCount / (AUDIO_WORDS_PER_MINUTE * rate)) * 60;
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
    select: 60,
    blank: 75,
    match: 120,
    order: 110,
  }[task.type] ?? 75;
  return typeBase + levelExtra;
};

const normalizePartKey = (value, fallback = "part-1") => {
  const text = String(value ?? "").trim().toLowerCase();
  const partMatch = text.match(/(?:teil|part)\s*(\d+)/i);
  if (partMatch) return `part-${partMatch[1]}`;
  const safe = text
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe ? `part-${safe}` : fallback;
};

const plainRichText = (value, fallback = "") => {
  const text = hasRichTextMarkup(value) ? richTextToPlainText(value) : String(value ?? "");
  return text.replace(/\s+/g, " ").trim() || fallback;
};

const getTaskPartKey = (task, index = 0) => {
  if (task?.partKey) return task.partKey;
  if (task?.partNumber) return `part-${task.partNumber}`;
  return normalizePartKey(task?.partTitle || task?.typeLabel, `part-${index + 1}`);
};

const buildExamParts = (module) => {
  const partMap = new Map();
  const moduleParts = Array.isArray(module.parts) ? module.parts : [];

  moduleParts.forEach((part, index) => {
    const partKey = String(part.id ?? "").startsWith("part-")
      ? part.id
      : normalizePartKey(part.id || part.label || part.heading || part.title, `part-${index + 1}`);
    partMap.set(partKey, {
      id: partKey,
      number: part.number || index + 1,
      title: part.heading || part.title || part.label || `Part ${index + 1}`,
      instructions: part.instructions || part.text || "",
      durationMinutes: part.durationMinutes,
      points: part.points,
      taskIndexes: [],
    });
  });

  module.tasks.forEach((task, index) => {
    const partKey = getTaskPartKey(task, index);
    if (!partMap.has(partKey)) {
      partMap.set(partKey, {
        id: partKey,
        number: task.partNumber || partMap.size + 1,
        title: task.partTitle || String(task.typeLabel || `Part ${partMap.size + 1}`).replace(/\s+-\s+.+$/, ""),
        instructions: task.partInstructions || "",
        durationMinutes: task.partDurationMinutes,
        points: task.partPoints,
        taskIndexes: [],
      });
    }
    const part = partMap.get(partKey);
    part.taskIndexes.push(index);
    if (!part.instructions && task.partInstructions) part.instructions = task.partInstructions;
    if (!part.durationMinutes && task.partDurationMinutes) part.durationMinutes = task.partDurationMinutes;
    if (!part.points && task.partPoints) part.points = task.partPoints;
  });

  return [...partMap.values()]
    .filter((part) => part.taskIndexes.length)
    .map((part, index) => ({
      ...part,
      number: part.number || index + 1,
      displayTitle: `Teil ${part.number || index + 1} - ${plainRichText(part.title, "Anweisungen").replace(/^Teil\s+\d+\s*:?\s*/i, "") || "Anweisungen"}`,
      sourceText: stripQuestionMaterial(part.instructions, part.taskIndexes.map((taskIndex) => module.tasks[taskIndex])),
      firstIndex: part.taskIndexes[0],
      lastIndex: part.taskIndexes[part.taskIndexes.length - 1],
    }));
};

const classifyExamTextLine = (line, index = 0, total = 1) => {
  const text = String(line ?? "").trim();
  if (!text) return "body";

  if (/^(achtung|warning|warnung|important|wichtig|note|notiz|hinweis|remarque|attention)\b\s*:?\s*/i.test(text)) {
    return "notice";
  }

  if (/lesen sie zuerst die anweisungen/i.test(text)) return "introInstruction";
  if (/^(teil|part|section|abschnitt)\s*\d+\s*(\||-|:)/i.test(text)) return "sectionTitle";

  if (/^(anweisung|instructions?|directions?|aufgabe|consigne)\b/i.test(text)) {
    return "instruction";
  }

  if (/^(lisez|lesen sie|hoeren sie|horen sie|schreiben sie|waehlen sie|wahlen sie|kreuzen sie|ordnen sie|markieren sie|completez|choisissez|associez|ecoutez)\b/i.test(text)) {
    return "body";
  }

  if (/^(teil|part|section|abschnitt)\s*\d+\b/i.test(text)) return "sectionTitle";
  if (/^(quelle|source|text|texte|transkript|transcript|situation|scenario|szenario)\b\s*:?\s*/i.test(text)) return "subtitle";
  if (/^[A-Z][\p{L}\p{N}\s'().,:-]{2,72}:$/u.test(text)) return "subtitle";
  if (total > 1 && index === 0 && text.length <= 90 && !/[.!?]$/.test(text)) return "sectionTitle";
  if (text.length <= 56 && !/[.!?]$/.test(text)) return "subtitle";

  return "body";
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

  if (task.type === "select") {
    return Boolean(answer);
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
  const lengthPenalty = 0;

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

  const germanSuggestions = [];
  if (words < task.minWords) {
    germanSuggestions.push(`Fuegen Sie etwa ${task.minWords - words} Wörter hinzu, um das erwartete Minimum zu erreichen.`);
  }
  if (!/(weil|deshalb|außerdem|jedoch|trotzdem|zum beispiel|daher|einerseits|andererseits)/i.test(text)) {
    germanSuggestions.push("Fuegen Sie mindestens einen deutschen Konnektor ein, damit der Text fluessiger wird.");
  }
  if (task.register === "formell" && !/(Sehr geehrte|Mit freundlichen Grüßen|bitte|würde)/i.test(text)) {
    germanSuggestions.push("Staerken Sie das formelle Register mit einer passenden Anrede und Schlussformel.");
  }
  if ((text.match(/\bich\b/gi) ?? []).length > 6) {
    germanSuggestions.push("Variieren Sie die Satzstruktur, damit nicht zu viele Saetze mit ich beginnen.");
  }
  if (task?.id) {
    return germanSuggestions.length ? germanSuggestions : ["Klare Struktur. Pruefen Sie jetzt die konjugierten Verben und die Deklinationen."];
  }

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
  if (!module?.tasks?.length) return 0;

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
    hint: override.hint ?? `Nutzen Sie den Kontext der Serie ${series.code}: ${content.theme}.`,
    explanation:
      override.explanation ??
      `Diese Antwort gehoert zu ${series.examName} ${series.code}; das Thema ist ${content.theme}.`,
  };

  if (moduleId === "write") {
    return {
      ...base,
      title: override.title ?? `${series.code}: ${task.title}`,
      prompt: `${task.prompt}\n\nBeziehen Sie Ihre Antwort auf die Serie ${series.code} und nennen Sie ein konkretes Beispiel aus dem Pruefungskontext.`,
      criteria: override.criteria ?? [...(task.criteria ?? []), series.code],
    };
  }

  if (moduleId === "speak") {
    return {
      ...base,
      title: override.title ?? `${series.code}: ${task.title}`,
      prompt: `${task.prompt} Nennen Sie ein Detail aus der Serie ${series.code} und ein konkretes Beispiel.`,
      checklist: override.checklist ?? [...(task.checklist ?? []), series.code],
    };
  }

  if (task.type === "multiple") {
    return {
      ...base,
      question:
        override.question ??
        `Was ist in ${series.code} das Hauptthema dieser Aufgabe?`,
      options: [
        { value: "a", label: "Das zentrale Thema dieser Aufgabe." },
        { value: "b", label: "Ein Rezept fuer den Urlaub." },
        { value: "c", label: "Eine Rangliste aus dem Sport." },
      ],
      correct: override.correct ?? "a",
    };
  }

  if (task.type === "trueFalse") {
    return {
      ...base,
      question:
        override.question ??
        `${series.code} gehoert zu ${series.examName} und nutzt das Thema ${content.theme}.`,
      correct: override.correct ?? "true",
    };
  }

  if (task.type === "blank") {
    return {
      ...base,
      question:
        override.question ??
        `Ergaenzen Sie den Satz: Diese Aufgabenserie heisst ____.`,
      correct: override.correct ?? series.code,
      alternatives: override.alternatives ?? [series.id, series.code.toLowerCase()],
    };
  }

  if (task.type === "match") {
    const paragraphs = task.paragraphs ?? ["A", "B", "C"];
    const headings = [
      `${series.code} Kontext`,
      "Zentrales Thema",
      `${series.examName} Pruefung`,
      `Niveau ${series.level}`,
    ].slice(0, paragraphs.length);
    return {
      ...base,
      question:
        override.question ??
        `Ordnen Sie jedes Element der passenden Ueberschrift aus ${series.code} zu.`,
      paragraphs,
      headings,
      correct: Object.fromEntries(paragraphs.map((paragraph, paragraphIndex) => [paragraph, headings[paragraphIndex]])),
    };
  }

  if (task.type === "order") {
    const events = [
      { value: "topic", label: "Thema erkennen" },
      { value: "details", label: "Daten und wichtige Details notieren" },
      { value: "answer", label: "Passende Antwort auswaehlen" },
    ];
    return {
      ...base,
      question:
        override.question ??
        `Bringen Sie die Hoerschritte aus ${series.code} in die passende Reihenfolge.`,
      events,
      correct: events.map((event) => event.value),
    };
  }

  return base;
};

const buildSeriesModule = (baseModule, content, series) => {
  if (!content || !series) return baseModule;

  if (content.available === false) {
    return {
      ...baseModule,
      isImported: true,
      unavailable: true,
      unavailableTitle: "Section non disponible",
      unavailableMessage:
        "Le test de cette section n'est pas encore disponible. Les exercices de compréhension orale seront ajoutés prochainement.",
      eyebrow: `${series.code} / ${baseModule.eyebrow}`,
      examPart: `${series.examName} ${series.code} - ${baseModule.examPart}`,
      focus: content.focus ?? baseModule.focus,
      advancement: content.advancement ?? [],
      seriesContext: {
        examId: series.examId,
        examName: series.examName,
        seriesId: series.id,
        seriesCode: series.code,
        seriesTitle: series.title,
        theme: content.theme ?? series.theme,
      },
    };
  }

  if (content.isImported) {
    return {
      ...baseModule,
      isImported: true,
      eyebrow: `${series.code} / ${baseModule.eyebrow}`,
      examPart: `${series.examName} ${series.code} - ${baseModule.examPart}`,
      tasks: content.tasks?.length ? content.tasks : baseModule.tasks,
      passage: content.passage ?? baseModule.passage,
      parts: content.parts ?? baseModule.parts,
      audio: content.audio ?? baseModule.audio,
      focus: content.focus ?? baseModule.focus,
      advancement: content.advancement ?? baseModule.advancement,
      seriesContext: {
        examId: series.examId,
        examName: series.examName,
        seriesId: series.id,
        seriesCode: series.code,
        seriesTitle: series.title,
        theme: content.theme ?? series.theme,
      },
    };
  }

  return {
    ...baseModule,
    eyebrow: `${series.code} / ${baseModule.eyebrow}`,
    examPart: `${series.examName} ${series.code} - ${baseModule.examPart}`,
    tasks: baseModule.tasks.map((task, index) => buildSeriesTask(baseModule.id, task, index, content, series)),
    passage: content.passage ?? baseModule.passage,
    parts: content.parts ?? baseModule.parts,
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

const stringifyAnswer = (value) => {
  if (value == null || value === "") return "Keine Antwort";
  if (Array.isArray(value)) {
    return value.map((item) => toPlainDisplayText(item)).filter(Boolean).join(" > ") || "Keine Antwort";
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${toPlainDisplayText(key, "-")}: ${toPlainDisplayText(item, "-")}`)
      .join(", ");
  }
  return toPlainDisplayText(value, "Keine Antwort");
};

const getAnswerLabel = (task, answer) => {
  if (task.type === "multiple" || task.type === "trueFalse" || task.type === "select") {
    const options = task.type === "trueFalse" ? TRUE_FALSE_OPTIONS : task.options;
    const option = options.find((item) => item.value === answer);
    return option ? getProtectedChoiceLabel(task, option) : stringifyAnswer(answer);
  }
  if (task.type === "blank") return stringifyAnswer(answer);
  if (task.type === "match" || task.type === "order") return stringifyAnswer(answer);
  return stringifyAnswer(answer);
};

const getCorrectLabel = (task) => {
  if (task.type === "multiple" || task.type === "trueFalse" || task.type === "select") {
    const options = task.type === "trueFalse" ? TRUE_FALSE_OPTIONS : task.options;
    const option = options.find((item) => item.value === task.correct);
    return option ? getProtectedChoiceLabel(task, option) : stringifyAnswer(task.correct);
  }
  return stringifyAnswer(task.correct);
};

const buildResultSummary = (module, answers) => {
  const rows = module.tasks.map((task, index) => {
    if (module.id === "write") {
      return {
        id: task.id,
        number: index + 1,
        title: toPlainDisplayText(task.title ?? task.question, `Aufgabe ${index + 1}`),
        typeLabel: toPlainDisplayText(task.typeLabel),
        isCorrect: null,
        userAnswer: `${countWords(answers[index])} Wörter`,
        correctAnswer: formatWritingRequirementGerman(task),
        explanation: "Antwort gespeichert. Die finale Bewertung kommt aus der KI-Korrektur.",
      };
    }

    if (module.id === "speak") {
      const taskScore = evaluateSpeaking(task, answers[index]);
      return {
        id: task.id,
        number: index + 1,
        title: toPlainDisplayText(task.title ?? task.question, `Aufgabe ${index + 1}`),
        typeLabel: toPlainDisplayText(task.typeLabel),
        isCorrect: taskScore >= PASS_SCORE,
        userAnswer: answers[index]?.duration ? `${answers[index].duration}s` : "Keine Antwort",
        correctAnswer: `Ziel: ${task.responseSeconds}s`,
        explanation: `Geschaetzte Punktzahl: ${taskScore}%`,
      };
    }

    if (module.id === "write") {
      return {
        id: task.id,
        number: index + 1,
        title: toPlainDisplayText(task.title ?? task.question, `Aufgabe ${index + 1}`),
        typeLabel: toPlainDisplayText(task.typeLabel),
        isCorrect: null,
        userAnswer: `${countWords(answers[index])} mots`,
        correctAnswer: formatWritingRequirementFrench(task),
        explanation: "Reponse enregistree. La note finale vient de la correction IA.",
      };
    }

    if (module.id === "speak") {
      const taskScore = evaluateSpeaking(task, answers[index]);
      return {
        id: task.id,
        number: index + 1,
        title: toPlainDisplayText(task.title ?? task.question, `Aufgabe ${index + 1}`),
        typeLabel: toPlainDisplayText(task.typeLabel),
        isCorrect: taskScore >= PASS_SCORE,
        userAnswer: answers[index]?.duration ? `${answers[index].duration}s` : "Aucune réponse",
        correctAnswer: `Cible: ${task.responseSeconds}s`,
        explanation: `Score estimé: ${taskScore}%`,
      };
    }

    const isCorrect = isAnswerCorrect(task, answers[index]);
    return {
      id: task.id,
      number: index + 1,
      title: toPlainDisplayText(task.question, `Aufgabe ${index + 1}`),
      typeLabel: toPlainDisplayText(task.typeLabel),
      isCorrect,
      userAnswer: getAnswerLabel(task, answers[index]),
      correctAnswer: getCorrectLabel(task),
      explanation: toPlainDisplayText(task.explanation),
    };
  });

  const correctCount = rows.filter((row) => row.isCorrect === true).length;
  const wrongCount = rows.filter((row) => row.isCorrect === false).length;
  return {
    rows,
    correctCount,
    wrongCount,
  };
};

function FeedbackBox({ task, answer }) {
  if (!isQuestionAnswered(task, answer)) return null;

  const correct = isAnswerCorrect(task, answer);

  if (task?.id) {
    return (
      <div className={`${styles.feedbackBox} ${correct ? styles.feedbackCorrect : styles.feedbackWrong}`}>
        {correct ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
        <div>
          <strong>{correct ? "Richtig" : "Noch einmal pruefen"}</strong>
          <p>{task.explanation}</p>
        </div>
      </div>
    );
  }

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
  const t = useSimulationLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const routeModuleId = moduleIdOverride ?? params.moduleId ?? "read";
  const baseModule = MODULES[routeModuleId] ?? MODULES.read;
  const [importedModuleState, setImportedModuleState] = useState({
    loading: Boolean(params.examId && params.seriesId),
    series: null,
    content: null,
  });

  useEffect(() => {
    let cancelled = false;
    setImportedModuleState({
      loading: Boolean(params.examId && params.seriesId),
      series: null,
      content: null,
    });

    fetchImportedSeriesModule(params.examId, params.seriesId, baseModule.id)
      .then((payload) => {
        if (cancelled) return;
        setImportedModuleState({
          loading: false,
          series: payload?.series ?? null,
          content: payload?.content ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setImportedModuleState({ loading: false, series: null, content: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [baseModule.id, params.examId, params.seriesId]);

  const selectedSeries = importedModuleState.series;
  const selectedSeriesContent = importedModuleState.content;
  const auth = useMemo(() => getAuthUser(), []);
  const loggedIn = Boolean(auth?.id);
  const visitorSeriesAttempt = isVisitorSeriesAttempt(selectedSeries);
  const visitorAccessAllowed = Boolean(location.state?.visitorFreeAccess);
  const blockedSeriesAccess = Boolean(selectedSeries && !canOpenSeries(selectedSeries));
  const blockedVisitorRefresh = visitorSeriesAttempt && !visitorAccessAllowed;
  const waitingForImportedSeries = Boolean(params.seriesId && !selectedSeries && importedModuleState.loading);
  const module = useMemo(
    () => buildSeriesModule(baseModule, selectedSeriesContent, selectedSeries),
    [baseModule, selectedSeriesContent, selectedSeries]
  );
  const shouldPersistProgress =
    !module.unavailable && !blockedSeriesAccess && !blockedVisitorRefresh && !waitingForImportedSeries;
  const ModuleIcon = module.Icon;
  const moduleTitle = t.modules[module.id] ?? module.title;
  const totalTasks = module.tasks.length;
  const progressScopeId = selectedSeries
    ? `${selectedSeries.examId}-${selectedSeries.id}-${module.id}`
    : module.id;
  const progressKey = getProgressKey(progressScopeId);
  const totalExamDuration = useMemo(
    () => module.tasks.reduce((sum, task) => sum + getTaskDuration(module, task), 0),
    [module]
  );
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
  const [timerSeconds, setTimerSeconds] = useState(totalExamDuration);
  const [simulationMode, setSimulationMode] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [partIntroVisible, setPartIntroVisible] = useState(true);
  const [partTransition, setPartTransition] = useState(null);
  const [navPanelOpen, setNavPanelOpen] = useState(false);
  const [, setSaveStatus] = useState("");
  const [resultStatus, setResultStatus] = useState("");
  const [savedSimulationId, setSavedSimulationId] = useState(null);
  const [writingCorrection, setWritingCorrection] = useState(null);
  const [writingCorrectionLoading, setWritingCorrectionLoading] = useState(false);
  const [writingCorrectionError, setWritingCorrectionError] = useState("");
  const [writingVersions, setWritingVersions] = useState([]);
  const [audioTimestamp, setAudioTimestamp] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioSessionActive, setAudioSessionActive] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [listeningAudioDuration, setListeningAudioDuration] = useState(0);
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
  const listeningAudioRef = useRef(null);
  const listeningAmbienceRef = useRef(null);
  const listeningSpeechFallbackRef = useRef(null);
  const audioDebugRef = useRef(null);
  const audioSessionRef = useRef(false);
  const audioTimestampRef = useRef(0);
  const timerDeadlineRef = useRef(null);
  const timerExpiredRef = useRef(false);
  const timerSecondsRef = useRef(totalExamDuration);
  const prepDeadlineRef = useRef(null);
  const prepExpiredRef = useRef(false);
  const prepRemainingRef = useRef(speakingTasks[0].prepSeconds);
  const recordingIntervalRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const recordingTaskIndexRef = useRef(0);
  const fallbackRecordingRef = useRef(false);
  const levelActivityKeyRef = useRef("");
  const writingTextareaRef = useRef(null);

  const currentTask = module.tasks[Math.min(currentIndex, Math.max(totalTasks - 1, 0))] ?? {
    id: `${module.id}-loading-task`,
    title: "",
    question: "",
    type: "multiple",
    typeLabel: "",
    hint: "",
    options: [],
    correct: null,
    prepSeconds: speakingTasks[0].prepSeconds,
    responseSeconds: speakingTasks[0].responseSeconds,
    checklist: [],
  };
  const currentAnswer = answers[currentIndex];
  const examParts = useMemo(() => buildExamParts(module), [module]);
  const currentPartIndex = Math.max(
    0,
    examParts.findIndex((part) => part.taskIndexes.includes(currentIndex))
  );
  const currentPart = examParts[currentPartIndex] ?? examParts[0];
  const currentPartQuestionIndex = currentPart ? Math.max(0, currentPart.taskIndexes.indexOf(currentIndex)) : 0;
  const currentPartQuestionTotal = currentPart?.taskIndexes.length ?? totalTasks;
  const moduleItemSingular = isTopicModule(module.id) ? "Thema" : "Frage";
  const moduleItemPlural = getModuleCountLabel(module.id);
  const currentTaskDuration = getTaskDuration(module, currentTask);
  const currentListeningAudio = module.id === "listen" ? (currentTask?.audio || module.audio || null) : null;
  const isBrowserSpeechAudio = currentListeningAudio?.fallbackEngine === "browser-speech";
  const listeningReplayLimit = Math.max(1, Number(currentListeningAudio?.listeningCount) || AUDIO_REPLAY_LIMIT);
  const currentAudioDuration = module.id === "listen"
    ? Math.round(Number(currentListeningAudio?.durationSeconds) || listeningAudioDuration || getEstimatedAudioDuration(currentListeningAudio))
    : 0;
  const listeningAudioUrl = currentListeningAudio?.audioUrl || "";
  const answeredCount = module.tasks.filter((task, index) => getTaskAnswered(module, task, answers[index])).length;
  const remainingCount = Math.max(0, totalTasks - answeredCount);
  const completedPartCount = examParts.filter((part) =>
    part.taskIndexes.every((taskIndex) => getTaskAnswered(module, module.tasks[taskIndex], answers[taskIndex]))
  ).length;
  const progressPercent = totalTasks ? ((answeredCount / totalTasks) * 100).toFixed(1) : "0";
  const score = calculateModuleScore(module, answers);
  const currentAnswered = getTaskAnswered(module, currentTask, currentAnswer);
  const level = selectedSeries?.level ?? currentTask?.level ?? "A1";

  useEffect(() => {
    if (!auth?.id || !level || module.unavailable) return;
    const key = `${auth.id}:${progressScopeId}:${module.id}:${level}`;
    if (levelActivityKeyRef.current === key) return;
    levelActivityKeyRef.current = key;
    API.post("/api/user/level-activity", { level }).then(() => {
      clearDashboardCache();
    }).catch(() => {
      // Starting-level tracking is helpful but should never block an exercise.
    });
  }, [auth?.id, level, module.id, module.unavailable, progressScopeId]);
  const audioAtSessionEnd = module.id === "listen" && audioTimestamp >= currentAudioDuration;
  const audioReplayBlocked = module.id === "listen" && replaysUsed >= listeningReplayLimit && (!audioSessionActive || audioAtSessionEnd);

  useEffect(() => {
    listeningAmbienceRef.current?.dispose();
    listeningAmbienceRef.current = null;
    listeningSpeechFallbackRef.current?.dispose();
    listeningSpeechFallbackRef.current = null;
    if (listeningAudioRef.current) {
      listeningAudioRef.current.pause();
      listeningAudioRef.current.currentTime = 0;
    }
    setAudioPlaying(false);
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    setListeningAudioDuration(0);
    setReplaysUsed(0);
    setAudioError("");
    return () => {
      listeningAmbienceRef.current?.dispose();
      listeningAmbienceRef.current = null;
      listeningSpeechFallbackRef.current?.dispose();
      listeningSpeechFallbackRef.current = null;
    };
  }, [currentListeningAudio?.id, listeningAudioUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentIndex, currentPart?.id]);

  const stopListeningAmbience = useCallback((immediate = false) => {
    listeningAmbienceRef.current?.stop(immediate);
  }, []);

  const getListeningSpeechFallback = useCallback(() => {
    if (!isBrowserSpeechAudio || !currentListeningAudio) return null;
    if (!listeningSpeechFallbackRef.current) {
      listeningSpeechFallbackRef.current = createListeningSpeechFallback({
        audio: currentListeningAudio,
        onTime: (seconds) => {
          audioTimestampRef.current = seconds;
          setAudioTimestamp(seconds);
        },
        onEnd: () => {
          const duration = listeningSpeechFallbackRef.current?.duration || currentAudioDuration || 0;
          audioTimestampRef.current = duration;
          setAudioTimestamp(duration);
          setAudioPlaying(false);
          audioSessionRef.current = false;
          setAudioSessionActive(false);
        },
        onError: (error) => {
          setAudioPlaying(false);
          audioSessionRef.current = false;
          setAudioSessionActive(false);
          audioDebugRef.current = {
            ...(audioDebugRef.current || {}),
            type: "browser-tts-error",
            error,
          };
          setAudioError("Browser-TTS konnte auf diesem Geraet nicht gestartet werden.");
        },
        onDebug: (event) => {
          audioDebugRef.current = event;
          if (import.meta.env.DEV && event?.type && event.type !== "voices-ready") {
            console.debug("[listening-browser-tts]", event);
          }
        },
      });
      if (listeningSpeechFallbackRef.current?.duration) {
        setListeningAudioDuration(listeningSpeechFallbackRef.current.duration);
      }
    }
    return listeningSpeechFallbackRef.current;
  }, [currentAudioDuration, currentListeningAudio, isBrowserSpeechAudio]);


  const armExamTimer = useCallback((seconds, { running = false } = {}) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    timerSecondsRef.current = safeSeconds;
    setTimerSeconds(safeSeconds);
    timerExpiredRef.current = false;
    timerDeadlineRef.current = running && safeSeconds > 0 ? Date.now() + safeSeconds * 1000 : null;
  }, []);

  const armPrepTimer = useCallback((seconds, { running = false } = {}) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    prepRemainingRef.current = safeSeconds;
    setPrepRemaining(safeSeconds);
    prepExpiredRef.current = false;
    prepDeadlineRef.current = running && safeSeconds > 0 ? Date.now() + safeSeconds * 1000 : null;
  }, []);

  useEffect(() => {
    if (!shouldPersistProgress) {
      setCurrentIndex(0);
      setAnswers({});
      setSkipped({});
      setFlagged({});
      setNotes({});
      setElapsedSeconds(0);
      armExamTimer(totalExamDuration, { running: false });
      setSimulationMode(true);
      setCompleted(false);
      setPartIntroVisible(true);
      setWritingVersions([]);
      setSavedSimulationId(null);
      setWritingCorrection(null);
      setWritingCorrectionLoading(false);
      setWritingCorrectionError("");
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
    const savedTimer = Number(stored?.timerSeconds);
    const restoredTimerSeconds =
      Number.isFinite(savedTimer) && savedTimer > 0
        ? savedTimer
        : totalExamDuration;
    const restoredPartIntroVisible = stored?.completed ? false : stored?.partIntroVisible ?? restoredIndex === 0;
    armExamTimer(restoredTimerSeconds, {
      running: !stored?.completed && !restoredPartIntroVisible,
    });
    setSimulationMode(stored?.completed ? Boolean(stored?.simulationMode) : true);
    setCompleted(Boolean(stored?.completed));
    setPartIntroVisible(restoredPartIntroVisible);
    setWritingVersions(stored?.writingVersions ?? []);
    const restoredAudioTimestamp = Number(stored?.audioTimestamp) || 0;
    setAudioTimestamp(restoredAudioTimestamp);
    audioTimestampRef.current = restoredAudioTimestamp;
    setReplaysUsed(Number(stored?.replaysUsed) || 0);
    const restoredPrepActive = module.id === "speak" && !stored?.completed && !restoredPartIntroVisible && (stored?.prepActive ?? true);
    setSpeakingPhase(stored?.speakingPhase ?? "prep");
    setPrepActive(restoredPrepActive);
    armPrepTimer(Number(stored?.prepRemaining) || restoredTask?.prepSeconds || speakingTasks[0].prepSeconds, {
      running: restoredPrepActive,
    });
    setAudioPlaying(false);
    setAudioSessionActive(false);
    setResultStatus("");
    setSavedSimulationId(null);
    setWritingCorrection(null);
    setWritingCorrectionLoading(false);
    setWritingCorrectionError("");
    setSaveStatus(stored?.savedAt ? `Dernière sauvegarde ${formatClock(new Date(stored.savedAt))}` : "Sauvegarde locale prête");
    setRestoredKey(progressKey);
  }, [armExamTimer, armPrepTimer, examParts, module, progressKey, shouldPersistProgress, totalExamDuration, totalTasks]);

  useEffect(() => {
    if (completed) return undefined;
    const interval = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [completed]);

  const saveResultToBackend = useCallback(
    async (finalScore) => {
      const isWritingModule = module.id === "write";
      if (!auth?.id) {
        if (isWritingModule) {
          setWritingCorrectionLoading(false);
          setWritingCorrectionError("Connectez-vous pour lancer la correction automatique.");
        }
        setResultStatus("Résultat gardé en local. Connectez-vous pour l'ajouter au dashboard.");
        return;
      }

      if (isWritingModule) {
        setSavedSimulationId(null);
        setWritingCorrection(null);
        setWritingCorrectionError("");
        setWritingCorrectionLoading(true);
      }

      try {
        const summary = buildResultSummary(module, answers);
        const writingTasksForCorrection = buildWritingCorrectionTasks(module, answers, examParts, {
          examHeading,
          moduleTitle,
          level,
        });
        const writingMaxScore = writingTasksForCorrection.reduce((sum, task) => sum + (Number(task.maxScore) || 0), 0);
        const resultDetails = {
          examName: examHeading,
          examCode: selectedSeries?.examId ?? null,
          moduleId: module.id,
          moduleTitle,
          moduleType: module.examPart,
          mode: simulationMode ? "simulation" : "training",
          level,
          correct: summary.correctCount,
          wrong: summary.wrongCount,
          total: totalTasks,
          totalTasks,
          answeredCount,
          correctCount: summary.correctCount,
          wrongCount: summary.wrongCount,
          score: finalScore,
          summary,
          series: selectedSeries
            ? {
                id: selectedSeries.id,
                code: selectedSeries.code,
                examId: selectedSeries.examId,
                examName: selectedSeries.examName,
                level: selectedSeries.level,
                title: selectedSeries.title,
              }
            : null,
        };

        if (isWritingModule) {
          resultDetails.answers = answers;
          resultDetails.writingTasks = writingTasksForCorrection;
          resultDetails.writingMaxScore = writingMaxScore || 100;
        }

        const response = await API.post(
          "/api/user/simulations",
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
            resultDetails,
            durationSeconds: elapsedSeconds,
          }
        );
        clearDashboardCache();
        let correction = response.data?.writingCorrection ?? null;
        if (isWritingModule) {
          const simulationId = response.data?.simulation?.id;
          if (simulationId) setSavedSimulationId(simulationId);
          if (!correction && simulationId) {
            setResultStatus("Résultat enregistré. Correction IA en cours.");
            try {
              const correctionResponse = await API.post(`/api/simulations/${simulationId}/writing-correction`);
              correction = correctionResponse.data?.correction ?? null;
            } catch {
              setWritingCorrectionError("Résultat enregistré, mais la correction IA n'a pas pu se terminer. Relancez la correction depuis ce résultat.");
            }
          }
          setWritingCorrection(correction);
          if (correction?.status === "partial" || correction?.status === "failed") {
            setWritingCorrectionError(correction.errorMessage || "Correction IA indisponible pour le moment.");
          }
        }
        setResultStatus("Résultat enregistré dans le dashboard.");
      } catch {
        if (isWritingModule) {
          setWritingCorrectionError("Correction IA indisponible: le resultat n'a pas pu etre envoye au backend.");
        }
        setResultStatus("Résultat gardé en local. Le backend n'est pas joignable pour le moment.");
      } finally {
        if (isWritingModule) setWritingCorrectionLoading(false);
      }
    },
    [
      answeredCount,
      answers,
      auth?.id,
      elapsedSeconds,
      examHeading,
      examParts,
      level,
      module,
      moduleTitle,
      selectedSeries,
      simulationMode,
      totalTasks,
    ]
  );

  const finishModule = useCallback(() => {
    setCompleted(true);
    setPartIntroVisible(false);
    setAudioPlaying(false);
    stopListeningAmbience(true);
    listeningSpeechFallbackRef.current?.reset();
    if (listeningAudioRef.current) {
      listeningAudioRef.current.pause();
      listeningAudioRef.current.currentTime = 0;
    }
    void saveResultToBackend(score);
  }, [saveResultToBackend, score, stopListeningAmbience]);

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
      remainingCount,
      completedPartCount,
      progressPercent: Number(progressPercent),
      answers,
      skipped,
      flagged,
      notes,
      elapsedSeconds,
      timerSeconds,
      taskDuration: currentTaskDuration,
      partIntroVisible,
      currentPartId: currentPart?.id,
      simulationMode,
      completed,
      audioTimestamp,
      replaysUsed,
      prepRemaining,
      prepActive,
      speakingPhase,
      writingVersions,
      lastAccessedAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
    }),
    [
      answers,
      answeredCount,
      audioTimestamp,
      completedPartCount,
      completed,
      currentIndex,
      currentPart?.id,
      currentTaskDuration,
      currentRoute,
      elapsedSeconds,
      flagged,
      module.examPart,
      moduleTitle,
      notes,
      partIntroVisible,
      prepRemaining,
      prepActive,
      progressPercent,
      remainingCount,
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
          auth?.id &&
          (snapshot.simulationMode ||
          snapshot.completed ||
          snapshot.currentIndex > 0 ||
          snapshot.answeredCount > 0 ||
          Object.values(snapshot.notes ?? {}).some((note) => String(note ?? "").trim()))
        ) {
          upsertSimulationHistoryEntry(snapshot);
        }
        setSaveStatus(message ?? `Sauvegardé à ${formatClock()}`);
      } catch {
        setSaveStatus("Sauvegarde locale impossible : espace navigateur insuffisant.");
      }
    },
    [auth?.id, buildProgressSnapshot, progressKey, shouldPersistProgress]
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
    if (module.id !== "speak") return;
    const shouldRunPrep = simulationMode && !completed && !partIntroVisible;
    armPrepTimer(currentTask.prepSeconds, { running: shouldRunPrep });
    setSpeakingPhase("prep");
    setPrepActive(shouldRunPrep);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setRecordError("");
  }, [armPrepTimer, completed, currentIndex, currentTask.prepSeconds, module.id, partIntroVisible, simulationMode]);

  useEffect(
    () => () => {
      listeningAudioRef.current?.pause();
      listeningAmbienceRef.current?.dispose();
      listeningSpeechFallbackRef.current?.dispose();
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

  const setAnswerForIndex = useCallback((taskIndex, value) => {
    setAnswers((previous) => ({ ...previous, [taskIndex]: value }));
    setSkipped((previous) => {
      if (!previous[taskIndex]) return previous;
      const next = { ...previous };
      delete next[taskIndex];
      return next;
    });
  }, []);

  const startSimulation = useCallback(() => {
    setCurrentIndex(0);
    setAnswers({});
    setSkipped({});
    setFlagged({});
    setNotes({});
    setElapsedSeconds(0);
    armExamTimer(totalExamDuration, { running: false });
    setSimulationMode(true);
    setCompleted(false);
    setPartIntroVisible(true);
    setPartTransition(null);
    setWritingVersions([]);
    setSavedSimulationId(null);
    setWritingCorrection(null);
    setWritingCorrectionLoading(false);
    setWritingCorrectionError("");
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    setListeningAudioDuration(0);
    setReplaysUsed(0);
    setAudioPlaying(false);
    setSpeakingPhase("prep");
    armPrepTimer(module.tasks[0]?.prepSeconds ?? speakingTasks[0].prepSeconds, { running: false });
    setPrepActive(false);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    setResultStatus("");
    setSaveStatus("Simulation démarrée : navigation verrouillée.");
    stopListeningAmbience(true);
    listeningSpeechFallbackRef.current?.reset();
    if (listeningAudioRef.current) {
      listeningAudioRef.current.pause();
      listeningAudioRef.current.currentTime = 0;
    }
  }, [armExamTimer, armPrepTimer, module, stopListeningAmbience, totalExamDuration]);

  const beginPart = useCallback((part, startIndex, { logStart = true } = {}) => {
    const safeIndex = part?.firstIndex ?? startIndex ?? currentIndex;
    setCurrentIndex(safeIndex);
    setPartIntroVisible(false);
    if (!timerDeadlineRef.current) {
      timerDeadlineRef.current = Date.now() + Math.max(0, timerSecondsRef.current || totalExamDuration) * 1000;
    }
    setSpeakingPhase("prep");
    armPrepTimer(module.tasks[safeIndex]?.prepSeconds ?? speakingTasks[0].prepSeconds, {
      running: module.id === "speak" && simulationMode,
    });
    setPrepActive(module.id === "speak" && simulationMode);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
    if (logStart) {
      persistProgress(`Teil ${part?.number ?? currentPartIndex + 1} demarree a ${formatClock()}`);
    }
  }, [armPrepTimer, currentIndex, currentPartIndex, module, persistProgress, simulationMode, totalExamDuration]);

  const startPartTransition = useCallback((nextPart, nextIndex, message = "") => {
    if (!nextPart) return false;
    timerDeadlineRef.current = null;
    prepDeadlineRef.current = null;
    setPrepActive(false);
    setPartIntroVisible(false);
    setNavPanelOpen(false);
    setPartTransition({
      id: `${nextPart.id || nextPart.number || nextIndex}-${Date.now()}`,
      nextPart,
      nextIndex,
    });
    if (message) setResultStatus(message);
    return true;
  }, []);

  const completePartTransition = useCallback(() => {
    if (!partTransition?.nextPart) return;
    const { nextPart, nextIndex } = partTransition;
    setPartTransition(null);
    setResultStatus("");
    beginPart(nextPart, nextIndex);
  }, [beginPart, partTransition]);

  const goToNext = useCallback(() => {
    if (currentIndex >= totalTasks - 1) {
      finishModule();
      return;
    }
    const nextPart = currentPart && currentIndex >= currentPart.lastIndex ? examParts[currentPartIndex + 1] : null;
    const nextIndex = nextPart ? nextPart.firstIndex : Math.min(totalTasks - 1, currentIndex + 1);
    if (module.id !== "listen" && startPartTransition(nextPart, nextIndex)) return;
    setCurrentIndex(nextIndex);
    setPartIntroVisible(false);
    setSpeakingPhase("prep");
    armPrepTimer(module.tasks[nextIndex]?.prepSeconds ?? speakingTasks[0].prepSeconds, {
      running: module.id === "speak" && simulationMode,
    });
    setPrepActive(module.id === "speak" && simulationMode);
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
  }, [armPrepTimer, currentIndex, currentPart, currentPartIndex, examParts, finishModule, module, simulationMode, startPartTransition, totalTasks]);

  const goToPrevious = useCallback(() => {
    const previousIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(previousIndex);
    setPartIntroVisible(false);
  }, [currentIndex]);

  const jumpToQuestion = useCallback((targetIndex) => {
    if (isRecording) return;
    const safeIndex = Math.min(Math.max(0, targetIndex), totalTasks - 1);
    setCurrentIndex(safeIndex);
    setPartIntroVisible(false);
    setNavPanelOpen(false);
  }, [isRecording, totalTasks]);

  const playListeningAudio = useCallback(async () => {
    if (module.id !== "listen") return;
    const replayLimit = listeningReplayLimit;
    const startingFresh = audioTimestamp <= 0 || audioTimestamp >= currentAudioDuration || !audioSessionActive;

    if (startingFresh) {
      if (replaysUsed >= replayLimit) {
        setSaveStatus(`Die maximale Anzahl von ${replayLimit} Hoerdurchgaengen ist erreicht.`);
        return;
      }
      setReplaysUsed((value) => value + 1);
      setAudioTimestamp(0);
      audioTimestampRef.current = 0;
      audioSessionRef.current = true;
      setAudioSessionActive(true);
    }

    if (isBrowserSpeechAudio && !listeningAudioUrl) {
      const speech = getListeningSpeechFallback();
      if (!speech) {
        setAudioError("Browser-TTS ist auf diesem Geraet nicht verfuegbar.");
        setAudioPlaying(false);
        audioSessionRef.current = false;
        setAudioSessionActive(false);
        return;
      }
      try {
        setAudioError("");
        await speech.play();
        setAudioPlaying(true);
      } catch {
        setAudioPlaying(false);
        audioSessionRef.current = false;
        setAudioSessionActive(false);
        setAudioError("Browser-TTS konnte auf diesem Geraet nicht gestartet werden.");
      }
      return;
    }

    if (!listeningAudioUrl) {
      setAudioError(MOBILE_AUDIO_UNSUPPORTED_MESSAGE);
      setAudioPlaying(false);
      audioSessionRef.current = false;
      setAudioSessionActive(false);
      return;
    }

    const audioElement = listeningAudioRef.current;
    if (!audioElement) return;

    if (startingFresh) {
      audioElement.currentTime = 0;
    }

    try {
      setAudioError("");
      await audioElement.play();
      setAudioPlaying(true);
    } catch {
      setAudioPlaying(false);
      audioSessionRef.current = false;
      setAudioSessionActive(false);
      setAudioError("Die Audiodatei konnte auf diesem Geraet nicht abgespielt werden.");
    }
  }, [audioSessionActive, audioTimestamp, currentAudioDuration, getListeningSpeechFallback, isBrowserSpeechAudio, listeningAudioUrl, listeningReplayLimit, module.id, replaysUsed]);

  const pauseListeningAudio = useCallback(() => {
    setAudioPlaying(false);
    stopListeningAmbience();
    audioTimestampRef.current = listeningAudioRef.current?.currentTime || audioTimestampRef.current;
    listeningAudioRef.current?.pause();
    listeningSpeechFallbackRef.current?.pause();
  }, [stopListeningAmbience]);

  const resetListeningAudio = useCallback(() => {
    const audioElement = listeningAudioRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    listeningSpeechFallbackRef.current?.reset();
    stopListeningAmbience(true);
    setAudioPlaying(false);
    setAudioTimestamp(0);
    audioTimestampRef.current = 0;
    audioSessionRef.current = false;
    setAudioSessionActive(false);
  }, [stopListeningAmbience]);

  const handleListeningAudioLoadedMetadata = useCallback((event) => {
    const duration = Math.round(Number(event.currentTarget.duration) || 0);
    setListeningAudioDuration(duration);
  }, []);

  const handleListeningAudioTimeUpdate = useCallback((event) => {
    const nextValue = Math.round(Number(event.currentTarget.currentTime) || 0);
    audioTimestampRef.current = nextValue;
    setAudioTimestamp(nextValue);
  }, []);

  const handleListeningAudioEnded = useCallback((event) => {
    const finalDuration = Math.round(Number(event.currentTarget.duration) || currentAudioDuration || 0);
    setAudioTimestamp(finalDuration);
    audioTimestampRef.current = finalDuration;
    setAudioPlaying(false);
    stopListeningAmbience();
    listeningSpeechFallbackRef.current?.reset();
    audioSessionRef.current = false;
    setAudioSessionActive(false);
  }, [currentAudioDuration, stopListeningAmbience]);

  const handleListeningAudioError = useCallback(() => {
    setAudioPlaying(false);
    stopListeningAmbience(true);
    audioSessionRef.current = false;
    setAudioSessionActive(false);
    setAudioError("Die freigegebene Audiodatei ist noch nicht verfuegbar.");
  }, [stopListeningAmbience]);

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
    armPrepTimer(currentTask.prepSeconds, { running: true });
    setPrepActive(true);
  }, [armPrepTimer, currentTask.prepSeconds]);

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
      const stream = await navigator.mediaDevices.getUserMedia(getMicrophoneConstraints());
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorderOptions = getPreferredRecorderOptions();
      const recorder = new window.MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = audioChunksRef.current.length ? createRecordingBlob(audioChunksRef.current) : null;
        finishRecording(blob);
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start(250);
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

    setResultStatus("Zeit abgelaufen. Die Antworten werden angezeigt.");
    finishModule();
  }, [
    finishModule,
    isRecording,
    persistProgress,
    stopRecording,
  ]);

  const finishCurrentTimedSection = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
    if (audioPlaying) {
      pauseListeningAudio();
    }
    persistProgress(`Temps termine a ${formatClock()}`);

    setResultStatus("Zeit abgelaufen. Die Antworten werden angezeigt.");
    finishModule();
  }, [
    audioPlaying,
    finishModule,
    isRecording,
    pauseListeningAudio,
    persistProgress,
    stopRecording,
  ]);

  useEffect(() => {
    if (!simulationMode || completed || partIntroVisible || partTransition || module.unavailable) {
      timerDeadlineRef.current = null;
      timerExpiredRef.current = false;
      return undefined;
    }

    if (!timerDeadlineRef.current) {
      timerDeadlineRef.current = Date.now() + Math.max(0, timerSecondsRef.current) * 1000;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timerDeadlineRef.current - Date.now()) / 1000));
      timerSecondsRef.current = remaining;
      setTimerSeconds((value) => (value === remaining ? value : remaining));
      if (remaining <= 0 && !timerExpiredRef.current) {
        timerExpiredRef.current = true;
        timerDeadlineRef.current = null;
        finishCurrentTimedSection();
      }
    };

    tick();
    const interval = window.setInterval(() => {
      tick();
    }, 250);

    return () => window.clearInterval(interval);
  }, [completed, finishCurrentTimedSection, module.unavailable, partIntroVisible, partTransition, simulationMode]);

  useEffect(() => {
    if (module.id !== "speak" || !simulationMode || !prepActive || completed || partIntroVisible || partTransition) {
      prepDeadlineRef.current = null;
      prepExpiredRef.current = false;
      return undefined;
    }

    if (!prepDeadlineRef.current) {
      prepDeadlineRef.current = Date.now() + Math.max(0, prepRemainingRef.current) * 1000;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((prepDeadlineRef.current - Date.now()) / 1000));
      prepRemainingRef.current = remaining;
      setPrepRemaining((value) => (value === remaining ? value : remaining));
      if (remaining > 0 || prepExpiredRef.current) return;
      prepExpiredRef.current = true;
      prepDeadlineRef.current = null;
      if (speakingPhase === "prep") {
        setSpeakingPhase("response");
        armPrepTimer(currentTask.responseSeconds, { running: true });
        return;
      }

      advanceAfterTimer();
    };

    tick();
    const interval = window.setInterval(() => {
      tick();
    }, 250);

    return () => window.clearInterval(interval);
  }, [
    advanceAfterTimer,
    armPrepTimer,
    completed,
    currentTask.responseSeconds,
    module.id,
    partIntroVisible,
    partTransition,
    prepActive,
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

  const startCurrentPart = useCallback(() => {
    const startIndex = currentPart?.firstIndex ?? currentIndex;
    setPartTransition(null);
    beginPart(currentPart, startIndex);
  }, [beginPart, currentIndex, currentPart]);

  const handleReadableWheel = useCallback((event) => {
    const target = event.currentTarget;
    const maxScrollTop = target.scrollHeight - target.clientHeight;
    if (maxScrollTop <= 0 || event.deltaY === 0) return;

    const scrollingDown = event.deltaY > 0;
    const canScrollDown = target.scrollTop < maxScrollTop - 1;
    const canScrollUp = target.scrollTop > 1;

    if ((scrollingDown && canScrollDown) || (!scrollingDown && canScrollUp)) {
      event.preventDefault();
      event.stopPropagation();
      target.scrollTop = Math.max(0, Math.min(maxScrollTop, target.scrollTop + event.deltaY));
    }
  }, []);

  const renderRichExamText = (html, keyPrefix = "rich-exam-text", className = "") => (
    <div
      key={keyPrefix}
      className={`${styles.richExamText} ${className}`}
      translate="no"
      dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(html) }}
    />
  );

  const renderContentTitle = (title, keyPrefix = "content-title") => {
    const safeHtml = sanitizeRichTextHtml(title);
    if (hasRichTextMarkup(title) && safeHtml) {
      return (
        <h2
          key={keyPrefix}
          className={styles.richHeadingTitle}
          translate="no"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      );
    }
    return <h2 translate="no">{plainRichText(title)}</h2>;
  };

  const renderQuestionHeading = (text, keyPrefix) => {
    if (hasRichTextMarkup(text)) {
      return renderRichExamText(text, keyPrefix, styles.questionText);
    }
    const plainText = String(text ?? "").trim();
    if (plainText.length > 180 || plainText.includes("\n")) {
      return (
        <div className={styles.questionTextBlock}>
          {renderStructuredExamText(plainText, keyPrefix)}
        </div>
      );
    }
    return <h2 className={styles.questionText}>{plainText}</h2>;
  };

  const renderPartMaterial = (part, { compact = false } = {}) => {
    const sourceText = part?.sourceText || module.passage?.intro || currentTask?.prompt || currentTask?.question || "";
    if (hasRichTextMarkup(sourceText)) {
      return (
        <div
          className={`${styles.examMaterial} ${styles.readableScrollArea} ${compact ? styles.examMaterialCompact : ""}`}
          onWheel={handleReadableWheel}
        >
          {renderRichExamText(sourceText, `${part?.id ?? "part"}-rich`)}
        </div>
      );
    }

    const blocks = String(sourceText)
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    return (
      <div
        className={`${styles.examMaterial} ${styles.readableScrollArea} ${compact ? styles.examMaterialCompact : ""}`}
        onWheel={handleReadableWheel}
      >
        {blocks.length ? (
          blocks.map((block, index) => {
            const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
            const listLineCount = lines.filter((line) => /^(\(?[a-j]\)|[-*]|\d+\.)\s+/i.test(line)).length;
            const looksLikeList = lines.length > 1 && listLineCount >= Math.ceil(lines.length * 0.6);
            if (looksLikeList) {
              return (
                <ul key={`${part?.id ?? "part"}-${index}`}>
                  {lines.map((line) => (
                    <li key={line} className={styles.examTextBody} translate="no">{line.replace(/^[-*]\s*/, "")}</li>
                  ))}
                </ul>
              );
            }
            const blockType = lines.length === 1
              ? classifyExamTextLine(lines[0], index, blocks.length)
              : null;
            if (!blockType) {
              return (
                <div key={`${part?.id ?? "part"}-${index}`} className={styles.examTextGroup}>
                  {lines.map((line, lineIndex) => {
                    const lineType = classifyExamTextLine(line, lineIndex, lines.length);
                    return (
                      <p key={`${line}-${lineIndex}`} className={styles[`examText${lineType[0].toUpperCase()}${lineType.slice(1)}`]} translate="no">
                        {line}
                      </p>
                    );
                  })}
                </div>
              );
            }
            return (
              <p key={`${part?.id ?? "part"}-${index}`} className={styles[`examText${blockType[0].toUpperCase()}${blockType.slice(1)}`]} translate="no">
                {block}
              </p>
            );
          })
        ) : (
          <p className={styles.examTextInstruction} translate="no">Die Anweisungen fuer diesen Teil stehen im aktiven {moduleItemSingular}.</p>
        )}
      </div>
    );
  };

  const renderStructuredExamText = (text, keyPrefix = "exam-text") => {
    if (hasRichTextMarkup(text)) {
      return renderRichExamText(text, `${keyPrefix}-rich`);
    }

    const lines = String(text ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) return null;

    return lines.map((line, index) => {
      const lineType = classifyExamTextLine(line, index, lines.length);
      const className = styles[`examText${lineType[0].toUpperCase()}${lineType.slice(1)}`];
      return (
        <p key={`${keyPrefix}-${index}`} className={className} translate="no">
          {line}
        </p>
      );
    });
  };

  const renderExamSidebar = () => (
    <>
      <button
        type="button"
        className={`${styles.navPanelBackdrop} ${navPanelOpen ? styles.navPanelBackdropOpen : ""}`}
        onClick={() => setNavPanelOpen(false)}
        aria-label="Navigation schliessen"
      />
      <aside
        id="exam-navigation-panel"
        className={`${styles.examNavPanel} ${navPanelOpen ? styles.examNavPanelOpen : ""}`}
        aria-label="Pruefungsnavigation"
      >
        <div className={styles.examNavPanelHeader}>
          <div>
            <p>Pruefungssteuerung</p>
            <h2>Navigation</h2>
          </div>
          <button
            type="button"
            className={styles.navPanelClose}
            onClick={() => setNavPanelOpen(false)}
            aria-label="Navigation schliessen"
          >
            <X size={18} />
          </button>
        </div>

        <section className={styles.navCard} aria-label="Timer und Status">
          <div className={styles.navCardHeader}>
            <span><Clock3 size={16} /> Section Timer/Status</span>
          </div>
          <div className={styles.navTimer}>
            {formatExamTime(simulationMode ? timerSeconds : currentTaskDuration)}
          </div>
          <p className={styles.navStatusText}>
            {simulationMode
              ? `Teil ${currentPart?.number ?? currentPartIndex + 1} von ${Math.max(1, examParts.length)}`
              : t.modulePage.freeTraining}
          </p>
          {simulationMode ? <span className={styles.navStatusBadge}><Lock size={14} /> Navigation kontrolliert</span> : null}
        </section>

        <section className={styles.navCard} aria-label="Abschnittsfortschritt">
          <div className={styles.navCardHeader}>
            <span><ClipboardCheck size={16} /> Section Progress</span>
          </div>
          <p className={styles.navSectionCurrent}>
            Teil {currentPart?.number ?? currentPartIndex + 1}: {currentPart?.displayTitle ?? moduleTitle}
          </p>
          <p className={styles.navStatusText}>
            {moduleItemSingular} {currentPartQuestionIndex + 1} von {currentPartQuestionTotal} in diesem Teil
          </p>
          <div className={styles.sectionProgressList}>
            {examParts.map((part, index) => {
              const partAnsweredCount = part.taskIndexes.filter((taskIndex) =>
                getTaskAnswered(module, module.tasks[taskIndex], answers[taskIndex])
              ).length;
              const partComplete = partAnsweredCount === part.taskIndexes.length;
              const partActive = index === currentPartIndex;
              const targetIndex = part.taskIndexes.find((taskIndex) =>
                !getTaskAnswered(module, module.tasks[taskIndex], answers[taskIndex])
              ) ?? part.firstIndex;
              return (
                <button
                  key={part.id}
                  type="button"
                  className={styles.sectionProgressButton}
                  data-active={partActive ? "true" : "false"}
                  data-complete={partComplete ? "true" : "false"}
                  onClick={() => jumpToQuestion(targetIndex)}
                  disabled={isRecording}
                >
                  <span>Teil {part.number}</span>
                  <strong>{partAnsweredCount}/{part.taskIndexes.length}</strong>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.navCard} aria-label={`${moduleItemPlural}-Navigator`}>
          <div className={styles.navCardHeader}>
            <span><ClipboardCheck size={16} /> {moduleItemPlural}-Navigator</span>
          </div>
          <div className={styles.questionNav}>
            {module.tasks.map((task, index) => {
              const answered = getTaskAnswered(module, task, answers[index]);
              const isSkipped = Boolean(skipped[index]);
              const isFlagged = Boolean(flagged[index]);
              const isCurrent = index === currentIndex && !partIntroVisible;
              return (
                <button
                  key={task.id}
                  type="button"
                  className={[
                    styles.questionButton,
                    isCurrent ? styles.questionCurrent : "",
                    answered ? styles.questionAnswered : "",
                    isSkipped ? styles.questionSkipped : "",
                  ].join(" ")}
                  onClick={() => jumpToQuestion(index)}
                  disabled={isRecording}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`${moduleItemSingular} ${index + 1}${answered ? ", beantwortet" : ", offen"}${isFlagged ? ", markiert" : ""}`}
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
            <span><i className={styles.legendCurrent} /> Aktuell</span>
            <span><i className={styles.legendFlagged} /> {t.modulePage.flagged}</span>
          </div>
        </section>
      </aside>
    </>
  );

  const renderPartIntro = () => (
    <section className={styles.partIntroPanel}>
      <div className={styles.partIntroHeader}>
        <div>
          <p className={styles.sectionLabel}>Teil {currentPart?.number ?? currentPartIndex + 1}</p>
          <h2>{currentPart?.displayTitle ?? "Einleitung zum Teil"}</h2>
          <p className={styles.examTextIntroInstruction}>
            Lesen Sie die Anweisungen aufmerksam. Der Timer laeuft fuer das gesamte Modul und wird zwischen den Teilen nicht neu gestartet.
          </p>
        </div>
        <div className={styles.partMetaStack}>
          <span><ClipboardCheck size={16} /> {currentPartQuestionTotal} {currentPartQuestionTotal === 1 ? moduleItemSingular : moduleItemPlural}</span>
          <span><Clock3 size={16} /> Gesamtzeit {formatExamTime(totalExamDuration)}</span>
          {currentPart?.points ? <span><ShieldCheck size={16} /> {currentPart.points} pts</span> : null}
        </div>
      </div>

      <div className={styles.partIntroBody} onWheel={handleReadableWheel}>
        {renderPartMaterial(currentPart)}
      </div>

      <div className={styles.partIntroActions}>
        <button type="button" className={styles.primaryButton} onClick={startCurrentPart}>
          Test starten
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );

  const getAnswerOptionStyle = (task) => {
    const style = task?.contentStyle?.answerOptions;
    if (!style || typeof style !== "object") return { buttonStyle: undefined, labelStyle: undefined };
    const inline = style.inline && typeof style.inline === "object" ? style.inline : {};
    const marks = style.marks && typeof style.marks === "object" ? style.marks : {};
    const block = style.block && typeof style.block === "object" ? style.block : {};
    const safe = (value, max = 80) => {
      const text = String(value ?? "").trim();
      return text && text.length <= max ? text : undefined;
    };
    const buttonStyle = {
      textAlign: safe(block.textAlign),
      lineHeight: safe(block.lineHeight),
      marginBottom: safe(block.marginBottom),
      paddingLeft: safe(block.paddingLeft),
      backgroundColor: safe(inline.backgroundColor),
    };
    const labelStyle = {
      color: safe(inline.color),
      fontFamily: safe(inline.fontFamily),
      fontSize: safe(inline.fontSize),
      fontWeight: marks.bold ? 800 : undefined,
      fontStyle: marks.italic ? "italic" : undefined,
      textDecoration: marks.underline ? "underline" : undefined,
    };
    return {
      buttonStyle: Object.fromEntries(Object.entries(buttonStyle).filter(([, value]) => value)),
      labelStyle: Object.fromEntries(Object.entries(labelStyle).filter(([, value]) => value)),
    };
  };

  const renderQuestionControl = (task, answer) => {
    if (task.type === "multiple" || task.type === "trueFalse") {
      const options = task.type === "trueFalse" ? TRUE_FALSE_OPTIONS : task.options;
      const optionStyle = getAnswerOptionStyle(task);

      return (
        <div className={styles.optionList}>
          {options.map((option) => {
            const showCorrectness = false;
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
                style={optionStyle.buttonStyle}
                onClick={() => setAnswerForCurrent(option.value)}
              >
                <span translate="no" style={optionStyle.labelStyle}>{getProtectedChoiceLabel(task, option)}</span>
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
          Antwort
          <input
            className={styles.textInput}
            value={answer ?? ""}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
            placeholder="Geben Sie das Wort oder den Ausdruck ein"
          />
        </label>
      );
    }

    if (task.type === "select") {
      return (
        <label className={styles.fieldLabel}>
          Antwort
          <select
            className={styles.selectInput}
            value={answer ?? ""}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
          >
            <option value="">Option waehlen</option>
            {(task.options ?? []).map((option) => (
              <option key={option.value} value={option.value} translate="no">
                {getProtectedChoiceLabel(task, option)}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (task.type === "match") {
      const answerObject = answer ?? {};
      return (
        <div className={styles.matchGrid}>
          {task.paragraphs.map((paragraphId) => (
            <label key={paragraphId} className={styles.matchRow}>
              <span>Abschnitt {paragraphId}</span>
              <select
                value={answerObject[paragraphId] ?? ""}
                onChange={(event) => setAnswerForCurrent({ ...answerObject, [paragraphId]: event.target.value })}
              >
                <option value="">Titel waehlen</option>
                {task.headings.map((heading, index) => (
                  <option key={heading} value={heading} translate="no">
                    {getProtectedChoiceLabel(task, heading, index)}
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
                <option value="">Ereignis waehlen</option>
                {task.events.map((event) => (
                  <option key={event.value} value={event.value} translate="no">
                    {getProtectedChoiceLabel(task, event)}
                  </option>
                ))}
              </select>
            </label>
          ))}
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

    if (task.type === "select") {
      return (
        <label className={styles.fieldLabel}>
          Réponse
          <select
            className={styles.selectInput}
            value={answer ?? ""}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
          >
            <option value="">Choisir une option</option>
            {(task.options ?? []).map((option) => (
              <option key={option.value} value={option.value} translate="no">
                {getProtectedChoiceLabel(task, option)}
              </option>
            ))}
          </select>
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
                {task.headings.map((heading, index) => (
                  <option key={heading} value={heading} translate="no">
                    {getProtectedChoiceLabel(task, heading, index)}
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
                  <option key={event.value} value={event.value} translate="no">
                    {getProtectedChoiceLabel(task, event)}
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

  const isTelcSprachbausteineModule = module.id === "sprach" && /telc/i.test(String(selectedSeries?.examId || selectedSeries?.examName || ""));

  const getCurrentPartTasks = () =>
    (currentPart?.taskIndexes || []).map((taskIndex) => ({ taskIndex, task: module.tasks[taskIndex] })).filter((item) => item.task);

  const getGapTask = (number) =>
    getCurrentPartTasks().find(({ task }) => Number(task.sourceQuestionNumber || task.sourceQuestionId || task.partNumber) === Number(number));

  const isAnswerBankLine = (line) => /^\s*[a-o]\)\s+/i.test(line);

  const splitTelcSprachPartMaterial = (part) => {
    const lines = String(part?.instructions || part?.sourceText || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const optionStart = lines.findIndex((line) => /^\d{1,2}\.\s*a\)/i.test(line));
    const answerBankStart = lines.findIndex((line) => isAnswerBankLine(line));
    const splitIndex = [optionStart, answerBankStart].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? lines.length;
    return {
      textLines: lines.slice(0, splitIndex),
      answerBankLines: answerBankStart >= 0 ? lines.slice(answerBankStart) : [],
    };
  };

  const renderTelcGapControl = ({ taskIndex, task, compact = false }) => {
    const answer = answers[taskIndex] ?? "";
    const options = Array.isArray(task.options) ? task.options : [];
    return (
      <label className={compact ? styles.sprachInlineGapCompact : styles.sprachInlineGap}>
        <span className={styles.sprachGapNumber}>{task.sourceQuestionNumber ?? taskIndex + 1}</span>
        <select
          value={answer}
          onChange={(event) => {
            setCurrentIndex(taskIndex);
            setAnswerForIndex(taskIndex, event.target.value);
          }}
          aria-label={`Lücke ${task.sourceQuestionNumber ?? taskIndex + 1}`}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.value} value={option.value} translate="no">
              {compact ? option.value : `${option.value}) ${getProtectedChoiceLabel(task, option)}`}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const renderTelcSprachLine = (line, lineIndex) => {
    const parts = [];
    let cursor = 0;
    const gapPattern = /\((1[0-9]|20|[1-9])\)/g;
    for (const match of line.matchAll(gapPattern)) {
      const number = Number(match[1]);
      const gap = getGapTask(number);
      if (!gap) continue;
      if (match.index > cursor) parts.push(line.slice(cursor, match.index));
      parts.push(
        <Fragment key={`gap-${lineIndex}-${number}`}>
          {renderTelcGapControl({ ...gap, compact: currentPart?.number === 2 })}
        </Fragment>
      );
      cursor = match.index + match[0].length;
    }
    if (cursor < line.length) parts.push(line.slice(cursor));

    const isHeader = lineIndex <= 1 || /^Lesen Sie\b/.test(line) || /^Text\.$/.test(line);
    const isTitle = !isHeader && lineIndex > 1 && line.length < 80 && !/[.!?:,]$/.test(line) && currentPart?.number === 2;
    return (
      <p
        key={`sprach-line-${lineIndex}`}
        className={isTitle ? styles.sprachArticleTitle : isHeader ? styles.sprachInstructionLine : styles.sprachTextLine}
        translate="no"
      >
        {parts.length ? parts : line}
      </p>
    );
  };

  const renderTelcPart1Options = () => {
    const tasks = getCurrentPartTasks();
    return (
      <div className={styles.sprachOptionsGrid}>
        {tasks.map(({ taskIndex, task }) => (
          <fieldset key={task.id} className={styles.sprachOptionGroup}>
            <legend>Lücke {task.sourceQuestionNumber ?? taskIndex + 1}</legend>
            <div className={styles.sprachOptionChoices}>
              {(task.options || []).map((option) => {
                const selected = answers[taskIndex] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={selected ? styles.sprachOptionSelected : styles.sprachOptionButton}
                    onClick={() => {
                      setCurrentIndex(taskIndex);
                      setAnswerForIndex(taskIndex, option.value);
                    }}
                  >
                    <span>{option.value})</span>
                    <strong translate="no">{getProtectedChoiceLabel(task, option)}</strong>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    );
  };

  const renderTelcAnswerBank = () => {
    const tasks = getCurrentPartTasks();
    const firstTask = tasks[0]?.task;
    const options = Array.isArray(firstTask?.options) ? firstTask.options : [];
    return (
      <section className={styles.sprachAnswerBank} aria-label="Antwortkasten">
        <h3>Antwortkasten</h3>
        <div className={styles.sprachAnswerBankGrid}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.sprachBankItem}
              onClick={() => {
                const firstEmpty = tasks.find(({ taskIndex }) => !answers[taskIndex]);
                if (firstEmpty) {
                  setCurrentIndex(firstEmpty.taskIndex);
                  setAnswerForIndex(firstEmpty.taskIndex, option.value);
                }
              }}
            >
              <span>{option.value})</span>
              <strong translate="no">{getProtectedChoiceLabel(firstTask, option)}</strong>
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderTelcSprachbausteine = () => {
    const partMaterial = splitTelcSprachPartMaterial(currentPart);
    const currentPartTasks = getCurrentPartTasks();
    const answeredInPart = currentPartTasks.filter(({ taskIndex, task }) => getTaskAnswered(module, task, answers[taskIndex])).length;

    return (
      <div className={styles.sprachExamLayout}>
        <section className={styles.sprachExamPane} onWheel={handleReadableWheel}>
          <div className={styles.sectionLabel}>
            <BookOpen size={18} />
            TELC B2 Sprachbausteine
          </div>
          <div className={styles.sprachExamHeader}>
            <div>
              <h2 translate="no">{currentPart?.displayTitle ?? "Sprachbausteine"}</h2>
              <p>{answeredInPart}/{currentPartTasks.length} Lücken bearbeitet</p>
            </div>
            <span>{currentPart?.points ?? currentPartTasks.length} Punkte</span>
          </div>

          <article className={styles.sprachArticle}>
            {partMaterial.textLines.map((line, index) => renderTelcSprachLine(line, index))}
          </article>

          {currentPart?.number === 1 ? renderTelcPart1Options() : renderTelcAnswerBank()}

          {!simulationMode ? (
            <div className={styles.sprachFeedbackGrid}>
              {currentPartTasks.map(({ taskIndex, task }) => (
                <FeedbackBox key={task.id} task={task} answer={answers[taskIndex]} />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    );
  };

  const renderReading = () => (
    isTelcSprachbausteineModule ? renderTelcSprachbausteine() :
    <div className={styles.readingLayout}>
      <section className={styles.passagePane} onWheel={handleReadableWheel}>
        <div className={styles.sectionLabel}>
          <BookOpen size={18} />
          Quelle Teil {currentPart?.number ?? currentPartIndex + 1}
        </div>
        <h2 translate="no">{currentPart?.displayTitle ?? module.passage.title}</h2>
        <div className={`${styles.introText} ${styles.readableScrollArea}`} onWheel={handleReadableWheel}>
          {renderStructuredExamText(module.passage.intro, "reading-intro")}
        </div>
        {renderPartMaterial(currentPart, { compact: true })}
      </section>

      <section key={currentTask.id} className={styles.questionPane}>
        <div className={styles.questionTopline}>
          <span className={styles.questionStep}>Frage {currentIndex + 1} von {totalTasks}</span>
          <span>{currentTask.typeLabel}</span>
        </div>
        {renderQuestionHeading(currentTask.question, `read-question-${currentTask.id}`)}
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
    const replayLimit = listeningReplayLimit;
    const replaysLeft = Math.max(0, replayLimit - replaysUsed);
    const audioProgressPercent = currentAudioDuration
      ? Math.min(100, (audioTimestamp / currentAudioDuration) * 100)
      : 0;
    const listeningAudioElement = (
      <audio
        ref={listeningAudioRef}
        src={listeningAudioUrl || undefined}
        preload="metadata"
        onLoadedMetadata={handleListeningAudioLoadedMetadata}
        onTimeUpdate={handleListeningAudioTimeUpdate}
        onEnded={handleListeningAudioEnded}
        onError={handleListeningAudioError}
      />
    );

    if (module.id === "listen") {
      return (
        <div className={styles.listeningLayout}>
          <section className={styles.audioPanel}>
            <div className={styles.audioHeader}>
              <div>
                <div className={styles.sectionLabel}>
                  <Headphones size={18} />
                  {currentListeningAudio?.title || module.audio?.title || "Hoeren"}
                </div>
                <h2>{currentListeningAudio?.speaker || module.audio?.speaker || "Standarddeutsch"}</h2>
              </div>
              <div className={styles.replayBadge} data-blocked={audioReplayBlocked ? "true" : "false"}>
                <Volume2 size={16} />
                {replaysLeft} Hoerdurchgang{replaysLeft !== 1 ? "e" : ""} uebrig
              </div>
            </div>

            {listeningAudioElement}
            <div className={styles.playerControls}>
              <button
                type="button"
                className={styles.audioPlayButton}
                data-playing={audioPlaying ? "true" : "false"}
                data-blocked={audioReplayBlocked ? "true" : "false"}
                style={{ "--audio-progress": `${audioProgressPercent}%` }}
                onClick={audioPlaying ? pauseListeningAudio : playListeningAudio}
                disabled={!audioPlaying && audioReplayBlocked}
                aria-label={audioPlaying ? "Pause" : "Abspielen"}
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
              <button type="button" className={styles.iconButton} onClick={resetListeningAudio} disabled={audioReplayBlocked} aria-label="Zum Anfang zurueck">
                <RotateCcw size={20} />
                Noch einmal hoeren
              </button>
            </div>

            <div className={styles.lockedNote}>
              <Lock size={18} />
              Hören Sie den Audiotext und beantworten Sie die Aufgaben.
            </div>
            {audioError ? (
              <p className={styles.warningText}>
                <AlertCircle size={16} /> {toGermanStatus(audioError)}
              </p>
            ) : null}
          </section>

          <section className={styles.questionPane}>
            <div className={styles.questionTopline}>
              <span className={styles.questionStep}>Frage {currentIndex + 1} von {totalTasks}</span>
              <span>{level}</span>
            </div>
            <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
            {renderQuestionHeading(currentTask.question, `listen-question-${currentTask.id}`)}
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
    }

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

          {listeningAudioElement}
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
            Hören Sie den Audiotext und beantworten Sie die Aufgaben.
          </div>
          {audioError ? (
            <p className={styles.warningText}>
              <AlertCircle size={16} /> {toGermanStatus(audioError)}
            </p>
          ) : null}
        </section>

        <section className={styles.questionPane}>
          <div className={styles.questionTopline}>
            <span className={styles.questionStep}>Question {currentIndex + 1} of {totalTasks}</span>
            <span>{level}</span>
          </div>
          <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
          {renderQuestionHeading(currentTask.question, `listen-question-${currentTask.id}`)}
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
    const insertGermanCharacter = (character) => {
      const textarea = writingTextareaRef.current;
      const start = textarea?.selectionStart ?? text.length;
      const end = textarea?.selectionEnd ?? text.length;
      const nextText = `${text.slice(0, start)}${character}${text.slice(end)}`;
      setAnswerForCurrent(nextText);
      window.setTimeout(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + character.length, start + character.length);
      }, 0);
    };
    const renderGermanCharacterToolbar = () => (
      <div className={styles.germanCharacterToolbar} aria-label="Deutsche Sonderzeichen">
        {["Ä", "ä", "Ö", "ö", "Ü", "ü", "ß"].map((character) => (
          <button key={character} type="button" onClick={() => insertGermanCharacter(character)}>
            {character}
          </button>
        ))}
      </div>
    );

    if (module.id === "write") {
      return (
        <div className={styles.writingLayout}>
          <section className={styles.promptPanel}>
            <div className={styles.questionTopline}>
              <span className={styles.questionStep}>Thema {currentIndex + 1} von {totalTasks}</span>
              <span>{level}</span>
            </div>
            <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
            {renderContentTitle(currentTask.title, `write-title-${currentTask.id}`)}
            <div className={`${styles.instructionText} ${styles.readableScrollArea}`} onWheel={handleReadableWheel}>
              {renderStructuredExamText(currentTask.prompt, `write-prompt-${currentTask.id}`)}
            </div>
            <div className={styles.promptMeta}>
              <span><FileText size={16} /> {formatWritingRequirementGerman(currentTask)}</span>
              <span><ShieldCheck size={16} /> Register {currentTask.register}</span>
            </div>
          </section>

          <section className={styles.editorPanel}>
            <div className={styles.editorToolbar}>
              <span>{words} Wort{words !== 1 ? "er" : ""}</span>
              <span>Minimum {getWritingMinimumWords(currentTask)}</span>
              <button type="button" onClick={saveWritingVersion}>
                <Save size={16} />
                Entwurf speichern
              </button>
            </div>
            <textarea
              ref={writingTextareaRef}
              value={text}
              onChange={(event) => setAnswerForCurrent(event.target.value)}
              placeholder="Schreiben Sie Ihre Antwort auf Deutsch..."
              className={styles.editor}
            />
            {renderGermanCharacterToolbar()}
          </section>

          <div className={styles.writingSupportGrid}>
            {!simulationMode ? (
              <section className={styles.supportPanel}>
                <div className={styles.sectionLabel}>
                  <WandSparkles size={18} />
                  Vorschlaege
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
                Verlauf
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
                      <small>{formatClock(new Date(version.createdAt))} - {version.words} Wörter</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.mutedText}>Versionen erscheinen nach einigen Sekunden Schreibzeit.</p>
              )}
            </section>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.writingLayout}>
        <section className={styles.promptPanel}>
          <div className={styles.questionTopline}>
            <span className={styles.questionStep}>Question {currentIndex + 1} of {totalTasks}</span>
            <span>{level}</span>
          </div>
          <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
          {renderContentTitle(currentTask.title, `write-title-${currentTask.id}`)}
          <div className={`${styles.instructionText} ${styles.readableScrollArea}`} onWheel={handleReadableWheel}>
            {renderStructuredExamText(currentTask.prompt, `write-prompt-${currentTask.id}`)}
          </div>
          <div className={styles.promptMeta}>
            <span><FileText size={16} /> {formatWritingRequirementFrench(currentTask)}</span>
            <span><ShieldCheck size={16} /> Registre {currentTask.register}</span>
          </div>
        </section>

        <section className={styles.editorPanel}>
          <div className={styles.editorToolbar}>
            <span>{words} mot{words > 1 ? "s" : ""}</span>
            <span>Minimum {getWritingMinimumWords(currentTask)}</span>
            <button type="button" onClick={saveWritingVersion}>
              <Save size={16} />
              Sauver le brouillon
            </button>
          </div>
          <textarea
            ref={writingTextareaRef}
            value={text}
            onChange={(event) => setAnswerForCurrent(event.target.value)}
            placeholder="Rédigez votre réponse en allemand..."
            className={styles.editor}
          />
          {renderGermanCharacterToolbar()}
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

    if (module.id === "speak") {
      return (
        <div className={styles.speakingLayout}>
          <section className={styles.promptPanel}>
            <div className={styles.questionTopline}>
              <span className={styles.questionStep}>Thema {currentIndex + 1} von {totalTasks}</span>
              <span>{level}</span>
            </div>
            <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
            {renderContentTitle(currentTask.title, `speak-title-${currentTask.id}`)}
            <div className={`${styles.instructionText} ${styles.readableScrollArea}`} onWheel={handleReadableWheel}>
              {renderStructuredExamText(currentTask.prompt, `speak-prompt-${currentTask.id}`)}
            </div>
            {currentTask.visual ? (
              <img className={styles.speakingImage} src={speakingImage} alt="Aktive Personen in einer Alltagssituation" />
            ) : null}
            <div className={styles.promptMeta}>
              <span><Clock3 size={16} /> Vorbereitung {currentTask.prepSeconds}s</span>
              <span><Mic size={16} /> Zielantwort {currentTask.responseSeconds}s</span>
            </div>
          </section>

          <section className={styles.recorderPanel}>
            <div className={styles.timerGrid}>
              <div className={styles.timerBlock}>
                <Clock3 size={20} />
                <strong>{formatTime(prepRemaining)}</strong>
                <span>{speakingPhase === "prep" ? "Verbleibende Vorbereitungszeit" : "Verbleibende Zeit"}</span>
              </div>
              <div className={styles.timerBlock}>
                <Mic size={20} />
                <strong>{formatTime(recordingSeconds || answer.duration || 0)}</strong>
                <span>Sprechzeit</span>
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
                aria-label={isRecording ? "Aufnahme stoppen" : "Aufnahme starten"}
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
                Vorbereitung neu starten
              </button>
              <button type="button" className={styles.secondaryButton} onClick={rerecord} disabled={isRecording}>
                <RotateCcw size={16} />
                Erneut aufnehmen
              </button>
            </div>

            {recordError ? <p className={styles.warningText}><AlertCircle size={16} /> {toGermanStatus(recordError)}</p> : null}

            {playbackSrc ? (
              <SmoothedAudioPlayer key={playbackSrc} src={playbackSrc} label="Wiedergabe Ihrer muendlichen Antwort" />
            ) : answer.simulated ? (
              <p className={styles.mutedText}>Zeitgesteuerte Antwort ohne Audiodatei gespeichert.</p>
            ) : (
              <p className={styles.mutedText}>Ihre Wiedergabe erscheint hier nach der Aufnahme.</p>
            )}
          </section>

          {!simulationMode ? (
            <section className={styles.supportPanel}>
              <div className={styles.sectionLabel}>
                <ClipboardCheck size={18} />
                Antwortschema
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
    }

    return (
      <div className={styles.speakingLayout}>
        <section className={styles.promptPanel}>
          <div className={styles.questionTopline}>
            <span className={styles.questionStep}>Question {currentIndex + 1} of {totalTasks}</span>
            <span>{level}</span>
          </div>
          <p className={styles.partMiniLabel}>{currentTask.typeLabel}</p>
          {renderContentTitle(currentTask.title, `speak-title-${currentTask.id}`)}
          <div className={`${styles.instructionText} ${styles.readableScrollArea}`} onWheel={handleReadableWheel}>
            {renderStructuredExamText(currentTask.prompt, `speak-prompt-${currentTask.id}`)}
          </div>
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

          {recordError ? <p className={styles.warningText}><AlertCircle size={16} /> {toGermanStatus(recordError)}</p> : null}

          {playbackSrc ? (
            <SmoothedAudioPlayer key={playbackSrc} src={playbackSrc} label="Lecture de votre reponse orale" />
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

  const retryWritingCorrection = async () => {
    if (!savedSimulationId || writingCorrectionLoading) return;
    setWritingCorrectionError("");
    setWritingCorrection(null);
    setWritingCorrectionLoading(true);
    try {
      const correctionResponse = await API.post(`/api/simulations/${savedSimulationId}/writing-correction`, { force: true });
      const correction = correctionResponse.data?.correction ?? null;
      setWritingCorrection(correction);
      if (correction?.status === "partial" || correction?.status === "failed") {
        setWritingCorrectionError(correction.errorMessage || "Correction IA indisponible pour le moment.");
      } else if (correction?.status === "processing") {
        setResultStatus("Correction IA en cours.");
      } else {
        setResultStatus("Correction IA terminée.");
      }
    } catch (err) {
      setWritingCorrectionError(err?.response?.data?.error || "La correction IA n'a pas pu se terminer. Vous pouvez réessayer dans quelques instants.");
    } finally {
      setWritingCorrectionLoading(false);
    }
  };

  const renderWritingCorrectionPanel = () => {
    if (module.id !== "write") return null;

    if (writingCorrectionLoading) {
      return (
        <section className={styles.aiCorrectionPanel} data-status="processing">
          <div className={styles.aiCorrectionHeader}>
            <span><WandSparkles size={18} /> Correction IA</span>
            <strong><ImportedLoadingDots label="Correction IA en cours" /></strong>
          </div>
          <p className={styles.aiCorrectionMessage}>Analyse des consignes et de vos réponses. Le score final apparait dès que la correction est terminée.</p>
          <div className={styles.aiProgressSteps} aria-hidden="true">
            <span>Consignes</span>
            <span>Texte candidat</span>
            <span>Score final</span>
          </div>
        </section>
      );
    }

    if (!writingCorrection) {
      return writingCorrectionError ? (
        <section className={styles.aiCorrectionPanel} data-status="failed">
          <div className={styles.aiCorrectionHeader}>
            <span><AlertCircle size={18} /> Correction IA</span>
            <strong>Indisponible</strong>
          </div>
          <p className={styles.aiCorrectionMessage}>{writingCorrectionError}</p>
          {savedSimulationId ? (
            <div className={styles.aiCorrectionActions}>
              <button type="button" className={styles.secondaryButton} onClick={retryWritingCorrection}>
                <RotateCcw size={16} />
                Relancer la correction
              </button>
            </div>
          ) : null}
        </section>
      ) : null;
    }

    const tasks = Array.isArray(writingCorrection.tasks) ? writingCorrection.tasks : [];
    const statusLabel =
      writingCorrection.status === "completed"
        ? "Terminee"
        : writingCorrection.status === "partial"
          ? "Partielle"
          : writingCorrection.status === "failed"
            ? "Echec"
            : "En cours";
    const correctionHasScores = ["completed", "partial"].includes(writingCorrection.status);

    return (
      <section className={styles.aiCorrectionPanel} data-status={writingCorrection.status}>
        <div className={styles.aiCorrectionHeader}>
          <span><WandSparkles size={18} /> Correction IA Expression Ecrite</span>
          <strong>{statusLabel}</strong>
        </div>

        {correctionHasScores ? (
          <div className={styles.aiScoreGrid}>
            <div>
              <span>Score total</span>
              <strong>{formatCorrectionScore(writingCorrection.totalScore)} / {formatCorrectionScore(writingCorrection.maxScore)}</strong>
            </div>
            <div>
              <span>Pourcentage</span>
              <strong>{formatCorrectionScore(writingCorrection.percentage)}%</strong>
            </div>
          </div>
        ) : null}

        {writingCorrection.overallFeedback ? (
          <p className={styles.aiCorrectionMessage}>{writingCorrection.overallFeedback}</p>
        ) : null}

        <div className={styles.aiSummaryGrid}>
          <div>
            <h3><CheckCircle2 size={17} /> Points forts</h3>
            {writingCorrection.overallStrengths?.length ? (
              <ul>{writingCorrection.overallStrengths.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : (
              <p>Aucun point fort specifique n'a ete identifie.</p>
            )}
          </div>
          <div>
            <h3><AlertCircle size={17} /> A ameliorer</h3>
            {writingCorrection.overallWeaknesses?.length ? (
              <ul>{writingCorrection.overallWeaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : (
              <p>Aucun point faible majeur n'a ete signale.</p>
            )}
          </div>
        </div>

        <div className={styles.aiTaskList}>
          {tasks.map((task) => {
            const validationStatus = normalizeWritingValidationStatus(task.validationStatus);
            const validationBadgeStatus = isInvalidWritingStatus(validationStatus)
              ? "invalid"
              : validationStatus === "unavailable"
                ? "unavailable"
                : "valid";
            const sentenceCorrections = Array.isArray(task.sentenceCorrections) ? task.sentenceCorrections : [];
            const nextSteps = Array.isArray(task.nextSteps) ? task.nextSteps : [];
            const hasMainMessage = Boolean(task.mainMessage);
            const hasDifferentFeedback = Boolean(task.feedback && task.feedback !== task.mainMessage);
            const shouldShowImprovement = Boolean(task.shouldShowImprovement) && !isInvalidWritingStatus(validationStatus);
            const criteria = Object.keys(CORRECTION_CRITERION_LABELS)
              .map((key) => [key, task.criterionScores?.[key]])
              .filter(([, value]) => value !== undefined && value !== null);
            return (
              <article key={`${task.taskId || task.id}-${task.taskIndex}`} className={styles.aiTaskCard}>
                <div className={styles.aiTaskHeader}>
                  <span><ClipboardCheck size={16} /> Tache {Number(task.taskIndex) + 1}</span>
                  <div className={styles.aiTaskHeaderMeta}>
                    <em className={styles.aiValidationBadge} data-status={validationBadgeStatus}>
                      {getWritingValidationLabel(validationStatus)}
                    </em>
                    <strong>
                      {formatCorrectionScore(task.score)} / {formatCorrectionScore(task.maxScore)}
                      {Number.isFinite(Number(task.scorePercentage)) ? ` (${formatCorrectionScore(task.scorePercentage)}%)` : ""}
                    </strong>
                  </div>
                </div>
                <h3>{task.title}</h3>
                {hasMainMessage ? (
                  <p className={styles.aiValidationMessage} data-status={validationBadgeStatus}>
                    {task.mainMessage}
                  </p>
                ) : null}
                {criteria.length && !isInvalidWritingStatus(validationStatus) ? (
                  <div className={styles.aiCriteriaGrid}>
                    {criteria.map(([key, value]) => (
                      <span key={key}>
                        <small>{CORRECTION_CRITERION_LABELS[key] || key}</small>
                        <b>{formatCorrectionScore(value)}/10</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                {!isInvalidWritingStatus(validationStatus) ? (
                  <div className={styles.aiTaskFeedbackGrid}>
                    <div>
                      <h4><ShieldCheck size={15} /> Forces</h4>
                      {task.strengths?.length ? (
                        <ul>{task.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p>Aucune force specifique.</p>
                      )}
                    </div>
                    <div>
                      <h4><Gauge size={15} /> Faiblesses</h4>
                      {task.weaknesses?.length ? (
                        <ul>{task.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
                      ) : (
                        <p>Aucune faiblesse specifique.</p>
                      )}
                    </div>
                  </div>
                ) : task.weaknesses?.length ? (
                  <div className={styles.aiNextSteps}>
                    <h4><AlertCircle size={15} /> Pourquoi la correction est bloquee</h4>
                    <ul>{task.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}
                {shouldShowImprovement && sentenceCorrections.length ? (
                  <div className={styles.aiSentenceCorrections}>
                    <h4><PencilLine size={15} /> Corrections basees sur votre texte</h4>
                    <div className={styles.aiSentenceCorrectionList}>
                      {sentenceCorrections.map((item, index) => (
                        <div key={`${item.original || item.improved}-${index}`} className={styles.aiSentenceCorrection}>
                          {item.original ? (
                            <p>
                              <span>Original</span>
                              {item.original}
                            </p>
                          ) : null}
                          {item.improved ? (
                            <p>
                              <span>Ameliore</span>
                              {item.improved}
                            </p>
                          ) : null}
                          {item.explanation ? <small>{item.explanation}</small> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {shouldShowImprovement && task.improvedVersion ? (
                  <div className={styles.aiImprovedVersion}>
                    <h4><WandSparkles size={15} /> Version amelioree de votre texte</h4>
                    <p>{task.improvedVersion}</p>
                  </div>
                ) : null}
                {nextSteps.length ? (
                  <div className={styles.aiNextSteps}>
                    <h4><Flag size={15} /> Prochaines etapes</h4>
                    <ul>{nextSteps.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}
                {hasDifferentFeedback ? <p className={styles.aiExaminerComment}>{task.feedback}</p> : null}
              </article>
            );
          })}
        </div>

        {writingCorrectionError ? (
          <div className={styles.aiCorrectionWarning}>
            <p>{writingCorrectionError}</p>
            {savedSimulationId ? (
              <button type="button" className={styles.secondaryButton} onClick={retryWritingCorrection}>
                <RotateCcw size={16} />
                Relancer la correction
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  };

  const renderUnavailableSection = () => (
    <section className={styles.unavailablePanel} aria-labelledby="unavailable-section-title">
      <div className={styles.unavailableIcon}>
        <ModuleIcon size={34} />
      </div>
      <p className={styles.sectionLabel}>Non disponible</p>
      <h2 id="unavailable-section-title">{module.unavailableTitle ?? "Section non disponible"}</h2>
      <p>
        {module.unavailableMessage ??
          "Le test de cette section n'est pas encore disponible. Les exercices de compréhension orale seront ajoutés prochainement."}
      </p>
      <div className={styles.resultActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => navigate(seriesRoute)}>
          <ChevronLeft size={16} />
          Retour aux sections
        </button>
      </div>
    </section>
  );


  const renderModuleContent = () => {
    if (module.unavailable) return renderUnavailableSection();

    if (completed) {
      const resultSummary = buildResultSummary(module, answers);
      const isWritingResult = module.id === "write";
      const correctionScoreReady =
        isWritingResult &&
        !writingCorrectionLoading &&
        ["completed", "partial"].includes(writingCorrection?.status) &&
        Number.isFinite(Number(writingCorrection?.percentage));
      const correctionFailed =
        isWritingResult &&
        !writingCorrectionLoading &&
        !correctionScoreReady &&
        (writingCorrection?.status === "failed" || Boolean(writingCorrectionError));
      const displayedScore = correctionScoreReady ? Number(writingCorrection.percentage) : isWritingResult ? null : score;
      const unlocked = displayedScore !== null && displayedScore >= PASS_SCORE;
      const scoreHeading = displayedScore === null
        ? correctionFailed
          ? "Correction IA"
          : <ImportedLoadingDots label="Correction IA en cours" />
        : `${displayedScore}%`;
      const germanResultMessage = isWritingResult
        ? correctionScoreReady
          ? `KI-Korrektur abgeschlossen. Das ist der finale Schreibscore: ${displayedScore}%.`
          : correctionFailed
            ? "Die KI-Korrektur konnte nicht abgeschlossen werden. Ihre Antworten sind gespeichert; starten Sie die Korrektur erneut."
            : "Ihre Antworten sind gespeichert. Der finale Score erscheint, sobald die KI-Korrektur abgeschlossen ist."
        : unlocked
          ? `Gut gemacht. Das naechste empfohlene Niveau ist ${getNextLevel(level)}.`
          : `Arbeiten Sie weiter auf ${level}, bevor Sie die Schwierigkeit erhoehen.`;
      const germanCorrectionState = correctionScoreReady
        ? "KI-Korrektur abgeschlossen"
        : correctionFailed
          ? "KI-Korrektur ausstehend"
          : "KI-Korrektur laeuft";
      if (module?.id) {
        return (
          <section className={styles.resultPanel}>
            <Trophy size={44} />
            <p className={styles.sectionLabel}>{t.modulePage.result}</p>
            <h2>{scoreHeading}</h2>
            <p>{germanResultMessage}</p>
            <div className={styles.resultStats}>
              <span><CheckCircle2 size={16} /> {answeredCount}/{totalTasks} Aufgaben bearbeitet</span>
              {isWritingResult ? (
                <span><WandSparkles size={16} /> {germanCorrectionState}</span>
              ) : (
                <>
                  <span><CheckCircle2 size={16} /> {resultSummary.correctCount} richtig</span>
                  <span><XCircle size={16} /> {resultSummary.wrongCount} falsch</span>
                </>
              )}
              <span><Flag size={16} /> {Object.values(flagged).filter(Boolean).length} markiert</span>
              <span><Clock3 size={16} /> {formatTime(elapsedSeconds)} Arbeitszeit</span>
            </div>
            {renderWritingCorrectionPanel()}
            <div className={styles.finalReviewList}>
              {resultSummary.rows.map((row) => {
                const reviewState = isWritingResult ? "neutral" : row.isCorrect ? "true" : "false";
                const reviewLabel = isWritingResult ? "Antwort gespeichert" : row.isCorrect ? "Richtig" : "Noch einmal pruefen";
                return (
                  <article key={row.id} className={styles.finalReviewItem} data-correct={reviewState}>
                    <div className={styles.finalReviewHeader}>
                      <span>{moduleItemSingular} {row.number}</span>
                      <strong>{reviewLabel}</strong>
                    </div>
                    <h3>{row.title}</h3>
                    <p><b>Ihre Antwort:</b> {row.userAnswer}</p>
                    {!isWritingResult && !module.isImported ? <p><b>Erwartete Antwort:</b> <span translate="no">{row.correctAnswer}</span></p> : null}
                    {!isWritingResult && !module.isImported && row.explanation ? <p className={styles.finalExplanation}>{row.explanation}</p> : null}
                  </article>
                );
              })}
            </div>
            {resultStatus ? <p className={styles.statusLine}>{toGermanStatus(resultStatus)}</p> : null}
            <div className={styles.resultActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate(loggedIn ? "/dashboard" : "/")}>
                <ChevronLeft size={16} />
                Zurueck
              </button>
              <button type="button" className={styles.secondaryButton} onClick={startSimulation}>
                <RotateCcw size={16} />
                Neu starten
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate(selectedSeries ? `/simulations/${selectedSeries.examId}` : "/simulations", { state: { fromResults: true } })}>
                <ClipboardCheck size={16} />
                Neue Serie waehlen
              </button>
              <button type="button" className={styles.primaryButton} onClick={() => navigate(seriesRoute)}>
                {t.modulePage.chooseModule}
                <ChevronRight size={16} />
              </button>
            </div>
          </section>
        );
      }

      return null;
    }

    if (partIntroVisible && currentPart) return renderPartIntro();

    if (module.id === "read" || module.id === "sprach") return renderReading();
    if (module.id === "listen") return renderListening();
    if (module.id === "write") return renderWriting();
    return renderSpeaking();
  };

  if (waitingForImportedSeries) {
    return (
      <div className={styles.page} style={{ "--module-accent": module.accent, "--module-soft": module.soft }}>
        <section className={styles.resultPanel}>
          <p className={styles.sectionLabel}>Serie</p>
          <h2>
            <ImportedLoadingDots />
          </h2>
        </section>
      </div>
    );
  }
  if (!params.seriesId && !importedModuleState.loading) {
    return <ComingSoonPage title="Dieser Uebungsablauf ist noch nicht verfuegbar" />;
  }

  if (params.seriesId && !selectedSeries && !importedModuleState.loading) {
    return <ComingSoonPage examId={params.examId} title="Diese Testserie ist noch nicht verfuegbar" />;
  }

  if (selectedSeries?.isImported && !selectedSeriesContent && !importedModuleState.loading) {
    return <ComingSoonPage examId={params.examId} title="Dieses Modul ist noch nicht verfuegbar" />;
  }

  if (blockedSeriesAccess || blockedVisitorRefresh) {
    return (
      <NotFoundPage
        title="404-Fehler"
        message="Diese Testsitzung ist nicht verfuegbar. Oeffnen Sie eine kostenlose Serie aus der Serienliste, um einen Besuchertest zu starten."
      />
    );
  }

  return (
    <div className={styles.page} style={{ "--module-accent": module.accent, "--module-soft": module.soft }}>
      {partTransition ? (
        <TeilTransitionScreen
          key={partTransition.id}
          nextTeilTitle={partTransition.nextPart?.displayTitle}
          nextTeilNumber={partTransition.nextPart?.number}
          durationSeconds={PART_TRANSITION_SECONDS}
          onComplete={completePartTransition}
        />
      ) : null}
      <nav className={styles.nav}>
        <button
          type="button"
          className={styles.logoButton}
          onClick={() => navigate(loggedIn ? "/dashboard" : "/")}
          aria-label="Zurueck"
        >
          <img src={logo} alt="Deutsch Prüfungen" />
        </button>
        <div className={styles.navActions}>
          {!loggedIn ? (
            <button type="button" onClick={() => navigate("/")}>
              <Home size={16} />
              {t.common.home}
            </button>
          ) : null}
          {loggedIn ? (
            <button type="button" onClick={() => navigate("/dashboard")}>
              <ClipboardCheck size={16} />
              {t.common.dashboard}
            </button>
          ) : null}
          <button type="button" onClick={() => navigate(seriesRoute)}>
            <ClipboardCheck size={16} />
            {t.common.modules}
          </button>
        </div>
      </nav>

      <main className={styles.shell}>
        <header className={styles.moduleHeader}>
          <div className={styles.examHeaderTop}>
            <div className={styles.titleBlock}>
              <h1>Simulation: {examHeading}</h1>
              <p>
                <ModuleIcon size={18} />
                Modul: {moduleTitle} ({module.examPart})
              </p>
            </div>
            <div
              className={[
                styles.examTimer,
                simulationMode && timerSeconds <= 15 ? styles.timerUrgent : "",
              ].join(" ")}
              aria-label="Verbleibende Zeit"
            >
              <Clock3 size={22} />
              {module.unavailable ? "Non disponible" : formatExamTime(simulationMode ? timerSeconds : currentTaskDuration)}
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
              {simulationMode ? "Pruefungsmodus" : t.modulePage.freeTraining}
            </span>
            {simulationMode ? (
              <span className={styles.moduleBadge}>
                <Lock size={16} />
                {t.modulePage.locked}
              </span>
            ) : null}
            <button
              type="button"
              className={styles.navPanelToggle}
              onClick={() => setNavPanelOpen(true)}
              aria-controls="exam-navigation-panel"
              aria-expanded={navPanelOpen}
            >
              <PanelRightOpen size={16} />
              Navigation
            </button>
          </div>

        </header>

        <div className={`${styles.workArea} ${module.id === "read" ? styles.readingWorkArea : ""}`}>
          <section className={styles.mainContent}>{renderModuleContent()}</section>

          {!completed && !module.unavailable ? renderExamSidebar() : null}
        </div>

        {!completed && !module.unavailable && !partIntroVisible && !partTransition ? (
          <section
            className={`${styles.actionPanel} ${styles.stepActionPanel}`}
            aria-label="Aufgabennavigation"
          >
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.mobileNavButton}`}
              onClick={goToPrevious}
              disabled={currentIndex === 0 || isRecording}
            >
              <ChevronLeft size={16} />
              Zurueck
            </button>
            {partIntroVisible ? (
            <button type="button" className={styles.secondaryButton} onClick={() => persistProgress(`Sauvegardé à ${formatClock()}`)}>
            </button>
            ) : null}
            <button
              type="button"
              className={`${styles.primaryButton} ${styles.mobileNavButton}`}
              onClick={goToNext}
              disabled={isRecording}
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
