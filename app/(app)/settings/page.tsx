import { GodownsManager } from "@/components/masters/godowns-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">System</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">Settings</h1>
      </div>

      <Tabs defaultValue="godowns" className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="godowns">Godowns</TabsTrigger>
          <TabsTrigger value="users" disabled>Users (soon)</TabsTrigger>
          <TabsTrigger value="preferences" disabled>Preferences (soon)</TabsTrigger>
        </TabsList>
        <TabsContent value="godowns">
          <GodownsManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
