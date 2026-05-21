import { Construction } from "lucide-react";

export default function SkillTree() {
  return (
    <div className="animate-page-in flex flex-col items-center justify-center h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)] px-4 text-center">
      <div className="card-surface p-6 rounded-xs border border-border max-w-sm w-full space-y-3">
        <Construction className="h-8 w-8 text-muted-foreground mx-auto" />
        <h1 className="text-lg font-bold">Skill Tree</h1>
        <p className="text-muted-foreground text-sm">
          Coming soon — track and visualize your technique progression across disciplines.
        </p>
      </div>
    </div>
  );
}
