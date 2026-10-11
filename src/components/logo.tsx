import { Lockup } from "@/components/brand";

/**
 * Brand lockup: the hilal holding three eggs, beside the wordmark «العش».
 * Kept for older imports; new code uses Lockup and Mark from "@/components/brand".
 */
export function Logo({ size = "lg" }: { size?: "md" | "lg" }) {
  return <Lockup height={size === "lg" ? 72 : 34} />;
}
