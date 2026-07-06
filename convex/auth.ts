/**
 * Convex Auth configuration.
 *
 * Exports the canonical `auth`, `signIn`, `signOut`, `store`, and
 * `isAuthenticated` helpers built from {@link convexAuth}. These are
 * referenced by the auto-generated `api`/`internal` modules and by
 * `convex/http.ts` (which calls `auth.addHttpRoutes(http)`).
 *
 * Providers:
 *  - Password (email + password, with reset flow)
 *  - Apple (OAuth — Services ID / Team ID / Key ID / p8 key are read
 *    from environment variables on the Convex deployment; see
 *    `auth.config.ts` for the env var contract.)
 *  - Google (OAuth — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are read
 *    from environment variables on the Convex deployment; see
 *    `auth.config.ts` for the env var contract.) Plus a `google-native`
 *    ConvexCredentials provider that verifies an Android-issued id_token
 *    server-side, mirroring `apple-native`.
 *
 * Required Convex env vars (set with `npx convex env set <NAME> <value>`):
 *   AUTH_APPLE_ID / AUTH_APPLE_* …  (Apple — see auth.config.ts)
 *   GOOGLE_CLIENT_ID                Web OAuth client id (also the audience
 *                                   the `google-native` provider verifies
 *                                   the Android id_token against).
 *   GOOGLE_CLIENT_SECRET            Web OAuth client secret (web redirect flow).
 *
 * Bootstrap:
 *  - `createOrUpdateUser` is invoked by Convex Auth after a successful
 *    sign-in. We use it to ensure a 1:1 `profiles` row exists for the
 *    auth user. Phase 3 will replace the inline insert below with a
 *    call to `internal.profiles.ensureExists` once that mutation lands.
 */
import { convexAuth, createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import Apple from "@auth/core/providers/apple";
import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// ─── Apple native id_token verification helpers ───────────────────────
// `@convex-dev/auth@0.0.92` has no built-in path to complete an OAuth
// provider's sign-in with a pre-obtained id_token (the dispatcher in
// `signIn.js` always returns a redirect for OAuth providers). For native
// iOS Sign In with Apple we therefore register a separate
// `ConvexCredentials` provider with id `apple-native` that:
//   1. Verifies the iOS-issued id_token against Apple's JWKS.
//   2. Verifies the SHA-256 hashed nonce matches what we sent to Apple.
//   3. Upserts the user via `createAccount` keyed by Apple `sub` so a
//      user is linked across the web OAuth Apple provider above and
//      this native provider (both use providerId "apple" in the
//      `authAccounts` table).
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_NATIVE_AUDIENCE = "com.weightcutwizard.app"; // iOS Bundle ID
const appleJWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

interface AppleIdTokenClaims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  nonce?: string;
}

/** SHA-256 of `input` as lowercase hex via Web Crypto (runtime-agnostic). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Google native id_token verification helpers ──────────────────────
// Same shape as the Apple block above: `@convex-dev/auth` has no native
// id_token short-circuit for OAuth providers, so native Android Sign In
// with Google goes through a separate `ConvexCredentials` provider with id
// `google-native` that:
//   1. Verifies the Android-issued id_token against Google's JWKS.
//   2. Verifies the nonce. IMPORTANT DIFFERENCE FROM APPLE: Google echoes
//      the `nonce` claim equal to the RAW value the client passed, whereas
//      Apple stores SHA-256(rawNonce). So here we compare the token's
//      `nonce` claim directly to the raw nonce (no hashing).
//   3. Upserts the user via `createAccount` keyed by Google `sub` under
//      providerId "google" so the web OAuth Google provider and this
//      native provider link to the SAME `authAccounts` record.
// Google accepts the issuer with or without the https scheme.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
// GOOGLE_NATIVE_AUDIENCE: the audience the id_token must be minted for.
// Sourced from the Convex env var GOOGLE_CLIENT_ID (the Web OAuth client id
// the Android plugin is initialized with via `serverClientId`/`webClientId`).
const GOOGLE_NATIVE_AUDIENCE = process.env.GOOGLE_CLIENT_ID;
// iOS Google Sign-In is initialized with the iOS OAuth client id. When an
// iOSServerClientId (= the web client id) is set, the iOS id_token's `aud` is
// the web client id and matches GOOGLE_NATIVE_AUDIENCE. We ALSO accept the iOS
// client id directly as a valid audience (belt-and-braces, in case a token is
// minted for the iOS client). Unset on Android-only deployments → harmless.
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID;
const GOOGLE_NATIVE_AUDIENCES = [
  GOOGLE_NATIVE_AUDIENCE,
  GOOGLE_IOS_CLIENT_ID,
].filter((id): id is string => typeof id === "string" && id.length > 0);
const googleJWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

interface GoogleIdTokenClaims extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  nonce?: string;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    // Email + password. Reset/verification email senders are stubbed for
    // now — see `auth.config.ts`. Phase 3 will wire up Resend (or similar).
    Password({
      // Custom profile shape: pull `role` out of the signIn params and
      // pass it through so `createOrUpdateUser` can persist it on the
      // freshly-created `profiles` row in the SAME transaction. Without
      // this the bootstrap row always defaults to `role: "fighter"` and
      // a coach signup races the client-side `profiles.setRole` patch.
      profile(params) {
        const email = params.email as string;
        const rawRole = (params as Record<string, unknown>).role;
        const role: "fighter" | "coach" =
          rawRole === "coach" ? "coach" : "fighter";
        return {
          email,
          // Stash on the user doc so `createOrUpdateUser` can read it via
          // `args.profile.role`. Convex Auth carries unknown keys through
          // the profile object verbatim.
          role,
        } as { email: string; role: "fighter" | "coach" };
      },
    }),

    // Apple Sign-In (OAuth). Provider config (clientId / clientSecret) is
    // read from env vars at runtime — see `auth.config.ts`. The redirect
    // URI on Apple's developer console must be set to:
    //   https://<your-convex-site-url>/api/auth/callback/apple
    //
    // We invoke `Apple({...})` (rather than the bare default-export) so we
    // can:
    //   1. Pin `idToken: true` — keeps the OIDC flow off Apple's fake
    //      `userinfo_endpoint` and tells `processAuthorizationCodeResponse`
    //      to trust the validated id_token claims as the profile. This is
    //      the path we want for native iOS, where the device returns a
    //      signed id_token + nonce from `ASAuthorizationAppleIDProvider`.
    //   2. Declare `checks: ["nonce"]` — Apple's stock provider also adds
    //      `state`, which is correct for browser-redirect flows. For native
    //      iOS the device generates the nonce itself, so we keep nonce in
    //      checks. We deliberately do NOT drop `state` here because the
    //      browser-redirect flow (web) still relies on it; `state` is
    //      already in the stock provider's defaults and we don't override
    //      it (this preserves web compatibility).
    //   3. Override `profile()` so the stable identifier is Apple's `sub`
    //      and `emailVerified` is normalized from Apple's "true"/true.
    //
    // NOTE: The @convex-dev/auth OAuth handler currently has no native
    // id_token short-circuit in `signInImpl` — `signIn("apple", {idToken,
    // nonce})` will still hit the redirect path. This config change makes
    // the provider id_token-correct (so a custom-action that drives the
    // OIDC callback path manually can succeed), but on its own it will
    // NOT make `signIn("apple", {idToken, nonce})` work end-to-end. The
    // parallel custom-action fallback in `convex/actions/` is required.
    Apple({
      clientId: process.env.AUTH_APPLE_ID,
      // Trust the validated id_token claims directly; skip the (fake)
      // userinfo round-trip Apple's stock provider stubs out.
      //
      // NOTE: `@auth/core`'s Apple provider is typed as `OAuthUserConfig`
      // (the OAuth2 arm of the union) even though it returns an OIDC
      // config at runtime — so `idToken` is not in the static type.
      // Convex Auth's runtime DOES read `config.idToken` when
      // `config.type === "oidc"` (see
      // `@convex-dev/auth/dist/server/oauth/convexAuth.js`), so we set it
      // via a cast. This is an upstream typing inconsistency, not a real
      // type error.
      ...({ idToken: true } as { idToken: boolean }),
      // Verify the nonce on the returned id_token. (Web redirect flow
      // still gets `state` from the stock provider defaults — we don't
      // override it here.)
      checks: ["nonce"],
      // Stable user id = Apple `sub`. Apple only returns `name` on the
      // very first consent — leave it undefined otherwise.
      profile(profile) {
        // Apple sends `user: { name: { firstName, lastName } }` only on
        // the FIRST consent. The OAuth web flow forwards it through
        // `profile.user.name`. Stitch a display name if present.
        const userObj = (profile as unknown as { user?: { name?: { firstName?: string; lastName?: string } } }).user;
        const fullName = userObj?.name
          ? [userObj.name.firstName, userObj.name.lastName].filter(Boolean).join(" ").trim()
          : undefined;
        return {
          id: profile.sub,
          email: profile.email,
          name: fullName || undefined,
          emailVerified:
            profile.email_verified === "true" ||
            profile.email_verified === true,
        };
      },
    }),

    // Native iOS Apple Sign-In via id_token. Client (Capacitor +
    // @capacitor-community/apple-sign-in) calls:
    //   signIn("apple-native", { idToken, nonce, email?, givenName?,
    //                            familyName?, role? })
    // We verify the id_token + nonce server-side and upsert the user.
    ConvexCredentials({
      id: "apple-native",
      authorize: async (credentials, ctx) => {
        const idToken = credentials.idToken;
        const rawNonce = credentials.nonce;
        if (typeof idToken !== "string" || idToken.length === 0) {
          throw new Error("APPLE_NATIVE_MISSING_ID_TOKEN");
        }
        if (typeof rawNonce !== "string" || rawNonce.length === 0) {
          throw new Error("APPLE_NATIVE_MISSING_NONCE");
        }

        // ─ 1. Verify signature + standard claims against Apple's JWKS.
        let payload: AppleIdTokenClaims;
        try {
          const verified = await jwtVerify<AppleIdTokenClaims>(idToken, appleJWKS, {
            issuer: APPLE_ISSUER,
            audience: APPLE_NATIVE_AUDIENCE,
            clockTolerance: "5s",
          });
          payload = verified.payload;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`APPLE_NATIVE_IDTOKEN_INVALID: ${msg}`);
        }

        // ─ 2. Nonce binding: Apple stores SHA-256(rawNonce). Refuse if
        //   the client never supplied a nonce or it doesn't match.
        if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
          throw new Error("APPLE_NATIVE_NONCE_MISSING_FROM_TOKEN");
        }
        const expectedNonceHash = await sha256Hex(rawNonce);
        if (payload.nonce !== expectedNonceHash) {
          throw new Error("APPLE_NATIVE_NONCE_MISMATCH");
        }

        // ─ 3. Pull stable identifier and optional profile fields.
        const appleSub = payload.sub;
        if (!appleSub) throw new Error("APPLE_NATIVE_MISSING_SUB");

        const email =
          typeof payload.email === "string" && payload.email.length > 0
            ? payload.email
            : typeof credentials.email === "string"
              ? credentials.email
              : undefined;
        const emailVerified =
          payload.email_verified === true || payload.email_verified === "true";

        const givenName =
          typeof credentials.givenName === "string" ? credentials.givenName : undefined;
        const familyName =
          typeof credentials.familyName === "string" ? credentials.familyName : undefined;
        const name = [givenName, familyName]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
          .join(" ")
          .trim() || undefined;

        // Role for the bootstrap `profiles` row. Defaults to fighter;
        // a coach signup needs to pass `role: "coach"` on the client.
        const role: "fighter" | "coach" =
          credentials.role === "coach" ? "coach" : "fighter";

        // ─ 4. Find-or-create the user under provider="apple" so the
        //   record is interchangeable with the web OAuth flow.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profilePayload: any = {
          ...(email !== undefined ? { email } : {}),
          ...(name !== undefined ? { name } : {}),
          emailVerified: emailVerified || email !== undefined,
          role,
        };

        const { user } = await createAccount(ctx, {
          provider: "apple",
          account: { id: appleSub },
          profile: profilePayload,
          shouldLinkViaEmail: true,
        });

        return { userId: user._id };
      },
    }),

    // Google Sign-In (OAuth, web redirect flow). Provider config
    // (clientId / clientSecret) is read from env vars at runtime — see
    // `auth.config.ts`. The redirect URI on the Google Cloud console must
    // be set to:
    //   https://<your-convex-site-url>/api/auth/callback/google
    //
    // Mirrors the Apple web provider above: stable identifier is Google's
    // `sub` and `emailVerified` is normalized from Google's "true"/true.
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          email: profile.email,
          name: profile.name,
          emailVerified:
            profile.email_verified === "true" ||
            profile.email_verified === true,
        };
      },
    }),

    // Native Android Google Sign-In via id_token. Client (Capacitor +
    // @capgo/capacitor-social-login) calls:
    //   signIn("google-native", { idToken, nonce, role? })
    // We verify the id_token + nonce server-side and upsert the user.
    // Mirrors the `apple-native` provider above; the one behavioural
    // difference is the nonce check (see step 2).
    ConvexCredentials({
      id: "google-native",
      authorize: async (credentials, ctx) => {
        const idToken = credentials.idToken;
        const rawNonce = credentials.nonce;
        if (typeof idToken !== "string" || idToken.length === 0) {
          throw new Error("GOOGLE_NATIVE_MISSING_ID_TOKEN");
        }
        if (typeof rawNonce !== "string" || rawNonce.length === 0) {
          throw new Error("GOOGLE_NATIVE_MISSING_NONCE");
        }
        if (GOOGLE_NATIVE_AUDIENCES.length === 0) {
          // Neither GOOGLE_CLIENT_ID nor GOOGLE_IOS_CLIENT_ID is set — refuse
          // rather than verify against an undefined audience.
          throw new Error("GOOGLE_NATIVE_AUDIENCE_NOT_CONFIGURED");
        }

        // ─ 1. Verify signature + standard claims against Google's JWKS.
        //   `audience` accepts an array (jose checks the token's `aud` matches
        //   ANY entry), so both the web client id (Android, and iOS via
        //   iOSServerClientId) and the iOS client id are accepted.
        let payload: GoogleIdTokenClaims;
        try {
          const verified = await jwtVerify<GoogleIdTokenClaims>(idToken, googleJWKS, {
            issuer: GOOGLE_ISSUERS,
            audience: GOOGLE_NATIVE_AUDIENCES,
            clockTolerance: "5s",
          });
          payload = verified.payload;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`GOOGLE_NATIVE_IDTOKEN_INVALID: ${msg}`);
        }

        // ─ 2. Nonce binding. UNLIKE APPLE (which stores SHA-256(rawNonce)),
        //   Google echoes the `nonce` claim equal to the RAW value the
        //   client passed, so we compare against the raw nonce directly —
        //   no hashing.
        if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
          throw new Error("GOOGLE_NATIVE_NONCE_MISSING_FROM_TOKEN");
        }
        if (payload.nonce !== rawNonce) {
          throw new Error("GOOGLE_NATIVE_NONCE_MISMATCH");
        }

        // ─ 3. Pull stable identifier and optional profile fields.
        const googleSub = payload.sub;
        if (!googleSub) throw new Error("GOOGLE_NATIVE_MISSING_SUB");

        const email =
          typeof payload.email === "string" && payload.email.length > 0
            ? payload.email
            : typeof credentials.email === "string"
              ? credentials.email
              : undefined;
        const emailVerified =
          payload.email_verified === true || payload.email_verified === "true";

        const givenName =
          typeof payload.given_name === "string" ? payload.given_name : undefined;
        const familyName =
          typeof payload.family_name === "string" ? payload.family_name : undefined;
        const name =
          (typeof payload.name === "string" && payload.name.length > 0
            ? payload.name
            : [givenName, familyName]
                .filter((s): s is string => typeof s === "string" && s.length > 0)
                .join(" ")
                .trim()) || undefined;

        // Role for the bootstrap `profiles` row. Defaults to fighter;
        // a coach signup needs to pass `role: "coach"` on the client.
        const role: "fighter" | "coach" =
          credentials.role === "coach" ? "coach" : "fighter";

        // ─ 4. Find-or-create the user under provider="google" so the
        //   record is interchangeable with the web OAuth flow.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profilePayload: any = {
          ...(email !== undefined ? { email } : {}),
          ...(name !== undefined ? { name } : {}),
          emailVerified: emailVerified || email !== undefined,
          role,
        };

        const { user } = await createAccount(ctx, {
          provider: "google",
          account: { id: googleSub },
          profile: profilePayload,
          shouldLinkViaEmail: true,
        });

        return { userId: user._id };
      },
    }),
  ],

  // After Convex Auth creates (or updates) a `users` row, make sure the
  // app-side `profiles` row exists. We can't import a mutation reference
  // here without circular deps, so we do a minimal inline upsert via the
  // mutation context.
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      // If this is an existing user, just return their id.
      if (args.existingUserId) {
        return args.existingUserId;
      }

      // Brand-new sign-up: create the users row first.
      const userId = await ctx.db.insert("users", {
        email: args.profile.email,
        name: args.profile.name,
        image: args.profile.image,
        emailVerificationTime: args.profile.emailVerified
          ? Date.now()
          : undefined,
      });

      // Bootstrap a placeholder `profiles` row. Required fields are filled
      // with sensible defaults so the row is valid; the onboarding flow
      // will overwrite these. The `role` is sourced from the signIn
      // params (see `Password.profile` above) so a coach signup lands
      // `role: "coach"` atomically — the client never has to chase it
      // with a follow-up `profiles.setRole` patch.
      const profileRole: "fighter" | "coach" =
        (args.profile as Record<string, unknown>).role === "coach"
          ? "coach"
          : "fighter";
      try {
        await ctx.db.insert("profiles", {
          userId,
          age: 0,
          sex: "",
          heightCm: 0,
          currentWeightKg: 0,
          goalWeightKg: 0,
          targetDate: "",
          activityLevel: "",
          goalType: "",
          role: profileRole,
          subscriptionTier: "free",
        });
      } catch (err) {
        // Defensive: if the schema rejects (e.g. during a migration where
        // profile fields shift), don't block the sign-in. The client can
        // call `profiles.ensureExists` to recover.
        console.warn("[auth] profile bootstrap failed", err);
      }

      // Server-side `signed_up` capture — fires EXACTLY ONCE per newly
      // created user, covering every provider (the client used to fire it
      // only on the password branches, so OAuth signups went untracked and
      // the client can't tell a new OAuth signup from a returning login).
      // Mutations can't do network I/O, so hop to a Node action via the
      // scheduler; the schedule is transactional with this user insert.
      // `provider.id` is "password" | "apple" | "google" here — the native
      // ConvexCredentials providers upsert via createAccount under the
      // canonical "apple"/"google" ids, so they map cleanly too.
      try {
        const providerId = args.provider?.id ?? "unknown";
        const method = providerId.includes("apple")
          ? "apple"
          : providerId.includes("google")
            ? "google"
            : providerId; // "password" or a future provider's raw id
        await ctx.scheduler.runAfter(0, internal.authAnalytics.captureSignedUp, {
          userId,
          method,
          role: profileRole,
        });
      } catch (err) {
        // Analytics must never block account creation.
        console.warn("[auth] signed_up capture schedule failed", err);
      }

      return userId;
    },
  },
});
