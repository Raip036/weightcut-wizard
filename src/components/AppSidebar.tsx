import { Home, Utensils, Flag, Users, Camera, Dumbbell } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";

const menuItems = [
  { title: "Home", url: "/dashboard", icon: Home },
  { title: "Camp", url: "/camp", icon: Flag },
  { title: "Community", url: "/community", icon: Users },
  { title: "Nutrition", url: "/nutrition", icon: Utensils },
];

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  // Desktop equivalent of the mobile camera FAB. Dispatches a synchronous
  // custom event so BottomNav (which owns the capture flow) fires
  // Camera.getPhoto within the user gesture. Training is the default action;
  // Nutrition logs a meal photo.
  const quickCapture = (mode: "training" | "nutrition") => {
    window.dispatchEvent(new CustomEvent("wcw:quick-capture", { detail: { mode } }));
  };

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      {/* Brand header */}
      <SidebarHeader className="px-4 pt-5 pb-2" />

      <SidebarContent className="px-3 py-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    className="touch-target h-auto min-h-[44px] p-0"
                  >
                    <NavLink
                      to={item.url}
                      onClick={handleNavClick}
                      className={({ isActive }) =>
                        `group flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[15px] font-medium transition-all duration-200 ease-out ${
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground active:bg-sidebar-accent/70"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
                              isActive
                                ? "bg-primary/20 text-primary"
                                : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground"
                            }`}
                          >
                            <item.icon className="h-5 w-5" />
                          </span>
                          <span className="truncate">{item.title}</span>
                        </>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Quick log: desktop equivalent of the mobile camera FAB,
            placed below the nav items. */}
        <div className="px-0 pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Quick log"
                className="group flex w-full items-center gap-3 rounded-2xl bg-primary px-3.5 py-2.5 text-[15px] font-semibold text-primary-foreground shadow-sm transition-all duration-200 ease-out hover:bg-primary/90 active:scale-[0.99]"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/15">
                  <Camera className="h-5 w-5" />
                </span>
                <span className="truncate">Quick Log</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-52">
              <DropdownMenuItem onClick={() => quickCapture("training")}>
                <Dumbbell className="mr-2 h-4 w-4" />
                Log Training
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => quickCapture("nutrition")}>
                <Utensils className="mr-2 h-4 w-4" />
                Log Nutrition
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
