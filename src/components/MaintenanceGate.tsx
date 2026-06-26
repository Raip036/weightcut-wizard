import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { MaintenanceScreen } from "./MaintenanceScreen";

export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const m = useQuery(api.appConfig.getMaintenance);
  // While the flag is still loading (undefined), render the app normally so we
  // never flash the maintenance screen. Once it resolves to enabled, the whole
  // app is replaced — reactively, so toggling the Convex flag flips it live.
  if (m?.enabled) return <MaintenanceScreen message={m.message} />;
  return <>{children}</>;
}
