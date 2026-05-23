import React, { Component, ErrorInfo, ReactNode, useState } from "react";
import { motion } from "motion/react";
import { RefreshCw, RotateCw, Copy, Check, Mail, ChevronDown, ChevronUp } from "lucide-react";
import { logger } from "@/lib/logger";
import { triggerHapticSelection } from "@/lib/haptics";
import { WizardCharacter } from "@/tutorial/WizardCharacter";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /**
   * Skip the universal `logger.error` call in componentDidCatch. Use for
   * boundaries that wrap known-tolerated failures (e.g. optional Convex
   * probes that are expected to fail before `npx convex dev` runs) so the
   * console stays clean.
   */
  silent?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface DefaultFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
}

function buildErrorReport(error: Error | null, errorInfo: ErrorInfo | null): string {
  if (!error) return "";
  const stack = errorInfo?.componentStack
    ? `\n\nComponent Stack:${errorInfo.componentStack}`
    : "";
  return `${error.toString()}${stack}`;
}

function DefaultFallback({ error, errorInfo, onRetry }: DefaultFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const report = buildErrorReport(error, errorInfo);

  const handleRetry = () => {
    triggerHapticSelection();
    onRetry();
  };

  const handleReload = () => {
    triggerHapticSelection();
    window.location.reload();
  };

  const handleSupport = () => {
    triggerHapticSelection();
  };

  const handleCopy = async () => {
    triggerHapticSelection();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      logger.warn("Clipboard write failed", { err });
    }
  };

  const handleToggleDetails = () => {
    triggerHapticSelection();
    setShowDetails((v) => !v);
  };

  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center px-5 py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md overflow-hidden rounded-xs border border-border/50 bg-card/60 backdrop-blur-sm p-6 sm:p-7"
      >
        <div className="flex flex-col items-center text-center">
          <div
            className="relative shrink-0 mb-1"
            style={{ width: 96, height: 96 }}
          >
            <div
              style={{
                width: 140,
                height: 140,
                transform: "scale(0.685) translate(-32px, -22px)",
                transformOrigin: "top left",
              }}
            >
              <WizardCharacter pose="wave" />
            </div>
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
            Coach
          </p>
          <h2 className="mt-1 text-[22px] font-bold leading-tight text-foreground">
            Hmm, that didn't go to plan.
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-[20rem]">
            Something tripped up on our end. Give it another try — if it
            sticks, a quick reload usually clears it.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[14px] font-bold text-primary-foreground active:scale-[0.98] transition"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
            Try again
          </button>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleReload}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-2.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
            >
              <RotateCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              Reload
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!report}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-2.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Copy
                </>
              )}
            </button>
            <a
              href="mailto:weightcutwizard@gmail.com"
              onClick={handleSupport}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-2.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2.5} />
              Support
            </a>
          </div>
        </div>

        {error && (
          <div className="mt-5 pt-4 border-t border-border/40">
            <button
              type="button"
              onClick={handleToggleDetails}
              aria-expanded={showDetails}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition"
            >
              {showDetails ? (
                <>
                  <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
                  Hide details
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                  Show details
                </>
              )}
            </button>

            {showDetails && (
              <motion.pre
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="user-selectable mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground bg-muted/40 rounded-xs p-3 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all"
              >
                {report}
              </motion.pre>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (!this.props.silent) {
      logger.error("ErrorBoundary caught an error", error, {
        componentStack: errorInfo.componentStack,
      });
    }
    this.setState({ error, errorInfo });

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <DefaultFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
