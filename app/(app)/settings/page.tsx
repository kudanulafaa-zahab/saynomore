import { GodownsManager } from "@/components/masters/godowns-manager";
import { UsersManager } from "@/components/masters/users-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">System</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Settings</h1>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="godowns">Godowns</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersManager />
        </TabsContent>
        <TabsContent value="godowns">
          <GodownsManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
