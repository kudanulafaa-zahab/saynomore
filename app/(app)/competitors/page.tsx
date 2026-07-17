import { Suspense } from "react";
import { CompetitorsView } from "@/components/competitors/competitors-view";
export default function Page() {
  return (
    <div className="max-w-4xl mx-auto">
      <Suspense>
        <CompetitorsView />
      </Suspense>
    </div>
  );
}
