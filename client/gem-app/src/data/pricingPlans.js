export const unlockedSections = [
  { title: "Compréhension Écrite", detail: "Tests en conditions réelles" },
  { title: "Compréhension Orale", detail: "Simulations audio officielles" },
  { title: "Expression Orale", detail: "Exercices guidés & corrections" },
  { title: "Expression Écrite", detail: "Exercices guidés & corrections" },
];

export const certificationOptions = [
  { key: "goethe", label: "Goethe" },
  { key: "osd", label: "ÖSD" },
  { key: "telc", label: "TELC" },
  { key: "ecl", label: "ECL" },
];

export const certificationLabels = certificationOptions.map((option) => option.label);
export const certificationKeys = certificationOptions.map((option) => option.key);

export const formatEuro = (value) =>
  `€${Number(value || 0).toFixed(2).replace(".", ",")}`;

export const pricingSections = [
  {
    level: "B1",
    plans: [
      {
        planKey: "starter",
        planName: "Starter",
        formulaLabel: "Formule 5 Jours",
        priceEur: 14.99,
        displayPrice: "€14,99",
        durationDays: 5,
        writingSimulatorAttempts: 3,
      },
      {
        planKey: "standard",
        planName: "Standard",
        formulaLabel: "Formule 15 Jours",
        priceEur: 29.99,
        displayPrice: "€29,99",
        durationDays: 15,
        writingSimulatorAttempts: 6,
      },
      {
        planKey: "intensif",
        planName: "Intensif",
        formulaLabel: "Formule 30 Jours",
        priceEur: 54.99,
        displayPrice: "€54,99",
        durationDays: 30,
        writingSimulatorAttempts: 10,
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
        priceEur: 19.99,
        displayPrice: "€19,99",
        durationDays: 5,
        writingSimulatorAttempts: 3,
      },
      {
        planKey: "standard",
        planName: "Standard",
        formulaLabel: "Formule 15 Jours",
        priceEur: 34.99,
        displayPrice: "€34,99",
        durationDays: 15,
        writingSimulatorAttempts: 6,
      },
      {
        planKey: "intensif",
        planName: "Intensif",
        formulaLabel: "Formule 30 Jours",
        priceEur: 64.99,
        displayPrice: "€64,99",
        durationDays: 30,
        writingSimulatorAttempts: 10,
      },
    ],
  },
];

export const enterpriseOffers = [
  {
    offerKey: "industrial_1_month",
    label: "Établissement 1 mois",
    subtitle: "Accès école intensif",
    priceEur: 450.99,
    displayPrice: "€450,99",
    accessLabel: "1 mois",
    billedLabel: "1 mois facturé",
    speakingSimulatorQuota: 240,
    description: "Pour classes, centres de langue et groupes de préparation.",
  },
  {
    offerKey: "industrial_6_months",
    label: "Établissement 6 mois",
    subtitle: "Programme semestriel",
    priceEur: 2500.99,
    displayPrice: "€2500,99",
    accessLabel: "6 mois",
    billedLabel: "6 mois facturés",
    speakingSimulatorQuota: 600,
    description: "Pour un suivi long avec plusieurs cohortes B1 et B2.",
  },
  {
    offerKey: "industrial_12_plus_2",
    label: "Établissement annuel",
    subtitle: "12 mois payés + 2 mois offerts",
    priceEur: 5000.99,
    displayPrice: "€5000,99",
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
  availableCertifications: certificationOptions,
  certificationLabels,
  unlockedSections: unlockedSections.map((section) => section.title),
  sectionDetails: unlockedSections,
  currency: "EUR",
});

export const pricingPlans = pricingSections.flatMap((section) =>
  section.plans.map((plan) => enrichPricingPlan(section.level, plan))
);

export const findPricingPlan = (planId) =>
  pricingPlans.find((plan) => plan.id === String(planId || "").toLowerCase()) ?? null;
