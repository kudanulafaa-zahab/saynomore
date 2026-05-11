import { redirect } from "next/navigation";

// Signup is disabled — accounts are created by admin invite only
export default function SignupPage() {
  redirect("/login");
}
