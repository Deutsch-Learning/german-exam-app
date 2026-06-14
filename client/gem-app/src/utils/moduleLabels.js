export const isTopicModule = (moduleId) => moduleId === "write" || moduleId === "speak";

export const getModuleCountLabel = (moduleId, fallback = "Fragen") =>
  isTopicModule(moduleId) ? "Themen" : fallback;
