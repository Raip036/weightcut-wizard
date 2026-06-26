/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _shared_aiSchemas from "../_shared/aiSchemas.js";
import type * as _shared_apnsJwt from "../_shared/apnsJwt.js";
import type * as _shared_athleteSnapshot from "../_shared/athleteSnapshot.js";
import type * as _shared_campLimit from "../_shared/campLimit.js";
import type * as _shared_coachBlocks from "../_shared/coachBlocks.js";
import type * as _shared_coachCampHistory from "../_shared/coachCampHistory.js";
import type * as _shared_coachDomains_campArchitect from "../_shared/coachDomains/campArchitect.js";
import type * as _shared_coachDomains_fightScore from "../_shared/coachDomains/fightScore.js";
import type * as _shared_coachDomains_fightWeekCornerman from "../_shared/coachDomains/fightWeekCornerman.js";
import type * as _shared_coachDomains_nutrition from "../_shared/coachDomains/nutrition.js";
import type * as _shared_coachDomains_recovery from "../_shared/coachDomains/recovery.js";
import type * as _shared_coachDomains_scorer from "../_shared/coachDomains/scorer.js";
import type * as _shared_coachDomains_trainingLoad from "../_shared/coachDomains/trainingLoad.js";
import type * as _shared_coachDomains_types from "../_shared/coachDomains/types.js";
import type * as _shared_coachSafety from "../_shared/coachSafety.js";
import type * as _shared_cutFeasibility from "../_shared/cutFeasibility.js";
import type * as _shared_errorReporter from "../_shared/errorReporter.js";
import type * as _shared_featureGates from "../_shared/featureGates.js";
import type * as _shared_fightWeekMath from "../_shared/fightWeekMath.js";
import type * as _shared_groq from "../_shared/groq.js";
import type * as _shared_loadMetrics from "../_shared/loadMetrics.js";
import type * as _shared_math from "../_shared/math.js";
import type * as _shared_normalizePlanTopLevel from "../_shared/normalizePlanTopLevel.js";
import type * as _shared_normalizeWeeklyPlan from "../_shared/normalizeWeeklyPlan.js";
import type * as _shared_nutrientCategories from "../_shared/nutrientCategories.js";
import type * as _shared_parseResponse from "../_shared/parseResponse.js";
import type * as _shared_posthog from "../_shared/posthog.js";
import type * as _shared_protocolResearch from "../_shared/protocolResearch.js";
import type * as _shared_recoveryContext from "../_shared/recoveryContext.js";
import type * as _shared_rehydrationMath from "../_shared/rehydrationMath.js";
import type * as _shared_researchSummary from "../_shared/researchSummary.js";
import type * as _shared_sanitizeUserText from "../_shared/sanitizeUserText.js";
import type * as _shared_subscriptionGuard from "../_shared/subscriptionGuard.js";
import type * as _shared_tier from "../_shared/tier.js";
import type * as _shared_weighInTiming from "../_shared/weighInTiming.js";
import type * as _shared_weightProtocolMath from "../_shared/weightProtocolMath.js";
import type * as actions__helpers from "../actions/_helpers.js";
import type * as actions__trainingCoach_completePath from "../actions/_trainingCoach/completePath.js";
import type * as actions__trainingCoach_evaluatePlateau from "../actions/_trainingCoach/evaluatePlateau.js";
import type * as actions__trainingCoach_extractCandidates from "../actions/_trainingCoach/extractCandidates.js";
import type * as actions__trainingCoach_generateSteps from "../actions/_trainingCoach/generateSteps.js";
import type * as actions__trainingCoach_prompts from "../actions/_trainingCoach/prompts.js";
import type * as actions_activatePremium from "../actions/activatePremium.js";
import type * as actions_analyseDiet from "../actions/analyseDiet.js";
import type * as actions_analyzeMeal from "../actions/analyzeMeal.js";
import type * as actions_dailyWisdom from "../actions/dailyWisdom.js";
import type * as actions_deleteAccount from "../actions/deleteAccount.js";
import type * as actions_feelCheckFeedback from "../actions/feelCheckFeedback.js";
import type * as actions_fightCampCoach from "../actions/fightCampCoach.js";
import type * as actions_fightFormCoach from "../actions/fightFormCoach.js";
import type * as actions_fightWeekAnalysis from "../actions/fightWeekAnalysis.js";
import type * as actions_foodSearch from "../actions/foodSearch.js";
import type * as actions_generateCutPlan from "../actions/generateCutPlan.js";
import type * as actions_generateFightPlan from "../actions/generateFightPlan.js";
import type * as actions_generateRehydrationProtocol from "../actions/generateRehydrationProtocol.js";
import type * as actions_generateTechniqueChains from "../actions/generateTechniqueChains.js";
import type * as actions_generateWeightPlan from "../actions/generateWeightPlan.js";
import type * as actions_hydrationInsights from "../actions/hydrationInsights.js";
import type * as actions_lookupIngredient from "../actions/lookupIngredient.js";
import type * as actions_mealPlanner from "../actions/mealPlanner.js";
import type * as actions_reconcileAiOutcomes from "../actions/reconcileAiOutcomes.js";
import type * as actions_reconcileSubscriptions from "../actions/reconcileSubscriptions.js";
import type * as actions_recovery_campCompass from "../actions/recovery/campCompass.js";
import type * as actions_recovery_preSessionBrief from "../actions/recovery/preSessionBrief.js";
import type * as actions_recoveryCoach from "../actions/recoveryCoach.js";
import type * as actions_scanBarcode from "../actions/scanBarcode.js";
import type * as actions_sendAnnouncementPush from "../actions/sendAnnouncementPush.js";
import type * as actions_sparringPlan_prompts from "../actions/sparringPlan/prompts.js";
import type * as actions_trainingCoachPlanner from "../actions/trainingCoachPlanner.js";
import type * as actions_trainingInsights from "../actions/trainingInsights.js";
import type * as actions_trainingMissions_extractIssues from "../actions/trainingMissions/extractIssues.js";
import type * as actions_trainingMissions_generate from "../actions/trainingMissions/generate.js";
import type * as actions_trainingMissions_graduate from "../actions/trainingMissions/graduate.js";
import type * as actions_trainingMissions_groundingReference from "../actions/trainingMissions/groundingReference.js";
import type * as actions_trainingMissions_prompts from "../actions/trainingMissions/prompts.js";
import type * as actions_trainingMissions_sweep from "../actions/trainingMissions/sweep.js";
import type * as actions_trainingSummary from "../actions/trainingSummary.js";
import type * as actions_transcribeAudio from "../actions/transcribeAudio.js";
import type * as actions_weightTrackerAnalysis from "../actions/weightTrackerAnalysis.js";
import type * as actions_wizardChat from "../actions/wizardChat.js";
import type * as actions_workoutGenerator from "../actions/workoutGenerator.js";
import type * as actions_internal from "../actions_internal.js";
import type * as ai_decisions from "../ai_decisions.js";
import type * as announcement_polls from "../announcement_polls.js";
import type * as announcements from "../announcements.js";
import type * as appConfig from "../appConfig.js";
import type * as auth from "../auth.js";
import type * as authCleanup from "../authCleanup.js";
import type * as campActivityFeed from "../campActivityFeed.js";
import type * as campCompletion from "../campCompletion.js";
import type * as coach from "../coach.js";
import type * as coachArchitect_internal from "../coachArchitect_internal.js";
import type * as coachBriefing from "../coachBriefing.js";
import type * as coachCampHistory_internal from "../coachCampHistory_internal.js";
import type * as coachCockpit from "../coachCockpit.js";
import type * as coachConversation from "../coachConversation.js";
import type * as coachDomains_internal from "../coachDomains_internal.js";
import type * as coachFightWeek_internal from "../coachFightWeek_internal.js";
import type * as coachNudge from "../coachNudge.js";
import type * as coachSafety_internal from "../coachSafety_internal.js";
import type * as coachTrends from "../coachTrends.js";
import type * as crons from "../crons.js";
import type * as deleteAccountMutations from "../deleteAccountMutations.js";
import type * as device_tokens from "../device_tokens.js";
import type * as exercise_prs from "../exercise_prs.js";
import type * as exercises from "../exercises.js";
import type * as feedActivity from "../feedActivity.js";
import type * as feedMaintenance from "../feedMaintenance.js";
import type * as feedSocial from "../feedSocial.js";
import type * as fightCampDebrief from "../fightCampDebrief.js";
import type * as fightFormScore from "../fightFormScore.js";
import type * as fightFormScore_internal from "../fightFormScore_internal.js";
import type * as fight_camp from "../fight_camp.js";
import type * as fight_offers from "../fight_offers.js";
import type * as foodRecents from "../foodRecents.js";
import type * as foods from "../foods.js";
import type * as gymFeed from "../gymFeed.js";
import type * as gymLeaderboard from "../gymLeaderboard.js";
import type * as gym_members from "../gym_members.js";
import type * as gym_sessions from "../gym_sessions.js";
import type * as gyms from "../gyms.js";
import type * as http from "../http.js";
import type * as hydration_logs from "../hydration_logs.js";
import type * as leaderboardCache from "../leaderboardCache.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_foodRanking from "../lib/foodRanking.js";
import type * as lib_gymAccess from "../lib/gymAccess.js";
import type * as lib_leaderboardAggregation from "../lib/leaderboardAggregation.js";
import type * as lib_revenuecat from "../lib/revenuecat.js";
import type * as lib_sessionTypes from "../lib/sessionTypes.js";
import type * as lib_xp from "../lib/xp.js";
import type * as markedSkips from "../markedSkips.js";
import type * as mastery_spine from "../mastery_spine.js";
import type * as meal_plans from "../meal_plans.js";
import type * as meals from "../meals.js";
import type * as migrations from "../migrations.js";
import type * as migrations_backfillSparring from "../migrations/backfillSparring.js";
import type * as profiles from "../profiles.js";
import type * as profiles_internal from "../profiles_internal.js";
import type * as pushFanout from "../pushFanout.js";
import type * as rate_limits from "../rate_limits.js";
import type * as recoveryReports from "../recoveryReports.js";
import type * as routines from "../routines.js";
import type * as sleep_logs from "../sleep_logs.js";
import type * as sparring_plan from "../sparring_plan.js";
import type * as techniques from "../techniques.js";
import type * as training_missions from "../training_missions.js";
import type * as training_paths from "../training_paths.js";
import type * as training_techniques from "../training_techniques.js";
import type * as user_discipline_xp from "../user_discipline_xp.js";
import type * as weightProtocols from "../weightProtocols.js";
import type * as weight_logs from "../weight_logs.js";
import type * as weight_protocols_internal from "../weight_protocols_internal.js";
import type * as wellness from "../wellness.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/aiSchemas": typeof _shared_aiSchemas;
  "_shared/apnsJwt": typeof _shared_apnsJwt;
  "_shared/athleteSnapshot": typeof _shared_athleteSnapshot;
  "_shared/campLimit": typeof _shared_campLimit;
  "_shared/coachBlocks": typeof _shared_coachBlocks;
  "_shared/coachCampHistory": typeof _shared_coachCampHistory;
  "_shared/coachDomains/campArchitect": typeof _shared_coachDomains_campArchitect;
  "_shared/coachDomains/fightScore": typeof _shared_coachDomains_fightScore;
  "_shared/coachDomains/fightWeekCornerman": typeof _shared_coachDomains_fightWeekCornerman;
  "_shared/coachDomains/nutrition": typeof _shared_coachDomains_nutrition;
  "_shared/coachDomains/recovery": typeof _shared_coachDomains_recovery;
  "_shared/coachDomains/scorer": typeof _shared_coachDomains_scorer;
  "_shared/coachDomains/trainingLoad": typeof _shared_coachDomains_trainingLoad;
  "_shared/coachDomains/types": typeof _shared_coachDomains_types;
  "_shared/coachSafety": typeof _shared_coachSafety;
  "_shared/cutFeasibility": typeof _shared_cutFeasibility;
  "_shared/errorReporter": typeof _shared_errorReporter;
  "_shared/featureGates": typeof _shared_featureGates;
  "_shared/fightWeekMath": typeof _shared_fightWeekMath;
  "_shared/groq": typeof _shared_groq;
  "_shared/loadMetrics": typeof _shared_loadMetrics;
  "_shared/math": typeof _shared_math;
  "_shared/normalizePlanTopLevel": typeof _shared_normalizePlanTopLevel;
  "_shared/normalizeWeeklyPlan": typeof _shared_normalizeWeeklyPlan;
  "_shared/nutrientCategories": typeof _shared_nutrientCategories;
  "_shared/parseResponse": typeof _shared_parseResponse;
  "_shared/posthog": typeof _shared_posthog;
  "_shared/protocolResearch": typeof _shared_protocolResearch;
  "_shared/recoveryContext": typeof _shared_recoveryContext;
  "_shared/rehydrationMath": typeof _shared_rehydrationMath;
  "_shared/researchSummary": typeof _shared_researchSummary;
  "_shared/sanitizeUserText": typeof _shared_sanitizeUserText;
  "_shared/subscriptionGuard": typeof _shared_subscriptionGuard;
  "_shared/tier": typeof _shared_tier;
  "_shared/weighInTiming": typeof _shared_weighInTiming;
  "_shared/weightProtocolMath": typeof _shared_weightProtocolMath;
  "actions/_helpers": typeof actions__helpers;
  "actions/_trainingCoach/completePath": typeof actions__trainingCoach_completePath;
  "actions/_trainingCoach/evaluatePlateau": typeof actions__trainingCoach_evaluatePlateau;
  "actions/_trainingCoach/extractCandidates": typeof actions__trainingCoach_extractCandidates;
  "actions/_trainingCoach/generateSteps": typeof actions__trainingCoach_generateSteps;
  "actions/_trainingCoach/prompts": typeof actions__trainingCoach_prompts;
  "actions/activatePremium": typeof actions_activatePremium;
  "actions/analyseDiet": typeof actions_analyseDiet;
  "actions/analyzeMeal": typeof actions_analyzeMeal;
  "actions/dailyWisdom": typeof actions_dailyWisdom;
  "actions/deleteAccount": typeof actions_deleteAccount;
  "actions/feelCheckFeedback": typeof actions_feelCheckFeedback;
  "actions/fightCampCoach": typeof actions_fightCampCoach;
  "actions/fightFormCoach": typeof actions_fightFormCoach;
  "actions/fightWeekAnalysis": typeof actions_fightWeekAnalysis;
  "actions/foodSearch": typeof actions_foodSearch;
  "actions/generateCutPlan": typeof actions_generateCutPlan;
  "actions/generateFightPlan": typeof actions_generateFightPlan;
  "actions/generateRehydrationProtocol": typeof actions_generateRehydrationProtocol;
  "actions/generateTechniqueChains": typeof actions_generateTechniqueChains;
  "actions/generateWeightPlan": typeof actions_generateWeightPlan;
  "actions/hydrationInsights": typeof actions_hydrationInsights;
  "actions/lookupIngredient": typeof actions_lookupIngredient;
  "actions/mealPlanner": typeof actions_mealPlanner;
  "actions/reconcileAiOutcomes": typeof actions_reconcileAiOutcomes;
  "actions/reconcileSubscriptions": typeof actions_reconcileSubscriptions;
  "actions/recovery/campCompass": typeof actions_recovery_campCompass;
  "actions/recovery/preSessionBrief": typeof actions_recovery_preSessionBrief;
  "actions/recoveryCoach": typeof actions_recoveryCoach;
  "actions/scanBarcode": typeof actions_scanBarcode;
  "actions/sendAnnouncementPush": typeof actions_sendAnnouncementPush;
  "actions/sparringPlan/prompts": typeof actions_sparringPlan_prompts;
  "actions/trainingCoachPlanner": typeof actions_trainingCoachPlanner;
  "actions/trainingInsights": typeof actions_trainingInsights;
  "actions/trainingMissions/extractIssues": typeof actions_trainingMissions_extractIssues;
  "actions/trainingMissions/generate": typeof actions_trainingMissions_generate;
  "actions/trainingMissions/graduate": typeof actions_trainingMissions_graduate;
  "actions/trainingMissions/groundingReference": typeof actions_trainingMissions_groundingReference;
  "actions/trainingMissions/prompts": typeof actions_trainingMissions_prompts;
  "actions/trainingMissions/sweep": typeof actions_trainingMissions_sweep;
  "actions/trainingSummary": typeof actions_trainingSummary;
  "actions/transcribeAudio": typeof actions_transcribeAudio;
  "actions/weightTrackerAnalysis": typeof actions_weightTrackerAnalysis;
  "actions/wizardChat": typeof actions_wizardChat;
  "actions/workoutGenerator": typeof actions_workoutGenerator;
  actions_internal: typeof actions_internal;
  ai_decisions: typeof ai_decisions;
  announcement_polls: typeof announcement_polls;
  announcements: typeof announcements;
  appConfig: typeof appConfig;
  auth: typeof auth;
  authCleanup: typeof authCleanup;
  campActivityFeed: typeof campActivityFeed;
  campCompletion: typeof campCompletion;
  coach: typeof coach;
  coachArchitect_internal: typeof coachArchitect_internal;
  coachBriefing: typeof coachBriefing;
  coachCampHistory_internal: typeof coachCampHistory_internal;
  coachCockpit: typeof coachCockpit;
  coachConversation: typeof coachConversation;
  coachDomains_internal: typeof coachDomains_internal;
  coachFightWeek_internal: typeof coachFightWeek_internal;
  coachNudge: typeof coachNudge;
  coachSafety_internal: typeof coachSafety_internal;
  coachTrends: typeof coachTrends;
  crons: typeof crons;
  deleteAccountMutations: typeof deleteAccountMutations;
  device_tokens: typeof device_tokens;
  exercise_prs: typeof exercise_prs;
  exercises: typeof exercises;
  feedActivity: typeof feedActivity;
  feedMaintenance: typeof feedMaintenance;
  feedSocial: typeof feedSocial;
  fightCampDebrief: typeof fightCampDebrief;
  fightFormScore: typeof fightFormScore;
  fightFormScore_internal: typeof fightFormScore_internal;
  fight_camp: typeof fight_camp;
  fight_offers: typeof fight_offers;
  foodRecents: typeof foodRecents;
  foods: typeof foods;
  gymFeed: typeof gymFeed;
  gymLeaderboard: typeof gymLeaderboard;
  gym_members: typeof gym_members;
  gym_sessions: typeof gym_sessions;
  gyms: typeof gyms;
  http: typeof http;
  hydration_logs: typeof hydration_logs;
  leaderboardCache: typeof leaderboardCache;
  "lib/auth": typeof lib_auth;
  "lib/foodRanking": typeof lib_foodRanking;
  "lib/gymAccess": typeof lib_gymAccess;
  "lib/leaderboardAggregation": typeof lib_leaderboardAggregation;
  "lib/revenuecat": typeof lib_revenuecat;
  "lib/sessionTypes": typeof lib_sessionTypes;
  "lib/xp": typeof lib_xp;
  markedSkips: typeof markedSkips;
  mastery_spine: typeof mastery_spine;
  meal_plans: typeof meal_plans;
  meals: typeof meals;
  migrations: typeof migrations;
  "migrations/backfillSparring": typeof migrations_backfillSparring;
  profiles: typeof profiles;
  profiles_internal: typeof profiles_internal;
  pushFanout: typeof pushFanout;
  rate_limits: typeof rate_limits;
  recoveryReports: typeof recoveryReports;
  routines: typeof routines;
  sleep_logs: typeof sleep_logs;
  sparring_plan: typeof sparring_plan;
  techniques: typeof techniques;
  training_missions: typeof training_missions;
  training_paths: typeof training_paths;
  training_techniques: typeof training_techniques;
  user_discipline_xp: typeof user_discipline_xp;
  weightProtocols: typeof weightProtocols;
  weight_logs: typeof weight_logs;
  weight_protocols_internal: typeof weight_protocols_internal;
  wellness: typeof wellness;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
