import { Construction } from "lucide-react";

export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="glass p-10 text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-secondary flex items-center justify-center">
          <Construction className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {description ?? "Building this module next. The foundation is ready — your data is safe."}
        </p>
      </div>
    </div>
  );
}
