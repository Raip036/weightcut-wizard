import type { TutorialFlow } from "../types";

export const onboardingFlow: TutorialFlow = {
  id: "onboarding",
  version: 11,
  steps: [
    {
      id: "welcome",
      title: "Good, you made it",
      description:
        "I'm the wizard, your corner for everything outside the cage. I'll keep your cut clean and your camp honest. Two minutes, then you're off.",
      position: "center",
      route: "/dashboard",
      wizardPose: "wave",
    },
    {
      id: "dashboard-overview",
      title: "This is home",
      description:
        "Your ring tracks the day, the wisdom keeps you sharp, the badges mark the work. Open this first, every morning.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "score-number",
      title: "About that ring",
      description:
        "The number in the ring is your Fight Form Score, 0 to 100, blending your week against your camp. It's a three day rolling average, so one rough day won't sink it.",
      position: "center",
      route: "/dashboard",
      spotlight: "fight-form-ring-only",
      wizardPose: "point",
    },
    {
      id: "score-labels",
      title: "Four labels, one read",
      description:
        "Sharp from 80 up. Sharpening sixty to seventy nine. Off Pace forty to fifty nine. At Risk under forty. Read the label first, the number second.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "score-components",
      title: "Five parts make it up",
      description:
        "Training load, sleep, weight cut, wellness, nutrition. Tap the dots under the ring to see which one is pulling you up and which one is holding you back.",
      position: "center",
      route: "/dashboard",
      wizardPose: "point",
    },
    {
      id: "score-phases",
      title: "Phase matters",
      description:
        "Weights shift with your camp phase. Build leans on training and the cut. Peak leans on sleep and the cut. Fight Week stacks the cut, sleep, and wellness.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "score-ceilings",
      title: "Safety caps",
      description:
        "Some signals cap the score. Cutting more than two percent of bodyweight in a week caps it at fifty. Big sleep debt caps it at sixty five. A training spike caps it at forty five. A lock icon shows when one fires.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "score-daily-use",
      title: "What to do with it",
      description:
        "Check it in the morning. The label tells you to push or recover. Read the limiter, pick that as your next lever. Work the components, and the number follows.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "card-states",
      title: "Light them up",
      description:
        "Cards stay dim until you log that day. Weight, training, sleep, food, log it and the card lights up. Empty days look quiet on purpose.",
      position: "center",
      route: "/dashboard",
      wizardPose: "point",
    },
    {
      id: "nutrition-page",
      title: "Food in, fight out",
      description:
        "Scan a barcode, search a food, or let Quick Fill read the plate. Build a personalised plan, then analyse the micros so nothing slips.",
      position: "center",
      navigateTo: "/nutrition",
    },
    {
      id: "nutrition-features",
      title: "Two tools, one job",
      description:
        "Analyse looks back, finding the gaps and quiet deficiencies. Generate looks forward, building meals around the macros you actually need.",
      position: "center",
      route: "/nutrition",
      wizardPose: "point",
    },
    {
      id: "weight-tracker-page",
      title: "Weigh in, every day",
      description:
        "One number, same time, no drama. Filter by week, month or all, and I'll analyse the trend so you see the truth, not the noise.",
      position: "center",
      navigateTo: "/weight",
    },
    {
      id: "fight-week-page",
      title: "The last seven days",
      description:
        "This is where the cut gets real. Water load, sodium taper, the lot. Follow it step by step and you'll walk to the scale calm.",
      position: "center",
      navigateTo: "/weight-cut",
      condition: (state) => state.goalType === "cutting",
    },
    {
      id: "rehydration-page",
      title: "After the scale",
      description:
        "The fight is won in the hours after weigh-in. Sip the plan I lay out, hour by hour, fluid, salt and carbs in order. Don't freelance here.",
      position: "center",
      navigateTo: "/weight-cut?tab=rehydration",
      condition: (state) => state.goalType === "cutting",
      wizardPose: "point",
    },
    {
      id: "fight-camps-page",
      title: "Organise the chaos",
      description:
        "Every camp gets its own home. Track the cut, log the sessions, drop in photos. When the next one starts, you'll know exactly what worked.",
      position: "center",
      navigateTo: "/fight-camps",
    },
    {
      id: "training-calendar-page",
      title: "Log the rounds",
      description:
        "BJJ, Muay Thai, wrestling, strength, all in one place with an RPE. Each week I'll write you a short summary, so the patterns surface.",
      position: "center",
      navigateTo: "/training-calendar",
    },
    {
      id: "recovery-page",
      title: "The other half of fitness",
      description:
        "Tell me how you slept, how sore you are, how the tank feels. The more you log, the sharper my recovery coach gets at calling your next move.",
      position: "center",
      navigateTo: "/recovery",
    },
    {
      id: "sleep-page",
      title: "Hours in the bank",
      description:
        "Log the nights, watch the trend across a week, a month, three months. Sleep is the cheapest performance gain you've got. Spend it.",
      position: "center",
      navigateTo: "/sleep",
    },
    {
      id: "your-corner",
      title: "Your corner",
      description:
        "The Corner is your gym feed. Drop a photo or clip after a session, scroll your teammates' work, double tap to give them love.",
      position: "center",
      navigateTo: "/community",
    },
    {
      id: "feed-view-once",
      title: "See it once",
      description:
        "Each post shows up once. Swipe it away and it's gone from your feed for good. Your own posts stay in your profile so you keep the record.",
      position: "center",
      route: "/community",
      wizardPose: "point",
    },
    {
      id: "quick-tips",
      title: "Two buttons to know",
      description:
        "Tap the plus on the nav and the camera opens straight away. Snap a photo of your session, confirm the chips, and it's logged and posted to your gym in two taps. The sparkle opens me up for a chat, any question, any time.",
      position: "center",
      navigateTo: "/dashboard",
      wizardPose: "point",
    },
    {
      id: "pro-features",
      title: "A quick note on Pro",
      description:
        "Manual logging, barcode and food search are yours, free, forever. The AI tools, the plans, the analysis, those live in Pro. Upgrade from Settings when you're ready.",
      position: "center",
      route: "/dashboard",
    },
    {
      id: "all-done",
      title: "That's the kit",
      description:
        "You can replay this from Settings whenever you like. Now go and do the work. I'll be here when you check in.",
      position: "center",
      route: "/dashboard",
      wizardPose: "celebrate",
    },
  ],
};
