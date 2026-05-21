export const FEATURE_FLAGS = {
  enableFightFormScore: import.meta.env.VITE_FF_FIGHT_FORM_SCORE === "true",
  enableTrainingCoachPaths:
    import.meta.env.VITE_FF_TRAINING_COACH_PATHS === "true",
};
