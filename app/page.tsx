import { redirect } from "next/navigation";

// Middleware redirects logged-in users to /dashboard.
// Non-logged-in users hitting / get sent to /login.
export default function Home() {
  redirect("/login");
}
