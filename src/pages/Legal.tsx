import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, Shield, FileText } from "lucide-react";

type Tab = "privacy" | "terms";

export default function Legal() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "privacy";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 border-b border-border" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2 rounded-full hover:bg-accent/50 active:scale-95 transition-all"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Legal</h1>
        </div>

        {/* Tab switcher */}
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="flex gap-1 p-1 rounded-xs bg-muted/50">
            <button
              onClick={() => setTab("privacy")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xs transition-all ${
                tab === "privacy" ? "bg-background text-foreground" : "text-muted-foreground"
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Privacy Policy
            </button>
            <button
              onClick={() => setTab("terms")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xs transition-all ${
                tab === "terms" ? "bg-background text-foreground" : "text-muted-foreground"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Terms of Service
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-5 py-6 pb-24">
        {tab === "privacy" ? <PrivacyPolicy /> : <TermsOfService />}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-foreground mt-6 mb-2">{children}</h2>;
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground mt-4 mb-1.5">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground leading-relaxed mb-2">{children}</p>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 mb-3 ml-1">
      {items.map((item, i) => (
        <li key={i} className="text-[13px] text-muted-foreground leading-relaxed flex gap-2">
          <span className="text-primary/60 mt-1.5 flex-shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function LastUpdated() {
  return (
    <p className="text-[11px] text-muted-foreground/50 mb-4">Last updated: April 13, 2026</p>
  );
}

function PrivacyPolicy() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Privacy Policy</h1>
      <LastUpdated />

      <P>
        FightCamp Wizard ("we", "our", "the app") is operated by Pratik Rai. This policy explains
        what data we collect, how we use it, and your rights regarding your information.
      </P>

      <SectionTitle>1. Data We Collect</SectionTitle>

      <SubTitle>Account Information</SubTitle>
      <BulletList items={[
        "Email address (for authentication)",
        "Display name (optional, set by you)",
        "Profile photo (optional, uploaded by you)",
        "Authentication tokens (managed by Convex Auth)",
      ]} />

      <SubTitle>Health & Fitness Data</SubTitle>
      <BulletList items={[
        "Body weight logs (date and weight entries)",
        "Nutrition logs (meal descriptions, calories, macronutrients)",
        "Hydration intake records",
        "Sleep logs (date and hours slept)",
        "Training session logs (type, duration, intensity, RPE, notes)",
        "Fight camp records (dates, weight targets, progress)",
        "Recovery and wellness check-in data",
      ]} />

      <SubTitle>Subscription & Purchase Data</SubTitle>
      <BulletList items={[
        "Subscription status and tier (managed by RevenueCat)",
        "Anonymous purchase identifiers (no payment card details are stored by us)",
        "AI gem balance and usage count",
      ]} />

      <SubTitle>App Usage Data</SubTitle>
      <BulletList items={[
        "Crash reports and error logs (via Sentry — no personal data included)",
        "Feature usage patterns (anonymised)",
        "Device type and iOS version (for compatibility)",
      ]} />

      <SectionTitle>2. How We Use Your Data</SectionTitle>
      <BulletList items={[
        "To provide personalised weight tracking, nutrition analysis, sleep tracking, and training insights",
        "To generate AI-powered meal plans, diet analysis, and coaching advice",
        "To calculate recovery scores, readiness metrics, and fight week schedules",
        "To manage your subscription and AI gem balance",
        "To maintain your account and sync data across sessions",
        "To improve app stability and fix bugs (crash reports)",
      ]} />

      <SectionTitle>3. Third-Party Services</SectionTitle>
      <P>We use the following services to operate the app:</P>

      <SubTitle>Convex</SubTitle>
      <P>
        Database hosting, user authentication, realtime sync, file storage, and serverless functions
        (including the AI inference orchestration layer). All data is encrypted in transit (TLS) and at
        rest. Convex is operated by Convex, Inc. on US-based infrastructure.
      </P>

      <SubTitle>Groq (Llama API)</SubTitle>
      <P>
        Powers AI features including meal analysis, diet scoring, fight week protocols, daily coaching,
        training summaries, and the AI chatbot. Meal descriptions and anonymised health context are sent
        to generate personalised responses. No personal identifiers are included in AI requests.
      </P>

      <SubTitle>RevenueCat</SubTitle>
      <P>
        Subscription management and in-app purchase processing. RevenueCat receives anonymous
        app user identifiers and purchase receipts from Apple to verify subscription status.
        No personal data, health data, or account credentials are shared with RevenueCat.
      </P>

      <SubTitle>Sentry</SubTitle>
      <P>
        Error monitoring and crash reporting. Collects technical error data only — no personal
        information, health data, or user content is sent to Sentry. PII collection is disabled.
      </P>

      <SubTitle>USDA FoodData Central</SubTitle>
      <P>
        Food nutrition database used for ingredient lookups and food search. Only search queries
        are sent — no user data.
      </P>

      <SubTitle>Open Food Facts</SubTitle>
      <P>
        Barcode-based food lookup database. Only barcode numbers are sent — no user data.
      </P>

      <SectionTitle>4. Data Storage & Security</SectionTitle>
      <BulletList items={[
        "All data is stored in Convex — every function checks the caller's identity and only allows access to that user's own rows",
        "All connections use HTTPS/TLS encryption",
        "Authentication tokens are securely stored on-device",
        "Profile photos and session media are stored in Convex File Storage and served over time-limited signed URLs",
        "We do not sell, rent, or share your personal data with advertisers or data brokers",
      ]} />

      <SectionTitle>5. Your Rights</SectionTitle>
      <BulletList items={[
        "Access: View all your data within the app at any time",
        "Export: Download your data as CSV from Settings > Reset Data > Export",
        "Deletion: Permanently delete your account and all data from Settings > Delete Account",
        "Correction: Edit your profile, weight logs, and nutrition entries at any time",
      ]} />

      <P>
        Account deletion is immediate and irreversible. All database records, authentication data,
        and stored files are permanently removed.
      </P>

      <SectionTitle>6. Data Retention</SectionTitle>
      <P>
        Your data is retained for as long as your account is active. When you delete your account,
        all data is permanently removed from our servers within 30 days (including any backups).
        Anonymised crash reports in Sentry are retained for 90 days.
      </P>

      <SectionTitle>7. Children's Privacy</SectionTitle>
      <P>
        FightCamp Wizard is not intended for users under 17 years of age. We do not knowingly
        collect data from children. If you believe a child has provided us with data, contact us
        to have it removed.
      </P>

      <SectionTitle>8. Changes to This Policy</SectionTitle>
      <P>
        We may update this policy from time to time. Changes will be reflected on this page with
        an updated date. Continued use of the app constitutes acceptance of the updated policy.
      </P>

      <SectionTitle>9. Contact</SectionTitle>
      <P>
        For privacy-related questions or data requests, email us at{" "}
        <a href="mailto:weightcutwizard@gmail.com" className="text-primary font-medium">
          weightcutwizard@gmail.com
        </a>
      </P>
    </div>
  );
}

function TermsOfService() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Terms of Service</h1>
      <LastUpdated />

      <P>
        By using FightCamp Wizard ("the app"), you agree to these terms. If you do not agree,
        do not use the app.
      </P>

      <SectionTitle>1. Service Description</SectionTitle>
      <P>
        FightCamp Wizard is a fitness and nutrition tracking application designed for combat sport
        athletes and individuals managing their weight. The app provides tools for weight tracking,
        meal logging, sleep tracking, training session management, recovery analytics,
        and AI-generated nutritional guidance.
      </P>

      <SectionTitle>2. Medical Disclaimer</SectionTitle>
      <P>
        <strong className="text-foreground">FightCamp Wizard is not a medical device and does not provide medical advice.</strong>{" "}
        All information, recommendations, and protocols generated by the app — including AI coaching,
        fight week plans, rehydration protocols, and diet analysis — are for educational and
        informational purposes only.
      </P>
      <BulletList items={[
        "Always consult a qualified physician, sports dietitian, or medical professional before starting any weight cut, dietary change, or rehydration protocol",
        "The app is not a substitute for professional medical advice, diagnosis, or treatment",
        "Stop any protocol and seek immediate medical attention if you experience dizziness, confusion, nausea, chest pain, or any adverse symptoms",
        "Weight cutting carries inherent health risks — the app helps plan and track, but you are responsible for your safety",
        "AI-generated advice is based on general sports science research and may not account for your specific medical conditions",
      ]} />

      <SectionTitle>3. Account & Eligibility</SectionTitle>
      <BulletList items={[
        "You must be at least 17 years old to use the app",
        "You are responsible for maintaining the security of your account credentials",
        "You must provide accurate information when creating your account",
        "One account per person — sharing accounts is not permitted",
      ]} />

      <SectionTitle>4. Acceptable Use</SectionTitle>
      <P>You agree not to:</P>
      <BulletList items={[
        "Use the app for any unlawful purpose",
        "Attempt to access other users' data or accounts",
        "Reverse-engineer, decompile, or extract source code from the app",
        "Abuse AI features (excessive requests, prompt injection, or automated scraping)",
        "Upload harmful, offensive, or illegal content",
        "Misrepresent the app's output as professional medical advice to others",
      ]} />

      <SectionTitle>5. AI-Generated Content</SectionTitle>
      <P>
        The app uses artificial intelligence (powered by Groq) to generate meal plans, diet analysis,
        coaching advice, and other content. AI-generated content:
      </P>
      <BulletList items={[
        "May contain inaccuracies — always verify nutritional data and recommendations",
        "Is generated from general knowledge and does not constitute professional advice",
        "Should not be relied upon as the sole basis for health or dietary decisions",
        "May vary between requests for the same input",
      ]} />

      <SectionTitle>6. Subscriptions & In-App Purchases</SectionTitle>

      <SubTitle>Free Tier</SubTitle>
      <P>
        The free tier includes weight tracking, nutrition logging, training session logging, and
        the daily-wisdom feature. AI-powered features (meal analysis, coach chat, weight insights,
        meal planning, etc.) require a Pro subscription.
      </P>

      <SubTitle>Pro Subscription</SubTitle>
      <BulletList items={[
        "Pro unlocks unlimited AI features across the app",
        "Available as a monthly or annual subscription via Apple In-App Purchase",
        "Payment is charged to your Apple ID account at confirmation of purchase",
        "Subscription automatically renews unless cancelled at least 24 hours before the end of the current billing period",
        "You can manage or cancel your subscription in your Apple ID account settings or via the app's Settings > Manage Subscription",
      ]} />

      <SubTitle>Refunds</SubTitle>
      <P>
        All purchases are processed by Apple. Refund requests must be submitted through Apple's
        support channels. We do not process refunds directly.
      </P>

      <SubTitle>Price Changes</SubTitle>
      <P>
        We may change subscription pricing. Any price change will take effect at the start of your
        next billing period after notice. You may cancel before the new price takes effect.
      </P>

      <SectionTitle>7. Data & Privacy</SectionTitle>
      <P>
        Your use of the app is also governed by our{" "}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="text-primary font-medium"
        >
          Privacy Policy
        </button>
        . By using the app, you consent to the collection and use of your data as described therein.
      </P>

      <SectionTitle>8. Intellectual Property</SectionTitle>
      <P>
        The app, its design, code, branding, and content are the intellectual property of Pratik Rai.
        You may not reproduce, distribute, or create derivative works from any part of the app
        without written permission.
      </P>

      <SectionTitle>9. Account Termination</SectionTitle>
      <BulletList items={[
        "You may delete your account at any time from Settings — this permanently removes all your data",
        "Deleting your account does not automatically cancel an active subscription — cancel via Apple ID settings first",
        "We reserve the right to suspend or terminate accounts that violate these terms",
        "Upon termination, all data associated with your account will be permanently deleted",
      ]} />

      <SectionTitle>10. Limitation of Liability</SectionTitle>
      <P>
        To the maximum extent permitted by law, FightCamp Wizard and its developers are not liable
        for any direct, indirect, incidental, or consequential damages arising from your use of the
        app. This includes but is not limited to:
      </P>
      <BulletList items={[
        "Health complications resulting from following app-generated protocols",
        "Data loss or service interruptions",
        "Inaccuracies in AI-generated content or nutritional data",
        "Third-party service outages (Convex, Groq, RevenueCat, etc.)",
      ]} />

      <SectionTitle>11. Changes to Terms</SectionTitle>
      <P>
        We may update these terms from time to time. Changes take effect when posted on this page.
        Continued use of the app after changes constitutes acceptance of the updated terms.
      </P>

      <SectionTitle>12. Governing Law</SectionTitle>
      <P>
        These terms are governed by the laws of England and Wales. Any disputes will be subject
        to the exclusive jurisdiction of the courts of England and Wales.
      </P>

      <SectionTitle>13. Contact</SectionTitle>
      <P>
        For questions about these terms, email us at{" "}
        <a href="mailto:weightcutwizard@gmail.com" className="text-primary font-medium">
          weightcutwizard@gmail.com
        </a>
      </P>
    </div>
  );
}
