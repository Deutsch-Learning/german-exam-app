export const unlockedSections = [
  { key: "reading", title: "Comprehension ecrite", detail: "Tests en conditions reelles" },
  { key: "listening", title: "Comprehension orale", detail: "Simulations audio officielles" },
  { key: "speaking", title: "Expression orale", detail: "Exercices guides et corrections" },
  { key: "writing", title: "Expression ecrite", detail: "Exercices guides et corrections" },
];

export const certificationOptions = [
  { key: "goethe", label: "Goethe" },
  { key: "osd", label: "OSD" },
  { key: "telc", label: "TELC" },
  { key: "ecl", label: "ECL" },
];

export const certificationLabels = certificationOptions.map((option) => option.label);
export const certificationKeys = certificationOptions.map((option) => option.key);

export const XAF_PER_EUR = 656;

export const formatXaf = (value) =>
  `${Number(value || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} XAF`;

export const formatEuroEquivalent = (valueXaf) =>
  `\u20ac${(Number(valueXaf || 0) / XAF_PER_EUR).toFixed(2).replace(".", ",")}`;

export const calculateOfferTotalXaf = (offer, quantity) => {
  const priceXaf = Number(offer?.priceXaf || 0);
  return offer?.isEnterprise ? priceXaf : priceXaf * Math.max(0, Number(quantity) || 0);
};

export const pricingSections = [
  {
    level: "B1",
    plans: [
      {
        planKey: "starter",
        planName: "Starter",
        formulaLabel: "Formule 5 Jours",
        priceXaf: 2500,
        durationDays: 5,
        writingSimulatorAttempts: 3,
        speakingSimulatorQuota: 20,
      },
      {
        planKey: "standard",
        planName: "Standard",
        formulaLabel: "Formule 15 Jours",
        priceXaf: 5900,
        durationDays: 15,
        writingSimulatorAttempts: 6,
        speakingSimulatorQuota: 45,
      },
      {
        planKey: "intensif",
        planName: "Intensif",
        formulaLabel: "Formule 30 Jours",
        priceXaf: 8900,
        durationDays: 30,
        writingSimulatorAttempts: 10,
        speakingSimulatorQuota: 65,
      },
    ],
  },
  {
    level: "B2",
    plans: [
      {
        planKey: "starter",
        planName: "Starter",
        formulaLabel: "Formule 5 Jours",
        priceXaf: 2500,
        durationDays: 5,
        writingSimulatorAttempts: 3,
        speakingSimulatorQuota: 20,
      },
      {
        planKey: "standard",
        planName: "Standard",
        formulaLabel: "Formule 15 Jours",
        priceXaf: 5900,
        durationDays: 15,
        writingSimulatorAttempts: 6,
        speakingSimulatorQuota: 45,
      },
      {
        planKey: "intensif",
        planName: "Intensif",
        formulaLabel: "Formule 30 Jours",
        priceXaf: 8900,
        durationDays: 30,
        writingSimulatorAttempts: 10,
        speakingSimulatorQuota: 65,
      },
    ],
  },
];

export const enterpriseOffers = [
  {
    offerKey: "industrial_1_month",
    label: "Établissement 1 mois",
    subtitle: "Accès école intensif",
    priceXaf: 150000,
    accessLabel: "1 mois",
    billedLabel: "1 mois facturé",
    speakingSimulatorQuota: 240,
    description: "Pour classes, centres de langue et groupes de préparation.",
  },
  {
    offerKey: "industrial_6_months",
    label: "Établissement 6 mois",
    subtitle: "Programme semestriel",
    priceXaf: 600000,
    accessLabel: "6 mois",
    billedLabel: "6 mois facturés",
    speakingSimulatorQuota: 600,
    description: "Pour un suivi long avec plusieurs cohortes B1 et B2.",
  },
  {
    offerKey: "industrial_12_plus_2",
    label: "Établissement annuel",
    subtitle: "12 mois payés + 2 mois offerts",
    priceXaf: 1000000,
    accessLabel: "14 mois",
    billedLabel: "12 mois facturés",
    speakingSimulatorQuota: 1000,
    description: "Pour écoles et institutions avec un volume élevé de simulations.",
  },
];

export const buildPlanId = (level, planKey) =>
  `${String(level || "").toLowerCase()}-${String(planKey || "").toLowerCase()}`;

export const enrichPricingPlan = (level, plan) => ({
  ...plan,
  id: buildPlanId(level, plan.planKey),
  level,
  displayPrice: `${formatXaf(plan.priceXaf)} (${formatEuroEquivalent(plan.priceXaf)})`,
  availableCertifications: certificationOptions,
  certificationLabels,
  unlockedSections: unlockedSections.map((section) => section.title),
  sectionDetails: unlockedSections,
  currency: "XAF",
});

export const pricingPlans = pricingSections.flatMap((section) =>
  section.plans.map((plan) => enrichPricingPlan(section.level, plan))
);

export const findPricingPlan = (planId) =>
  pricingPlans.find((plan) => plan.id === String(planId || "").toLowerCase()) ?? null;
