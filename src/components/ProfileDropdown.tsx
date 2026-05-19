import { useEffect, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { useProfile, useAuth } from "@/contexts/UserContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, Link } from "react-router-dom";
import { ProfilePictureUpload } from "./ProfilePictureUpload";

export function ProfileDropdown() {
  const { userName, avatarUrl, setUserName, setAvatarUrl } = useProfile();
  const { signOut } = useAuth();
  const user = useQuery(api.profiles.getMyAuthUser, {});
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [editedName, setEditedName] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    setEditedName(userName);
  }, [userName]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const handleUpdateProfile = async () => {
    try {
      setUserName(editedName);
      setIsProfileOpen(false);
    } catch {
      toast({
        description: "Failed to update profile",
        variant: "destructive",
      });
    }
  };

  const getInitials = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
          <Avatar className="h-8 w-8">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={userName} />}
            <AvatarFallback className="bg-primary text-primary-foreground">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium hidden md:inline">{userName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56" sideOffset={8}>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Profile Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Profile Settings</DialogTitle>
            <DialogDescription>
              View and manage your account details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Profile Picture</Label>
              <ProfilePictureUpload
                currentAvatarUrl={avatarUrl}
                onUploadSuccess={setAvatarUrl}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={user?.email || ""}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>Account Created</Label>
              <Input
                value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ""}
                disabled
                className="bg-muted"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Legal</span>
            <Link to="/legal?tab=privacy" className="hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <span>·</span>
            <Link to="/legal?tab=terms" className="hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsProfileOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateProfile}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
