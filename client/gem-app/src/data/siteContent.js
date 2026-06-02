export const currentTopics = [
  {
    id: "testdaf",
    label: "TestDaF (Test Deutsch als Fremdsprache)",
    path: "/topics/testdaf",
    seriesTitle: "TestDaF Academic Entry Series",
    expressionType: "Written and oral expression",
    tasks: ["Summarize a university notice", "Write a structured opinion", "Present an academic plan orally"],
    notice: "Focus on academic vocabulary and clear argument order.",
    warning: "Do not rely on translation tools during exam practice.",
  },
  {
    id: "dsh",
    label: "DSH (Deutsche Sprachpr\u00fcfung f\u00fcr den Hochschulzugang)",
    path: "/topics/dsh",
    seriesTitle: "DSH University Admission Series",
    expressionType: "Written synthesis and oral response",
    tasks: ["Extract information from lecture notes", "Build a written summary", "Respond to examiner follow-up questions"],
    notice: "DSH tasks often expect formal academic phrasing.",
    warning: "Check the exact requirements of your target university.",
  },
  {
    id: "goethe-certificate",
    label: "Goethe Certificate",
    path: "/topics/goethe-certificate",
    seriesTitle: "Goethe Communication Series",
    expressionType: "Everyday written and oral expression",
    tasks: ["Write a formal message", "Describe a situation", "Give a short personal opinion"],
    notice: "Keep answers practical, polite, and clearly structured.",
    warning: "Train timing because each Goethe module moves quickly.",
  },
  {
    id: "telc-deutsch",
    label: "telc Deutsch",
    path: "/topics/telc-deutsch",
    seriesTitle: "telc Integration and Work Series",
    expressionType: "Practical written and oral tasks",
    tasks: ["Understand a public-service notice", "Write a workplace message", "Negotiate a simple solution orally"],
    notice: "Use everyday formal German with direct, useful phrasing.",
    warning: "Locked premium telc series require an active offer.",
  },
];

export const aboutTestSections = [];

export const pageLinks = [
  {
    id: "faq",
    label: "FAQ",
    description: "We answer all your questions",
    path: "/faq",
  },
  {
    id: "privacy-policy",
    label: "Privacy policy",
    description: "Find out how we handle your personal information",
    path: "/privacy-policy",
  },
  {
    id: "refund-condition",
    label: "Refund condition",
    description: "Find out how and to what extent you can be reimbursed",
    path: "/refund-condition",
  },
];

export const examSimulations = [
  {
    id: "goethe-b1",
    name: "Goethe B1",
    buttonLabel: "Start Goethe B1",
    path: "/simulations/goethe-b1",
    accent: "#f9c415",
    provider: "goethe",
    level: "B1",
  },
  {
    id: "goethe-b2",
    name: "Goethe B2",
    buttonLabel: "Start Goethe B2",
    path: "/simulations/goethe-b2",
    accent: "#d97706",
    provider: "goethe",
    level: "B2",
  },
  {
    id: "ösd-b1",
    name: "ÖSD B1",
    buttonLabel: "Start ÖSD B1",
    path: "/simulations/ösd-b1",
    accent: "#2563eb",
    provider: "ösd",
    level: "B1",
  },
  {
    id: "ösd-b2",
    name: "ÖSD B2",
    buttonLabel: "Start ÖSD B2",
    path: "/simulations/ösd-b2",
    accent: "#1d4ed8",
    provider: "ösd",
    level: "B2",
  },
  {
    id: "telc",
    name: "TELC",
    buttonLabel: "Start TELC",
    path: "/simulations/telc",
    accent: "#0f766e",
    provider: "telc",
  },
  {
    id: "ecl",
    name: "ECL",
    buttonLabel: "Start ECL",
    path: "/simulations/ecl",
    accent: "#7c3aed",
    provider: "ecl",
  },
];

export const offerPlans = [
  {
    id: "starter",
    name: "Starter",
    price: "$30.99",
    description: "A focused package for learners who want realistic entry-level practice.",
    features: ["5 full simulations", "Automatic correction", "Progress overview"],
  },
  {
    id: "intensive",
    name: "Intensive",
    price: "$45.99",
    description: "The balanced option for regular practice across all exam modules.",
    features: ["Unlimited simulations", "Written feedback", "Oral-expression practice"],
  },
  {
    id: "premium",
    name: "Premium",
    price: "$99.99",
    description: "Personalized preparation with stronger tracking and premium support.",
    features: ["All test series", "Tutor correction", "Priority guidance"],
  },
];
