import { redirect } from "next/navigation";

export default function AccessDeniedPage() {
  redirect("/welcome");
}
