import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Home, ArrowLeft } from "lucide-react";
import { logger } from "@/lib/logger";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    logger.warn("404: User attempted to access non-existent route", {
      path: location.pathname,
    });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground px-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div>
          <h1 className="text-6xl font-bold text-primary mb-2">404</h1>
          <p className="text-[16px] font-semibold">Page not found</p>
          <p className="text-[12px] text-muted-foreground mt-1 break-all">
            {location.pathname}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => navigate("/dashboard", { replace: true })}
            className="w-full rounded-2xl bg-primary text-primary-foreground px-4 py-3 text-[14px] font-semibold flex items-center justify-center gap-2"
          >
            <Home className="h-4 w-4" />
            Go to Dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-full rounded-2xl border border-border/50 px-4 py-3 text-[14px] font-semibold flex items-center justify-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
