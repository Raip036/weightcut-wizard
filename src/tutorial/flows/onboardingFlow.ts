import type { TutorialFlow } from "../types";

export const onboardingFlow: TutorialFlow = {
  id: "onboarding",
  version: 12,
  steps: [
    // ─── Section 1: Home ───────────────────────────────────────────────
    {
      id: "welcome",
      title: "Good, you made it",
      description:
        "I'm your corner between sessions. I'll track the work, guide the cut, and call out what needs fixing. Two minutes to get you set up.",
      position: "center",
      route: "/dashboard",
      wizardPose: "wave",
    },
    {
      id: "home-overview",
      title: "This is home",
      description:
        "Your score, your progress, your next move, all here. Come back every morning and this page tells you where you stand.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "ring-intro",
      title: "Your Fight Form Score",
      description:
        "Zero to a hundred. A daily read on how sharp you are, built from your training, sleep, weight, wellness, and nutrition. Tap the ring to see what's driving it.",
      position: "center",
      route: "/dashboard",
      spotlight: "fight-form-ring-only",
      wizardPose: "point",
    },
    {
      id: "today-strip-intro",
      title: "Five things, every day",
      description:
        "Hit all five chips and the strip goes green. Weight, training, sleep, wellness, meals. Each one feeds your score. Miss them and it dims.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "today-strip",
      spotlightShape: "rect",
      bubbleFirst: true,
      wizardAboveSpotlight: true,
      wizardPose: "point",
    },
    {
      id: "today-weight",
      title: "Start with your weight",
      description:
        "Same time every morning, before you eat. Keep the baseline consistent and the trend line honest.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "today-weight",
      spotlightShape: "circle",
      spotlightPadding: 8,
      bubbleFirst: true,
      wizardAboveSpotlight: true,
    },
    {
      id: "today-sleep",
      title: "Log your sleep",
      description:
        "Hours and quality. Sleep moves your score more than most people expect. It's the cheapest performance gain you've got.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "today-sleep",
      spotlightShape: "circle",
      spotlightPadding: 8,
      bubbleFirst: true,
      wizardAboveSpotlight: true,
    },
    {
      id: "today-wellness",
      title: "Check in daily",
      description:
        "A quick read on your soreness, energy, and mood. The more you fill it in, the better I can read when to push and when to pull back.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "today-wellness",
      spotlightShape: "circle",
      spotlightPadding: 8,
      bubbleFirst: true,
      wizardAboveSpotlight: true,
    },
    {
      id: "home-stats",
      title: "Your progress below",
      description:
        "Weight trend, cut pace, training week. The cards below the ring show where you stand. The camp status section tracks your cut trajectory.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "camp-status",
      spotlightShape: "rect",
      scrollTo: "camp-status",
      wizardAnchor: "top",
      bubbleFirst: true,
      wizardSide: "right",
      condition: (state) => state.goalType !== "maintaining",
    },

    // ─── Section 2: Camp ───────────────────────────────────────────────
    {
      id: "camp-intro",
      title: "Your camp hub",
      description:
        "Everything for your preparation is in the Camp tab. Your plan, your sessions, your fight week protocol. One place, all of it.",
      position: "center",
      navigateTo: "/camp",
    },
    {
      id: "camp-full-plan",
      title: "Your plan is here",
      description:
        "The phase timeline and your full plan are here. Tap View full plan to see your daily targets and weekly milestones.",
      position: "center",
      navigateTo: "/camp",
      spotlight: "camp-plan-area",
      spotlightShape: "rect",
      wizardAnchor: "top",
      wizardPose: "point",
      condition: (state) => state.goalType !== "maintaining",
    },
    {
      id: "camp-gym-tracker",
      title: "Gym Tracker",
      description:
        "Log your strength sessions here: sets, reps, exercises, routines. Progress is tracked automatically so you can see where you're improving.",
      position: "center",
      navigateTo: "/camp",
      spotlight: "camp-gym-tracker",
      spotlightShape: "rect",
      scrollTo: "camp-gym-tracker",
      wizardAnchor: "top",
    },
    {
      id: "camp-gym-page",
      title: "Gym Tracker",
      description:
        "Log your strength sessions here: sets, reps, exercises, routines. Progress is tracked automatically so you can see where you're improving.",
      position: "center",
      navigateTo: "/gym",
    },
    {
      id: "camp-training-calendar",
      title: "Training Calendar",
      description:
        "Log every session here: BJJ, Muay Thai, wrestling, S&C, rest days. Each one feeds your training load and your Fight Form Score.",
      position: "center",
      navigateTo: "/camp",
      spotlight: "camp-training-calendar",
      spotlightShape: "rect",
      scrollTo: "camp-training-calendar",
      wizardAnchor: "top",
    },
    {
      id: "camp-training-calendar-page",
      title: "Training Calendar",
      description:
        "Log every session here: BJJ, Muay Thai, wrestling, S&C, rest days. Each one feeds your training load and your Fight Form Score.",
      position: "center",
      navigateTo: "/training-calendar",
    },
    {
      id: "camp-recent-activity",
      title: "Recent activity",
      description:
        "A running log of everything you've done across the app. All your sessions, logs, and milestones in one feed.",
      position: "center",
      navigateTo: "/camp",
      spotlight: "camp-recent-activity",
      spotlightShape: "rect",
      scrollTo: "camp-recent-activity",
      wizardAnchor: "top",
    },
    {
      id: "camp-weight-protocol-tile",
      title: "Fight Week Protocol",
      description:
        "This is where the final cut lives. Carb reduction, water loading, sodium taper, laid out day by day.",
      position: "center",
      navigateTo: "/camp",
      spotlight: "camp-weight-protocol",
      spotlightShape: "rect",
      scrollTo: "camp-weight-protocol",
      autoAdvanceMs: 2000,
      wizardAnchor: "top",
      condition: (state) => state.goalType === "cutting",
    },
    {
      id: "camp-fight-protocol",
      title: "Fight Week Protocol",
      description:
        "After the scales, the rehydration plan runs hour by hour: fluid, salt, and carbs in order. Don't freelance here.",
      position: "center",
      navigateTo: "/weight-protocol",
      condition: (state) => state.goalType === "cutting",
    },

    // ─── Section 3: Community ──────────────────────────────────────────
    {
      id: "community-intro",
      title: "The Corner",
      description:
        "Your gym's social feed. Post after sessions, see what your teammates are putting in, and check the leaderboard.",
      position: "center",
      navigateTo: "/community",
    },
    {
      id: "community-photos",
      title: "Drop a photo",
      description:
        "Post a clip or shot from your session. Each card shows once then clears, so the feed stays fresh. Use the camera button in the nav to post from anywhere.",
      position: "center",
      navigateTo: "/community",
      spotlight: "community-photo-stack",
      spotlightShape: "rect",
      wizardAnchor: "top",
    },
    {
      id: "community-details",
      title: "Stats and members",
      description:
        "See who's in your gym, check the weekly leaderboard, and track your own ranking. The more you log, the higher you climb.",
      position: "center",
      navigateTo: "/community",
      spotlight: "community-leaderboard",
      spotlightShape: "rect",
      scrollTo: "community-leaderboard",
      wizardAnchor: "top",
    },

    // ─── Section 4: Nutrition ──────────────────────────────────────────
    {
      id: "nutrition-intro",
      title: "Your fuel",
      description:
        "Everything you eat lives here. Log meals against your daily targets and keep the macros honest.",
      position: "center",
      navigateTo: "/nutrition",
    },
    {
      id: "nutrition-snap-meal",
      title: "Snap a meal",
      description:
        "Take a photo and I'll break it down: calories, protein, carbs, fats. Or search manually if you already know the numbers.",
      position: "center",
      navigateTo: "/nutrition",
      spotlight: "nutrition-quick-add",
      spotlightShape: "rect",
      spotlightPadding: 4,
      wizardAnchor: "top",
      wizardPose: "point",
    },
    {
      id: "nutrition-meal-plan",
      title: "Generate a meal plan",
      description:
        "I'll build you a full day of meals that hits your macros. Tap any idea to log it straight to your diary.",
      position: "center",
      navigateTo: "/nutrition",
      spotlight: "generate-meal-plan",
      spotlightShape: "rect",
      scrollTo: "generate-meal-plan",
      wizardAnchor: "top",
      wizardPose: "point",
    },

    // ─── Section 5: Wizard Chat ────────────────────────────────────────
    {
      id: "chat-intro",
      title: "Ask me anything",
      description:
        "That orb that follows you around is me. Tap it any time. I know your profile, your stats, and your plan.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "wizard-chat",
      spotlightShape: "rect",
      wizardAnchor: "top",
      wizardPose: "wave",
      actionEventName: "tutorial:pulse-wizard-chat",
    },
    {
      id: "chat-suggestions",
      title: "What I can help with",
      description:
        "Cut questions, nutrition gaps, session tips, protocol explanations. If it's in your plan, I can explain it. If it's about your data, I can read it.",
      position: "center",
      navigateTo: "/dashboard",
      wizardAnchor: "top",
      actionEventName: "tutorial:open-wizard-chat",
    },

    // ─── Section 6: Profile ────────────────────────────────────────────
    {
      id: "profile-tap",
      title: "Your profile and settings",
      description:
        "Tap your profile photo in the top left to access your stats, targets, and account settings.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "profile-avatar",
      spotlightShape: "rect",
      autoAdvanceMs: 2000,
      wizardAnchor: "top",
    },
    {
      id: "profile-intro",
      title: "Your profile and settings",
      description:
        "Update your stats here (weight, target, activity level) whenever your situation changes. Your plan recalculates automatically.",
      position: "center",
      navigateTo: "/goals",
    },

    // ─── Section 7: Handoff ────────────────────────────────────────────
    {
      id: "camera-intro",
      title: "Your quick-log button",
      description:
        "The camera in the nav is the fastest way in. Tap to snap a meal. Long press to pick: log a training session or scan food.",
      position: "center",
      navigateTo: "/dashboard",
      spotlight: "nav-quick-log",
      spotlightShape: "rect",
      wizardAnchor: "top",
      wizardPose: "point",
      navBottomOffset: "calc(env(safe-area-inset-bottom) + 90px)",
      actionEventName: "tutorial:pulse-quick-log",
    },
    {
      id: "camera-log",
      title: "Go log something now",
      description:
        "That's everything you need to know. The rest you'll learn by doing. Start with a quick log: snap what you had for your last meal.",
      position: "center",
      navigateTo: "/dashboard",
      navBottomOffset: "calc(env(safe-area-inset-bottom) + 90px)",
    },
    {
      id: "all-done",
      title: "That's the kit",
      description:
        "Come back every morning, hit the five chips, and I'll keep the score honest. Now go do the work.",
      position: "center",
      navigateTo: "/dashboard",
      wizardPose: "celebrate",
    },
  ],
};
