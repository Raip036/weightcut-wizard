import { Home, Utensils, Flag, Users, RotateCcw } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import wizardLogo from "@/assets/wizard-logo.webp";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { useIsMobile } from "@/hooks/use-mobile";
import { DataResetDialog } from "@/components/DataResetDialog";


const menuItems = [
  { title: "Home", url: "/dashboard", icon: Home },
  { title: "Camp", url: "/camp", icon: Flag },
  { title: "Community", url: "/community", icon: Users },
  { title: "Nutrition", url: "/nutrition", icon: Utensils },
];

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar>
      {/* Mobile-optimized header with responsive sizing */}
      <SidebarHeader className="p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <img
            src={wizardLogo}
            alt="Wizard"
            className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0"
          />
          <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent truncate">
            Weightcut Wizard
          </h1>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 sm:px-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 sm:px-0 text-xs sm:text-sm">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="touch-target min-h-[44px]">
                    <NavLink
                      to={item.url}
                      onClick={handleNavClick}
                      className={({ isActive }) =>
                        `transition-all duration-200 ease-in-out px-3 sm:px-4 py-2.5 sm:py-2 rounded-md ${isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/50 active:bg-sidebar-accent/70"
                        }`
                      }
                    >
                      <item.icon className="h-5 w-5 sm:h-4 sm:w-4 flex-shrink-0" />
                      <span className="text-sm sm:text-base">{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Mobile-optimized footer with touch-friendly buttons */}
      <SidebarFooter className="p-3 sm:p-4 border-t safe-area-inset-bottom">
        <div className="space-y-2 sm:space-y-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 touch-target min-h-[44px] text-sm sm:text-base"
            onClick={() => setResetDialogOpen(true)}
          >
            <RotateCcw className="h-4 w-4 sm:h-4 sm:w-4 mr-2 flex-shrink-0" />
            <span className="truncate">Reset All Data</span>
          </Button>
          <div className="touch-target">
            <ProfileDropdown />
          </div>
        </div>
      </SidebarFooter>
      <DataResetDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen} />
    </Sidebar>
  );
}